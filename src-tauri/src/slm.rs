use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncReadExt;
use tokio::process::Command;

/// Payload emitted to the frontend for each streamed token chunk.
#[derive(Clone, serde::Serialize)]
pub struct CoachingToken {
    pub text: String,
    pub done: bool,
}

/// Resolve the model path: check app data dir first, then resource dir, then src-tauri/resources (dev).
pub fn find_model(app_data_dir: &Path, resource_dir: Option<PathBuf>) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = vec![
        app_data_dir.join("gobirdie-coach-4bit"),
    ];

    if let Some(ref rd) = resource_dir {
        candidates.push(rd.join("gobirdie-coach-4bit"));
        // In dev mode Tauri resolves resource_dir to src-tauri/ — try both
        candidates.push(rd.join("resources").join("gobirdie-coach-4bit"));
    }

    // Fallback: walk up from resource_dir to find src-tauri/resources (dev mode)
    if let Some(rd) = resource_dir {
        let mut dir = rd.as_path();
        for _ in 0..5 {
            let candidate = dir.join("resources").join("gobirdie-coach-4bit");
            candidates.push(candidate);
            match dir.parent() {
                Some(p) => dir = p,
                None => break,
            }
        }
    }

    for p in &candidates {
        println!("[slm] checking model path: {:?} exists={}", p, p.exists());
    }

    candidates.into_iter().find(|p| p.exists() && p.is_dir())
}

/// Stream a coaching narrative from the fine-tuned SLM to the frontend.
/// Reads stdout byte-by-byte so each token is emitted as soon as it's generated.
/// Emits `coaching_token` events with `{ text, done }` payloads.
pub async fn stream_coaching(
    app: AppHandle,
    model_path: PathBuf,
    prompt: String,
    max_tokens: u32,
) -> Result<(), String> {
    // Signal loading state to frontend
    app.emit("coaching_token", CoachingToken { text: String::new(), done: false })
        .map_err(|e| e.to_string())?;

    let mut child = Command::new("python3")
        .args([
            "-u", "-c",
            &format!(
                "import mlx_lm; from mlx_lm.generate import make_sampler; \
                 model, tokenizer = mlx_lm.load({:?}); \
                 sampler = make_sampler(0.7); \
                 [print(r.text, end='', flush=True) for r in mlx_lm.stream_generate(model, tokenizer, prompt={:?}, max_tokens={}, sampler=sampler)]",
                model_path.to_str().unwrap_or(""),
                prompt,
                max_tokens
            ),
        ])
        .env("PYTHONUNBUFFERED", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn mlx_lm: {}", e))?;

    let mut stdout = child.stdout.take()
        .ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take();

    // Buffer handles multi-byte UTF-8 characters (Korean = 3 bytes each)
    // We accumulate bytes until we have valid UTF-8 before emitting
    let mut buf = [0u8; 64];
    let mut byte_buf: Vec<u8> = Vec::new();

    loop {
        match stdout.read(&mut buf).await {
            Ok(0) => break,
            Ok(n) => {
                byte_buf.extend_from_slice(&buf[..n]);

                // Emit only complete UTF-8 sequences
                let valid_len = match std::str::from_utf8(&byte_buf) {
                    Ok(_) => byte_buf.len(),
                    Err(e) => e.valid_up_to(),
                };

                if valid_len > 0 {
                    let chunk = String::from_utf8_lossy(&byte_buf[..valid_len]).to_string();
                    byte_buf.drain(..valid_len);

                    app.emit("coaching_token", CoachingToken {
                        text: chunk,
                        done: false,
                    }).map_err(|e| e.to_string())?;
                }
            }
            Err(e) => return Err(e.to_string()),
        }
    }

    // Flush any remaining bytes
    if !byte_buf.is_empty() {
        let chunk = String::from_utf8_lossy(&byte_buf).to_string();
        app.emit("coaching_token", CoachingToken { text: chunk, done: false })
            .map_err(|e| e.to_string())?;
    }

    child.wait().await.map_err(|e| e.to_string())?;

    // Log any stderr output for debugging
    if let Some(mut err) = stderr {
        let mut err_out = String::new();
        tokio::io::AsyncReadExt::read_to_string(&mut err, &mut err_out).await.ok();
        if !err_out.trim().is_empty() {
            eprintln!("[slm stderr] {}", err_out.trim());
        }
    }

    // Signal completion
    app.emit("coaching_token", CoachingToken {
        text: String::new(),
        done: true,
    }).map_err(|e| e.to_string())?;

    Ok(())
}
