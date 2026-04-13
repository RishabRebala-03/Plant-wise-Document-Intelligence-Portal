from __future__ import annotations

from flask import Blueprint

from ..auth import require_auth
from ..db import get_db
from ..serializers import serialize_document, serialize_plant
from ..utils import error_response, success_response


plants_bp = Blueprint("plants", __name__)


@plants_bp.get("/plants")
@require_auth()
def list_plants():
    db = get_db()
    plants = []
    for plant in db.plants.find({}).sort("name", 1):
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
