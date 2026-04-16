use std::path::PathBuf;
use std::process::Command;
use serde::Deserialize;
use crate::models::{
    GolfRound, GpsPoint, HoleDefinition, HoleScore, Scorecard, ShotPosition,
    GARMIN_EPOCH_OFFSET,
};

// ── Wire-format structs ───────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct AppleRoundSummary {
    pub id: String,
}

#[derive(Deserialize)]
pub struct AppleRound {
    pub id: String,
    pub source: String,
    pub course_name: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub holes: Vec<AppleHoleScore>,
}

#[derive(Deserialize)]
pub struct AppleHoleScore {
    pub number: u8,
    pub par: u8,
    pub strokes: u8,
    pub putts: u8,
    pub fairway_hit: Option<bool>,
    pub shots: Vec<AppleShot>,
}

#[derive(Deserialize)]
pub struct AppleShot {
    pub location: GpsPoint,
    pub timestamp: String,
    pub club: String,
    pub altitude_meters: Option<f64>,
    pub heart_rate_bpm: Option<u32>,
}

// ── Helper binary ─────────────────────────────────────────────────────────────

fn find_helper() -> Result<PathBuf, String> {
    let native_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/native");
    let candidates = [
        // bundled: next to the app executable (with arch suffix)
        std::env::current_exe().ok()
            .and_then(|p| p.parent().map(|d| d.join(format!("gobirdie-sync-helper-{}", env!("TAURI_ENV_TARGET_TRIPLE"))))),
        // dev: compiled with arch suffix in native dir
        Some(native_dir.join(format!("gobirdie-sync-helper-{}", env!("TAURI_ENV_TARGET_TRIPLE")))),
        // fallback: unsuffixed in native dir
        Some(native_dir.join("gobirdie-sync-helper")),
    ];
    for candidate in candidates.into_iter().flatten() {
        if candidate.exists() { return Ok(candidate); }
    }
    Err("gobirdie-sync-helper binary not found".into())
}

fn run_helper(args: &[&str]) -> Result<String, String> {
    let binary = find_helper()?;
    let output = Command::new(&binary)
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run gobirdie-sync-helper: {}", e))?;

    match output.status.code() {
        Some(0) => {},
        Some(1) => return Err("iPhone not found on network".into()),
        Some(3) => return Err("Helper usage error".into()),
        _ => {
            let err = String::from_utf8_lossy(&output.stderr);
            return Err(format!("gobirdie-sync-helper failed: {}", err));
        }
    }

    String::from_utf8(output.stdout)
        .map(|s| s.trim().to_string())
        .map_err(|e| format!("Invalid UTF-8 from helper: {}", e))
}

// ── Fetch via helper ──────────────────────────────────────────────────────────

pub fn fetch_round_list() -> Result<Vec<AppleRoundSummary>, String> {
    let json = run_helper(&["list"])?;
    serde_json::from_str(&json)
        .map_err(|e| format!("fetch_round_list decode: {}", e))
}

pub fn fetch_round(id: &str) -> Result<AppleRound, String> {
    let json = run_helper(&["round", id])?;
    serde_json::from_str(&json)
        .map_err(|e| format!("fetch_round decode: {}", e))
}

// ── Conversion (unchanged) ────────────────────────────────────────────────────

fn iso_to_garmin(s: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.timestamp() - GARMIN_EPOCH_OFFSET)
        .unwrap_or(0)
}

fn map_club(raw: &str) -> (&'static str, &'static str) {
    match raw {
        "driver"  => ("Driver",  "tee"),
        "3w"      => ("3-Wood",  "fairway_wood"),
        "5w"      => ("5-Wood",  "fairway_wood"),
        "4i"      => ("4-Iron",  "iron"),
        "5i"      => ("5-Iron",  "iron"),
        "6i"      => ("6-Iron",  "iron"),
        "7i"      => ("7-Iron",  "iron"),
        "8i"      => ("8-Iron",  "iron"),
        "9i"      => ("9-Iron",  "iron"),
        "pw"      => ("PW",      "wedge"),
        "gw"      => ("GW",      "wedge"),
        "sw"      => ("SW",      "wedge"),
        "lw"      => ("LW",      "wedge"),
        "putter"  => ("Putter",  "putt"),
        _         => ("Unknown", "unknown"),
    }
}

pub fn convert_apple_round(r: AppleRound) -> GolfRound {
    let start_ts = iso_to_garmin(&r.started_at);
    let end_ts = r.ended_at.as_deref()
        .map(iso_to_garmin)
        .unwrap_or(start_ts);
    let duration_seconds = (end_ts - start_ts).max(0) as f32;

    let mut hole_definitions: Vec<HoleDefinition> = Vec::new();
    let mut hole_scores: Vec<HoleScore> = Vec::new();
    let mut total_score: u8 = 0;
    let mut total_putts: u8 = 0;

    for hole in r.holes {
        hole_definitions.push(HoleDefinition {
            hole_number: hole.number,
            par: hole.par,
            handicap: 0,
            distance_cm: 0,
            tee_position: None,
        });

        let shots = convert_shots(&hole.shots);
        total_score  = total_score.saturating_add(hole.strokes);
        total_putts  = total_putts.saturating_add(hole.putts);

        hole_scores.push(HoleScore {
            hole_number: hole.number,
            score: hole.strokes as i8,
            putts: hole.putts as i8,
            fairway_hit: hole.fairway_hit.unwrap_or(false),
            shots,
        });
    }

    let (front_score, back_score) = split_scores(&hole_scores);

    let scorecard = Scorecard {
        course_id: 0,
        course_name: r.course_name,
        round_start_ts: start_ts,
        tee_time_ts: start_ts,
        round_end_ts: end_ts,
        front_par: 0,
        back_par: 0,
        total_par: 0,
        tee_color: String::new(),
        course_rating: 0.0,
        slope: 0,
        player_name: String::new(),
        front_score,
        back_score,
        total_score,
        total_putts,
        gir: 0,
        fairways_hit: hole_scores.iter().filter(|h| h.fairway_hit).count() as u8,
        hole_definitions,
        hole_scores,
    };

    GolfRound {
        id: r.id,
        source: r.source,
        start_ts,
        end_ts,
        duration_seconds,
        distance_meters: 0.0,
        calories: None,
        avg_heart_rate: None,
        max_heart_rate: None,
        total_ascent: None,
        total_descent: None,
        min_altitude_meters: None,
        max_altitude_meters: None,
        avg_swing_tempo: None,
        tempo_timeline: Vec::new(),
        shots: Vec::new(),
        health_timeline: Vec::new(),
        scorecard: Some(scorecard),
        clubs: Vec::new(),
    }
}

fn convert_shots(shots: &[AppleShot]) -> Vec<ShotPosition> {
    shots.windows(2).map(|w| {
        let from = w[0].location.clone();
        let to   = w[1].location.clone();
        let dist = from.distance_meters_to(&to);
        let (club_name, club_category) = map_club(&w[0].club);
        ShotPosition {
            from,
            to,
            club_id: 0,
            club_name: Some(club_name.to_string()),
            club_category: Some(club_category.to_string()),
            distance_meters: Some(dist),
            heart_rate: w[0].heart_rate_bpm.map(|v| v.min(255) as u8),
            altitude_meters: w[0].altitude_meters,
            swing_tempo: None,
            timestamp: Some(iso_to_garmin(&w[0].timestamp)),
        }
    }).chain(shots.last().map(|last| {
        let (club_name, club_category) = map_club(&last.club);
        ShotPosition {
            from: last.location.clone(),
            to: last.location.clone(),
            club_id: 0,
            club_name: Some(club_name.to_string()),
            club_category: Some(club_category.to_string()),
            distance_meters: Some(0.0),
            heart_rate: last.heart_rate_bpm.map(|v| v.min(255) as u8),
            altitude_meters: last.altitude_meters,
            swing_tempo: None,
            timestamp: Some(iso_to_garmin(&last.timestamp)),
        }
    })).collect()
}

fn split_scores(holes: &[HoleScore]) -> (u8, u8) {
    let front: u8 = holes.iter().filter(|h| h.hole_number <= 9)
        .map(|h| h.score as u8).sum();
    let back: u8  = holes.iter().filter(|h| h.hole_number > 9)
        .map(|h| h.score as u8).sum();
    (front, back)
}
