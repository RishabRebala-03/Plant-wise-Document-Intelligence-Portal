from __future__ import annotations

from flask import Blueprint, request

from ..auth import current_user, require_auth, require_capability
from ..db import get_db, next_public_id
from ..security import record_audit_event
from ..utils import error_response, get_pagination, parse_json_body, success_response, utc_now


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
        "documentsCount": len(project.get("document_ids", [])),
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
    user = current_user()
    page, page_size = get_pagination()
    query = _visible_query(user)
    plant_id = request.args.get("plantId", request.args.get("plant_id", "")).strip()
    status = request.args.get("status", "").strip()
    q = request.args.get("q", "").strip()
    if plant_id:
        if user.get("role") == "Mining Manager":
            assigned = user.get("assigned_plant_ids") or ([user["plant_id"]] if user.get("plant_id") else [])
            query["plant_id"] = plant_id if plant_id in assigned else {"$in": []}
        else:
            query["plant_id"] = plant_id
    if status:
        query["status"] = status
    if q:
        query["$or"] = [
            {"name": {"$regex": q, "$options": "i"}},
            {"code": {"$regex": q, "$options": "i"}},
            {"plant_name": {"$regex": q, "$options": "i"}},
            {"owner_name": {"$regex": q, "$options": "i"}},
        ]
    sort_by = request.args.get("sort_by", "created_at")
    direction = -1 if request.args.get("order", "desc") == "desc" else 1
    sort_field = {
        "name": "name",
        "plant": "plant_name",
        "status": "status",
        "created_at": "created_at",
        "createdAt": "created_at",
    }.get(sort_by, "created_at")
    total = db.projects.count_documents(query)
    projects = db.projects.find(query).sort(sort_field, direction).skip((page - 1) * page_size).limit(page_size)
    rows = [_serialize_project(project) for project in projects]
    return success_response({"items": rows, "pagination": {"page": page, "pageSize": page_size, "total": total}})


@projects_bp.get("/projects/<project_id>/documents")
@require_auth()
def list_project_documents(project_id: str):
    from ..serializers import serialize_document
    from .documents import _document_query_for_user, _visible_comments

    db = get_db()
    project = get_db().projects.find_one({"id": project_id})
    if not project:
        return error_response("Project not found", 404)
    user = current_user()
    visible_query = _visible_query(user)
    if visible_query and project.get("plant_id") not in visible_query.get("plant_id", {}).get("$in", []):
        return error_response("Project not found", 404)
    page, page_size = get_pagination()
    query = _document_query_for_user(user)
    query["project_id"] = project_id
    total = db.documents.count_documents(query)
    cursor = db.documents.find(query).sort("uploaded_at", -1).skip((page - 1) * page_size).limit(page_size)
    return success_response(
        {
            "items": [serialize_document(document, _visible_comments(document["id"], user)) for document in cursor],
            "pagination": {"page": page, "pageSize": page_size, "total": total},
        }
    )


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
