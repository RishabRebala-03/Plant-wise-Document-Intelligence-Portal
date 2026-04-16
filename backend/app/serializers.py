from __future__ import annotations

from collections import Counter
from typing import Any

from .permissions import get_access_rule_for_role, user_capabilities
from .utils import serialize_object_id, to_iso


def serialize_user(user: dict[str, Any]) -> dict[str, Any]:
    from .db import get_db

    db = get_db()
    access_rule = get_access_rule_for_role(db, user["role"])
    return {
        "id": user["id"],
        "name": user["name"],
        "firstName": user.get("first_name"),
        "lastName": user.get("last_name"),
        "email": user["email"],
        "role": user["role"],
        "status": user["status"],
        "plant": user.get("plant_name") or "All",
        "plantId": user.get("plant_id"),
        "assignedPlantIds": user.get("assigned_plant_ids", [user["plant_id"]] if user.get("plant_id") else []),
        "assignedPlants": user.get("assigned_plant_names", [user.get("plant_name")] if user.get("plant_name") and user.get("plant_name") != "All" else []),
        "notificationPreferences": user.get("notification_preferences", {}),
        "displayPreferences": user.get("display_preferences", {}),
        "accessRule": access_rule,
        "capabilities": user_capabilities(user, db),
        "security": {
            "twoFactorEnabled": user.get("security", {}).get("two_factor_enabled", False),
            "lastPasswordChangeAt": to_iso(user.get("security", {}).get("last_password_change_at")),
        },
        "createdAt": to_iso(user.get("created_at")),
        "updatedAt": to_iso(user.get("updated_at")),
    }


def serialize_comment(comment: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": comment["id"],
        "documentId": comment["document_id"],
        "text": comment["text"],
        "visibility": comment["visibility"],
        "author": comment["author_name"],
        "authorId": comment["author_id"],
        "role": comment.get("role"),
        "date": to_iso(comment.get("created_at")),
        "updatedAt": to_iso(comment.get("updated_at")),
    }


def serialize_document(document: dict[str, Any], comments: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    note_count = len(comments or [])
    latest = serialize_comment(comments[0]) if comments else None
    return {
        "id": document["id"],
        "name": document["name"],
        "plant": document["plant_name"],
        "plantId": document["plant_id"],
        "category": document["category"],
        "uploadedBy": document["uploaded_by_name"],
        "uploadedById": document["uploaded_by_id"],
        "date": to_iso(document.get("uploaded_at")),
        "version": document.get("version", 1),
        "uploadComment": document.get("upload_comment"),
        "status": document.get("status", "Draft"),
        "company": document.get("company", "Midwest Ltd"),
        "projectId": document.get("project_id"),
        "projectName": document.get("project_name"),
        "file": {
            "name": document.get("file_name"),
            "contentType": document.get("content_type"),
            "sizeBytes": document.get("size_bytes"),
            "storageId": serialize_object_id(document.get("file_storage_id")),
        },
        "noteSummary": {
            "count": note_count,
            "latest": latest,
        },
        "createdAt": to_iso(document.get("created_at")),
        "updatedAt": to_iso(document.get("updated_at")),
    }


def serialize_project(project: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": project["id"],
        "plantId": project["plant_id"],
        "plantName": project["plant_name"],
        "name": project["name"],
        "code": project.get("code", ""),
        "description": project.get("description", ""),
        "owner": project.get("owner_name") or project.get("owner") or "Unassigned",
        "status": project.get("status", "Active"),
        "createdAt": to_iso(project.get("created_at")),
        "dueDate": to_iso(project.get("due_date")),
        "documentIds": project.get("document_ids", []),
    }


def serialize_activity(activity: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": activity["id"],
        "action": activity["action"],
        "entityType": activity["entity_type"],
        "entityId": activity["entity_id"],
        "documentId": activity.get("document_id"),
        "documentName": activity.get("document_name"),
        "userId": activity.get("user_id"),
        "userName": activity.get("user_name"),
        "metadata": activity.get("metadata", {}),
        "createdAt": to_iso(activity.get("created_at")),
    }


def serialize_notification(notification: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": notification["id"],
        "userId": notification["user_id"],
        "title": notification.get("title", ""),
        "detail": notification.get("detail", ""),
        "href": notification.get("href", ""),
        "documentId": notification.get("document_id"),
        "type": notification.get("type", "info"),
        "read": bool(notification.get("read")),
        "createdAt": to_iso(notification.get("created_at")),
        "readAt": to_iso(notification.get("read_at")),
    }


def serialize_plant(plant: dict[str, Any], recent_documents: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {
        "id": plant["id"],
        "name": plant["name"],
        "company": plant["company"],
        "documents": plant.get("documents_count", 0),
        "lastUpload": to_iso(plant.get("last_upload_at")),
        "status": plant.get("status", "Operational"),
        "manager": plant.get("manager_name"),
        "location": plant.get("location"),
        "capacity": plant.get("capacity"),
        "recentDocuments": recent_documents or [],
    }


def summarize_categories(documents: list[dict[str, Any]]) -> list[dict[str, Any]]:
    counts = Counter(doc["category"] for doc in documents)
    total = sum(counts.values()) or 1
    palette = {
        "Safety Report": "#E9730C",
        "Environmental Compliance": "#107E3E",
        "Equipment Inspection": "#0A6ED1",
        "Production Log": "#945ECF",
        "Maintenance Record": "#5B738B",
        "Incident Report": "#BB0000",
        "Permit": "#3A7D44",
        "Other": "#999999",
    }
    rows = []
    for category, count in counts.most_common():
        rows.append(
            {
                "category": category,
                "count": count,
                "pct": round((count / total) * 100),
                "color": palette.get(category, "#999999"),
            }
        )
    return rows
