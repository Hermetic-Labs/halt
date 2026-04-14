"""
Tasks — field task board with self-service claiming.

Provides a simple kanban-style task flow: open → assigned → in_progress → done.
Tasks have priority levels (critical/urgent/normal/low), due hints for urgency
("ASAP", "within 1hr"), and category tags (medical, logistics, security, comms).
Volunteers can self-claim open tasks without leader intervention.
"""
import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from storage import write_json, tasks_path, log_activity

router = APIRouter(tags=["tasks"])


class Task(BaseModel):
    id: str = ""
    title: str
    description: str = ""
    priority: str = "normal"  # critical | urgent | normal | low
    status: str = "open"  # open | assigned | in_progress | done
    assignee_id: str = ""  # roster member ID
    assignee_name: str = ""
    created_by: str = ""
    created_at: str = ""
    updated_at: str = ""
    due_hint: str = ""  # e.g. "ASAP", "within 1hr", "when able"
    category: str = ""  # e.g. "medical", "logistics", "security", "comms"
    escalate_at: str = ""  # ISO timestamp when task becomes critical if unclaimed


PRIORITY_ORDER = {"critical": 0, "urgent": 1, "normal": 2, "low": 3}


@router.get("/api/tasks")
def list_tasks(status: Optional[str] = None):
    """List all tasks, optionally filtered by status. Sorted by priority."""
    p = tasks_path()
    if not p.exists():
        return []
    tasks = json.loads(p.read_text(encoding="utf-8"))
    if status:
        tasks = [t for t in tasks if t.get("status") == status]
    tasks.sort(key=lambda t: PRIORITY_ORDER.get(t.get("priority", "normal"), 2))
    return tasks


@router.post("/api/tasks", status_code=201)
def create_task(task: Task):
    """Create a new task."""
    p = tasks_path()
    tasks = json.loads(p.read_text(encoding="utf-8")) if p.exists() else []
    if not task.id:
        task.id = f"T-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    now = datetime.now().isoformat()
    if not task.created_at:
        task.created_at = now
    task.updated_at = now
    tasks.append(task.model_dump())
    write_json(p, tasks)
    log_activity(task.created_by or "unknown", "created task", task.title)
    return task.model_dump()


@router.put("/api/tasks/{task_id}")
def update_task(task_id: str, task: Task):
    """Update a task (assign, change status, etc.)."""
    p = tasks_path()
    if not p.exists():
        raise HTTPException(404, "Tasks not found")
    tasks = json.loads(p.read_text(encoding="utf-8"))
    for i, t in enumerate(tasks):
        if t["id"] == task_id:
            task.id = task_id
            task.updated_at = datetime.now().isoformat()
            tasks[i] = task.model_dump()
            write_json(p, tasks)
            return tasks[i]
    raise HTTPException(404, f"Task {task_id} not found")


@router.delete("/api/tasks/{task_id}")
def delete_task(task_id: str):
    """Remove a task."""
    p = tasks_path()
    if not p.exists():
        raise HTTPException(404, "Tasks not found")
    tasks = json.loads(p.read_text(encoding="utf-8"))
    tasks = [t for t in tasks if t["id"] != task_id]
    write_json(p, tasks)
    return {"deleted": task_id}


@router.post("/api/tasks/{task_id}/claim")
def claim_task(task_id: str, member_id: str = "", member_name: str = ""):
    """Self-service: a volunteer claims an open task."""
    p = tasks_path()
    if not p.exists():
        raise HTTPException(404, "Tasks not found")
    tasks = json.loads(p.read_text(encoding="utf-8"))
    for i, t in enumerate(tasks):
        if t["id"] == task_id:
            if t["status"] not in ("open",):
                raise HTTPException(400, f"Task is already {t['status']}")
            t["assignee_id"] = member_id
            t["assignee_name"] = member_name
            t["status"] = "assigned"
            t["updated_at"] = datetime.now().isoformat()
            tasks[i] = t
            write_json(p, tasks)
            log_activity(member_name or member_id, "claimed task", task_id)
            return t
    raise HTTPException(404, f"Task {task_id} not found")
