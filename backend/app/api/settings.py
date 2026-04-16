from __future__ import annotations

import ipaddress
from zoneinfo import ZoneInfo

from flask import Blueprint

from ..auth import current_user, hash_password, require_auth, require_capability, verify_password
from ..db import get_db, next_public_id
from ..permissions import DEFAULT_ACCESS_RULES, get_access_rules, save_access_rules
from ..security import (
    DEFAULT_BUSINESS_HOURS,
    DEFAULT_UPLOAD_FORMATS,
    current_business_hours,
    get_governance_policy,
    record_audit_event,
    save_governance_policy,
)
from ..serializers import serialize_user
from ..utils import ensure_utc, error_response, parse_json_body, success_response, to_iso, utc_now


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


def _serialize_access_rule(rule: dict) -> dict:
    fallback = next((item for item in DEFAULT_ACCESS_RULES if item["role"] == rule.get("role")), {"plantsScope": "Controlled by administrator"})
    return {
        "role": rule.get("role"),
        "plantsScope": rule.get("plantsScope", fallback["plantsScope"]),
        "canCreateProjects": bool(rule.get("canCreateProjects")),
        "canUploadDocuments": bool(rule.get("canUploadDocuments")),
        "canEditDocuments": bool(rule.get("canEditDocuments")),
        "canDeleteDocuments": bool(rule.get("canDeleteDocuments")),
        "canManageUsers": bool(rule.get("canManageUsers")),
        "canConfigureIp": bool(rule.get("canConfigureIp")),
    }


def _serialize_session(session: dict, user: dict | None = None) -> dict:
    started_at = ensure_utc(session.get("created_at"))
    last_seen_at = ensure_utc(session.get("last_seen_at"))
    revoked_at = ensure_utc(session.get("revoked_at"))
    ended_at = revoked_at or last_seen_at
    duration_seconds = int(max(0, (ended_at - started_at).total_seconds())) if started_at and ended_at else 0
    idle_seconds = int(max(0, (utc_now() - last_seen_at).total_seconds())) if last_seen_at and not revoked_at else 0
    return {
        "sessionId": session.get("session_id"),
        "userId": session.get("user_id"),
        "userName": user.get("name") if user else None,
        "userEmail": user.get("email") if user else None,
        "userRole": user.get("role") if user else None,
        "clientIp": session.get("client_ip") or "unknown",
        "userAgent": session.get("user_agent") or "",
        "browser": _browser_label(session.get("user_agent") or ""),
        "device": _device_label(session.get("user_agent") or ""),
        "startedAt": to_iso(started_at),
        "lastSeenAt": to_iso(last_seen_at),
        "endedAt": to_iso(revoked_at),
        "durationSeconds": duration_seconds,
        "idleSeconds": idle_seconds,
        "status": "Active" if not revoked_at else "Ended",
        "revokedReason": session.get("revoked_reason"),
    }


def _serialize_governance_policy(policy: dict) -> dict:
    business_hours = policy.get("businessHours") if isinstance(policy.get("businessHours"), dict) else {}
    allowed_upload_formats = policy.get("allowedUploadFormats") if isinstance(policy.get("allowedUploadFormats"), list) else []
    return {
        "allowedUploadFormats": [str(value).strip().lower() for value in (allowed_upload_formats or DEFAULT_UPLOAD_FORMATS) if str(value).strip()],
        "businessHours": {
            "timezone": str(business_hours.get("timezone") or DEFAULT_BUSINESS_HOURS["timezone"]),
            "startHour": int(business_hours.get("startHour", DEFAULT_BUSINESS_HOURS["startHour"])),
            "endHour": int(business_hours.get("endHour", DEFAULT_BUSINESS_HOURS["endHour"])),
            "allowedDays": [int(day) for day in (business_hours.get("allowedDays") or DEFAULT_BUSINESS_HOURS["allowedDays"])],
        },
    }


def _outside_business_hours(session: dict) -> bool:
    started_at = ensure_utc(session.get("created_at"))
    if not started_at:
        return False
    business_hours = current_business_hours()
    try:
        localized = started_at.astimezone(ZoneInfo(str(business_hours.get("timezone") or DEFAULT_BUSINESS_HOURS["timezone"])))
    except Exception:
        return False
    allowed_days = [int(day) for day in (business_hours.get("allowedDays") or DEFAULT_BUSINESS_HOURS["allowedDays"])]
    start_hour = int(business_hours.get("startHour", DEFAULT_BUSINESS_HOURS["startHour"]))
    end_hour = int(business_hours.get("endHour", DEFAULT_BUSINESS_HOURS["endHour"]))
    return localized.weekday() not in allowed_days or not (start_hour <= localized.hour < end_hour)


def _serialize_outside_hours_event(audit_log: dict) -> dict:
    device = audit_log.get("device") or {}
    user_agent = str(device.get("userAgent") or "")
    metadata = audit_log.get("metadata") or {}
    return {
        "id": audit_log.get("id"),
        "userId": audit_log.get("user_id"),
        "userName": audit_log.get("user_name"),
        "userRole": audit_log.get("user_role"),
        "clientIp": audit_log.get("client_ip") or metadata.get("clientIp") or "unknown",
        "occurredAt": to_iso(audit_log.get("created_at")),
        "detail": audit_log.get("action"),
        "browser": _browser_label(user_agent),
        "device": _device_label(user_agent),
        "userAgent": user_agent,
        "status": audit_log.get("status"),
    }


def _browser_label(user_agent: str) -> str:
    value = user_agent.lower()
    if "edg/" in value:
        return "Edge"
    if "chrome/" in value and "edg/" not in value:
        return "Chrome"
    if "firefox/" in value:
        return "Firefox"
    if "safari/" in value and "chrome/" not in value:
        return "Safari"
    return "Unknown browser"


def _device_label(user_agent: str) -> str:
    value = user_agent.lower()
    if "iphone" in value:
        return "iPhone"
    if "ipad" in value:
        return "iPad"
    if "android" in value:
        return "Android device"
    if "mac os x" in value or "macintosh" in value:
        return "Mac"
    if "windows" in value:
        return "Windows PC"
    if "linux" in value:
        return "Linux device"
    return "Unknown device"


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


@settings_bp.get("/settings/access-rules")
@require_auth()
def list_access_rules():
    rules = [_serialize_access_rule(rule) for rule in get_access_rules(get_db())]
    return success_response({"items": rules})


@settings_bp.put("/settings/access-rules")
@require_auth(["Admin"])
@require_capability("canManageUsers")
def update_access_rules():
    body = parse_json_body()
    rules = body.get("rules")
    if not isinstance(rules, list) or not rules:
        return error_response("Access rules payload is required", 400)

    valid_roles = {rule["role"] for rule in DEFAULT_ACCESS_RULES}
    seen_roles = set()
    sanitized = []
    for item in rules:
        if not isinstance(item, dict):
            return error_response("Each access rule must be an object", 400)
        role = item.get("role")
        if role not in valid_roles or role in seen_roles:
            return error_response("Access rules must include each role exactly once", 400)
        seen_roles.add(role)
        sanitized.append(_serialize_access_rule(item))

    if seen_roles != valid_roles:
        return error_response("Access rules must define CEO, Mining Manager, and Admin", 400)

    save_access_rules(get_db(), sanitized)
    _record_settings_activity("Access Rules Updated", current_user(), roles=sorted(seen_roles))
    record_audit_event(
        "Access Rules Updated",
        user=current_user(),
        resource_type="settings",
        resource_id="access_rules",
        metadata={"roles": sorted(seen_roles)},
    )
    return success_response({"items": sanitized})


@settings_bp.get("/settings/ip-rules")
@require_auth(["Admin", "CEO"])
@require_capability("canConfigureIp")
def list_ip_rules():
    db = get_db()
    rules = [_serialize_ip_rule(rule) for rule in db.ip_rules.find({}).sort("label", 1)]
    return success_response({"items": rules})


@settings_bp.post("/settings/ip-rules")
@require_auth(["Admin", "CEO"])
@require_capability("canConfigureIp")
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
@require_auth(["Admin", "CEO"])
@require_capability("canConfigureIp")
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


@settings_bp.get("/settings/governance-policy")
@require_auth()
def get_governance_settings():
    return success_response(_serialize_governance_policy(get_governance_policy()))


@settings_bp.put("/settings/governance-policy")
@require_auth(["Admin"])
@require_capability("canManageUsers")
def update_governance_settings():
    body = parse_json_body()
    allowed_upload_formats = body.get("allowedUploadFormats")
    business_hours = body.get("businessHours")
    if not isinstance(allowed_upload_formats, list) or not allowed_upload_formats:
        return error_response("At least one allowed upload format is required", 400)
    sanitized_formats = []
    for value in allowed_upload_formats:
        extension = str(value).strip().lower().lstrip(".")
        if extension not in DEFAULT_UPLOAD_FORMATS:
            return error_response(f"Unsupported upload format: {value}", 400)
        if extension not in sanitized_formats:
            sanitized_formats.append(extension)
    if not isinstance(business_hours, dict):
        return error_response("Business hours are required", 400)
    timezone = str(business_hours.get("timezone") or DEFAULT_BUSINESS_HOURS["timezone"]).strip()
    start_hour = int(business_hours.get("startHour", DEFAULT_BUSINESS_HOURS["startHour"]))
    end_hour = int(business_hours.get("endHour", DEFAULT_BUSINESS_HOURS["endHour"]))
    allowed_days = business_hours.get("allowedDays")
    if not isinstance(allowed_days, list) or not allowed_days:
        return error_response("At least one business day must be selected", 400)
    sanitized_days = sorted({int(day) for day in allowed_days if 0 <= int(day) <= 6})
    if start_hour < 0 or start_hour > 23 or end_hour < 1 or end_hour > 24 or start_hour >= end_hour:
        return error_response("Business hours must define a valid start and end window", 400)

    policy = save_governance_policy(
        allowed_upload_formats=sanitized_formats,
        business_hours={
            "timezone": timezone,
            "startHour": start_hour,
            "endHour": end_hour,
            "allowedDays": sanitized_days,
        },
    )
    _record_settings_activity(
        "Governance Policy Updated",
        current_user(),
        allowedUploadFormats=sanitized_formats,
        businessHours=policy["businessHours"],
    )
    record_audit_event(
        "Governance Policy Updated",
        user=current_user(),
        resource_type="settings",
        resource_id="governance_policy",
        metadata={"allowedUploadFormats": sanitized_formats, "businessHours": policy["businessHours"]},
    )
    return success_response(_serialize_governance_policy(policy))


@settings_bp.get("/settings/sessions")
@require_auth(["Admin"])
def list_sessions():
    db = get_db()
    sessions = []
    outside_hours_sessions = []
    for session in db.active_sessions.find({}).sort("created_at", -1).limit(250):
        user = db.users.find_one({"id": session.get("user_id")})
        serialized = _serialize_session(session, user)
        sessions.append(serialized)
        if user and user.get("role") == "Mining Manager" and _outside_business_hours(session):
            outside_hours_sessions.append(serialized)

    blocked_off_hours = [
        _serialize_outside_hours_event(item)
        for item in db.audit_logs.find(
            {
                "action": "Login Rejected",
                "metadata.reason": "outside_business_hours",
            }
        ).sort("created_at", -1).limit(100)
    ]

    return success_response({"items": sessions, "outsideBusinessHours": {"sessions": outside_hours_sessions, "blockedAttempts": blocked_off_hours}})
