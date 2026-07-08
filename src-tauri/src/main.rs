#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod models;
mod parser;
mod store;
mod mtp;
mod inference;
mod prompt_builder;
mod slm;
mod mobile_sync;
#[cfg(not(target_os = "windows"))]
mod apple_sync;
mod android_sync;


use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use sha2::Digest;
use serde::{Serialize, Deserialize};
use models::{GolfRound, RoundSummary, ClubInfo, Settings};
use store::Store;
use tauri::{AppHandle, State};

struct AppState {
    store: Mutex<Store>,
    fit_dir: PathBuf,
    app_data_dir: PathBuf,
    clubs: Mutex<Vec<ClubInfo>>,
    elevation_cache: Mutex<HashMap<String, Option<f64>>>,
    onnx_model: Option<inference::OnnxModel>,
    slm_model_path: Option<PathBuf>,
}

fn hash_file(path: &Path) -> String {
    let bytes = std::fs::read(path).unwrap_or_default();
    let mut h = sha2::Sha256::new();
    h.update(&bytes);
    hex::encode(h.finalize())
}

fn parse_and_save(
    act_path: &Path,
    sc_path: &Path,
    clubs: &[ClubInfo],
    store: &Store,
) -> Result<RoundSummary, String> {
    if store.contains(act_path) {
        if let Some(round) = store.load(act_path) {
            return Ok(RoundSummary::from(&round));
        }
    }

    let mut round     = parser::parse_activity(act_path)?;
    let mut scorecard = parser::parse_scorecard(sc_path)?;

    // Enrich shot positions with club info + health data
    parser::enrich_shots(&mut scorecard, clubs, &round.health_timeline, &round.tempo_timeline);

    round.scorecard = Some(scorecard);
    round.clubs     = clubs.to_vec();
    round.id        = hash_file(act_path);

    let summary = RoundSummary::from(&round);
    store.save(act_path, &round)?;
    Ok(summary)
}

#[tauri::command]
async fn sync_rounds(
    count: usize,
    offset: usize,
    state: State<'_, AppState>,
) -> Result<Vec<RoundSummary>, String> {
    let fit_dir = state.fit_dir.clone();
    let entries = mtp::download_rounds(&fit_dir, count, offset)?;

    // Load clubs from the first entry's clubs_path (same file for all)
    if let Some(first) = entries.first() {
        if !first.clubs_path.is_empty() {
            let cp = Path::new(&first.clubs_path);
            if cp.exists() {
                match parser::parse_clubs(cp) {
                    Ok(loaded) => {
                        *state.clubs.lock().unwrap() = loaded;
                    }
                    Err(e) => eprintln!("clubs parse error: {}", e),
                }
            }
        }
    }

    let clubs = state.clubs.lock().unwrap().clone();
    let mut summaries = Vec::new();
    for entry in &entries {
        let sc_path  = Path::new(&entry.scorecard);
        let act_path = Path::new(&entry.activity);
        match parse_and_save(act_path, sc_path, &clubs, &state.store.lock().unwrap()) {
            Ok(s)  => summaries.push(s),
            Err(e) => eprintln!("Parse error {}: {}", entry.activity_name, e),
        }
    }
    Ok(summaries)
}

#[tauri::command]
async fn import_fit_files(
    scorecard_paths: Vec<String>,
    activity_paths: Vec<String>,
    clubs_path: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<RoundSummary>, String> {
    // Load clubs if path provided
    if let Some(cp) = clubs_path {
        if let Ok(loaded) = parser::parse_clubs(Path::new(&cp)) {
            *state.clubs.lock().unwrap() = loaded;
        }
    }
    let clubs = state.clubs.lock().unwrap().clone();

    let mut scorecards: Vec<models::Scorecard> = Vec::new();
    for path in &scorecard_paths {
        match parser::parse_scorecard(Path::new(path)) {
            Ok(sc) => scorecards.push(sc),
            Err(e) => eprintln!("Scorecard parse error {}: {}", path, e),
        }
    }

    let mut summaries = Vec::new();
    for path in &activity_paths {
        let act_path = Path::new(path);
        let store = state.store.lock().unwrap();

        if store.contains(act_path) {
            if let Some(round) = store.load(act_path) {
                summaries.push(RoundSummary::from(&round));
                continue;
            }
        }

        let mut round = match parser::parse_activity(act_path) {
            Ok(r)  => r,
            Err(e) => { eprintln!("Activity parse error {}: {}", path, e); continue; }
        };

        let matched_sc = scorecards.iter().find(|sc| {
            (sc.tee_time_ts - round.start_ts).abs() < 43200
        }).cloned();

        if let Some(mut sc) = matched_sc {
            parser::enrich_shots(&mut sc, &clubs, &round.health_timeline, &round.tempo_timeline);
            round.scorecard = Some(sc);
        }
        round.clubs = clubs.clone();
        round.id    = hash_file(act_path);

        let summary = RoundSummary::from(&round);
        store.save(act_path, &round)?;
        summaries.push(summary);
    }

    summaries.sort_by(|a, b| b.date.cmp(&a.date));
    Ok(summaries)
}

#[tauri::command]
fn get_all_rounds(state: State<'_, AppState>) -> Vec<RoundSummary> {
    state.store.lock().unwrap().all_summaries()
}

#[tauri::command]
fn get_all_rounds_light(state: State<'_, AppState>) -> Vec<GolfRound> {
    state.store.lock().unwrap().all_rounds_light()
}

#[tauri::command]
fn get_round_detail(id: String, state: State<'_, AppState>) -> Option<GolfRound> {
    state.store.lock().unwrap().load_by_id(&id)
}

#[tauri::command]
fn get_store_stats(state: State<'_, AppState>) -> serde_json::Value {
    let count = state.store.lock().unwrap().count();
    serde_json::json!({ "round_count": count })
}

#[tauri::command]
fn get_clubs(state: State<'_, AppState>) -> Vec<ClubInfo> {
    state.clubs.lock().unwrap().clone()
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Option<Settings> {
    state.store.lock().unwrap().load_settings()
}

#[tauri::command]
fn save_settings(settings: Settings, state: State<'_, AppState>) -> Result<(), String> {
    state.store.lock().unwrap().save_settings(&settings)
}

#[tauri::command]
fn delete_round(id: String, state: State<'_, AppState>) -> Result<bool, String> {
    state.store.lock().unwrap().delete_by_id(&id)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
async fn sync_apple_rounds(state: State<'_, AppState>) -> Result<Vec<RoundSummary>, String> {
    let list = apple_sync::fetch_round_list()?;

    let mut new_summaries = Vec::new();
    for summary in list {
        {
            let store = state.store.lock().unwrap();
            if store.contains_id(&summary.id) {
                continue;
            }
        }

        let full = apple_sync::fetch_round(&summary.id)?;
        let round = apple_sync::convert_apple_round(full);
        let rs = RoundSummary::from(&round);
        state.store.lock().unwrap().save_by_id(&summary.id, &round)?;
        new_summaries.push(rs);
    }

    Ok(new_summaries)
}

#[cfg(target_os = "windows")]
#[tauri::command]
async fn sync_apple_rounds() -> Result<Vec<RoundSummary>, String> {
    Err("iPhone sync is not available on Windows".into())
}

#[tauri::command]
fn get_platform() -> &'static str {
    #[cfg(target_os = "windows")] { "windows" }
    #[cfg(target_os = "macos")] { "macos" }
    #[cfg(target_os = "linux")] { "linux" }
}

#[tauri::command]
fn get_is_apple_silicon() -> bool {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))] { true }
    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))] { false }
}

#[tauri::command]
fn get_app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
async fn sync_android_rounds(state: State<'_, AppState>) -> Result<Vec<RoundSummary>, String> {
    let (host, list) = android_sync::sync_all(None)?;

    let mut new_summaries = Vec::new();
    for summary in list {
        {
            let store = state.store.lock().unwrap();
            if store.contains_id(&summary.id) {
                continue;
            }
        }

        let round = android_sync::fetch_and_convert(&host, &summary.id)?;
        let rs = RoundSummary::from(&round);
        state.store.lock().unwrap().save_by_id(&summary.id, &round)?;
        new_summaries.push(rs);
    }

    Ok(new_summaries)
}

/// WiFi sync for both Android and iPhone (uses mDNS + HTTP, works on all platforms).
/// iPhone requires Sync Server enabled in GoBirdie iOS Settings.
#[tauri::command]
async fn sync_mobile_wifi(host: Option<String>, state: State<'_, AppState>) -> Result<Vec<RoundSummary>, String> {
    let (resolved_host, list) = android_sync::sync_all(host.as_deref())?;

    let mut new_summaries = Vec::new();
    for summary in list {
        {
            let store = state.store.lock().unwrap();
            if store.contains_id(&summary.id) {
                continue;
            }
        }
        let round = android_sync::fetch_and_convert(&resolved_host, &summary.id)?;
        let rs = RoundSummary::from(&round);
        state.store.lock().unwrap().save_by_id(&summary.id, &round)?;
        new_summaries.push(rs);
    }

    Ok(new_summaries)
}
#[tauri::command]
async fn fetch_elevations(locations: Vec<String>, state: State<'_, AppState>) -> Result<Vec<Option<f64>>, String> {
    if locations.is_empty() {
        return Ok(Vec::new());
    }

    // Partition into cached hits and uncached misses
    let mut results: Vec<Option<f64>> = vec![None; locations.len()];
    let mut uncached: Vec<(usize, String)> = Vec::new();
    {
        let cache = state.elevation_cache.lock().unwrap();
        for (i, loc) in locations.iter().enumerate() {
            match cache.get(loc) {
                Some(&elev) => results[i] = elev,
                None => uncached.push((i, loc.clone())),
            }
        }
    }
    if uncached.is_empty() {
        return Ok(results);
    }

    // Fetch only uncached locations
    let to_fetch: Vec<String> = uncached.iter().map(|(_, l)| l.clone()).collect();
    let fetched = fetch_elevations_raw(&to_fetch).await?;

    // Write back into results + cache
    let mut cache = state.elevation_cache.lock().unwrap();
    for (j, (orig_idx, loc)) in uncached.iter().enumerate() {
        let elev = fetched[j];
        results[*orig_idx] = elev;
        cache.insert(loc.clone(), elev);
    }

    Ok(results)
}

/// Raw API fetch — no caching, just batched HTTP calls with retry.
async fn fetch_elevations_raw(locations: &[String]) -> Result<Vec<Option<f64>>, String> {
    let datasets = ["ned10m", "srtm30m"];
    let batch_size = 100;
    let max_retries = 3;

    for dataset in &datasets {
        let mut all: Vec<Option<f64>> = Vec::new();
        let mut ok = true;

        for chunk in locations.chunks(batch_size) {
            let url = format!(
                "https://api.opentopodata.org/v1/{}?locations={}",
                dataset, chunk.join("|")
            );

            let mut attempt = 0;
            let mut done = false;
            while attempt < max_retries && !done {
                match reqwest::Client::new().get(&url).send().await {
                    Ok(resp) => match resp.json::<serde_json::Value>().await {
                        Ok(data) if data["status"].as_str() == Some("OK") => {
                            if let Some(arr) = data["results"].as_array() {
                                let batch: Vec<Option<f64>> = arr.iter().map(|r| r["elevation"].as_f64()).collect();
                                if batch.iter().all(|e| e.is_some()) {
                                    all.extend(batch);
                                    done = true;
                                } else { attempt += 1; }
                            } else { attempt += 1; }
                        }
                        _ => { attempt += 1; }
                    },
                    Err(_) => { attempt += 1; }
                }
                if !done && attempt < max_retries {
                    std::thread::sleep(std::time::Duration::from_millis(1000 * 2_u64.pow(attempt as u32 - 1)));
                }
            }
            if !done { ok = false; break; }
            if chunk.len() == batch_size {
                std::thread::sleep(std::time::Duration::from_millis(1100));
            }
        }
        if ok && all.len() == locations.len() { return Ok(all); }
    }
    Ok(vec![None; locations.len()])
}

#[allow(dead_code)]
fn try_load_clubs(state: &AppState) -> Result<(), String> {
    // Look for Clubs.fit in the fit_dir
    let clubs_path = state.fit_dir.join("Clubs.fit");
    if clubs_path.exists() {
        let loaded = parser::parse_clubs(&clubs_path)?;
        *state.clubs.lock().unwrap() = loaded;
    }
    Ok(())
}

#[derive(serde::Serialize)]
pub struct PatternVector {
    pub driver_slice_risk: f32,
    pub driver_pull_hook_risk: f32,
    pub tee_shot_tempo_rush: f32,
    pub iron_contact_error: f32,
    pub mid_range_inconsistency: f32,
    pub wedge_distance_control: f32,
    pub bunker_escape_failure: f32,
    pub putting_3putt_risk: f32,
    pub long_putt_tempo_issue: f32,
    pub short_putt_alignment_miss: f32,
    pub fatigue_late_release: f32,
    pub mental_snowball_effect: f32,
    pub par5_overaggressive: f32,
    pub course_rating_stress: f32,
    pub score_anxiety_collapse: f32,
}

#[tauri::command]
fn infer_patterns(id: String, state: State<'_, AppState>) -> Option<PatternVector> {
    let model = state.onnx_model.as_ref()?;
    let round = state.store.lock().unwrap().load_by_id(&id)?;
    let features = inference::build_feature_vector(&round);
    let probs = inference::run_inference(model, &features).ok()?;
    Some(PatternVector {
        driver_slice_risk:         probs[0],
        driver_pull_hook_risk:     probs[1],
        tee_shot_tempo_rush:       probs[2],
        iron_contact_error:        probs[3],
        mid_range_inconsistency:   probs[4],
        wedge_distance_control:    probs[5],
        bunker_escape_failure:     probs[6],
        putting_3putt_risk:        probs[7],
        long_putt_tempo_issue:     probs[8],
        short_putt_alignment_miss: probs[9],
        fatigue_late_release:      probs[10],
        mental_snowball_effect:    probs[11],
        par5_overaggressive:       probs[12],
        course_rating_stress:      probs[13],
        score_anxiety_collapse:    probs[14],
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SgShotData {
    pub hole: u8,
    pub club: String,
    pub dist: u16,
    pub sg: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SgData {
    pub total: f32,
    pub tee: f32,
    pub approach: f32,
    pub short_game: f32,
    pub putting: f32,
    pub shots: Vec<SgShotData>,
}

#[tauri::command]
async fn generate_coaching_report(
    id: String,
    lang: String,
    notes: Option<String>,
    sg_data: Option<SgData>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let model_path = state.slm_model_path.clone()
        .ok_or("SLM model not found. Copy gobirdie-coach-4bit into the app data directory.")?;

    let round = state.store.lock().unwrap().load_by_id(&id)
        .ok_or("Round not found")?;

    let settings = state.store.lock().unwrap().load_settings()
        .unwrap_or_default();

    let prompt = prompt_builder::build_coaching_prompt(&round, &settings, &lang, notes.as_deref(), sg_data.as_ref());

    slm::stream_coaching(app, model_path, prompt, 2500).await
}

#[tauri::command]
fn save_feedback(round_id: String, code: String, helpful: bool, state: State<'_, AppState>) -> Result<(), String> {
    let path = state.app_data_dir.join("feedback.json");
    let mut entries: Vec<serde_json::Value> = path.exists()
        .then(|| std::fs::read_to_string(&path).ok())
        .flatten()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    entries.retain(|e| !(e["round_id"] == round_id && e["code"] == code));
    entries.push(serde_json::json!({ "round_id": round_id, "code": code, "helpful": helpful, "ts": ts }));
    std::fs::write(&path, serde_json::to_string_pretty(&entries).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_round_feedback(round_id: String, state: State<'_, AppState>) -> serde_json::Value {
    let path = state.app_data_dir.join("feedback.json");
    let entries: Vec<serde_json::Value> = path.exists()
        .then(|| std::fs::read_to_string(&path).ok())
        .flatten()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let map: serde_json::Map<String, serde_json::Value> = entries.into_iter()
        .filter(|e| e["round_id"] == round_id)
        .filter_map(|e| Some((e["code"].as_str()?.to_string(), e["helpful"].clone())))
        .collect();
    serde_json::Value::Object(map)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            use tauri::Manager;

            let app_dir = dirs::data_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("go-birdie-desktop");
            std::fs::create_dir_all(&app_dir).ok();

            let db_path = app_dir.join("rounds.db");
            let fit_dir = app_dir.join("fit-files");
            std::fs::create_dir_all(&fit_dir).ok();

            let store = Store::open(&db_path).expect("Failed to open store");

            // Try to load clubs from fit_dir on startup
            let clubs = fit_dir.join("Clubs.fit");
            let initial_clubs = if clubs.exists() {
                parser::parse_clubs(&clubs).unwrap_or_default()
            } else {
                Vec::new()
            };

            // Load ONNX model
            let model_path = app_dir.join("gobirdie_patterns.onnx");
            let resource_dir = app.path().resource_dir().ok();
            let resource_path = resource_dir.as_ref()
                .map(|p| p.join("resources").join("gobirdie_patterns.onnx"));

            let onnx_model = model_path.exists()
                .then(|| inference::load_model(&model_path).ok()).flatten()
                .or_else(|| resource_path.as_deref()
                    .filter(|p| p.exists())
                    .and_then(|p| inference::load_model(p).ok()));

            // Resolve SLM model path
            let slm_model_path = slm::find_model(&app_dir, resource_dir.clone());
            if slm_model_path.is_some() {
                println!("SLM model found: {:?}", slm_model_path);
            } else {
                println!("SLM model not found — coaching narrative unavailable");
            }


            app.manage(AppState {
                store: Mutex::new(store),
                fit_dir,
                app_data_dir: app_dir,
                clubs: Mutex::new(initial_clubs),
                elevation_cache: Mutex::new(HashMap::new()),
                onnx_model,
                slm_model_path,
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            sync_rounds,
            import_fit_files,
            get_all_rounds,
            get_all_rounds_light,
            get_round_detail,
            get_store_stats,
            get_clubs,
            get_settings,
            save_settings,
            get_platform,
            get_app_version,
            #[cfg(not(target_os = "windows"))]
            sync_apple_rounds,
            #[cfg(not(target_os = "windows"))]
            sync_android_rounds,
            sync_mobile_wifi,
            delete_round,
            fetch_elevations,
            infer_patterns,
            save_feedback,
            get_round_feedback,
            generate_coaching_report,
            get_is_apple_silicon,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
