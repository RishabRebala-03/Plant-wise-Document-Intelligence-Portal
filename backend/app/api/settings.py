from __future__ import annotations

from flask import Blueprint

from ..auth import current_user, hash_password, require_auth, verify_password
from ..db import get_db
from ..serializers import serialize_user
from ..utils import error_response, parse_json_body, success_response, utc_now


settings_bp = Blueprint("settings", __name__)


@settings_bp.get("/settings/me")
@require_auth()
def get_settings():
    return success_response(serialize_user(current_user()))


@settings_bp.put("/settings/me")
@require_auth()
def update_profile():
    user = current_user()
    db = get_db()
    body = parse_json_body()
    updates = {}
    for field, source in (("first_name", "firstName"), ("last_name", "lastName"), ("email", "email"), ("name", "name")):
        if body.get(source) is not None:
            updates[field] = body[source].strip()
    if "email" in updates:
        updates["email"] = updates["email"].lower()
    if "first_name" in updates or "last_name" in updates:
        updates["name"] = f"{updates.get('first_name', user.get('first_name', '')).strip()} {updates.get('last_name', user.get('last_name', '')).strip()}".strip()
    if not updates:
        return error_response("No profile updates were supplied", 400)
    updates["updated_at"] = utc_now()
    db.users.update_one({"id": user["id"]}, {"$set": updates})
    updated = db.users.find_one({"id": user["id"]})
    return success_response(serialize_user(updated))


@settings_bp.put("/settings/preferences")
@require_auth()
def update_preferences():
    user = current_user()
    db = get_db()
    body = parse_json_body()
    updates = {}
    if body.get("notificationPreferences") is not None:
        updates["notification_preferences"] = body["notificationPreferences"]
    if body.get("displayPreferences") is not None:
        updates["display_preferences"] = body["displayPreferences"]
    if body.get("security") is not None:
        security = user.get("security", {})
        security.update(body["security"])
        updates["security"] = security
    if not updates:
        return error_response("No preference updates were supplied", 400)
    updates["updated_at"] = utc_now()
    db.users.update_one({"id": user["id"]}, {"$set": updates})
    updated = db.users.find_one({"id": user["id"]})
    return success_response(serialize_user(updated))


@settings_bp.put("/settings/security/password")
@require_auth()
def update_password():
    user = current_user()
    db = get_db()
    body = parse_json_body()
    current_password = body.get("currentPassword", "")
    new_password = body.get("newPassword", "")
    confirm_password = body.get("confirmPassword", "")

    if not verify_password(current_password, user["password_hash"]):
        return error_response("Current password is incorrect", 400)
    if not new_password or len(new_password) < 8:
        return error_response("New password must be at least 8 characters long", 400)
    if new_password != confirm_password:
        return error_response("Password confirmation does not match", 400)

    now = utc_now()
    db.users.update_one(
        {"id": user["id"]},
        {
            "$set": {
                "password_hash": hash_password(new_password),
                "security.last_password_change_at": now,
                "updated_at": now,
            }
        },
    )
    updated = db.users.find_one({"id": user["id"]})
    return success_response(serialize_user(updated))
