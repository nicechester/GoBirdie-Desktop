use crate::models::{GolfRound, Settings};
use crate::SgData;

const DOMAIN_CONSTRAINTS: &str = "
[필수 도메인 및 계산 규칙 - 절대 준수]
1. 스코어 용어 절대 매핑:
   - Par 대비 타수가 -2 이면 무조건 'Eagle' (파3 홀에서 -2는 홀인원/이글)
   - Par 대비 타수가 -1 이면 무조건 'Birdie'
   - Par 대비 타수가  0 이면 무조건 'Par'
   - Par 대비 타수가 +1 이면 무조건 'Bogey'
   - Par 대비 타수가 +2 이면 무조건 'Double Bogey'
   텍스트 피드백 작성 시, 스코어카드 테이블에 명시된 'Score Type' 용어를 그대로 인용하고 임의로 계산하거나 바꾸지 마십시오.

2. 핸디캡 및 난이도 해석:
   - 코스 레이팅(Course Rating)과 슬로프 레이팅(Slope Rating)이 높을수록 어려운 코스입니다.
   - 핸디캡이 낮은 싱글/스크래치 골퍼(핸디캡 0 내외)가 어려운 코스(Slope 135~140 이상)에서 +4 내외의 스코어를 기록한 것은 본인의 실력을 훌륭히 방어한 성과입니다. 이를 '언더퍼포먼스'나 '실패한 라운드'로 오해하여 혹평하지 마십시오. 코스 난이도를 반드시 감안하세요.

3. 수치 일관성:
   - 전반(Front) 및 후반(Back) 스코어의 합이 전체 총점(Total Score)과 완벽히 일치하는지 확인하고 피드백에 언급하십시오. 환각으로 인한 모순된 숫자를 절대 적지 마십시오.
";

fn score_type(diff: i8) -> &'static str {
    match diff {
        i8::MIN..=-3 => "Albatross",
        -2 => "Eagle",
        -1 => "Birdie",
        0  => "Par",
        1  => "Bogey",
        2  => "Double Bogey",
        3  => "Triple Bogey",
        _  => "+4 Over Par",
    }
}

pub fn build_coaching_prompt(
    round: &GolfRound,
    settings: &Settings,
    lang: &str,
    notes: Option<&str>,
    _sg_data: Option<&SgData>,
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

    let total_par: i32 = sorted_holes
        .iter()
        .map(|h| par_map.get(&h.hole_number).copied().unwrap_or(4) as i32)
        .sum();

    let total_putts: u32 = sorted_holes.iter().map(|h| h.putts as u32).sum();
    let total_score = sc.total_score as i32;
    let over_par = total_score - total_par;

    let n_holes = sorted_holes.len();
    let front: Vec<_> = sorted_holes.iter().filter(|h| h.hole_number <= 9).collect();
    let back: Vec<_> = sorted_holes.iter().filter(|h| h.hole_number > 9).collect();
    let front_score: i32 = front.iter().map(|h| h.score as i32).sum();
    let back_score: i32 = back.iter().map(|h| h.score as i32).sum();

    let dt = round.start_datetime();
    let date_str = dt.format("%Y-%m-%d").to_string();

    // Summary block — matches format_round_for_haiku exactly
    let mut user_msg = format!(
        "## Round Summary\nDate: {}\nCourse: {} (Rating {:.1}, Slope {})\nYour Handicap: {}\nScore: {} ({}{}) over par {}\n",
        date_str,
        sc.course_name,
        sc.course_rating,
        sc.slope,
        settings.sg_baseline,
        total_score,
        if over_par >= 0 { "+" } else { "" },
        over_par,
        total_par,
    );

    if n_holes == 18 {
        user_msg.push_str(&format!("Front: {} | Back: {}\n", front_score, back_score));
    }

    user_msg.push_str(&format!(
        "Holes: {}, Duration: {} min\nAvg HR: {} bpm, Max HR: {} bpm\n",
        n_holes,
        (round.duration_seconds / 60.0) as u32,
        round.avg_heart_rate.unwrap_or(0),
        round.max_heart_rate.unwrap_or(0),
    ));

    // Scorecard table — matches format_round_for_haiku exactly
    user_msg.push_str("\n## Hole-by-Hole Scorecard\nHole | Par | Score | +/- | Score Type | Putts\n-----|-----|-------|-----|------------|------\n");

    for hole in &sorted_holes {
        let par = par_map.get(&hole.hole_number).copied().unwrap_or(4) as i8;
        let diff = hole.score as i8 - par;
        user_msg.push_str(&format!(
            "H{:02} | {} | {} | {:+} | {} | {}\n",
            hole.hole_number, par, hole.score, diff,
            score_type(diff), hole.putts
        ));
    }

    // Optional notes
    if let Some(n) = notes {
        let n = n.trim();
        if !n.is_empty() {
            user_msg.push_str(&format!("\nNotes: {}\n", n));
        }
    }

    // Verification anchor
    let fw_hit: u8 = sorted_holes.iter().filter(|h| {
        let par = par_map.get(&h.hole_number).copied().unwrap_or(4);
        par != 3 && h.fairway_hit
    }).count() as u8;

    let verification = format!(
        "데이터 확인: 총타수={}, 총퍼트={}, 페어웨이={}. 이 숫자만 사용해라.",
        sc.total_score, total_putts, fw_hit
    );

    let instruction = if lang == "ko" {
        format!(
            "당신은 골프 코치입니다. 라운드를 분석해서 공백 제외 400~600자(약 250-300단어) 내외의 피드백을 제공해주세요.\n지정된 분량 안에서 반드시 명확한 개선점과 문장의 완결(마무리 마침표)을 지어 응답을 끝마쳐야 하며, 문장이 잘린 채로 종료되어서는 안 됩니다.\n\n1. 전체 성과 vs 핸디캡 (코스 난이도/슬로프 고려 필수)\n2. 잘한 점과 개선 필요 부분 (구체적 홀/수치 인용)\n3. 심박수 패턴과 스코어 연관성\n4. 한 가지 실천 포커스\n\n구체적으로 수치를 인용해주세요. 지레짐작으로 스코어 용어를 혼동하지 마십시오.\n{}",
            DOMAIN_CONSTRAINTS
        )
    } else {
        format!(
            "You are a golf coach. Analyze the round and provide 150-200 word feedback.\nEnsure the text is fully completed and wraps up with a clear conclusion within this length limit. Do not cut off mid-sentence.\n\n1. Overall performance vs handicap (Consider Course Difficulty/Slope)\n2. Key strengths and areas to improve (cite specific holes/metrics)\n3. Heart rate patterns and correlation to score\n4. One actionable practice focus\n\nBe direct. Cite numbers. No generic advice.\n{}",
            DOMAIN_CONSTRAINTS
        )
    };

    format!(
        "<|start_header_id|>system<|end_header_id|>\n{}<|eot_id|><|start_header_id|>user<|end_header_id|>\n{}\n{}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n",
        instruction, user_msg, verification
    )
}
