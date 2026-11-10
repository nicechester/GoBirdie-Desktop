use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader};
use std::sync::mpsc;
use std::thread;
use std::collections::HashMap;
use crate::mobile_sync::{MobileRound, MobileRoundSummary, convert_mobile_round};
use crate::models::GolfRound;

pub type AppleRoundSummary = MobileRoundSummary;
pub type AppleRound = MobileRound;

pub fn convert_apple_round(r: AppleRound) -> GolfRound {
    convert_mobile_round(r)
}

// ── Status events ─────────────────────────────────────────────────────────────

#[derive(Clone, serde::Serialize)]
pub struct SyncStatus {
    pub stage: String,
    pub detail: Option<String>,
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

// ── Sync result from helper ───────────────────────────────────────────────────

#[derive(serde::Deserialize)]
struct SyncResult {
    list: Vec<AppleRoundSummary>,
    rounds: HashMap<String, AppleRound>,
}

// ── Main sync function ────────────────────────────────────────────────────────

/// Sync all rounds from iPhone in a single connection.
/// Returns (list of summaries, map of id -> full round data)
pub fn sync_all_rounds<F>(mut on_status: F) -> Result<(Vec<AppleRoundSummary>, HashMap<String, AppleRound>), String>
where
    F: FnMut(SyncStatus),
{
    let binary = find_helper()?;
    let mut child = Command::new(&binary)
        .arg("sync")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to run gobirdie-sync-helper: {}", e))?;

    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;
    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;

    // Channel to collect stdout
    let (tx, rx) = mpsc::channel::<String>();

    // Read stdout in background thread
    let stdout_handle = thread::spawn(move || {
        let reader = BufReader::new(stdout);
        let mut output = String::new();
        for line in reader.lines().map_while(Result::ok) {
            output.push_str(&line);
            output.push('\n');
        }
        let _ = tx.send(output);
    });

    // Read stderr and emit status events
    let stderr_reader = BufReader::new(stderr);
    for line in stderr_reader.lines().map_while(Result::ok) {
        if line.starts_with("STATUS:") {
            let parts: Vec<&str> = line.splitn(3, ':').collect();
            let stage = parts.get(1).unwrap_or(&"").to_string();
            let detail = parts.get(2).map(|s| s.to_string());
            on_status(SyncStatus { stage, detail });
        }
        eprintln!("[sync-helper] {}", line);
    }

    let status = child.wait().map_err(|e| format!("Failed to wait for helper: {}", e))?;
    stdout_handle.join().map_err(|_| "stdout thread panicked")?;

    let output = rx.recv().map_err(|_| "Failed to receive stdout")?;

    match status.code() {
        Some(0) => {
            let result: SyncResult = serde_json::from_str(output.trim())
                .map_err(|e| format!("Failed to parse sync result: {}", e))?;
            Ok((result.list, result.rounds))
        }
        Some(1) => Err("iPhone not found on network".into()),
        Some(3) => Err("Helper usage error".into()),
        _ => Err("gobirdie-sync-helper failed".into()),
    }
}
