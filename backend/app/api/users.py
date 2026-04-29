from __future__ import annotations

from datetime import datetime, time, timezone

from flask import Blueprint, request

from ..auth import hash_password, require_auth, require_capability
from ..db import get_db, next_public_id
from ..serializers import serialize_user
from ..utils import error_response, parse_json_body, success_response, utc_now


users_bp = Blueprint("users", __name__)


def _current_user():
    from ..auth import current_user

    return current_user()


def _can_manage_user(actor: dict, target: dict, *, allow_delete: bool = False) -> tuple[bool, str | None]:
    if actor["role"] == "Admin":
        if target["id"] == actor["id"] and allow_delete:
            return False, "You cannot delete your own account"
        return True, None

    if actor["role"] == "CEO":
        if target.get("role") != "Mining Manager":
            return False, "CEO access is limited to mining manager accounts"
        return True, None

    return False, "You do not have permission to manage this user"


def _assigned_plants(db, plant_ids: list[str] | None) -> tuple[list[str], list[str], str | None, str]:
    ids = [plant_id for plant_id in (plant_ids or []) if plant_id]
    if not ids:
        return [], [], None, "All"
    plants = list(db.plants.find({"id": {"$in": ids}}).sort("name", 1))
    if len(plants) != len(set(ids)):
        return [], [], None, ""
    ordered = sorted(plants, key=lambda plant: ids.index(plant["id"]))
    ordered_ids = [plant["id"] for plant in ordered]
    ordered_names = [plant["name"] for plant in ordered]
    return ordered_ids, ordered_names, ordered_ids[0], ordered_names[0]


def _record_user_activity(action: str, actor: dict, target: dict, **metadata):
    db = get_db()
    db.activities.insert_one(
        {
            "id": next_public_id("activities", "EVT"),
            "action": action,
            "entity_type": "user",
            "entity_id": target["id"],
            "user_id": actor["id"],
            "user_name": actor["name"],
            "metadata": {
                "targetUserId": target["id"],
                "targetUserName": target["name"],
                "targetRole": target.get("role"),
                "targetStatus": target.get("status"),
                "assignedPlants": target.get("assigned_plant_names", []),
                **metadata,
            },
            "created_at": utc_now(),
        }
    )


def _parse_date_boundary(value: str, *, end_of_day: bool = False) -> datetime | None:
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        return None
    clock = time.max if end_of_day else time.min
    return datetime.combine(parsed.date(), clock, tzinfo=timezone.utc)


@users_bp.get("/users")
@require_auth(["Admin", "CEO"])
@require_capability("canManageUsers")
def list_users():
    db = get_db()
    actor = _current_user()
    query = {}
    role = request.args.get("role", "").strip()
    status = request.args.get("status", "").strip()
    plant_id = request.args.get("plantId", "").strip()
    q = request.args.get("q", "").strip()
    date_field = request.args.get("dateField", "created").strip().lower()
    date_from = request.args.get("dateFrom", "").strip()
    date_to = request.args.get("dateTo", "").strip()
    if role:
        query["role"] = role
    if status:
        query["status"] = status
    if plant_id:
        query["assigned_plant_ids"] = plant_id
    if q:
        query["$or"] = [{"name": {"$regex": q, "$options": "i"}}, {"email": {"$regex": q, "$options": "i"}}]
    if date_from or date_to:
        date_key = "updated_at" if date_field == "updated" else "created_at"
        date_query = {}
        if date_from:
            parsed_from = _parse_date_boundary(date_from)
            if parsed_from is None:
                return error_response("Invalid dateFrom value. Use YYYY-MM-DD.", 400)
            date_query["$gte"] = parsed_from
        if date_to:
            parsed_to = _parse_date_boundary(date_to, end_of_day=True)
            if parsed_to is None:
                return error_response("Invalid dateTo value. Use YYYY-MM-DD.", 400)
            date_query["$lte"] = parsed_to
        if "$gte" in date_query and "$lte" in date_query and date_query["$gte"] > date_query["$lte"]:
            return error_response("dateFrom cannot be later than dateTo", 400)
        query[date_key] = date_query
    if actor["role"] == "CEO":
        query["role"] = "Mining Manager"
    users = [serialize_user(user) for user in db.users.find(query).sort("name", 1)]
    return success_response(users)


@users_bp.get("/users/<user_id>")
@require_auth(["Admin", "CEO"])
@require_capability("canManageUsers")
def get_user(user_id: str):
    db = get_db()
    user = db.users.find_one({"id": user_id})
    if not user:
        return error_response("User not found", 404)
    actor = _current_user()
    allowed, message = _can_manage_user(actor, user)
    if not allowed:
        return error_response(message or "Forbidden", 403)
    return success_response(serialize_user(user))


@users_bp.post("/users")
@require_auth(["Admin"])
@require_capability("canManageUsers")
def create_user():
    db = get_db()
    body = parse_json_body()
    name = (body.get("name") or "").strip()
    email = (body.get("email") or "").strip().lower()
    role = (body.get("role") or "Mining Manager").strip()
    assigned_plant_ids = body.get("assignedPlantIds")
    if assigned_plant_ids is None and body.get("plantId") is not None:
        assigned_plant_ids = [body.get("plantId")] if body.get("plantId") else []

    if not name or not email:
        return error_response("Name and email are required", 400)
    if db.users.find_one({"email": email}):
        return error_response("A user with this email already exists", 409)

    first_name, _, last_name = name.partition(" ")
    plant_ids, plant_names, primary_plant_id, primary_plant_name = _assigned_plants(db, assigned_plant_ids if isinstance(assigned_plant_ids, list) else [])
    if assigned_plant_ids and not plant_names:
        return error_response("One or more assigned plants were not found", 404)
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
        "plant_id": primary_plant_id,
        "plant_name": primary_plant_name,
        "assigned_plant_ids": plant_ids,
        "assigned_plant_names": plant_names,
        "password_hash": hash_password(password),
        "notification_preferences": body.get("notificationPreferences", {}),
        "display_preferences": body.get("displayPreferences", {}),
        "security": {"two_factor_enabled": False, "last_password_change_at": now},
        "active_session_id": None,
        "session_started_at": None,
        "created_at": now,
        "updated_at": now,
    }
    db.users.insert_one(user)
    _record_user_activity("User Created", _current_user(), user, createdBy=_current_user()["id"])
    return success_response(serialize_user(user), 201)


@users_bp.patch("/users/<user_id>")
@require_auth(["Admin", "CEO"])
@require_capability("canManageUsers")
def update_user(user_id: str):
    db = get_db()
    body = parse_json_body()
    user = db.users.find_one({"id": user_id})
    if not user:
        return error_response("User not found", 404)
    actor = _current_user()
    allowed, message = _can_manage_user(actor, user)
    if not allowed:
        return error_response(message or "Forbidden", 403)

    updates = {}
    editable_fields = ("name", "email", "status") if actor["role"] == "CEO" else ("name", "email", "role", "status")
    for field in editable_fields:
        if body.get(field) is not None:
            updates[field] = body[field].strip() if isinstance(body[field], str) else body[field]
    if "email" in updates:
        updates["email"] = updates["email"].lower()
    assigned_plant_ids = body.get("assignedPlantIds")
    if assigned_plant_ids is None and body.get("plantId") is not None:
        assigned_plant_ids = [body["plantId"]] if body["plantId"] else []
    if assigned_plant_ids is not None:
        if not isinstance(assigned_plant_ids, list):
            return error_response("Assigned plants must be a list", 400)
        plant_ids, plant_names, primary_plant_id, primary_plant_name = _assigned_plants(db, assigned_plant_ids)
        if assigned_plant_ids and not plant_names:
            return error_response("One or more assigned plants were not found", 404)
        updates["assigned_plant_ids"] = plant_ids
        updates["assigned_plant_names"] = plant_names
        updates["plant_id"] = primary_plant_id
        updates["plant_name"] = primary_plant_name
    if body.get("password"):
        updates["password_hash"] = hash_password(body["password"])
        updates["security.last_password_change_at"] = utc_now()

    if not updates:
        return error_response("No updates were supplied", 400)

    updates["updated_at"] = utc_now()
    db.users.update_one({"id": user_id}, {"$set": updates})
    updated = db.users.find_one({"id": user_id})
    _record_user_activity("User Updated", actor, updated, updatedFields=sorted(updates.keys()))
    return success_response(serialize_user(updated))


@users_bp.post("/users/<user_id>/toggle-status")
@require_auth(["Admin", "CEO"])
@require_capability("canManageUsers")
def toggle_user_status(user_id: str):
    db = get_db()
    user = db.users.find_one({"id": user_id})
    if not user:
        return error_response("User not found", 404)
    actor = _current_user()
    allowed, message = _can_manage_user(actor, user)
    if not allowed:
        return error_response(message or "Forbidden", 403)
    next_status = "Disabled" if user.get("status") == "Active" else "Active"
    db.users.update_one({"id": user_id}, {"$set": {"status": next_status, "updated_at": utc_now()}})
    updated = db.users.find_one({"id": user_id})
    _record_user_activity("User Status Changed", actor, updated, previousStatus=user.get("status"), nextStatus=next_status)
    return success_response(serialize_user(updated))


@users_bp.post("/users/<user_id>/reset-password")
@require_auth(["Admin", "CEO"])
@require_capability("canManageUsers")
def reset_user_password(user_id: str):
    db = get_db()
    target = db.users.find_one({"id": user_id})
    if not target:
        return error_response("User not found", 404)

    actor = _current_user()
    allowed, message = _can_manage_user(actor, target)
    if not allowed:
        return error_response(message or "Forbidden", 403)

    if target["id"] == actor["id"]:
        return error_response("Use the profile security page to change your own password", 400)

    body = parse_json_body()
    new_password = (body.get("newPassword") or "").strip()
    confirm_password = (body.get("confirmPassword") or "").strip()

    if not new_password or len(new_password) < 8:
        return error_response("Temporary password must be at least 8 characters long", 400)
    if new_password != confirm_password:
        return error_response("Password confirmation does not match", 400)

    now = utc_now()
    db.users.update_one(
        {"id": user_id},
        {
            "$set": {
                "password_hash": hash_password(new_password),
                "security.last_password_change_at": now,
                "updated_at": now,
            }
        },
    )
    updated = db.users.find_one({"id": user_id})
    _record_user_activity("User Password Reset", actor, updated)
    return success_response(serialize_user(updated))


@users_bp.delete("/users/<user_id>")
@require_auth(["Admin", "CEO"])
@require_capability("canManageUsers")
def delete_user(user_id: str):
    db = get_db()
    user = db.users.find_one({"id": user_id})
    if not user:
        return error_response("User not found", 404)

    actor = _current_user()
    allowed, message = _can_manage_user(actor, user, allow_delete=True)
    if not allowed:
        return error_response(message or "Forbidden", 403)

    db.users.delete_one({"id": user_id})
    _record_user_activity("User Deleted", actor, user)
    return success_response({"message": "User removed"})
