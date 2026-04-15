from __future__ import annotations

import ipaddress

from flask import Blueprint

from ..auth import current_user, hash_password, require_auth, verify_password
from ..db import get_db, next_public_id
from ..security import record_audit_event
from ..serializers import serialize_user
from ..utils import error_response, parse_json_body, success_response, utc_now


settings_bp = Blueprint("settings", __name__)


def _serialize_ip_rule(rule: dict) -> dict:
    return {
        "id": rule["id"],
        "label": rule.get("label", ""),
        "address": rule.get("address", ""),
        "status": rule.get("status", "Review"),
        "lastUpdated": rule.get("last_updated_at", rule.get("created_at")).date().isoformat() if rule.get("last_updated_at", rule.get("created_at")) else None,
    }


def _record_settings_activity(action: str, actor: dict, **metadata):
    db = get_db()
    db.activities.insert_one(
        {
            "id": next_public_id("activities", "EVT"),
            "action": action,
            "entity_type": "settings",
            "entity_id": actor["id"],
            "user_id": actor["id"],
            "user_name": actor["name"],
            "metadata": metadata,
            "created_at": utc_now(),
        }
    )


def _validate_ip_rule_address(address: str) -> bool:
    try:
        if "/" in address:
            ipaddress.ip_network(address, strict=False)
        else:
            ipaddress.ip_address(address)
        return True
    except ValueError:
        return False


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
    record_audit_event("Profile Updated", user=user, resource_type="settings", resource_id=user["id"], metadata={"updatedFields": sorted(updates.keys())})
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
    record_audit_event("Preferences Updated", user=user, resource_type="settings", resource_id=user["id"], metadata={"updatedFields": sorted(updates.keys())})
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
    record_audit_event("Password Updated", user=user, resource_type="settings", resource_id=user["id"])
    return success_response(serialize_user(updated))


@settings_bp.get("/settings/ip-rules")
@require_auth(["Admin"])
def list_ip_rules():
    db = get_db()
    rules = [_serialize_ip_rule(rule) for rule in db.ip_rules.find({}).sort("label", 1)]
    return success_response({"items": rules})


@settings_bp.post("/settings/ip-rules")
@require_auth(["Admin"])
def create_ip_rule():
    db = get_db()
    body = parse_json_body()
    label = (body.get("label") or "").strip()
    address = (body.get("address") or "").strip()
    status = (body.get("status") or "Allowed").strip()
    if not label or not address:
        return error_response("Label and IP address are required", 400)
    if not _validate_ip_rule_address(address):
        return error_response("Enter a valid IP address or CIDR range", 400)
    if db.ip_rules.find_one({"address": address}):
        return error_response("This IP address already exists", 409)
    now = utc_now()
    rule = {
        "id": next_public_id("ip_rules", "IP"),
        "label": label,
        "address": address,
        "status": status,
        "created_at": now,
        "last_updated_at": now,
    }
    db.ip_rules.insert_one(rule)
    _record_settings_activity("IP Rule Created", current_user(), label=label, address=address, status=status)
    record_audit_event("IP Rule Created", user=current_user(), resource_type="ip_rule", resource_id=rule["id"], metadata={"address": address, "status": status})
    return success_response(_serialize_ip_rule(rule), 201)


@settings_bp.patch("/settings/ip-rules/<rule_id>")
@require_auth(["Admin"])
def update_ip_rule(rule_id: str):
    db = get_db()
    body = parse_json_body()
    rule = db.ip_rules.find_one({"id": rule_id})
    if not rule:
        return error_response("IP rule not found", 404)
    updates = {}
    for source, target in (("label", "label"), ("address", "address"), ("status", "status")):
        if body.get(source) is not None:
            updates[target] = body[source].strip() if isinstance(body[source], str) else body[source]
    if "address" in updates:
        if not _validate_ip_rule_address(updates["address"]):
            return error_response("Enter a valid IP address or CIDR range", 400)
        duplicate = db.ip_rules.find_one({"address": updates["address"], "id": {"$ne": rule_id}})
        if duplicate:
            return error_response("This IP address already exists", 409)
    if not updates:
        return error_response("No changes were supplied", 400)
    updates["last_updated_at"] = utc_now()
    db.ip_rules.update_one({"id": rule_id}, {"$set": updates})
    updated = db.ip_rules.find_one({"id": rule_id})
    _record_settings_activity("IP Rule Updated", current_user(), ruleId=rule_id, updatedFields=sorted(updates.keys()), address=updated.get("address"), status=updated.get("status"))
    record_audit_event("IP Rule Updated", user=current_user(), resource_type="ip_rule", resource_id=rule_id, metadata={"updatedFields": sorted(updates.keys())})
    return success_response(_serialize_ip_rule(updated))
