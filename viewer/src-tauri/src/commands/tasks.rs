//! Tasks — field task board with self-service claiming.
//!
//! Direct translation of `api/routes/tasks.py`.
//!
//! Provides a simple kanban-style task flow: open → assigned → in_progress → done.
//! Tasks have priority levels (critical/urgent/normal/low), due hints for urgency
//! ("ASAP", "within 1hr"), and category tags (medical, logistics, security, comms).
//! Volunteers can self-claim open tasks without leader intervention.

use crate::storage;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    #[serde(default)]
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_priority")]
    pub priority: String,
    #[serde(default = "default_status")]
    pub status: String,
    #[serde(default)]
    pub assignee_id: String,
    #[serde(default)]
    pub assignee_name: String,
    #[serde(default)]
    pub created_by: String,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub due_hint: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub escalate_at: String,
}

fn default_priority() -> String {
    "normal".to_string()
}
fn default_status() -> String {
    "open".to_string()
}

const PRIORITY_ORDER: &[(&str, i32)] = &[("critical", 0), ("urgent", 1), ("normal", 2), ("low", 3)];

fn priority_rank(p: &str) -> i32 {
    PRIORITY_ORDER
        .iter()
        .find(|(k, _)| *k == p)
        .map(|(_, v)| *v)
        .unwrap_or(2)
}

fn load_tasks() -> Vec<Task> {
    let path = storage::tasks_path();
    if !path.exists() {
        return Vec::new();
    }
    storage::read_json(&path)
        .ok()
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

fn save_tasks(tasks: &[Task]) -> Result<(), String> {
    let val = serde_json::to_value(tasks).map_err(|e| e.to_string())?;
    storage::write_json(&storage::tasks_path(), &val)
}

fn now_iso() -> String {
    chrono::Local::now().to_rfc3339()
}

#[tauri::command]
pub fn list_tasks(status: Option<String>) -> Vec<Task> {
    let mut tasks = load_tasks();
    if let Some(s) = status {
        tasks.retain(|t| t.status == s);
    }
    tasks.sort_by_key(|t| priority_rank(&t.priority));
    tasks
}

#[tauri::command]
pub fn create_task(mut task: Task) -> Result<Task, String> {
    let mut tasks = load_tasks();

    if task.id.is_empty() {
        task.id = format!("T-{}", chrono::Local::now().format("%Y%m%d-%H%M%S"));
    }
    let now = now_iso();
    if task.created_at.is_empty() {
        task.created_at = now.clone();
    }
    task.updated_at = now;

    let who = if task.created_by.is_empty() {
        "unknown"
    } else {
        &task.created_by
    };
    storage::log_activity(who, "created task", &task.title, None);

    tasks.push(task.clone());
    save_tasks(&tasks)?;
    Ok(task)
}

#[tauri::command]
pub fn update_task(task_id: String, mut task: Task) -> Result<Task, String> {
    let mut tasks = load_tasks();

    let idx = tasks
        .iter()
        .position(|t| t.id == task_id)
        .ok_or_else(|| format!("Task {} not found", task_id))?;

    task.id = task_id;
    task.updated_at = now_iso();
    tasks[idx] = task.clone();
    save_tasks(&tasks)?;
    Ok(task)
}

#[tauri::command]
pub fn delete_task(task_id: String) -> Result<Value, String> {
    let tasks = load_tasks();
    let filtered: Vec<Task> = tasks.into_iter().filter(|t| t.id != task_id).collect();
    save_tasks(&filtered)?;
    Ok(serde_json::json!({"deleted": task_id}))
}

#[tauri::command]
pub fn claim_task(
    task_id: String,
    member_id: Option<String>,
    member_name: Option<String>,
) -> Result<Task, String> {
    let mut tasks = load_tasks();

    let idx = tasks
        .iter()
        .position(|t| t.id == task_id)
        .ok_or_else(|| format!("Task {} not found", task_id))?;

    if tasks[idx].status != "open" {
        return Err(format!("Task is already {}", tasks[idx].status));
    }

    let mid = member_id.unwrap_or_default();
    let mname = member_name.unwrap_or_default();

    tasks[idx].assignee_id = mid;
    tasks[idx].assignee_name = mname.clone();
    tasks[idx].status = "assigned".to_string();
    tasks[idx].updated_at = now_iso();

    let who = if mname.is_empty() { "unknown" } else { &mname };
    storage::log_activity(who, "claimed task", &task_id, None);

    let task = tasks[idx].clone();
    save_tasks(&tasks)?;
    Ok(task)
}
