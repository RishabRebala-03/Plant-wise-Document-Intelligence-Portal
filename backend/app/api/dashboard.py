from __future__ import annotations

from datetime import timedelta

from flask import Blueprint

from ..auth import current_user, require_auth
from ..db import get_db
from ..serializers import serialize_activity, serialize_document, serialize_plant
from ..utils import ensure_utc, success_response, utc_now


dashboard_bp = Blueprint("dashboard", __name__)


@dashboard_bp.get("/dashboard/ceo")
@require_auth(["CEO", "Admin"])
def ceo_dashboard():
    db = get_db()
    now = utc_now()
    documents = list(db.documents.find({"deleted_at": None}).sort("uploaded_at", -1))
    plants = list(db.plants.find({}).sort("name", 1))
    recent_uploads = [
        doc for doc in documents
        if (uploaded_at := ensure_utc(doc.get("uploaded_at"))) and uploaded_at >= now - timedelta(days=7)
    ]

    alerts = []
    for plant in plants:
        last_upload_at = ensure_utc(plant.get("last_upload_at"))
        if last_upload_at and last_upload_at < now - timedelta(days=10):
            alerts.append({"type": "warning", "text": f"{plant['name']}: no uploads in the last 10 days", "link": f"/plants/{plant['id']}"})
    for document in documents:
        if document["category"] == "Permit":
            alerts.append({"type": "info", "text": f"{document['name']} should be reviewed for renewal readiness", "link": f"/documents/{document['id']}"})
        if document.get("status") == "Action Required":
            alerts.append({"type": "warning", "text": f"{document['name']} requires follow-up action", "link": f"/documents/{document['id']}"})

    return success_response(
        {
            "kpis": {
                "totalDocuments": len(documents),
                "activePlants": len(plants),
                "recentUploads": len(recent_uploads),
                "categories": len({doc["category"] for doc in documents}),
            },
            "alerts": alerts[:5],
            "plants": [serialize_plant(plant) for plant in plants],
            "recentDocuments": [serialize_document(document, []) for document in documents[:5]],
        }
    )


@dashboard_bp.get("/dashboard/manager")
@require_auth(["Mining Manager", "Admin", "CEO"])
def manager_dashboard():
    db = get_db()
    user = current_user()
    now = utc_now()
    plant_id = user.get("plant_id")
    query = {"deleted_at": None}
    if plant_id:
        query["plant_id"] = plant_id
    documents = list(db.documents.find(query).sort("uploaded_at", -1))
    my_documents = [document for document in documents if document["uploaded_by_id"] == user["id"]]
    activities = list(db.activities.find({"user_id": user["id"]}).sort("created_at", -1).limit(10))

    approved = len([doc for doc in my_documents if doc.get("status") == "Approved"])
    uploaded_this_week = len([
        doc for doc in my_documents
        if (uploaded_at := ensure_utc(doc.get("uploaded_at"))) and uploaded_at >= now - timedelta(days=7)
    ])

    return success_response(
        {
            "stats": {
                "myDocuments": len(my_documents),
                "uploadedThisWeek": uploaded_this_week,
                "approved": approved,
            },
            "recentUploads": [serialize_document(document, []) for document in my_documents[:5]],
            "activity": [serialize_activity(activity) for activity in activities],
        }
    )
