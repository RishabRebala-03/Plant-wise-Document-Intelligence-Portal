from __future__ import annotations

from flask import Blueprint

from ..auth import current_user, require_auth
from ..db import get_db
from ..serializers import serialize_document, serialize_plant
from ..utils import error_response, success_response


plants_bp = Blueprint("plants", __name__)


def _allowed_plant_ids(user: dict) -> list[str] | None:
    if user.get("role") != "Mining Manager":
        return None
    assigned = user.get("assigned_plant_ids")
    if assigned:
        return assigned
    return [user["plant_id"]] if user.get("plant_id") else []


@plants_bp.get("/plants")
@require_auth()
def list_plants():
    db = get_db()
    user = current_user()
    allowed_ids = _allowed_plant_ids(user)
    query = {"id": {"$in": allowed_ids}} if allowed_ids is not None else {}
    plants = []
    for plant in db.plants.find(query).sort("name", 1):
        recent_docs = list(db.documents.find({"plant_id": plant["id"], "deleted_at": None}).sort("uploaded_at", -1).limit(4))
        plants.append(serialize_plant(plant, [serialize_document(doc, []) for doc in recent_docs]))

    summary = {
        "totalPlants": len(plants),
        "operational": len([plant for plant in plants if plant["status"] == "Operational"]),
        "needsAttention": len([plant for plant in plants if plant["status"] != "Operational"]),
    }
    return success_response({"summary": summary, "items": plants})


@plants_bp.get("/plants/<plant_id>")
@require_auth()
def get_plant(plant_id: str):
    db = get_db()
    user = current_user()
    allowed_ids = _allowed_plant_ids(user)
    if allowed_ids is not None and plant_id not in allowed_ids:
        return error_response("Plant not found", 404)
    plant = db.plants.find_one({"id": plant_id})
    if not plant:
        return error_response("Plant not found", 404)
    documents = list(db.documents.find({"plant_id": plant_id, "deleted_at": None}).sort("uploaded_at", -1))
    return success_response(
        {
            "plant": serialize_plant(plant, [serialize_document(document, []) for document in documents[:4]]),
            "documents": [serialize_document(document, []) for document in documents],
        }
    )
