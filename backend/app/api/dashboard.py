from __future__ import annotations

from datetime import timedelta

from flask import Blueprint

from ..auth import current_user, require_auth
from ..db import get_db
from ..serializers import serialize_activity, serialize_document, serialize_plant
from ..utils import ensure_utc, success_response, utc_now


dashboard_bp = Blueprint("dashboard", __name__)


def _enrich_activity(activity: dict, db) -> dict:
    enriched = dict(activity)
    document_id = enriched.get("document_id")
    document = db.documents.find_one({"id": document_id}) if document_id else None
    metadata = dict(enriched.get("metadata") or {})
    if document:
        metadata.setdefault("plantId", document.get("plant_id"))
        metadata.setdefault("plantName", document.get("plant_name"))
        metadata.setdefault("documentCategory", document.get("category"))
        metadata.setdefault("documentStatus", document.get("status"))
        metadata.setdefault("version", document.get("version"))
        metadata.setdefault("fileName", document.get("file_name") or document.get("name"))
        metadata.setdefault("contentType", document.get("content_type") or "Not available")
        metadata.setdefault("sizeBytes", document.get("size_bytes"))
        metadata.setdefault("uploadComment", document.get("upload_comment") or "Not available")
        enriched.setdefault("document_name", document.get("name"))
    enriched["metadata"] = metadata
    return enriched


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
    plant_ids = user.get("assigned_plant_ids") or ([user["plant_id"]] if user.get("plant_id") else [])
    query = {"deleted_at": None}
    if plant_ids:
        query["plant_id"] = {"$in": plant_ids}
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
            "activity": [serialize_activity(_enrich_activity(activity, db)) for activity in activities],
        }
    )
