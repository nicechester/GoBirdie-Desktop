use crate::apple_sync::{AppleRound, AppleRoundSummary, convert_apple_round};
use crate::models::GolfRound;

const TIMEOUT_SECS: u64 = 5;

/// Discover Android phone via mDNS (_gobirdie._tcp) or fall back to manual IP.
fn discover_host() -> Result<String, String> {
    // Try mDNS discovery first
    if let Ok(host) = discover_mdns() {
        return Ok(host);
    }
    Err("Android phone not found on network. Make sure Sync Server is enabled in GoBirdie Settings on your phone.".into())
}

fn discover_mdns() -> Result<String, String> {
    let mdns = mdns_sd::ServiceDaemon::new()
        .map_err(|e| format!("mDNS init failed: {}", e))?;

    let receiver = mdns.browse("_gobirdie._tcp.local.")
        .map_err(|e| format!("mDNS browse failed: {}", e))?;

    // Wait up to 3 seconds for a response
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    while std::time::Instant::now() < deadline {
        match receiver.recv_timeout(std::time::Duration::from_millis(500)) {
            Ok(mdns_sd::ServiceEvent::ServiceResolved(info)) => {
                if let Some(addr) = info.get_addresses().iter().next() {
                    let port = info.get_port();
                    let host = format!("{}:{}", addr, port);
                    let _ = mdns.shutdown();
                    return Ok(host);
                }
            }
            Ok(_) => continue,
            Err(_) => continue,
        }
    }
    let _ = mdns.shutdown();
    Err("mDNS timeout".into())
}

fn http_get(host: &str, path: &str) -> Result<String, String> {
    let url = format!("http://{}{}", host, path);
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let resp = client.get(&url).send()
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}: {}", resp.status(), url));
    }

    resp.text().map_err(|e| format!("HTTP read error: {}", e))
}

pub fn fetch_round_list(host: &str) -> Result<Vec<AppleRoundSummary>, String> {
    let json = http_get(host, "/api/rounds")?;
    serde_json::from_str(&json)
        .map_err(|e| format!("fetch_round_list decode: {}", e))
}

pub fn fetch_round(host: &str, id: &str) -> Result<AppleRound, String> {
    let json = http_get(host, &format!("/api/rounds/{}", id))?;
    serde_json::from_str(&json)
        .map_err(|e| format!("fetch_round decode: {}", e))
}

pub fn sync_all(host: Option<&str>) -> Result<(String, Vec<AppleRoundSummary>), String> {
    let resolved = match host {
        Some(h) => h.to_string(),
        None => discover_host()?,
    };
    let list = fetch_round_list(&resolved)?;
    Ok((resolved, list))
}

pub fn fetch_and_convert(host: &str, id: &str) -> Result<GolfRound, String> {
    let round = fetch_round(host, id)?;
    Ok(convert_apple_round(round))
}
