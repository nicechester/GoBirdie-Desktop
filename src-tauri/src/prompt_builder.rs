use crate::models::{GolfRound, Settings};

/// Assembles the user-facing coaching prompt from a GolfRound.
/// Mirrors the Python round_to_prompt_context() logic exactly.
pub fn build_coaching_prompt(round: &GolfRound, settings: &Settings, lang: &str) -> String {
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
    let over_par = sc.total_score as i16 - total_par as i16;
    let over_par_str = if over_par >= 0 {
        format!("+{}", over_par)
    } else {
        over_par.to_string()
    };

    let body_battery = round.health_timeline
        .iter()
        .find_map(|s| s.body_battery)
        .unwrap_or(50);

    let dt = round.start_datetime();
    let date_str = dt.format("%Y-%m-%d").to_string();

    let mut lines: Vec<String> = Vec::new();

    lines.push("## Round Summary".into());
    lines.push(format!("Date: {}", date_str));
    lines.push(format!(
        "Course: {} (Slope {}, Rating {:.1})",
        sc.course_name, sc.slope, sc.course_rating
    ));
    lines.push(format!(
        "Score: {} ({}) over par {}",
        sc.total_score, over_par_str, total_par
    ));
    lines.push(format!(
        "Holes: {}, Duration: {} min",
        sorted_holes.len(),
        (round.duration_seconds / 60.0) as u32
    ));

    if let Some(hr) = round.avg_heart_rate {
        lines.push(format!("Avg HR: {} bpm", hr));
    }
    lines.push(format!("Body Battery start: {}%", body_battery));
    if let Some(tempo) = round.avg_swing_tempo {
        lines.push(format!("Avg swing tempo: {:.1}:1", tempo));
    }

    lines.push(String::new());
    lines.push("## Player Profile".into());
    lines.push(format!("Handicap: {}", settings.sg_baseline));
    lines.push("Dominant hand: left-handed".into());

    lines.push(String::new());
    lines.push("## Hole-by-Hole Scorecard".into());
    lines.push("Hole | Par | Score | +/- | Putts | FW | GIR".into());
    lines.push("-----|-----|-------|-----|-------|----|----".into());

    for hole in &sorted_holes {
        let par = par_map.get(&hole.hole_number).copied().unwrap_or(4);
        let diff = hole.score as i16 - par as i16;
        let diff_str = if diff >= 0 { format!("+{}", diff) } else { diff.to_string() };
        let fw = if par == 3 { "n/a" } else if hole.fairway_hit { "Y" } else { "N" };
        // GIR: strokes to green <= par - 2
        let strokes_to_green = hole.score - hole.putts;
        let gir = if strokes_to_green <= (par as i8 - 2) { "Y" } else { "N" };
        lines.push(format!(
            "H{} | {} | {} | {} | {} | {} | {}",
            hole.hole_number, par, hole.score, diff_str, hole.putts, fw, gir
        ));
    }
    lines.push(format!(
        "Total | {} | {} | {} | {} | | ",
        total_par, sc.total_score, over_par_str, sc.total_putts
    ));

    let context = lines.join("\n");

    // Wrap in the user prompt for the selected language
    if lang == "ko" {
        format!(
            "나의 골프 라운드를 종합적으로 분석하고 성과, 패턴, 개선 방향에 대한 인사이트를 제공해줘.\n\n{}\n\n다음을 한국어로 제공해줘: 1) 전체 성과 요약, 2) 잘한 점, 3) 개선이 필요한 부분, 4) 패턴 (템포, 심박수, 스트레스 vs 스코어), 5) 구체적인 권고사항.\n글자 수 안내나 분량 지시는 절대 출력하지 마라.",
            context
        )
    } else {
        format!(
            "Please analyze my golf round comprehensively and provide insights on performance, patterns, and areas for improvement.\n\n{}\n\nPlease provide: 1) Overall performance summary, 2) Strengths, 3) Areas for improvement, 4) Patterns (tempo, HR, stress vs score), 5) Specific recommendations.",
            context
        )
    }
}
