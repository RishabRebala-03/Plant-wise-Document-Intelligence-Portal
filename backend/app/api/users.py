from __future__ import annotations

from flask import Blueprint, request

from ..auth import hash_password, require_auth
from ..db import get_db, next_public_id
from ..serializers import serialize_user
from ..utils import error_response, parse_json_body, success_response, utc_now


users_bp = Blueprint("users", __name__)


@users_bp.get("/users")
@require_auth(["Admin", "CEO"])
def list_users():
    db = get_db()
    query = {}
    role = request.args.get("role", "").strip()
    status = request.args.get("status", "").strip()
    q = request.args.get("q", "").strip()
    if role:
        query["role"] = role
    if status:
        query["status"] = status
    if q:
        query["$or"] = [{"name": {"$regex": q, "$options": "i"}}, {"email": {"$regex": q, "$options": "i"}}]
    users = [serialize_user(user) for user in db.users.find(query).sort("name", 1)]
    return success_response(users)


@users_bp.post("/users")
@require_auth(["Admin"])
def create_user():
    db = get_db()
    body = parse_json_body()
    name = (body.get("name") or "").strip()
    email = (body.get("email") or "").strip().lower()
    role = (body.get("role") or "Mining Manager").strip()
    plant_id = body.get("plantId")

    if not name or not email:
        return error_response("Name and email are required", 400)
    if db.users.find_one({"email": email}):
        return error_response("A user with this email already exists", 409)

    first_name, _, last_name = name.partition(" ")
    plant = db.plants.find_one({"id": plant_id}) if plant_id else None
    now = utc_now()
    password = body.get("password") or "Password123!"
    user = {
        "id": next_public_id("users", "U"),
        "name": name,
        "first_name": first_name,
        "last_name": last_name or "",
        "email": email,
        "role": role,
        "status": "Active",
        "plant_id": plant["id"] if plant else None,
        "plant_name": plant["name"] if plant else "All",
        "password_hash": hash_password(password),
        "notification_preferences": body.get("notificationPreferences", {}),
        "display_preferences": body.get("displayPreferences", {}),
        "security": {"two_factor_enabled": False, "last_password_change_at": now},
        "created_at": now,
        "updated_at": now,
    }
    db.users.insert_one(user)
    return success_response(serialize_user(user), 201)


@users_bp.patch("/users/<user_id>")
@require_auth(["Admin"])
def update_user(user_id: str):
    db = get_db()
    body = parse_json_body()
    user = db.users.find_one({"id": user_id})
    if not user:
        return error_response("User not found", 404)

    updates = {}
    for field in ("name", "email", "role", "status"):
        if body.get(field) is not None:
            updates[field] = body[field].strip() if isinstance(body[field], str) else body[field]
    if "email" in updates:
        updates["email"] = updates["email"].lower()
    if body.get("plantId") is not None:
        plant = db.plants.find_one({"id": body["plantId"]})
        if not plant:
            return error_response("Plant not found", 404)
        updates["plant_id"] = plant["id"]
        updates["plant_name"] = plant["name"]
    if body.get("password"):
        updates["password_hash"] = hash_password(body["password"])
        updates["security.last_password_change_at"] = utc_now()

    if not updates:
        return error_response("No updates were supplied", 400)

    updates["updated_at"] = utc_now()
    db.users.update_one({"id": user_id}, {"$set": updates})
    updated = db.users.find_one({"id": user_id})
    return success_response(serialize_user(updated))


@users_bp.post("/users/<user_id>/toggle-status")
@require_auth(["Admin"])
def toggle_user_status(user_id: str):
    db = get_db()
    user = db.users.find_one({"id": user_id})
    if not user:
        return error_response("User not found", 404)
    next_status = "Disabled" if user.get("status") == "Active" else "Active"
    db.users.update_one({"id": user_id}, {"$set": {"status": next_status, "updated_at": utc_now()}})
    updated = db.users.find_one({"id": user_id})
    return success_response(serialize_user(updated))
