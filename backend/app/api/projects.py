from __future__ import annotations

from flask import Blueprint

from ..auth import current_user, require_auth
from ..db import get_db, next_public_id
from ..permissions import user_has_capability
from ..security import record_audit_event
from ..serializers import serialize_project
from ..utils import error_response, parse_json_body, success_response, utc_now


projects_bp = Blueprint("projects", __name__)


def _allowed_plant_ids(user: dict) -> list[str] | None:
    if user.get("role") != "Mining Manager":
        return None
    assigned = user.get("assigned_plant_ids")
    if assigned:
        return assigned
    return [user["plant_id"]] if user.get("plant_id") else []


@projects_bp.get("/projects")
@require_auth()
def list_projects():
    db = get_db()
    user = current_user()
    allowed_ids = _allowed_plant_ids(user)
    query = {"plant_id": {"$in": allowed_ids}} if allowed_ids is not None else {}
    projects = [serialize_project(project) for project in db.projects.find(query).sort("created_at", -1)]
    return success_response({"items": projects})


@projects_bp.post("/projects")
@require_auth(["Mining Manager", "Admin", "CEO"])
def create_project():
    db = get_db()
    user = current_user()
    if not user_has_capability(user, "canCreateProjects", db):
        return error_response("You do not have permission to create projects", 403)

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

    allowed_ids = _allowed_plant_ids(user)
    if allowed_ids is not None and plant_id not in allowed_ids:
        return error_response("Managers can only create projects inside their assigned plant", 403)

    now = utc_now()
    project = {
        "id": next_public_id("projects", "PRJ"),
        "plant_id": plant["id"],
        "plant_name": plant["name"],
        "name": name,
        "code": code or name[:6].upper().replace(" ", ""),
        "description": description,
        "owner_name": user["name"],
        "owner_id": user["id"],
        "status": "Active",
        "created_at": now,
        "updated_at": now,
        "due_date": due_date,
        "document_ids": [],
    }
    db.projects.insert_one(project)
    record_audit_event(
        "Project Created",
        user=user,
        resource_type="project",
        resource_id=project["id"],
        metadata={"plantId": plant_id, "projectName": name},
    )
    return success_response(serialize_project(project), 201)
