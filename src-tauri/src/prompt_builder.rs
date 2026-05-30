use serde_json::json;
use crate::models::{GolfRound, Settings};
use crate::SgData;

/// Build coaching prompt with full JSON (scorecard + shots + SG + health timeline).
pub fn build_coaching_prompt(
    round: &GolfRound,
    settings: &Settings,
    lang: &str,
    notes: Option<&str>,
    sg_data: Option<&SgData>,
) -> String {
    let sc = match &round.scorecard {
        Some(s) => s,
        None => return String::from("No scorecard data available."),
    };

    let par_map: std::collections::HashMap<u8, u8> = sc
        .hole_definitions
        .iter()
        .map(|h| (h.hole_number, h.par))
        .collect();

    let mut sorted_holes = sc.hole_scores.clone();
    sorted_holes.sort_by_key(|h| h.hole_number);

    let total_par: u8 = sorted_holes
        .iter()
        .map(|h| par_map.get(&h.hole_number).copied().unwrap_or(4))
        .sum();

    // Body battery
    let bb_samples: Vec<u8> = round.health_timeline
        .iter()
        .filter_map(|s| s.body_battery)
        .collect();
    let bb_start = bb_samples.first().copied().unwrap_or(50);
    let bb_end = bb_samples.last().copied().unwrap_or(bb_start);

    // Stress
    let stress_samples: Vec<u8> = round.health_timeline
        .iter()
        .filter_map(|s| s.stress_proxy)
        .filter(|&s| s > 0)
        .collect();
    let stress_avg = if stress_samples.is_empty() { 0 }
        else { stress_samples.iter().map(|&s| s as u32).sum::<u32>() / stress_samples.len() as u32 };
    let stress_peak = stress_samples.iter().copied().max().unwrap_or(0);

    let dt = round.start_datetime();
    let date_str = dt.format("%Y-%m-%d").to_string();

    // Compute aggregates
    let total_putts: u16 = sorted_holes.iter().map(|h| h.putts as u16).sum();
    let fw_hit: u8 = sorted_holes.iter().filter(|h| {
        let par = par_map.get(&h.hole_number).copied().unwrap_or(4);
        par != 3 && h.fairway_hit
    }).count() as u8;
    let gir_count: u8 = sorted_holes.iter().filter(|h| {
        let par = par_map.get(&h.hole_number).copied().unwrap_or(4);
        let stg = h.score as i8 - h.putts as i8;
        stg <= (par as i8 - 2)
    }).count() as u8;

    // Build scorecard with shots
    let sg_shots = sg_data.map(|sg| &sg.shots);

    let scorecard: Vec<serde_json::Value> = sorted_holes.iter().map(|hole| {
        let par = par_map.get(&hole.hole_number).copied().unwrap_or(4);
        let stg = hole.score as i8 - hole.putts as i8;
        let gir = stg <= (par as i8 - 2);

        // Build shots array
        let shots: Vec<serde_json::Value> = hole.shots.iter().enumerate().map(|(idx, shot)| {
            let mut s = json!({
                "club": shot.club_name.as_deref().unwrap_or("Unknown"),
                "dist": shot.distance_meters.map(|d| (d * 1.09361) as u16).unwrap_or(0),
            });
            if let Some(hr) = shot.heart_rate {
                s["hr"] = json!(hr);
            }
            if let Some(alt) = shot.altitude_meters {
                s["alt"] = json!((alt * 3.28084) as u16);
            }
            if let Some(tempo) = shot.swing_tempo {
                s["tempo"] = json!(format!("{:.1}:1", tempo));
            }
            // Add SG for this shot
            if let Some(sg_list) = sg_shots {
                let mut shot_idx = 0;
                for sg_shot in sg_list.iter() {
                    if sg_shot.hole == hole.hole_number {
                        if shot_idx == idx {
                            s["sg"] = json!(sg_shot.sg);
                            break;
                        }
                        shot_idx += 1;
                    }
                }
            }
            s
        }).collect();

        let mut entry = json!({
            "hole": hole.hole_number,
            "par": par,
            "score": hole.score,
            "putts": hole.putts,
            "gir": gir,
            "shots": shots,
        });
        if par != 3 {
            entry["fairway"] = json!(hole.fairway_hit);
        }
        entry
    }).collect();

    // Build health timeline (sampled ~5min intervals with tempo)
    let garmin_epoch: i64 = 631065600;
    let health_timeline: Vec<serde_json::Value> = {
        let timeline = &round.health_timeline;
        if timeline.is_empty() {
            vec![]
        } else {
            let total_secs = timeline.last().unwrap().timestamp - timeline.first().unwrap().timestamp;
            let avg_interval = if timeline.len() > 1 { total_secs as f64 / timeline.len() as f64 } else { 60.0 };
            let step = ((300.0 / avg_interval) as usize).max(1); // ~5min intervals

            // Also include tempo samples
            let tempo_ts: std::collections::HashSet<i64> = round.tempo_timeline
                .iter()
                .map(|t| t.timestamp)
                .collect();

            timeline.iter().enumerate().filter_map(|(i, s)| {
                let has_tempo = tempo_ts.contains(&s.timestamp);
                if i % step != 0 && !has_tempo {
                    return None;
                }
                let ts = s.timestamp + garmin_epoch;
                let dt = chrono::DateTime::from_timestamp(ts, 0)?;
                let time_str = dt.format("%H:%M").to_string();

                let mut entry = json!({"t": time_str});
                if let Some(hr) = s.heart_rate {
                    entry["hr"] = json!(hr);
                }
                if let Some(stress) = s.stress_proxy {
                    if stress > 0 { entry["stress"] = json!(stress); }
                }
                // Find matching tempo
                if let Some(tempo) = round.tempo_timeline.iter().find(|t| {
                    (t.timestamp - s.timestamp).abs() <= 30
                }) {
                    entry["tempo"] = json!(format!("{:.1}:1", tempo.ratio));
                }
                Some(entry)
            }).collect()
        }
    };

    // Build full JSON
    let mut data = json!({
        "date": date_str,
        "course": sc.course_name,
        "slope": sc.slope,
        "rating": sc.course_rating,
        "score": sc.total_score,
        "par": total_par,
        "holes": sorted_holes.len(),
        "duration_min": (round.duration_seconds / 60.0) as u32,
        "handicap": settings.sg_baseline,
        "hand": "left-handed",
        "avg_hr": round.avg_heart_rate.unwrap_or(0),
        "max_hr": round.max_heart_rate.unwrap_or(0),
        "body_battery": {"start": bb_start, "end": bb_end},
        "stress": {"avg": stress_avg, "peak": stress_peak},
        "total_putts": total_putts,
        "fairways_hit": fw_hit,
        "gir_count": gir_count,
        "scorecard": scorecard,
    });

    if let Some(tempo) = round.avg_swing_tempo {
        data["avg_tempo"] = json!(format!("{:.1}:1", tempo));
    }

    // Add SG summary
    if let Some(sg) = sg_data {
        data["sg"] = json!({
            "total": sg.total,
            "tee": sg.tee,
            "approach": sg.approach,
            "short_game": sg.short_game,
            "putting": sg.putting,
        });
    }

    // Add health timeline
    if !health_timeline.is_empty() {
        data["health_timeline"] = json!(health_timeline);
    }

    if let Some(n) = notes {
        if !n.trim().is_empty() {
            data["notes"] = json!(n.trim());
        }
    }

    let compact = serde_json::to_string(&data).unwrap_or_default();

    let instruction = if lang == "ko" {
        "골프 코치로서 라운드 데이터를 분석하라. 한국어로: 1) 전체 요약, 2) 강점, 3) 개선점, 4) 패턴(템포/심박수/스트레스 vs 스코어), 5) 권고(최대3개). 데이터에 없는 사실은 만들지 마라."
    } else {
        "You are a golf coach. Analyze the round data. Provide: 1) Summary, 2) Strengths, 3) Weaknesses, 4) Patterns (tempo/HR/stress vs score), 5) Recommendations (max 3). Do not invent facts."
    };

    // Verification line
    let verification = format!(
        "데이터 확인: 총타수={}, 총퍼트={}, 페어웨이={}. 이 숫자만 사용해라.",
        sc.total_score, total_putts, fw_hit
    );

    format!(
        "<|start_header_id|>system<|end_header_id|>\n{}<|eot_id|><|start_header_id|>user<|end_header_id|>\n{}\n{}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n",
        instruction, compact, verification
    )
}
