use std::path::{Path, PathBuf};
use std::process::Command;
use serde::Deserialize;

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct MtpEntry {
    pub scorecard: String,
    pub scorecard_name: String,
    pub scorecard_mtime: i64,
    pub activity: String,
    pub activity_name: String,
    pub activity_mtime: i64,
    pub activity_size: u64,
    pub clubs_path: String,
}

/// Download up to `count` rounds starting at `offset`.
pub fn download_rounds(dest_dir: &Path, count: usize, offset: usize) -> Result<Vec<MtpEntry>, String> {
    std::fs::create_dir_all(dest_dir)
        .map_err(|e| format!("Cannot create dest dir: {}", e))?;

    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("pkill").arg("-f").arg("Android File Transfer").output();
        std::thread::sleep(std::time::Duration::from_secs(1));
    }

    let binary = find_binary()?;

    let output = Command::new(&binary)
        .arg(dest_dir.to_str().unwrap())
        .arg(count.to_string())
        .arg(offset.to_string())
        .output()
        .map_err(|e| format!("Failed to run garmin_mtp: {}", e))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("garmin_mtp failed: {}", err));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json_start = stdout.find('[').ok_or("No JSON array in output")?;
    let json_str = &stdout[json_start..];

    let entries: Vec<MtpEntry> = serde_json::from_str(json_str)
        .map_err(|e| format!("JSON parse error: {} (raw: {})", e, stdout))?;

    Ok(entries)
}

fn find_binary() -> Result<PathBuf, String> {
    let native_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/native");

    #[cfg(target_os = "windows")]
    let binary_name = "garmin_mtp_windows";
    #[cfg(not(target_os = "windows"))]
    let binary_name = "garmin_mtp";

    let candidates = [
        std::env::current_exe().ok()
            .and_then(|p| p.parent().map(|d| d.join(format!("{}-{}", binary_name, env!("TAURI_ENV_TARGET_TRIPLE"))))),
        Some(native_dir.join(format!("{}-{}", binary_name, env!("TAURI_ENV_TARGET_TRIPLE")))),
        Some(native_dir.join(binary_name)),
        #[cfg(not(target_os = "windows"))]
        Some(PathBuf::from(format!("/usr/local/bin/{}", binary_name))),
    ];
    for candidate in candidates.into_iter().flatten() {
        if candidate.exists() { return Ok(candidate); }
    }
    Err(format!("{} binary not found", binary_name))
}
