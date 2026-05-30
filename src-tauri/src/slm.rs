use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaModel};
use llama_cpp_2::sampling::LlamaSampler;
use tauri::{AppHandle, Emitter};

#[derive(Clone, serde::Serialize)]
pub struct CoachingToken {
    pub text: String,
    pub done: bool,
}

/// Find the GGUF model file in standard locations.
pub fn find_model(app_data_dir: &Path, resource_dir: Option<PathBuf>) -> Option<PathBuf> {
    let model_name = "gobirdie-bllossom-Q4_K_M.gguf";

    let mut candidates: Vec<PathBuf> = vec![
        app_data_dir.join(model_name),
    ];

    if let Some(ref rd) = resource_dir {
        candidates.push(rd.join("resources").join(model_name));
        candidates.push(rd.join(model_name));
    }

    if let Some(rd) = resource_dir {
        let mut dir = rd.as_path();
        for _ in 0..5 {
            candidates.push(dir.join("resources").join(model_name));
            match dir.parent() {
                Some(p) => dir = p,
                None => break,
            }
        }
    }

    for p in &candidates {
        println!("[slm] checking model path: {:?} exists={}", p, p.exists());
    }

    candidates.into_iter().find(|p| p.exists() && p.is_file())
}

/// Stream coaching tokens via Tauri events using llama.cpp native inference.
pub async fn stream_coaching(
    app: AppHandle,
    model_path: PathBuf,
    prompt: String,
    max_tokens: u32,
) -> Result<(), String> {
    app.emit("coaching_token", CoachingToken { text: String::new(), done: false })
        .map_err(|e| e.to_string())?;

    let app_clone = app.clone();

    tokio::task::spawn_blocking(move || {
        run_inference_blocking(&app_clone, &model_path, &prompt, max_tokens)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
    .map_err(|e| {
        let _ = app.emit("coaching_token", CoachingToken { text: String::new(), done: true });
        e
    })?;

    app.emit("coaching_token", CoachingToken { text: String::new(), done: true })
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn run_inference_blocking(
    app: &AppHandle,
    model_path: &Path,
    prompt: &str,
    max_tokens: u32,
) -> Result<(), String> {
    let backend = LlamaBackend::init().map_err(|e| format!("Backend init: {}", e))?;

    let model_params = LlamaModelParams::default();
    let model = LlamaModel::load_from_file(&backend, model_path, &model_params)
        .map_err(|e| format!("Model load: {}", e))?;

    let n_batch: usize = 512;

    let ctx_params = LlamaContextParams::default()
        .with_n_ctx(NonZeroU32::new(6144))
        .with_n_batch(n_batch as u32);

    let mut ctx = model.new_context(&backend, ctx_params)
        .map_err(|e| format!("Context create: {}", e))?;

    let tokens = model.str_to_token(prompt, AddBos::Always)
        .map_err(|e| format!("Tokenize: {}", e))?;

    let n_prompt = tokens.len();
    println!("[slm] prompt tokens: {}", n_prompt);

    // Evaluate prompt in chunks of n_batch
    let mut batch = LlamaBatch::new(n_batch, 1);
    let mut pos = 0;
    while pos < n_prompt {
        batch.clear();
        let end = (pos + n_batch).min(n_prompt);
        for i in pos..end {
            let is_last = i == n_prompt - 1;
            batch.add(tokens[i], i as i32, &[0], is_last)
                .map_err(|e| format!("Batch add: {}", e))?;
        }
        ctx.decode(&mut batch).map_err(|e| format!("Decode prompt chunk: {}", e))?;
        pos = end;
    }

    // Sampler: repetition penalty + top_p + temp + dist
    let mut sampler = LlamaSampler::chain_simple([
        LlamaSampler::penalties(64, 1.05, 0.0, 0.0),
        LlamaSampler::top_p(0.9, 1),
        LlamaSampler::temp(0.5),
        LlamaSampler::dist(42),
    ]);

    let eot_token = model.token_eos();
    let mut decoder = encoding_rs::UTF_8.new_decoder();
    let mut full_text = String::new();

    for i in 0..max_tokens {
        let token = sampler.sample(&ctx, -1);
        sampler.accept(token);

        if token == eot_token {
            break;
        }

        let piece = model.token_to_piece(token, &mut decoder, false, None)
            .map_err(|e| format!("Token to str: {}", e))?;

        full_text.push_str(&piece);
        if full_text.contains("<|eot_id|>") {
            break;
        }

        app.emit("coaching_token", CoachingToken { text: piece, done: false })
            .map_err(|e| e.to_string())?;

        // Prepare next decode step
        batch.clear();
        batch.add(token, (n_prompt as i32) + (i as i32), &[0], true)
            .map_err(|e| format!("Batch add gen: {}", e))?;

        ctx.decode(&mut batch).map_err(|e| format!("Decode gen: {}", e))?;
    }

    Ok(())
}
