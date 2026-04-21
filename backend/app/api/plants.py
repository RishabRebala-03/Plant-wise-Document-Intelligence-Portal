from __future__ import annotations

from flask import Blueprint, request

from ..auth import current_user, require_auth, require_capability
from ..db import get_db, next_public_id
from ..security import record_audit_event
from ..serializers import serialize_document, serialize_plant
from ..utils import error_response, parse_json_body, success_response, utc_now


plants_bp = Blueprint("plants", __name__)
DEFAULT_PLANT_COMPANY = "Midwest Limited"


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
    plant_records = list(db.plants.find(query))
    plant_records.sort(key=lambda plant: (plant.get("plant_name") or plant.get("name") or plant.get("plant") or "").lower())
    for plant in plant_records:
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


@plants_bp.post("/plants")
@require_auth(["Admin"])
@require_capability("canManageUsers")
def create_plant():
    db = get_db()
    body = parse_json_body()
    plant_code = (body.get("plant") or "").strip()
    plant_name = (body.get("plantName") or body.get("name") or "").strip()
    plant_name_2 = (body.get("plantName2") or "").strip()
    address = (body.get("address") or body.get("location") or "").strip()
    company = (body.get("company") or "").strip() or DEFAULT_PLANT_COMPANY
    capacity = (body.get("capacity") or "").strip() or None
    manager_name = (body.get("manager") or "").strip() or None

    if not plant_code or not plant_name or not plant_name_2 or not address:
        return error_response("Plant, Plant Name, Plant Name 2, and Address are required", 400)
    if db.plants.find_one({"$or": [{"plant_name": plant_name}, {"name": plant_name}]}):
        return error_response("A plant with this name already exists", 409)

    now = utc_now()
    plant = {
        "id": next_public_id("plants", "P"),
        "plant": plant_code,
        "plant_name": plant_name,
        "plant_name_2": plant_name_2,
        "address": address,
        "name": plant_name,
        "company": company,
        "documents_count": 0,
        "last_upload_at": None,
        "status": "Operational",
        "capacity": capacity,
        "location": address,
        "manager_name": manager_name,
        "created_at": now,
        "updated_at": now,
    }
    db.plants.insert_one(plant)
    record_audit_event("Plant Created", user=current_user(), resource_type="plant", resource_id=plant["id"], metadata={"plant": plant_code, "plantName": plant_name})
    return success_response(serialize_plant(plant), 201)


@plants_bp.patch("/plants/<plant_id>")
@require_auth(["Admin"])
@require_capability("canManageUsers")
def update_plant(plant_id: str):
    db = get_db()
    body = parse_json_body()
    plant = db.plants.find_one({"id": plant_id})
    if not plant:
        return error_response("Plant not found", 404)

    updates = {}
    field_map = {
        "plant": "plant",
        "plantName": "plant_name",
        "plantName2": "plant_name_2",
        "address": "address",
        "name": "name",
        "company": "company",
        "location": "location",
        "capacity": "capacity",
        "manager": "manager_name",
    }
    for source, target in field_map.items():
        if body.get(source) is not None:
            updates[target] = body[source].strip() if isinstance(body[source], str) else body[source]
    if "plant_name" in updates:
        updates["name"] = updates["plant_name"]
    if "address" in updates:
        updates["location"] = updates["address"]
    if "company" in updates and not updates["company"]:
        updates["company"] = DEFAULT_PLANT_COMPANY
    if not updates:
        return error_response("No changes were supplied", 400)
    required_fields = {
        "plant": updates.get("plant", plant.get("plant")),
        "plant_name": updates.get("plant_name", plant.get("plant_name") or plant.get("name")),
        "plant_name_2": updates.get("plant_name_2", plant.get("plant_name_2")),
        "address": updates.get("address", plant.get("address") or plant.get("location")),
    }
    if not all(isinstance(value, str) and value.strip() for value in required_fields.values()):
        return error_response("Plant, Plant Name, Plant Name 2, and Address are required", 400)
    if "plant_name" in updates:
        duplicate = db.plants.find_one({"$or": [{"plant_name": updates["plant_name"]}, {"name": updates["plant_name"]}], "id": {"$ne": plant_id}})
        if duplicate:
            return error_response("A plant with this name already exists", 409)
    updates["updated_at"] = utc_now()
    db.plants.update_one({"id": plant_id}, {"$set": updates})
    updated = db.plants.find_one({"id": plant_id})
    if "plant_name" in updates:
        db.documents.update_many({"plant_id": plant_id}, {"$set": {"plant_name": updates["plant_name"], "updated_at": updates["updated_at"]}})
        db.users.update_many({"assigned_plant_ids": plant_id}, {"$set": {"updated_at": updates["updated_at"]}})
    record_audit_event("Plant Updated", user=current_user(), resource_type="plant", resource_id=plant_id, metadata={"updatedFields": sorted(updates.keys())})
    return success_response(serialize_plant(updated))


@plants_bp.delete("/plants/<plant_id>")
@require_auth(["Admin"])
@require_capability("canManageUsers")
def delete_plant(plant_id: str):
    db = get_db()
    plant = db.plants.find_one({"id": plant_id})
    if not plant:
        return error_response("Plant not found", 404)

    now = utc_now()
    active_documents = list(db.documents.find({"plant_id": plant_id, "deleted_at": None}, {"id": 1}))
    assigned_users = list(
        db.users.find(
            {"assigned_plant_ids": plant_id},
            {"id": 1, "assigned_plant_ids": 1, "assigned_plant_names": 1, "plant_id": 1, "plant_name": 1},
        )
    )
    deleted_projects = 0

    if active_documents:
        db.documents.update_many(
            {"plant_id": plant_id, "deleted_at": None},
            {"$set": {"deleted_at": now, "updated_at": now}},
        )

    for user in assigned_users:
        next_assigned_ids = [value for value in user.get("assigned_plant_ids", []) if value != plant_id]
        next_assigned_names = [value for value in user.get("assigned_plant_names", []) if value != (plant.get("plant_name") or plant.get("name"))]
        primary_plant_id = next_assigned_ids[0] if next_assigned_ids else None
        primary_plant_name = next_assigned_names[0] if next_assigned_names else None
        db.users.update_one(
            {"id": user["id"]},
            {
                "$set": {
                    "assigned_plant_ids": next_assigned_ids,
                    "assigned_plant_names": next_assigned_names,
                    "plant_id": primary_plant_id,
                    "plant_name": primary_plant_name,
                    "updated_at": now,
                }
            },
        )

    if "projects" in db.list_collection_names():
        deleted_projects = db.projects.delete_many({"plant_id": plant_id}).deleted_count

    db.plants.delete_one({"id": plant_id})
    record_audit_event(
        "Plant Deleted",
        user=current_user(),
        resource_type="plant",
        resource_id=plant_id,
        metadata={
            "plantName": plant.get("plant_name") or plant.get("name"),
            "deletedDocumentCount": len(active_documents),
            "updatedUserCount": len(assigned_users),
            "deletedProjectCount": deleted_projects,
        },
    )
    return success_response(
        {
            "message": "Plant removed",
            "deletedDocumentCount": len(active_documents),
            "updatedUserCount": len(assigned_users),
            "deletedProjectCount": deleted_projects,
        }
    )
