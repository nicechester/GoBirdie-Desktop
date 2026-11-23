//! Google Drive manual backup: export and import of rounds through the app-data folder.
//!
//! - OAuth 2.0 authorization code flow with PKCE over a loopback redirect (127.0.0.1).
//! - Only the refresh token is persisted, in the OS keychain. Access tokens live in memory.
//! - Scope is `drive.appdata`, so the app only touches its own files (one JSON per round).

use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::Engine;
use rand::RngCore;
use reqwest::blocking::{Client, RequestBuilder, Response};
use reqwest::header::CONTENT_TYPE;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use sha2::Digest;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::ShellExt;

use crate::models::GolfRound;
use crate::AppState;

// Error codes returned to the frontend (mapped to i18n strings there).
pub const ERR_NOT_CONFIGURED: &str = "gdrive_not_configured";
pub const ERR_NOT_CONNECTED: &str = "gdrive_not_connected";
pub const ERR_AUTH_REVOKED: &str = "gdrive_auth_revoked";
pub const ERR_AUTH_TIMEOUT: &str = "gdrive_auth_timeout";
pub const ERR_AUTH_DENIED: &str = "gdrive_auth_denied";
pub const ERR_NETWORK: &str = "gdrive_network";
pub const ERR_QUOTA: &str = "gdrive_quota";
pub const ERR_BUSY: &str = "gdrive_busy";
pub const ERR_BROWSER: &str = "gdrive_browser";
pub const ERR_SECURE_STORAGE: &str = "gdrive_secure_storage";
pub const ERR_FILE_TOO_LARGE: &str = "gdrive_file_too_large";

const KEYRING_SERVICE: &str = "com.gobirdie.desktop";
const KEYRING_ACCOUNT: &str = "gdrive-refresh-token";
const SCOPE: &str = "https://www.googleapis.com/auth/drive.appdata";
const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
const DRIVE_FILES_URL: &str = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_URL: &str = "https://www.googleapis.com/upload/drive/v3/files";
const AUTH_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_FILE_BYTES: u64 = 50 * 1024 * 1024;
pub(crate) const FORMAT_VERSION: u32 = 1;
const FILE_PREFIX: &str = "round_";
const FILE_SUFFIX: &str = ".json";
const PROGRESS_EVENT: &str = "gdrive-progress";

// ── Config ───────────────────────────────────────────────────────────────────

/// OAuth client settings. Stored in the sled store (never in `Settings`).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GDriveConfig {
    pub client_id: String,
    #[serde(default)]
    pub client_secret: Option<String>,
}

/// Stored config wins; otherwise the build-time environment variables are used.
fn resolve_config(state: &AppState) -> Option<GDriveConfig> {
    if let Some(cfg) = state.store.lock().unwrap().load_gdrive_config() {
        if !cfg.client_id.trim().is_empty() {
            return Some(cfg);
        }
    }
    let client_id = option_env!("GOBIRDIE_GOOGLE_CLIENT_ID").filter(|s| !s.is_empty())?;
    Some(GDriveConfig {
        client_id: client_id.to_string(),
        client_secret: option_env!("GOBIRDIE_GOOGLE_CLIENT_SECRET")
            .filter(|s| !s.is_empty())
            .map(str::to_string),
    })
}

pub fn set_config(state: &AppState, client_id: String, client_secret: Option<String>) -> Result<(), String> {
    let client_id = client_id.trim().to_string();
    if client_id.is_empty() {
        return Err(ERR_NOT_CONFIGURED.to_string());
    }
    let client_secret = client_secret.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    state.store.lock().unwrap().save_gdrive_config(&GDriveConfig { client_id, client_secret })
}

// ── Status ───────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct GDriveStatus {
    pub configured: bool,
    pub connected: bool,
}

pub fn status(app: &AppHandle) -> Result<GDriveStatus, String> {
    let state = app.state::<AppState>();
    Ok(GDriveStatus {
        configured: resolve_config(&state).is_some(),
        connected: refresh_entry().and_then(|e| e.get_password().map_err(|_| ())).is_ok(),
    })
}

// ── Secure storage and in-memory session ─────────────────────────────────────

fn refresh_entry() -> Result<keyring::Entry, ()> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).map_err(|_| ())
}

struct Session {
    access_token: String,
    expires_at: Instant,
}

static SESSION: Mutex<Option<Session>> = Mutex::new(None);
static BUSY: AtomicBool = AtomicBool::new(false);

/// Rejects a second backup operation while one is running.
struct BusyGuard;

impl BusyGuard {
    fn acquire() -> Result<Self, String> {
        if BUSY.swap(true, Ordering::SeqCst) {
            Err(ERR_BUSY.to_string())
        } else {
            Ok(BusyGuard)
        }
    }
}

impl Drop for BusyGuard {
    fn drop(&mut self) {
        BUSY.store(false, Ordering::SeqCst);
    }
}

fn store_session(access_token: String, expires_in: Option<u64>) {
    let lifetime = Duration::from_secs(expires_in.unwrap_or(3600));
    *SESSION.lock().unwrap() = Some(Session {
        access_token,
        expires_at: Instant::now() + lifetime,
    });
}

fn clear_session() {
    *SESSION.lock().unwrap() = None;
}

// ── OAuth (PKCE, loopback redirect) ──────────────────────────────────────────

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: Option<u64>,
    refresh_token: Option<String>,
}

fn http_client() -> Client {
    Client::builder()
        .timeout(Duration::from_secs(60))
        .user_agent("GoBirdie-Desktop")
        .build()
        .unwrap_or_else(|_| Client::new())
}

fn random_urlsafe(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buf)
}

fn pkce_challenge(verifier: &str) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(sha2::Sha256::digest(verifier.as_bytes()))
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn respond(stream: &mut TcpStream, ok: bool) {
    let body = if ok {
        "<html><body style='font-family:sans-serif'><h3>GoBirdie is connected to Google Drive.</h3><p>You can close this window.</p></body></html>"
    } else {
        "<html><body style='font-family:sans-serif'><h3>Sign-in was not completed.</h3><p>You can close this window and try again.</p></body></html>"
    };
    let status = if ok { "200 OK" } else { "400 Bad Request" };
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
}

/// Waits for the browser redirect, verifies `state`, and returns the authorization code.
fn wait_for_code(listener: &TcpListener, expected_state: &str) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|_| ERR_NETWORK.to_string())?;
    let deadline = Instant::now() + AUTH_TIMEOUT;
    loop {
        if Instant::now() >= deadline {
            return Err(ERR_AUTH_TIMEOUT.to_string());
        }
        let (mut stream, _) = match listener.accept() {
            Ok(conn) => conn,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
                continue;
            }
            Err(_) => return Err(ERR_NETWORK.to_string()),
        };
        // Accepted sockets may inherit non-blocking mode from the listener.
        let _ = stream.set_nonblocking(false);
        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));

        let mut buf = [0u8; 4096];
        let n = stream.read(&mut buf).unwrap_or(0);
        let request = String::from_utf8_lossy(&buf[..n]);
        let target = request.lines().next().unwrap_or("").split_whitespace().nth(1).unwrap_or("/");
        let parsed = match reqwest::Url::parse(&format!("http://127.0.0.1{target}")) {
            Ok(url) => url,
            Err(_) => {
                respond(&mut stream, false);
                continue;
            }
        };

        let (mut code, mut returned_state, mut error) = (None, None, None);
        for (key, value) in parsed.query_pairs() {
            match key.as_ref() {
                "code" => code = Some(value.into_owned()),
                "state" => returned_state = Some(value.into_owned()),
                "error" => error = Some(value.into_owned()),
                _ => {}
            }
        }

        if error.is_some() {
            respond(&mut stream, false);
            return Err(ERR_AUTH_DENIED.to_string());
        }
        match (code, returned_state) {
            (Some(code), Some(st)) if constant_time_eq(st.as_bytes(), expected_state.as_bytes()) => {
                respond(&mut stream, true);
                return Ok(code);
            }
            (Some(_), _) => {
                // A code without the matching state is not ours to trust.
                respond(&mut stream, false);
                return Err(ERR_AUTH_DENIED.to_string());
            }
            _ => {
                // Unrelated request (e.g. favicon): answer and keep waiting.
                respond(&mut stream, false);
            }
        }
    }
}

/// POST to the token endpoint. Maps Google's error codes to our codes; never logs bodies or tokens.
fn post_token(client: &Client, form: &[(&str, String)]) -> Result<TokenResponse, String> {
    let resp = client.post(TOKEN_URL).form(form).send().map_err(|_| ERR_NETWORK.to_string())?;
    let status = resp.status();
    if status.is_success() {
        return resp.json::<TokenResponse>().map_err(|_| ERR_NETWORK.to_string());
    }
    let error_code = resp
        .json::<serde_json::Value>()
        .ok()
        .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(str::to_string))
        .unwrap_or_default();
    println!("[gdrive] token endpoint returned HTTP {} ({})", status.as_u16(), error_code);
    Err(match error_code.as_str() {
        "invalid_grant" => ERR_AUTH_REVOKED,
        "invalid_client" => ERR_NOT_CONFIGURED,
        _ => ERR_NETWORK,
    }
    .to_string())
}

/// Full interactive sign-in. Opens the system browser and waits for the redirect.
pub fn connect(app: &AppHandle) -> Result<(), String> {
    let _busy = BusyGuard::acquire()?;
    let state = app.state::<AppState>();
    let cfg = resolve_config(&state).ok_or_else(|| ERR_NOT_CONFIGURED.to_string())?;

    let listener = TcpListener::bind("127.0.0.1:0").map_err(|_| ERR_NETWORK.to_string())?;
    let port = listener.local_addr().map_err(|_| ERR_NETWORK.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}");

    let verifier = random_urlsafe(32);
    let challenge = pkce_challenge(&verifier);
    let oauth_state = random_urlsafe(16);

    let mut url = reqwest::Url::parse(AUTH_URL).map_err(|_| ERR_BROWSER.to_string())?;
    url.query_pairs_mut()
        .append_pair("client_id", &cfg.client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", SCOPE)
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent")
        .append_pair("state", &oauth_state)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256");
    app.shell().open(url.as_str(), None).map_err(|_| ERR_BROWSER.to_string())?;

    let code = wait_for_code(&listener, &oauth_state)?;

    let client = http_client();
    let mut form = vec![
        ("client_id", cfg.client_id.clone()),
        ("code", code),
        ("code_verifier", verifier),
        ("redirect_uri", redirect_uri),
        ("grant_type", "authorization_code".to_string()),
    ];
    if let Some(secret) = &cfg.client_secret {
        form.push(("client_secret", secret.clone()));
    }
    let tokens = post_token(&client, &form)?;

    // Without a refresh token we cannot keep the session; treat as a failed connect.
    let refresh_token = tokens.refresh_token.ok_or_else(|| ERR_AUTH_DENIED.to_string())?;
    refresh_entry()
        .and_then(|e| e.set_password(&refresh_token).map_err(|_| ()))
        .map_err(|_| ERR_SECURE_STORAGE.to_string())?;
    store_session(tokens.access_token, tokens.expires_in);
    println!("[gdrive] connected");
    Ok(())
}

/// Best-effort revoke, then forget the token locally. Always succeeds locally.
pub fn disconnect(_app: &AppHandle) -> Result<(), String> {
    if let Ok(entry) = refresh_entry() {
        if let Ok(token) = entry.get_password() {
            let _ = http_client().post(REVOKE_URL).form(&[("token", token)]).send();
        }
        let _ = entry.delete_credential();
    }
    clear_session();
    println!("[gdrive] disconnected");
    Ok(())
}

// ── Drive REST client ────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct RemoteFile {
    id: String,
    name: String,
}

#[derive(Deserialize)]
struct ListResponse {
    #[serde(default)]
    files: Vec<RemoteFile>,
    #[serde(rename = "nextPageToken")]
    next_page_token: Option<String>,
}

struct Drive {
    client: Client,
    cfg: GDriveConfig,
}

impl Drive {
    fn new(app: &AppHandle) -> Result<Self, String> {
        let state = app.state::<AppState>();
        let cfg = resolve_config(&state).ok_or_else(|| ERR_NOT_CONFIGURED.to_string())?;
        Ok(Self { client: http_client(), cfg })
    }

    /// Current access token, refreshed when missing or close to expiry.
    fn access_token(&self) -> Result<String, String> {
        if let Some(s) = SESSION.lock().unwrap().as_ref() {
            if s.expires_at > Instant::now() + Duration::from_secs(60) {
                return Ok(s.access_token.clone());
            }
        }
        self.refresh()
    }

    /// Exchanges the stored refresh token. A revoked grant clears local credentials.
    fn refresh(&self) -> Result<String, String> {
        let refresh_token = refresh_entry()
            .and_then(|e| e.get_password().map_err(|_| ()))
            .map_err(|_| ERR_NOT_CONNECTED.to_string())?;
        let mut form = vec![
            ("client_id", self.cfg.client_id.clone()),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token".to_string()),
        ];
        if let Some(secret) = &self.cfg.client_secret {
            form.push(("client_secret", secret.clone()));
        }
        match post_token(&self.client, &form) {
            Ok(tokens) => {
                let token = tokens.access_token.clone();
                store_session(tokens.access_token, tokens.expires_in);
                Ok(token)
            }
            Err(e) if e == ERR_AUTH_REVOKED => {
                if let Ok(entry) = refresh_entry() {
                    let _ = entry.delete_credential();
                }
                clear_session();
                Err(ERR_AUTH_REVOKED.to_string())
            }
            Err(e) => Err(e),
        }
    }

    /// Sends an authorized request. On 401 it refreshes once and retries.
    fn send(&self, build: &dyn Fn(&Client, &str) -> RequestBuilder) -> Result<Response, String> {
        let token = self.access_token()?;
        let resp = build(&self.client, &token).send().map_err(|_| ERR_NETWORK.to_string())?;
        if resp.status() != StatusCode::UNAUTHORIZED {
            return check(resp);
        }
        let token = self.refresh()?;
        let resp = build(&self.client, &token).send().map_err(|_| ERR_NETWORK.to_string())?;
        if resp.status() == StatusCode::UNAUTHORIZED {
            return Err(ERR_AUTH_REVOKED.to_string());
        }
        check(resp)
    }

    fn list_files(&self) -> Result<Vec<RemoteFile>, String> {
        let mut files = Vec::new();
        let mut page_token: Option<String> = None;
        loop {
            let token_for_page = page_token.clone();
            let resp = self.send(&|c, t| {
                let mut req = c.get(DRIVE_FILES_URL).bearer_auth(t).query(&[
                    ("spaces", "appDataFolder"),
                    ("fields", "nextPageToken,files(id,name)"),
                    ("pageSize", "1000"),
                    ("q", "name contains 'round_'"),
                ]);
                if let Some(p) = &token_for_page {
                    req = req.query(&[("pageToken", p.as_str())]);
                }
                req
            })?;
            let body: ListResponse = resp.json().map_err(|_| ERR_NETWORK.to_string())?;
            files.extend(body.files);
            match body.next_page_token {
                Some(next) => page_token = Some(next),
                None => break,
            }
        }
        Ok(files)
    }

    /// Creates a new file (`existing == None`) or overwrites an existing one, via multipart upload.
    fn upload(&self, name: &str, data: &[u8], existing: Option<&str>) -> Result<(), String> {
        let boundary = format!("gobirdie{}", random_urlsafe(12));
        let metadata = match existing {
            Some(_) => serde_json::json!({ "name": name, "mimeType": "application/json" }),
            None => serde_json::json!({
                "name": name,
                "parents": ["appDataFolder"],
                "mimeType": "application/json"
            }),
        };
        let mut body: Vec<u8> = Vec::with_capacity(data.len() + 256);
        body.extend_from_slice(format!(
            "--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n--{boundary}\r\nContent-Type: application/json\r\n\r\n"
        ).as_bytes());
        body.extend_from_slice(data);
        body.extend_from_slice(format!("\r\n--{boundary}--").as_bytes());
        let content_type = format!("multipart/related; boundary={boundary}");
        let existing = existing.map(str::to_string);

        self.send(&|c, t| {
            let request = match &existing {
                Some(id) => c
                    .patch(format!("{DRIVE_UPLOAD_URL}/{id}"))
                    .query(&[("uploadType", "multipart")]),
                None => c.post(DRIVE_UPLOAD_URL).query(&[("uploadType", "multipart")]),
            };
            request
                .bearer_auth(t)
                .header(CONTENT_TYPE, content_type.clone())
                .body(body.clone())
        })?;
        Ok(())
    }

    fn download(&self, file_id: &str) -> Result<Vec<u8>, String> {
        let resp = self.send(&|c, t| {
            c.get(format!("{DRIVE_FILES_URL}/{file_id}"))
                .bearer_auth(t)
                .query(&[("alt", "media")])
        })?;
        if resp.content_length().map_or(false, |n| n > MAX_FILE_BYTES) {
            return Err(ERR_FILE_TOO_LARGE.to_string());
        }
        let mut buf = Vec::new();
        resp.take(MAX_FILE_BYTES + 1)
            .read_to_end(&mut buf)
            .map_err(|_| ERR_NETWORK.to_string())?;
        if buf.len() as u64 > MAX_FILE_BYTES {
            return Err(ERR_FILE_TOO_LARGE.to_string());
        }
        Ok(buf)
    }
}

/// Maps HTTP failures to our codes. Logs only the status code.
fn check(resp: Response) -> Result<Response, String> {
    let status = resp.status();
    if status.is_success() {
        return Ok(resp);
    }
    println!("[gdrive] Drive request failed: HTTP {}", status.as_u16());
    Err(if status == StatusCode::FORBIDDEN || status == StatusCode::TOO_MANY_REQUESTS {
        ERR_QUOTA
    } else {
        ERR_NETWORK
    }
    .to_string())
}

// ── Backup format and naming ─────────────────────────────────────────────────

/// On-disk payload: one envelope per round file. Settings and feedback are never included.
#[derive(Serialize, Deserialize)]
struct BackupEnvelope {
    format_version: u32,
    #[serde(default)]
    app_version: String,
    #[serde(default)]
    exported_at: String,
    round: GolfRound,
}

#[derive(Serialize)]
pub struct ExportResult {
    pub uploaded: u32,
    pub updated: u32,
    pub failed: u32,
    pub total: u32,
}

#[derive(Serialize)]
pub struct ImportResult {
    pub imported: u32,
    pub skipped_existing: u32,
    pub skipped_invalid: u32,
    pub failed: u32,
    pub total: u32,
}

/// Round ids come from FIT file hashes (hex), iPhone/Android sync (may contain '-').
/// Only these characters are accepted so the Drive file name stays predictable.
pub(crate) fn valid_round_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn file_name_for(round_id: &str) -> String {
    format!("{FILE_PREFIX}{round_id}{FILE_SUFFIX}")
}

fn round_id_from_name(name: &str) -> Option<String> {
    let id = name.strip_prefix(FILE_PREFIX)?.strip_suffix(FILE_SUFFIX)?;
    valid_round_id(id).then(|| id.to_string())
}

/// Parses and validates one backup file. `expected_id` comes from the file name.
fn parse_envelope(bytes: &[u8], expected_id: &str) -> Result<GolfRound, String> {
    let envelope: BackupEnvelope = serde_json::from_slice(bytes).map_err(|_| "parse".to_string())?;
    if envelope.format_version > FORMAT_VERSION {
        return Err("newer_format".to_string());
    }
    if envelope.round.id != expected_id {
        return Err("id_mismatch".to_string());
    }
    if envelope.round.start_ts <= 0 {
        return Err("bad_start".to_string());
    }
    Ok(envelope.round)
}

fn emit_progress(app: &AppHandle, phase: &str, done: u32, total: u32) {
    let _ = app.emit(
        PROGRESS_EVENT,
        serde_json::json!({ "phase": phase, "done": done, "total": total }),
    );
}

// ── Export and import ────────────────────────────────────────────────────────

/// Uploads every round. Existing files are overwritten, so repeat exports are idempotent.
pub fn export(app: &AppHandle) -> Result<ExportResult, String> {
    let _busy = BusyGuard::acquire()?;
    let drive = Drive::new(app)?;
    let state = app.state::<AppState>();

    // Snapshot first so the store lock is never held during network I/O.
    let rounds = state.store.lock().unwrap().all_rounds_full();
    let existing: HashMap<String, String> = drive
        .list_files()?
        .into_iter()
        .filter_map(|f| round_id_from_name(&f.name).map(|id| (id, f.id)))
        .collect();

    let total = rounds.len() as u32;
    let (mut uploaded, mut updated, mut failed) = (0u32, 0u32, 0u32);
    for (i, round) in rounds.into_iter().enumerate() {
        let round_id = round.id.clone();
        let envelope = BackupEnvelope {
            format_version: FORMAT_VERSION,
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            exported_at: chrono::Utc::now().to_rfc3339(),
            round,
        };
        let data = serde_json::to_vec(&envelope).map_err(|_| ERR_NETWORK.to_string())?;
        let file_id = existing.get(&round_id).map(String::as_str);
        match drive.upload(&file_name_for(&round_id), &data, file_id) {
            Ok(()) if file_id.is_some() => updated += 1,
            Ok(()) => uploaded += 1,
            // Revoked sign-in aborts; other per-round failures are counted and skipped.
            Err(e) if e == ERR_AUTH_REVOKED || e == ERR_NOT_CONNECTED => return Err(e),
            Err(_) => failed += 1,
        }
        emit_progress(app, "export", (i + 1) as u32, total);
    }

    println!("[gdrive] export finished: {uploaded} uploaded, {updated} updated, {failed} failed");
    Ok(ExportResult { uploaded, updated, failed, total })
}

/// Imports rounds from Drive. Existing rounds are skipped unless `overwrite` is set.
pub fn import(app: &AppHandle, overwrite: bool) -> Result<ImportResult, String> {
    let _busy = BusyGuard::acquire()?;
    let drive = Drive::new(app)?;
    let state = app.state::<AppState>();

    let remote = drive.list_files()?;
    let mut local_ids: HashSet<String> = state.store.lock().unwrap().all_ids();

    let total = remote.len() as u32;
    let (mut imported, mut skipped_existing, mut skipped_invalid, mut failed) = (0u32, 0u32, 0u32, 0u32);
    for (i, file) in remote.into_iter().enumerate() {
        match round_id_from_name(&file.name) {
            None => skipped_invalid += 1,
            Some(round_id) => {
                let exists = local_ids.contains(&round_id);
                if exists && !overwrite {
                    skipped_existing += 1;
                } else {
                    match drive.download(&file.id) {
                        Err(e) if e == ERR_AUTH_REVOKED || e == ERR_NOT_CONNECTED => return Err(e),
                        Err(_) => failed += 1,
                        Ok(bytes) => match parse_envelope(&bytes, &round_id) {
                            Err(_) => skipped_invalid += 1,
                            Ok(round) => {
                                // Overwrite replaces in place so the stored key (and any
                                // FIT-hash key) is preserved; new rounds use the id key.
                                let written = {
                                    let store = state.store.lock().unwrap();
                                    if exists {
                                        store.update_round(&round_id, |r| {
                                            *r = round;
                                            Ok(())
                                        }).map(|o| o.is_some())
                                    } else {
                                        store.save_by_id(&round_id, &round).map(|_| true)
                                    }
                                };
                                match written {
                                    Ok(true) => {
                                        imported += 1;
                                        local_ids.insert(round_id);
                                    }
                                    _ => failed += 1,
                                }
                            }
                        },
                    }
                }
            }
        }
        emit_progress(app, "import", (i + 1) as u32, total);
    }

    println!("[gdrive] import finished: {imported} imported, {skipped_existing} skipped, {skipped_invalid} invalid, {failed} failed");
    Ok(ImportResult { imported, skipped_existing, skipped_invalid, failed, total })
}
