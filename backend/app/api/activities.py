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

    activities = [
        serialize_activity(activity)
        for activity in db.activities.find(query).sort("created_at", -1).limit(200)
    ]
    return success_response({"items": activities})
