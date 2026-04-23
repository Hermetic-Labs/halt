//! HTTP server — axum REST API for field clients (iPads/phones).
//!
//! Wraps existing Tauri commands as HTTP endpoints on port 7779.
//! Also serves the frontend `dist/` for browser-based field clients.
//!
//! Routes mirror the Python FastAPI paths exactly so the frontend
//! works identically whether connecting to Python or Rust.

use axum::{
    extract::{Json, Path},
    http::Method,
    response::IntoResponse,
    routing::{delete, get, post, put},
    Router,
};
use serde_json::Value;
use tower_http::cors::{Any, CorsLayer};

use crate::commands::*;
use crate::mesh::alerts;

/// Build the axum router with all REST endpoints.
pub fn build_router() -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
        .allow_headers(Any);

    Router::new()
        // ── Health ─────────────────────────────────────────────
        .route("/health", get(health_check))
        .route("/api/health", get(health_check))
        .route("/health/ready", get(health_ready))
        // ── Patients ──────────────────────────────────────────
        .route("/api/patients", get(list_patients_handler))
        .route("/api/patients", post(create_patient_handler))
        .route("/api/patients/{id}", get(get_patient_handler))
        .route("/api/patients/{id}", put(update_patient_handler))
        .route("/api/patients/{id}", delete(delete_patient_handler))
        .route("/api/patients/{id}/pdf", get(patient_pdf_handler))
        .route("/api/patients/{id}/export", get(patient_export_handler))
        .route("/api/reports/shift", get(shift_report_handler))
        // ── Translation ───────────────────────────────────────
        .route("/api/translate", post(translate_text_handler))
        .route("/api/translate/batch", post(translate_batch_handler))
        .route("/api/translate/status", get(translate_status_handler))
        // ── TTS ───────────────────────────────────────────────
        .route("/tts/health", get(tts_health_handler))
        .route("/tts/voices", get(tts_voices_handler))
        .route("/tts/synthesize", post(tts_synth_handler))
        .route("/tts/synthesize-multi", post(tts_synth_multi_handler))
        .route("/tts/queue-status", get(tts_queue_handler))
        // ── STT ───────────────────────────────────────────────
        .route("/stt/health", get(stt_health_handler))
        .route("/stt/listen", post(stt_listen_handler))
        // ── Inference ─────────────────────────────────────────
        .route("/inference/health", get(inference_health_handler))
        .route("/inference/models", get(inference_models_handler))
        .route("/inference/stop", post(inference_stop_handler))
        // ── Distribution ──────────────────────────────────────
        .route("/api/distribution/status", get(distribution_status_handler))
        // ── Setup ─────────────────────────────────────────────
        .route("/api/setup/status", get(setup_status_handler))
        // ── Roster ────────────────────────────────────────────
        .route("/api/roster", get(roster_list_handler))
        .route("/api/roster", post(roster_add_handler))
        .route("/api/roster/{id}", put(roster_update_handler))
        .route("/api/roster/{id}", delete(roster_delete_handler))
        // ── Tasks ─────────────────────────────────────────────
        .route("/api/tasks", get(tasks_list_handler))
        // ── Inventory ─────────────────────────────────────────
        .route("/api/inventory", get(inventory_list_handler))
        // ── Wards ─────────────────────────────────────────────
        .route("/api/wards", get(wards_list_handler))
        // ── Mesh ──────────────────────────────────────────────
        .route("/api/mesh/status", get(mesh_status_handler))
        .route("/api/mesh/clients", get(mesh_clients_handler))
        .route("/api/mesh/chat", get(chat_list_handler))
        .route("/api/mesh/chat", post(chat_send_handler))
        .route("/api/mesh/chat", delete(chat_clear_handler))
        .route("/api/mesh/announcement", post(mesh_announcement_handler))
        .route("/api/mesh/emergency", post(mesh_emergency_handler))
        .route("/api/mesh/alert", post(mesh_alert_handler))
        .route("/mesh/announcement", post(mesh_announcement_handler))
        .route("/mesh/emergency", post(mesh_emergency_handler))
        .route("/mesh/alert", post(mesh_alert_handler))
        .layer(cors)
}

// ── Health ────────────────────────────────────────────────────────────────────

async fn health_check() -> impl IntoResponse {
    Json(serde_json::to_value(health::get_health()).unwrap_or_default())
}

async fn health_ready() -> impl IntoResponse {
    Json(serde_json::json!({"status": "ready", "native": true}))
}

// ── Patients ──────────────────────────────────────────────────────────────────

async fn list_patients_handler() -> impl IntoResponse {
    Json(serde_json::to_value(patients::list_patients(None, None)).unwrap_or_default())
}

async fn create_patient_handler(Json(body): Json<Value>) -> impl IntoResponse {
    match serde_json::from_value::<patients::PatientRecord>(body) {
        Ok(record) => match patients::create_patient(record) {
            Ok(p) => Json(serde_json::to_value(p).unwrap_or_default()),
            Err(e) => Json(serde_json::json!({"error": e})),
        },
        Err(e) => Json(serde_json::json!({"error": format!("Invalid patient data: {}", e)})),
    }
}

async fn get_patient_handler(Path(id): Path<String>) -> impl IntoResponse {
    match patients::get_patient(id) {
        Ok(p) => Json(p),
        Err(e) => Json(serde_json::json!({"error": e})),
    }
}

async fn update_patient_handler(
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    match serde_json::from_value::<patients::PatientRecord>(body) {
        Ok(record) => match patients::update_patient(id, record) {
            Ok(p) => Json(serde_json::to_value(p).unwrap_or_default()),
            Err(e) => Json(serde_json::json!({"error": e})),
        },
        Err(e) => Json(serde_json::json!({"error": format!("Invalid patient data: {}", e)})),
    }
}

async fn delete_patient_handler(Path(id): Path<String>) -> impl IntoResponse {
    match patients::delete_patient(id) {
        Ok(()) => Json(serde_json::json!({"status": "deleted"})),
        Err(e) => Json(serde_json::json!({"error": e})),
    }
}

async fn patient_pdf_handler(Path(id): Path<String>) -> impl IntoResponse {
    match export::export_patient_pdf(id) {
        Ok(bytes) => Json(serde_json::json!({
            "pdf_base64": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes)
        })),
        Err(e) => Json(serde_json::json!({"error": e})),
    }
}

async fn patient_export_handler(Path(id): Path<String>) -> impl IntoResponse {
    match export::export_patient_html(id, None) {
        Ok(html) => Json(serde_json::json!({"html": html})),
        Err(e) => Json(serde_json::json!({"error": e})),
    }
}

async fn shift_report_handler() -> impl IntoResponse {
    match export::shift_report_html(None) {
        Ok(html) => Json(serde_json::json!({"html": html})),
        Err(e) => Json(serde_json::json!({"error": e})),
    }
}

// ── Translation ───────────────────────────────────────────────────────────────

async fn translate_text_handler(Json(body): Json<Value>) -> impl IntoResponse {
    let req = translate::TranslateRequest {
        text: body["text"].as_str().unwrap_or("").to_string(),
        source: body["source"].as_str().unwrap_or("en").to_string(),
        target: body["target"].as_str().unwrap_or("en").to_string(),
    };
    
    match translate::translate_text(req).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap_or_default()),
        Err(e) => Json(serde_json::json!({"error": e})),
    }
}

async fn translate_batch_handler(Json(body): Json<Value>) -> impl IntoResponse {
    let texts: Vec<String> = body["texts"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let req = translate::BatchTranslateRequest {
        texts,
        source: body["source"].as_str().unwrap_or("en").to_string(),
        target: body["target"].as_str().unwrap_or("en").to_string(),
    };
    
    match translate::translate_batch(req).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap_or_default()),
        Err(e) => Json(serde_json::json!({"error": e})),
    }
}

async fn translate_status_handler() -> impl IntoResponse {
    Json(translate::translate_status())
}

// ── TTS ───────────────────────────────────────────────────────────────────────

async fn tts_health_handler() -> impl IntoResponse {
    Json(tts::tts_health())
}

async fn tts_voices_handler() -> impl IntoResponse {
    Json(tts::tts_voices())
}

async fn tts_queue_handler() -> impl IntoResponse {
    Json(tts::tts_queue_status())
}

async fn tts_synth_handler(Json(body): Json<Value>) -> impl IntoResponse {
    let req = tts::SynthesizeRequest {
        text: body["text"].as_str().unwrap_or("").to_string(),
        voice: body["voice"].as_str().unwrap_or("af_heart").to_string(),
        speed: body["speed"].as_f64().unwrap_or(1.0) as f32,
        lang: body["lang"].as_str().unwrap_or("").to_string(),
    };
    match tts::tts_synthesize(req) {
        Ok(r) => Json(serde_json::to_value(r).unwrap_or_default()),
        Err(e) => Json(serde_json::json!({"error": e})),
    }
}

async fn tts_synth_multi_handler(Json(body): Json<Value>) -> impl IntoResponse {
    let segments: Vec<tts::SynthSegment> = body["segments"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|s| tts::SynthSegment {
                    text: s["text"].as_str().unwrap_or("").to_string(),
                    lang: s["lang"].as_str().unwrap_or("en").to_string(),
                })
                .collect()
        })
        .unwrap_or_default();
    let req = tts::MultiSynthRequest {
        segments,
        speed: body["speed"].as_f64().unwrap_or(1.0) as f32,
    };
    match tts::tts_synthesize_multi(req) {
        Ok(r) => Json(serde_json::to_value(r).unwrap_or_default()),
        Err(e) => Json(serde_json::json!({"error": e})),
    }
}

// ── STT ───────────────────────────────────────────────────────────────────────

async fn stt_health_handler() -> impl IntoResponse {
    Json(stt::stt_health())
}

async fn stt_listen_handler(body: axum::body::Bytes) -> impl IntoResponse {
    let audio = body.to_vec();
    let result = tokio::task::spawn_blocking(move || {
        stt::stt_listen_raw(audio, Some("en".to_string()))
    }).await;
    match result {
        Ok(Ok(r)) => Json(serde_json::to_value(r).unwrap_or_default()),
        Ok(Err(e)) => Json(serde_json::json!({"error": e})),
        Err(e) => Json(serde_json::json!({"error": format!("Task: {}", e)})),
    }
}

// ── Inference ─────────────────────────────────────────────────────────────────

async fn inference_health_handler() -> impl IntoResponse {
    Json(inference::inference_queue_status())
}

async fn inference_models_handler() -> impl IntoResponse {
    Json(inference::list_models())
}

async fn inference_stop_handler() -> impl IntoResponse {
    Json(inference::inference_stop())
}

// ── Distribution ──────────────────────────────────────────────────────────────

async fn distribution_status_handler() -> impl IntoResponse {
    Json(distribution::distribution_status())
}

// ── Setup ─────────────────────────────────────────────────────────────────────

async fn setup_status_handler() -> impl IntoResponse {
    Json(setup::setup_status())
}

// ── Roster ────────────────────────────────────────────────────────────────────

async fn roster_list_handler() -> impl IntoResponse {
    Json(serde_json::to_value(roster::list_roster()).unwrap_or_default())
}

async fn roster_add_handler(Json(member): Json<crate::commands::roster::RosterMember>) -> impl IntoResponse {
    match roster::add_roster_member(member) {
        Ok(r) => Json(serde_json::to_value(r).unwrap_or_default()),
        Err(e) => Json(serde_json::json!({"error": e})),
    }
}

async fn roster_update_handler(
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(member): Json<crate::commands::roster::RosterMember>,
) -> impl IntoResponse {
    match roster::update_roster_member(id, member) {
        Ok(r) => Json(serde_json::to_value(r).unwrap_or_default()),
        Err(e) => Json(serde_json::json!({"error": e})),
    }
}

async fn roster_delete_handler(axum::extract::Path(id): axum::extract::Path<String>) -> impl IntoResponse {
    match roster::delete_roster_member(id) {
        Ok(r) => Json(r),
        Err(e) => Json(serde_json::json!({"error": e})),
    }
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

async fn tasks_list_handler() -> impl IntoResponse {
    Json(serde_json::to_value(tasks::list_tasks(None)).unwrap_or_default())
}

// ── Inventory ─────────────────────────────────────────────────────────────────

async fn inventory_list_handler() -> impl IntoResponse {
    Json(serde_json::to_value(inventory::get_inventory()).unwrap_or_default())
}

// ── Wards ─────────────────────────────────────────────────────────────────────

async fn wards_list_handler() -> impl IntoResponse {
    Json(serde_json::to_value(wards::list_wards()).unwrap_or_default())
}

// ── Mesh ──────────────────────────────────────────────────────────────────────

async fn mesh_status_handler() -> impl IntoResponse {
    Json(crate::mesh::server::mesh_status())
}

async fn mesh_clients_handler() -> impl IntoResponse {
    Json(serde_json::to_value(crate::mesh::server::mesh_clients()).unwrap_or_default())
}

async fn chat_list_handler() -> impl IntoResponse {
    Json(serde_json::to_value(crate::mesh::chat::get_chat(Some(100))).unwrap_or_default())
}

async fn chat_send_handler(Json(body): Json<Value>) -> impl IntoResponse {
    let msg = crate::mesh::chat::ChatMessage {
        id: String::new(),
        sender_name: body["sender_name"].as_str().unwrap_or("").to_string(),
        sender_role: body["sender_role"].as_str().unwrap_or("").to_string(),
        message: body["message"].as_str().unwrap_or("").to_string(),
        target_name: body["target_name"].as_str().unwrap_or("").to_string(),
        timestamp: String::new(),
        reactions: serde_json::Map::new(),
        translations: serde_json::Map::new(),
        attachment: body["attachment"].as_str().unwrap_or("").to_string(),
        reply_to: body["reply_to"].as_str().unwrap_or("").to_string(),
    };
    match crate::mesh::chat::send_chat(msg) {
        Ok(r) => Json(serde_json::to_value(r).unwrap_or_default()),
        Err(e) => Json(serde_json::json!({"error": e})),
    }
}

async fn chat_clear_handler() -> impl IntoResponse {
    Json(crate::mesh::chat::clear_chat())
}

// ── Mesh Alerts ──────────────────────────────────────────────────────────────

async fn mesh_announcement_handler(Json(body): Json<Value>) -> impl IntoResponse {
    let req = alerts::AnnouncementRequest {
        message: body["message"].as_str().unwrap_or("").to_string(),
        sender_name: body["sender_name"].as_str().unwrap_or("").to_string(),
        sound: body["sound"].as_str().unwrap_or("").to_string(),
        audio_base64: body["audio_base64"].as_str().unwrap_or("").to_string(),
        translations: body["translations"].as_object().cloned().unwrap_or_default(),
    };
    match alerts::mesh_announcement(req) {
        Ok(r) => Json(r),
        Err(e) => Json(serde_json::json!({"error": e})),
    }
}

async fn mesh_emergency_handler(Json(body): Json<Value>) -> impl IntoResponse {
    let req = alerts::EmergencyRequest {
        ward: body["ward"].as_str().unwrap_or("").to_string(),
        bed: body["bed"].as_str().unwrap_or("").to_string(),
        categories: body["categories"].as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default(),
        categories_text: body["categories_text"].as_str().unwrap_or("").to_string(),
        sender_name: body["sender_name"].as_str().unwrap_or("").to_string(),
        notes: body["notes"].as_str().unwrap_or("").to_string(),
        sound: body["sound"].as_str().unwrap_or("").to_string(),
        audio_base64: body["audio_base64"].as_str().unwrap_or("").to_string(),
        message: body["message"].as_str().unwrap_or("").to_string(),
        translations: body["translations"].as_object().cloned().unwrap_or_default(),
    };
    let result = tokio::task::spawn_blocking(move || alerts::mesh_emergency(req)).await;
    match result {
        Ok(Ok(r)) => Json(r),
        Ok(Err(e)) => Json(serde_json::json!({"error": e})),
        Err(e) => Json(serde_json::json!({"error": format!("Task: {}", e)})),
    }
}

async fn mesh_alert_handler(Json(body): Json<Value>) -> impl IntoResponse {
    let req = alerts::AlertRequest {
        ward: body["ward"].as_str().unwrap_or("").to_string(),
        bed: body["bed"].as_str().unwrap_or("").to_string(),
        categories: body["categories"].as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default(),
        categories_text: body["categories_text"].as_str().unwrap_or("").to_string(),
        sender_name: body["sender_name"].as_str().unwrap_or("").to_string(),
        notes: body["notes"].as_str().unwrap_or("").to_string(),
    };
    match alerts::mesh_alert(req) {
        Ok(r) => Json(r),
        Err(e) => Json(serde_json::json!({"error": e})),
    }
}
