from __future__ import annotations

from flask import Blueprint

from ..auth import current_user, require_auth, require_capability
from ..db import get_db, next_public_id
from ..security import record_audit_event
from ..utils import error_response, parse_json_body, success_response, utc_now


projects_bp = Blueprint("projects", __name__)


def _serialize_project(project: dict) -> dict:
    return {
        "id": project["id"],
        "plantId": project["plant_id"],
        "plantName": project["plant_name"],
        "name": project["name"],
        "code": project.get("code", ""),
        "description": project.get("description", ""),
        "owner": project.get("owner_name", "Unassigned"),
        "status": project.get("status", "Active"),
        "createdAt": project.get("created_at").date().isoformat() if project.get("created_at") else None,
        "dueDate": project.get("due_date"),
        "documentIds": project.get("document_ids", []),
        "source": "backend",
    }


def _visible_query(user: dict) -> dict:
    if user.get("role") != "Mining Manager":
        return {}
    assigned = user.get("assigned_plant_ids") or ([user["plant_id"]] if user.get("plant_id") else [])
    return {"plant_id": {"$in": assigned}} if assigned else {"plant_id": {"$in": []}}


@projects_bp.get("/projects")
@require_auth()
def list_projects():
    db = get_db()
    rows = [_serialize_project(project) for project in db.projects.find(_visible_query(current_user())).sort("created_at", -1)]
    return success_response({"items": rows})


@projects_bp.post("/projects")
@require_auth(["Admin", "Mining Manager"])
@require_capability("canCreateProjects")
def create_project():
    db = get_db()
    user = current_user()
    body = parse_json_body()
    plant_id = (body.get("plantId") or "").strip()
    name = (body.get("name") or "").strip()
    code = (body.get("code") or "").strip()
    description = (body.get("description") or "").strip()
    due_date = body.get("dueDate")

    if not plant_id or not name or not description:
        return error_response("Plant, project name, and description are required", 400)

    plant = db.plants.find_one({"id": plant_id})
    if not plant:
        return error_response("Plant not found", 404)

    if user["role"] == "Mining Manager":
        assigned = user.get("assigned_plant_ids") or ([user["plant_id"]] if user.get("plant_id") else [])
        if plant_id not in assigned:
            return error_response("Managers can only create projects inside assigned plants", 403)

    now = utc_now()
    project = {
        "id": next_public_id("projects", "PRJ"),
        "plant_id": plant["id"],
        "plant_name": plant["name"],
        "name": name,
        "code": code or name[:6].upper().replace(" ", ""),
        "description": description,
        "owner_name": user["name"],
        "status": "Active",
        "created_at": now,
        "updated_at": now,
        "due_date": due_date,
        "document_ids": [],
    }
    db.projects.insert_one(project)
    record_audit_event("Project Created", user=user, resource_type="project", resource_id=project["id"], metadata={"projectName": name, "plantId": plant_id})
    return success_response(_serialize_project(project), 201)
