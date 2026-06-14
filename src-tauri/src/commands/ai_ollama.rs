//! Ollama-specific models, helpers, and Tauri commands.
//!
//! Extracted from `ai.rs` to keep file sizes within the 500-line soft limit.
//! All items are re-exported from `ai.rs` so existing import paths remain valid.

use futures_util::future::join_all;
use tauri::{AppHandle, Manager};
use crate::{AppState, AppError, app_data_dir};

// ─── Types ────────────────────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct OllamaOptions {
    pub temperature: Option<f32>,
    pub top_k: Option<u32>,
    pub top_p: Option<f32>,
    pub num_ctx: Option<u64>,
    pub num_predict: Option<i32>,
    pub repeat_penalty: Option<f32>,
    pub repeat_last_n: Option<i32>,
    pub seed: Option<i32>,
    pub mirostat: Option<u8>,
    pub mirostat_tau: Option<f32>,
    pub mirostat_eta: Option<f32>,
    pub tfs_z: Option<f32>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelPreset {
    pub id: String,
    pub name: String,
    pub description: String,
    pub options: OllamaOptions,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaModel {
    pub id: String,
    pub name: String,
    pub capabilities: Vec<String>,
    pub family: String,
    pub families: Vec<String>,
    pub context_length: Option<u64>,
    pub modelfile_num_ctx: Option<u64>,
    pub provider: String,
}

struct OllamaModelDetails {
    capabilities: Vec<String>,
    family: String,
    families: Vec<String>,
    context_length: Option<u64>,
    modelfile_num_ctx: Option<u64>,
}

/// Extracts `num_ctx` from `/api/show`'s `parameters` field (Modelfile-export
/// format: https://github.com/ollama/ollama/blob/main/docs/modelfile.mdx).
/// `None` if absent — callers fall back to `contextLength`.
fn parse_modelfile_num_ctx(json: &serde_json::Value) -> Option<u64> {
    let parameters = json.get("parameters")?.as_str()?;
    parameters.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        if parts.next()? == "num_ctx" {
            parts.next()?.parse::<u64>().ok()
        } else {
            None
        }
    })
}

// ─── Ollama helpers ────────────────────────────────────────────────────────────

pub(crate) fn parse_ollama_host(raw: &str) -> (String, u16) {
    let (scheme, rest) = if let Some(s) = raw.strip_prefix("https://") {
        ("https", s)
    } else if let Some(s) = raw.strip_prefix("http://") {
        ("http", s)
    } else {
        ("http", raw)
    };
    if let Some(colon) = rest.rfind(':') {
        let host_part = &rest[..colon];
        if let Ok(port) = rest[colon + 1..].parse::<u16>() {
            return (format!("{}://{}", scheme, host_part), port);
        }
    }
    let default_port = if scheme == "https" { 443u16 } else { 11434u16 };
    (format!("{}://{}", scheme, rest), default_port)
}

pub(crate) fn build_ollama_client(host: &str, api_key: &str) -> Result<ollama_rs::Ollama, AppError> {
    let (base_url, port) = parse_ollama_host(host);
    if !api_key.is_empty() {
        use ollama_rs::headers::{HeaderMap, AUTHORIZATION};
        let mut headers = HeaderMap::new();
        let header_val = format!("Bearer {}", api_key)
            .parse()
            .map_err(|_| AppError::Http("Invalid API key format".into()))?;
        headers.insert(AUTHORIZATION, header_val);
        Ok(ollama_rs::Ollama::new_with_request_headers(base_url, port, headers))
    } else {
        Ok(ollama_rs::Ollama::new(base_url, port))
    }
}

fn parse_show_response(json: &serde_json::Value) -> OllamaModelDetails {
    let capabilities = json["capabilities"].as_array()
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();
    let details = &json["details"];
    let family = details["family"].as_str().unwrap_or("").to_string();
    let families: Vec<String> = details["families"]
        .as_array()
        .map(|arr| {
            let mut v: Vec<String> = Vec::with_capacity(arr.len());
            for item in arr {
                if let Some(s) = item.as_str() {
                    v.push(s.to_string());
                }
            }
            v
        })
        .unwrap_or_default();
    let context_length = {
        let mi = json.get("model_info");
        let mut found: Option<u64> = None;
        if !family.is_empty() {
            found = mi.and_then(|m| m.get(format!("{}.context_length", family).as_str())).and_then(|v| v.as_u64());
        }
        if found.is_none() {
            for f in &families {
                if f == &family { continue; }
                found = mi.and_then(|m| m.get(format!("{}.context_length", f).as_str())).and_then(|v| v.as_u64());
                if found.is_some() { break; }
            }
        }
        if found.is_none() {
            if let Some(mi_obj) = mi.and_then(|v| v.as_object()) {
                for (key, val) in mi_obj {
                    if key.ends_with(".context_length") {
                        if let Some(n) = val.as_u64() { found = Some(n); break; }
                    }
                }
            }
        }
        found
    };
    let modelfile_num_ctx = parse_modelfile_num_ctx(json);
    OllamaModelDetails { capabilities, family, families, context_length, modelfile_num_ctx }
}

async fn fetch_model_details(client: &reqwest::Client, host: &str, api_key: &str, model_name: &str) -> Result<OllamaModelDetails, AppError> {
    let url = format!("{}/api/show", host);
    let mut req = client.post(&url).json(&serde_json::json!({ "model": model_name }));
    if !api_key.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", api_key));
    }
    let res = req.send().await.map_err(|e| AppError::Http(format!("/api/show request failed for {}: {}", model_name, e)))?;
    if !res.status().is_success() {
        let code = res.status().as_u16();
        let err_body = res.text().await.unwrap_or_default();
        return Err(AppError::Http(format!("Ollama /api/show returned HTTP {} for model {}: {}", code, model_name, &err_body[..err_body.len().min(200)])));
    }
    let resp_body = res.text().await.map_err(|e| AppError::Http(format!("/api/show body read failed for {}: {}", model_name, e)))?;
    let json: serde_json::Value = serde_json::from_str(&resp_body).map_err(|e| AppError::Http(format!("/api/show JSON parse failed for {}: {}", model_name, e)))?;
    Ok(parse_show_response(&json))
}

// ─── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn save_model_presets(presets: Vec<ModelPreset>, app: AppHandle) -> Result<(), AppError> {
    let path = app_data_dir(&app)?.join("model-presets.json");
    let json = serde_json::to_string_pretty(&presets)
        .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))?;
    std::fs::write(&path, json.as_bytes()).map_err(AppError::Io)
}

#[tauri::command]
pub async fn load_model_presets(app: AppHandle) -> Result<Vec<ModelPreset>, AppError> {
    let path = app_data_dir(&app)?.join("model-presets.json");
    if !path.exists() { return Ok(vec![]); }
    let json = std::fs::read_to_string(&path).map_err(AppError::Io)?;
    serde_json::from_str(&json).map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))
}

#[tauri::command]
pub async fn list_ollama_models(host: String, api_key: String, app: AppHandle) -> Result<Vec<OllamaModel>, AppError> {
    let state = app.state::<AppState>();
    let client = &state.http_client;
    let host = if host.is_empty() { "http://localhost:11434".to_string() } else { host.trim_end_matches('/').to_string() };
    let provider = if host == "https://ollama.com" { "ollama-cloud".to_string() } else { "ollama-local".to_string() };

    let ollama = build_ollama_client(&host, &api_key)?;
    let local_models = ollama.list_local_models().await.map_err(|e| AppError::Http(e.to_string()))?;
    let model_names: Vec<String> = local_models.iter().map(|m| m.name.clone()).collect();
    if model_names.is_empty() { return Ok(vec![]); }

    let client_clone = client.clone();
    let host_owned = host.to_string();
    let detail_futures: Vec<_> = model_names.iter().map(|name| {
        let name = name.clone();
        let host = host_owned.clone();
        let api_key = api_key.clone();
        let client = client_clone.clone();
        async move { (name.clone(), fetch_model_details(&client, &host, &api_key, &name).await) }
    }).collect();

    let results = join_all(detail_futures).await;

    Ok(results.into_iter().map(|(name, detail_result)| {
        match detail_result {
            Ok(d) => OllamaModel { id: name.clone(), name, capabilities: d.capabilities, family: d.family, families: d.families, context_length: d.context_length, modelfile_num_ctx: d.modelfile_num_ctx, provider: provider.clone() },
            Err(_) => OllamaModel { id: name.clone(), name, capabilities: vec![], family: String::new(), families: vec![], context_length: None, modelfile_num_ctx: None, provider: provider.clone() },
        }
    }).collect())
}