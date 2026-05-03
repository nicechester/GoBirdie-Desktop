use sled::Db;
use sha2::Digest;
use std::path::Path;
use crate::models::{GolfRound, RoundSummary, Settings};

const SETTINGS_KEY: &[u8] = b"__app_settings__";

pub struct Store {
    db: Db,
}

impl Store {
    pub fn open(db_path: &Path) -> Result<Self, String> {
        let db = sled::open(db_path)
            .map_err(|e| format!("Failed to open store: {}", e))?;
        Ok(Self { db })
    }

    pub fn contains(&self, fit_path: &Path) -> bool {
        let key = file_hash(fit_path);
        self.db.contains_key(&key).unwrap_or(false)
    }

    pub fn save(&self, fit_path: &Path, round: &GolfRound) -> Result<(), String> {
        let key = file_hash(fit_path);
        let json = serde_json::to_vec(round)
            .map_err(|e| format!("Serialize error: {}", e))?;
        self.db.insert(key, json)
            .map_err(|e| format!("Store insert error: {}", e))?;
        self.db.flush()
            .map_err(|e| format!("Flush error: {}", e))?;
        Ok(())
    }

    pub fn load(&self, fit_path: &Path) -> Option<GolfRound> {
        let key = file_hash(fit_path);
        self.db.get(&key).ok().flatten().and_then(|bytes| {
            serde_json::from_slice(&bytes).ok()
        })
    }

    pub fn save_by_id(&self, id: &str, round: &GolfRound) -> Result<(), String> {
        let key = id_hash(id);
        let json = serde_json::to_vec(round)
            .map_err(|e| format!("Serialize error: {}", e))?;
        self.db.insert(key, json)
            .map_err(|e| format!("Store insert error: {}", e))?;
        self.db.flush()
            .map_err(|e| format!("Flush error: {}", e))?;
        Ok(())
    }

    pub fn contains_id(&self, id: &str) -> bool {
        let key = id_hash(id);
        self.db.contains_key(&key).unwrap_or(false)
    }

    pub fn load_by_id(&self, id: &str) -> Option<GolfRound> {
        // The store key is raw SHA-256 bytes; the round's id field is the hex encoding.
        // Scan all values and match by id field.
        self.db.iter()
            .filter_map(|r| r.ok())
            .filter_map(|(_, v)| serde_json::from_slice::<GolfRound>(&v).ok())
            .find(|r| r.id == id)
    }

    pub fn all_summaries(&self) -> Vec<RoundSummary> {
        let mut summaries: Vec<RoundSummary> = self.db.iter()
            .filter_map(|r| r.ok())
            .filter_map(|(_, v)| serde_json::from_slice::<GolfRound>(&v).ok())
            .filter(|r| !r.id.is_empty())
            .map(|r| RoundSummary::from(&r))
            .collect();
        summaries.sort_by(|a, b| b.date.cmp(&a.date)); // newest first
        summaries
    }

    /// Returns all rounds with scorecards but stripped of heavy fields.
    pub fn all_rounds_light(&self) -> Vec<GolfRound> {
        let mut rounds: Vec<GolfRound> = self.db.iter()
            .filter_map(|r| r.ok())
            .filter_map(|(_, v)| serde_json::from_slice::<GolfRound>(&v).ok())
            .filter(|r| !r.id.is_empty() && r.scorecard.is_some())
            .map(|mut r| {
                r.health_timeline.clear();
                r.shots.clear();
                r.tempo_timeline.clear();
                r.clubs.clear();
                r
            })
            .collect();
        rounds.sort_by(|a, b| a.start_ts.cmp(&b.start_ts));
        rounds
    }

    pub fn count(&self) -> usize {
        self.db.len()
    }

    pub fn delete_by_id(&self, id: &str) -> Result<bool, String> {
        for item in self.db.iter() {
            if let Ok((key, val)) = item {
                if let Ok(r) = serde_json::from_slice::<GolfRound>(&val) {
                    if r.id == id {
                        self.db.remove(&key)
                            .map_err(|e| format!("Delete error: {}", e))?;
                        self.db.flush()
                            .map_err(|e| format!("Flush error: {}", e))?;
                        return Ok(true);
                    }
                }
            }
        }
        Ok(false)
    }

    pub fn load_settings(&self) -> Option<Settings> {
        self.db.get(SETTINGS_KEY).ok().flatten().and_then(|bytes| {
            serde_json::from_slice(&bytes).ok()
        })
    }

    pub fn save_settings(&self, settings: &Settings) -> Result<(), String> {
        let json = serde_json::to_vec(settings)
            .map_err(|e| format!("Serialize settings error: {}", e))?;
        self.db.insert(SETTINGS_KEY, json)
            .map_err(|e| format!("Store settings error: {}", e))?;
        self.db.flush()
            .map_err(|e| format!("Flush error: {}", e))?;
        Ok(())
    }
}

fn file_hash(path: &Path) -> Vec<u8> {
    match std::fs::read(path) {
        Ok(bytes) => {
            let mut hasher = sha2::Sha256::new();
            Digest::update(&mut hasher, &bytes);
            Digest::finalize(hasher).to_vec()
        }
        Err(_) => path.to_string_lossy().as_bytes().to_vec(),
    }
}

fn id_hash(id: &str) -> Vec<u8> {
    let mut hasher = sha2::Sha256::new();
    Digest::update(&mut hasher, id.as_bytes());
    Digest::finalize(hasher).to_vec()
}
