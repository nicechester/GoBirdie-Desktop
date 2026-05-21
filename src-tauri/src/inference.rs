use std::path::Path;
use tract_onnx::prelude::*;
use crate::models::{GolfRound, ClubType};

pub const INPUT_DIM: usize = 85;
pub const NUM_PATTERNS: usize = 15;

const NORM_MIN: [f32; INPUT_DIM] = [
    -4.0, 0.0, 0.0, 0.0, -5.0, 0.0, 0.0, 0.0, -4.0, 0.0, 0.0, 0.0, -3.0, 0.0, 0.0, 0.0,
    -4.0, 0.0, 0.0, 0.0, -5.0, 0.0, 0.0, 0.0, -3.0, 0.0, 0.0, 0.0, -4.0, 0.0, 0.0, 0.0,
    -4.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, -4.0, 0.0, 0.0, 0.0,
    -4.0, 0.0, 0.0, 0.0, -5.0, 0.0, 0.0, 0.0, -3.0, 0.0, 0.0, 0.0, -4.0, 0.0, 0.0, 0.0,
    -4.0, 0.0, 0.0, 0.0, -5.0, 0.0, 0.0, 0.0,
    1.0, 73.0, 1.5, 101.0, 199.0, 5.0, 10.0, 7.0, 0.5555555820465088, 20.0, 60.0, 55.0, 80.0,
];

const NORM_MAX: [f32; INPUT_DIM] = [
    5.0, 5.0, 1.0, 1.0, 5.0, 4.0, 1.0, 1.0, 5.0, 5.0, 1.0, 1.0, 5.0, 5.0, 1.0, 1.0,
    5.0, 4.0, 1.0, 1.0, 5.0, 5.0, 1.0, 1.0, 5.0, 4.0, 1.0, 1.0, 5.0, 4.0, 1.0, 1.0,
    5.0, 5.0, 1.0, 1.0, 5.0, 5.0, 1.0, 1.0, 5.0, 5.0, 1.0, 1.0, 5.0, 5.0, 1.0, 1.0,
    5.0, 5.0, 1.0, 1.0, 5.0, 4.0, 1.0, 1.0, 5.0, 4.0, 1.0, 1.0, 5.0, 4.0, 1.0, 1.0,
    5.0, 4.0, 1.0, 1.0, 5.0, 4.0, 1.0, 1.0,
    95.0, 153.0, 3.984499931335449, 174.0, 206.10000610351562, 55.0, 132.0, 18.0, 7.44444465637207, 20.0, 360.0, 75.30000305175781, 142.0,
];

pub type OnnxModel = SimplePlan<TypedFact, Box<dyn TypedOp>, Graph<TypedFact, Box<dyn TypedOp>>>;

pub fn load_model(path: &Path) -> Result<OnnxModel, String> {
    tract_onnx::onnx()
        .model_for_path(path)
        .map_err(|e| e.to_string())?
        .into_optimized()
        .map_err(|e| e.to_string())?
        .into_runnable()
        .map_err(|e| e.to_string())
}

pub fn build_feature_vector(round: &GolfRound) -> Vec<f32> {
    let mut features = vec![0.0; INPUT_DIM];

    // Per-hole features: [0..72] = 18 holes × 4 features (score_vs_par, putts, fir, gir)
    if let Some(sc) = &round.scorecard {
        // Build a par map
        let par_map: std::collections::HashMap<u8, u8> = sc
            .hole_definitions
            .iter()
            .map(|h| (h.hole_number, h.par))
            .collect();

        // Sort hole_scores by hole_number
        let mut sorted_holes = sc.hole_scores.clone();
        sorted_holes.sort_by_key(|h| h.hole_number);

        // Fill up to 18 holes
        for (i, hole) in sorted_holes.iter().enumerate().take(18) {
            let par = *par_map.get(&hole.hole_number).unwrap_or(&4) as f32;
            let score_vs_par = hole.score as f32 - par;
            let putts = hole.putts as f32;
            let fir = if hole.fairway_hit { 1.0 } else { 0.0 };
            let gir = 0.0; // not available per hole in Rust model

            let base_idx = i * 4;
            features[base_idx] = score_vs_par;
            features[base_idx + 1] = putts;
            features[base_idx + 2] = fir;
            features[base_idx + 3] = gir;
        }

        // Scalar features: [72..85]
        // [72] body_battery_start
        let body_battery_start = round.health_timeline
            .iter()
            .find_map(|s| s.body_battery)
            .unwrap_or(50) as f32;
        features[72] = body_battery_start;

        // [73] avg_heart_rate
        features[73] = round.avg_heart_rate.unwrap_or(100) as f32;

        // [74] avg_swing_tempo
        features[74] = round.avg_swing_tempo.unwrap_or(3.0);

        // [75] max_heart_rate
        features[75] = round.max_heart_rate.unwrap_or(130) as f32;

        // [76] driver_yards
        let driver_yards = round.clubs
            .iter()
            .find(|c| c.club_type == ClubType::Driver)
            .map(|c| c.avg_distance_yards() as f32)
            .unwrap_or(200.0);
        features[76] = driver_yards;

        // [77] total_putts
        features[77] = sc.total_putts as f32;

        // [78] total_score
        features[78] = sc.total_score as f32;

        // [79] total_holes
        let total_holes = sc.hole_scores.len() as f32;
        features[79] = total_holes;

        // [80] scoring_rate
        let scoring_rate = if total_holes > 0.0 {
            features[78] / total_holes
        } else {
            5.0
        };
        features[80] = scoring_rate;

        // [81] handicap (always 20.0, not in model)
        features[81] = 20.0;

        // [82] duration_min
        features[82] = round.duration_seconds / 60.0;

        // [83] course_rating
        features[83] = sc.course_rating;

        // [84] slope
        features[84] = sc.slope as f32;
    }

    // Normalize features
    let mut normalized = features.clone();
    for i in 0..INPUT_DIM {
        let min = NORM_MIN[i];
        let max = NORM_MAX[i];
        let denominator = (max - min).max(1.0); // Clamp to 1.0 if would be 0
        normalized[i] = (features[i] - min) / denominator;
    }

    normalized
}

pub fn run_inference(model: &OnnxModel, features: &[f32]) -> Result<[f32; NUM_PATTERNS], String> {
    let input = tract_ndarray::Array2::from_shape_vec((1, features.len()), features.to_vec())
        .map_err(|e| e.to_string())?;

    let result = model
        .run(tvec![input.into_tvalue()])
        .map_err(|e| e.to_string())?;

    let output = result[0]
        .to_array_view::<f32>()
        .map_err(|e| e.to_string())?;

    // The output should be shape (1, 15) or just (15,)
    let output_data = if output.shape().len() == 2 && output.shape()[0] == 1 {
        // Shape is (1, 15), extract the first row
        output.to_owned().remove_axis(tract_ndarray::Axis(0))
    } else {
        // Shape is already (15,)
        output.to_owned()
    };

    let mut result_array = [0.0f32; NUM_PATTERNS];
    for i in 0..NUM_PATTERNS {
        result_array[i] = output_data[i];
    }

    Ok(result_array)
}
