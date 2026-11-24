//! Google Drive manual backup: export and import of rounds through the app-data folder.
//!
//! - OAuth 2.0 authorization code flow with PKCE over a loopback redirect (127.0.0.1).
//! - Only the refresh token is persisted, in the OS keychain. Access tokens live in memory.
//! - Scope is `drive.appdata`, so the app only touches its own files (one JSON per round).

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
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;

use crate::file_backup;
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
pub const ERR_INVALID_NAME: &str = "gdrive_invalid_name";
pub const ERR_FILE_EXISTS: &str = "gdrive_file_exists";

const KEYRING_SERVICE: &str = "com.gobirdie.desktop";
const KEYRING_ACCOUNT: &str = "gdrive-refresh-token";
const SCOPE: &str = "https://www.googleapis.com/auth/drive.file";
const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
const DRIVE_FILES_URL: &str = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_URL: &str = "https://www.googleapis.com/upload/drive/v3/files";
const AUTH_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_FILE_BYTES: u64 = 50 * 1024 * 1024;
pub(crate) const FORMAT_VERSION: u32 = 1;
const FOLDER_NAME: &str = "GoBirdie Backups";
const FOLDER_MIME: &str = "application/vnd.google-apps.folder";

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

/// A file or folder in Drive. Only files the app created (or opened via the picker) are visible
/// under `drive.file`, which is why backups live in a folder the app creates.
#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct RemoteFile {
    pub id: String,
    pub name: String,
    #[serde(rename = "modifiedTime", default)]
    pub modified_time: Option<String>,
    #[serde(default)]
    pub size: Option<String>,
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

    /// Lists files matching a Drive query (`q`). Follows pagination.
    fn list_files(&self, q: &str) -> Result<Vec<RemoteFile>, String> {
        let mut files = Vec::new();
        let mut page_token: Option<String> = None;
        loop {
            let token_for_page = page_token.clone();
            let resp = self.send(&|c, t| {
                let mut req = c.get(DRIVE_FILES_URL).bearer_auth(t).query(&[
                    ("q", q),
                    ("fields", "nextPageToken,files(id,name,modifiedTime,size)"),
                    ("pageSize", "100"),
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

    /// Creates a folder under My Drive and returns its id.
    fn create_folder(&self, name: &str) -> Result<String, String> {
        let body = serde_json::json!({ "name": name, "mimeType": FOLDER_MIME });
        let resp = self.send(&|c, t| {
            c.post(DRIVE_FILES_URL).bearer_auth(t).json(&body)
        })?;
        let created: RemoteFile = resp.json().map_err(|_| ERR_NETWORK.to_string())?;
        Ok(created.id)
    }

    /// Creates a file in `parent` (or overwrites `existing`) via multipart upload. Returns its id.
    fn upload(&self, name: &str, data: &[u8], parent: &str, existing: Option<&str>) -> Result<String, String> {
        let boundary = format!("gobirdie{}", random_urlsafe(12));
        let metadata = match existing {
            Some(_) => serde_json::json!({ "name": name, "mimeType": "application/json" }),
            None => serde_json::json!({
                "name": name,
                "parents": [parent],
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

        let resp = self.send(&|c, t| {
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
        let created: RemoteFile = resp.json().map_err(|_| ERR_NETWORK.to_string())?;
        Ok(created.id)
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

// ── Backup folder and file names ─────────────────────────────────────────────

/// Round ids come from FIT file hashes (hex) or iPhone/Android sync (may contain '-' or '_').
pub(crate) fn valid_round_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Escapes a value for a Drive `q` string literal.
fn q_literal(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\'', "\\'")
}

/// Accepts a plain file name ending in .json, with no path separators.
fn sanitize_file_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    let ok = !trimmed.is_empty()
        && trimmed.len() <= 120
        && !trimmed.contains(['/', '\\', '\0'])
        && trimmed.to_lowercase().ends_with(".json");
    if ok {
        Ok(trimmed.to_string())
    } else {
        Err(ERR_INVALID_NAME.to_string())
    }
}

/// Finds the "GoBirdie Backups" folder in My Drive, creating it on first use.
fn ensure_folder(drive: &Drive) -> Result<String, String> {
    let q = format!(
        "name = '{}' and mimeType = '{}' and 'root' in parents and trashed = false",
        q_literal(FOLDER_NAME),
        FOLDER_MIME
    );
    if let Some(folder) = drive.list_files(&q)?.into_iter().next() {
        return Ok(folder.id);
    }
    drive.create_folder(FOLDER_NAME)
}

// ── Export and import (one bundle file per backup) ───────────────────────────

#[derive(Serialize)]
pub struct ExportResult {
    pub name: String,
    pub count: u32,
}

/// Uploads all rounds as one file named `name` in the backup folder.
/// An existing file with the same name is not overwritten; the user picks another name.
pub fn export(app: &AppHandle, name: String) -> Result<ExportResult, String> {
    let _busy = BusyGuard::acquire()?;
    let name = sanitize_file_name(&name)?;
    let drive = Drive::new(app)?;
    let state = app.state::<AppState>();
    let folder = ensure_folder(&drive)?;

    let clash = drive.list_files(&format!(
        "name = '{}' and '{}' in parents and trashed = false",
        q_literal(&name),
        folder
    ))?;
    if !clash.is_empty() {
        return Err(ERR_FILE_EXISTS.to_string());
    }

    let (bytes, count) = file_backup::bundle_bytes(&state)?;
    drive.upload(&name, &bytes, &folder, None)?;
    println!("[gdrive] exported {count} rounds to backup folder");
    Ok(ExportResult { name, count })
}

/// Lists the backup files in the app's folder, newest first.
pub fn list_backups(app: &AppHandle) -> Result<Vec<RemoteFile>, String> {
    let drive = Drive::new(app)?;
    let folder = ensure_folder(&drive)?;
    let mut files: Vec<RemoteFile> = drive
        .list_files(&format!(
            "'{}' in parents and mimeType != '{}' and trashed = false",
            folder, FOLDER_MIME
        ))?
        .into_iter()
        .filter(|f| f.name.to_lowercase().ends_with(".json"))
        .collect();
    files.sort_by(|a, b| b.modified_time.cmp(&a.modified_time));
    Ok(files)
}

/// Downloads one chosen backup and imports it. Existing rounds are kept unless `overwrite` is set.
pub fn import(app: &AppHandle, file_id: String, overwrite: bool) -> Result<file_backup::ImportFileResult, String> {
    let _busy = BusyGuard::acquire()?;
    let drive = Drive::new(app)?;
    let bytes = drive.download(&file_id)?;
    let json = String::from_utf8(bytes).map_err(|_| file_backup::ERR_INVALID.to_string())?;
    let state = app.state::<AppState>();
    file_backup::import_json(&state, &json, overwrite)
}
