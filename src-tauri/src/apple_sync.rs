use std::path::PathBuf;
use std::process::Command;
use crate::mobile_sync::{MobileRound, MobileRoundSummary, convert_mobile_round};
use crate::models::GolfRound;

pub type AppleRoundSummary = MobileRoundSummary;
pub type AppleRound = MobileRound;

pub fn convert_apple_round(r: AppleRound) -> GolfRound {
    convert_mobile_round(r)
}

// ── Helper binary ─────────────────────────────────────────────────────────────

fn find_helper() -> Result<PathBuf, String> {
    let native_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/native");
    let candidates = [
        std::env::current_exe().ok()
            .and_then(|p| p.parent().map(|d| d.join(format!("gobirdie-sync-helper-{}", env!("TAURI_ENV_TARGET_TRIPLE"))))),
        Some(native_dir.join(format!("gobirdie-sync-helper-{}", env!("TAURI_ENV_TARGET_TRIPLE")))),
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
