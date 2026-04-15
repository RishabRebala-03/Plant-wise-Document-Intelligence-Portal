from __future__ import annotations

from flask import Blueprint, request

from ..auth import require_auth
from ..db import get_db
from ..serializers import serialize_activity
from ..utils import success_response


activities_bp = Blueprint("activities", __name__)


@activities_bp.get("/activities")
@require_auth(["Admin", "CEO"])
def list_activities():
    db = get_db()
    q = request.args.get("q", "").strip()
    action = request.args.get("action", "").strip()

    query: dict = {}
    if action:
        query["action"] = action
    if q:
        query["$or"] = [
            {"document_name": {"$regex": q, "$options": "i"}},
            {"user_name": {"$regex": q, "$options": "i"}},
            {"metadata.plantName": {"$regex": q, "$options": "i"}},
        ]

    activities = []
    for activity in db.activities.find(query).sort("created_at", -1).limit(200):
        metadata = dict(activity.get("metadata") or {})
        if activity.get("document_id"):
            document = db.documents.find_one({"id": activity["document_id"]})
            if document:
                metadata.setdefault("plantId", document.get("plant_id"))
                metadata.setdefault("plantName", document.get("plant_name"))
                metadata.setdefault("documentCategory", document.get("category"))
                metadata.setdefault("documentStatus", document.get("status"))
                metadata.setdefault("version", document.get("version"))
                metadata.setdefault("fileName", document.get("file_name") or document.get("name"))
                metadata.setdefault("contentType", document.get("content_type"))
                metadata.setdefault("sizeBytes", document.get("size_bytes"))
                metadata.setdefault("uploadComment", document.get("upload_comment"))
        if activity.get("entity_type") == "user":
            target_id = metadata.get("targetUserId") or activity.get("entity_id")
            if target_id:
                target = db.users.find_one({"id": target_id})
                if target:
                    metadata.setdefault("targetUserName", target.get("name"))
                    metadata.setdefault("targetRole", target.get("role"))
                    metadata.setdefault("targetStatus", target.get("status"))
                    metadata.setdefault("assignedPlants", target.get("assigned_plant_names", []))
        activity["metadata"] = metadata
        activities.append(serialize_activity(activity))
    return success_response({"items": activities})
