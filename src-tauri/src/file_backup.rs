//! Local file backup: export all rounds to one JSON file, and import rounds from such a file.
//!
//! The file is a single JSON bundle `{ format_version, app_version, exported_at, rounds: [...] }`.
//! Settings, feedback and FIT files are never included.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::gdrive::{valid_round_id, FORMAT_VERSION};
use crate::models::GolfRound;
use crate::AppState;

// Error codes returned to the frontend.
pub const ERR_INVALID: &str = "file_invalid";
pub const ERR_NEWER: &str = "file_newer";
pub const ERR_TOO_LARGE: &str = "file_too_large";
pub const ERR_WRITE: &str = "file_write";

const MAX_BUNDLE_BYTES: usize = 50 * 1024 * 1024;

/// Written file. Rounds are typed so export output matches the store format.
#[derive(Serialize)]
struct BundleOut {
    format_version: u32,
    app_version: String,
    exported_at: String,
    rounds: Vec<GolfRound>,
}

/// Read file. Rounds stay as raw JSON so one bad round does not reject the whole file.
#[derive(Deserialize)]
struct BundleIn {
    format_version: u32,
    rounds: Vec<serde_json::Value>,
}

#[derive(Serialize)]
pub struct ExportFileResult {
    pub path: String,
    pub count: u32,
}

#[derive(Serialize)]
pub struct ImportFileResult {
    pub imported: u32,
    pub skipped_existing: u32,
    pub skipped_invalid: u32,
    pub failed: u32,
    pub total: u32,
}

/// Opens a save dialog, then writes all rounds to the chosen file. `None` if cancelled.
pub fn export_with_dialog(app: &AppHandle, state: &AppState) -> Result<Option<ExportFileResult>, String> {
    let default_name = format!("gobirdie-rounds-{}.json", chrono::Local::now().format("%Y%m%d-%H%M%S"));
    let Some(file) = app
        .dialog()
        .file()
        .add_filter("JSON", &["json"])
        .set_file_name(&default_name)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = file.into_path().map_err(|_| ERR_WRITE.to_string())?;

    // Snapshot under the lock, then build and write without holding it.
    let rounds = state.store.lock().unwrap().all_rounds_full();
    let count = rounds.len() as u32;
    let bundle = BundleOut {
        format_version: FORMAT_VERSION,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        exported_at: chrono::Utc::now().to_rfc3339(),
        rounds,
    };
    let json = serde_json::to_vec_pretty(&bundle).map_err(|_| ERR_WRITE.to_string())?;
    std::fs::write(&path, json).map_err(|_| ERR_WRITE.to_string())?;

    println!("[backup] exported {count} rounds to file");
    Ok(Some(ExportFileResult {
        path: path.to_string_lossy().to_string(),
        count,
    }))
}

/// Opens a file picker, then imports the chosen bundle. `None` if cancelled.
pub fn import_with_dialog(app: &AppHandle, state: &AppState, overwrite: bool) -> Result<Option<ImportFileResult>, String> {
    let Some(file) = app
        .dialog()
        .file()
        .add_filter("JSON", &["json"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = file.into_path().map_err(|_| ERR_INVALID.to_string())?;

    let size = std::fs::metadata(&path).map_err(|_| ERR_INVALID.to_string())?.len();
    if size > MAX_BUNDLE_BYTES as u64 {
        return Err(ERR_TOO_LARGE.to_string());
    }
    let json = std::fs::read_to_string(&path).map_err(|_| ERR_INVALID.to_string())?;
    import_json(state, &json, overwrite).map(Some)
}

/// Imports rounds from a bundle. Existing rounds are skipped unless `overwrite` is set.
pub fn import_json(state: &AppState, json: &str, overwrite: bool) -> Result<ImportFileResult, String> {
    if json.len() > MAX_BUNDLE_BYTES {
        return Err(ERR_TOO_LARGE.to_string());
    }
    let bundle: BundleIn = serde_json::from_str(json).map_err(|_| ERR_INVALID.to_string())?;
    if bundle.format_version > FORMAT_VERSION {
        return Err(ERR_NEWER.to_string());
    }

    let mut local_ids = state.store.lock().unwrap().all_ids();
    let total = bundle.rounds.len() as u32;
    let (mut imported, mut skipped_existing, mut skipped_invalid, mut failed) = (0u32, 0u32, 0u32, 0u32);

    for value in bundle.rounds {
        let round: GolfRound = match serde_json::from_value(value) {
            Ok(r) => r,
            Err(_) => {
                skipped_invalid += 1;
                continue;
            }
        };
        if !valid_round_id(&round.id) || round.start_ts <= 0 {
            skipped_invalid += 1;
            continue;
        }

        let exists = local_ids.contains(&round.id);
        if exists && !overwrite {
            skipped_existing += 1;
            continue;
        }

        let id = round.id.clone();
        let written = {
            let store = state.store.lock().unwrap();
            if exists {
                // Replace in place so the stored key (including any FIT-hash key) is preserved.
                store
                    .update_round(&id, |r| {
                        *r = round;
                        Ok(())
                    })
                    .map(|o| o.is_some())
            } else {
                store.save_by_id(&id, &round).map(|_| true)
            }
        };
        match written {
            Ok(true) => {
                imported += 1;
                local_ids.insert(id);
            }
            _ => failed += 1,
        }
    }

    println!("[backup] file import finished: {imported} imported, {skipped_existing} skipped, {skipped_invalid} invalid, {failed} failed");
    Ok(ImportFileResult {
        imported,
        skipped_existing,
        skipped_invalid,
        failed,
        total,
    })
}
