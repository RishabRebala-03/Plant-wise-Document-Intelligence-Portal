from __future__ import annotations

import base64
import ipaddress
import json
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from flask import current_app, request
from pymongo.errors import DuplicateKeyError

from .db import get_db, next_public_id
from .utils import ensure_utc, utc_now

DEFAULT_UPLOAD_FORMATS = ["pdf", "doc", "docx", "xls", "xlsx", "png", "jpg", "jpeg"]
UPLOAD_CONTENT_TYPE_MAP = {
    "pdf": {"application/pdf"},
    "doc": {"application/msword"},
    "docx": {"application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
    "xls": {"application/vnd.ms-excel"},
    "xlsx": {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
    "png": {"image/png"},
    "jpg": {"image/jpeg"},
    "jpeg": {"image/jpeg"},
}

DEFAULT_BUSINESS_HOURS = {
    "timezone": "Asia/Kolkata",
    "startHour": 7,
    "endHour": 20,
    "allowedDays": [0, 1, 2, 3, 4],
}


def get_governance_policy() -> dict[str, Any]:
    db = get_db()
    settings = db.app_settings.find_one({"_id": "governance_policy"}) or {}
    upload_formats = settings.get("allowedUploadFormats")
    business_hours = settings.get("businessHours")
    policy = {
        "allowedUploadFormats": upload_formats if isinstance(upload_formats, list) and upload_formats else list(DEFAULT_UPLOAD_FORMATS),
        "businessHours": {
            **DEFAULT_BUSINESS_HOURS,
            **(business_hours if isinstance(business_hours, dict) else {}),
        },
    }
    db.app_settings.update_one(
        {"_id": "governance_policy"},
        {
            "$setOnInsert": {
                "allowedUploadFormats": policy["allowedUploadFormats"],
                "businessHours": policy["businessHours"],
            }
        },
        upsert=True,
    )
    return policy


def save_governance_policy(*, allowed_upload_formats: list[str], business_hours: dict[str, Any]) -> dict[str, Any]:
    db = get_db()
    policy = {
        "allowedUploadFormats": allowed_upload_formats,
        "businessHours": {
            **DEFAULT_BUSINESS_HOURS,
            **business_hours,
        },
    }
    db.app_settings.update_one(
        {"_id": "governance_policy"},
        {"$set": policy},
        upsert=True,
    )
    return policy


def allowed_upload_extensions() -> list[str]:
    policy = get_governance_policy()
    formats = policy.get("allowedUploadFormats") or []
    sanitized = []
    for value in formats:
        extension = str(value).strip().lower().lstrip(".")
        if extension and extension in UPLOAD_CONTENT_TYPE_MAP and extension not in sanitized:
            sanitized.append(extension)
    return sanitized or list(DEFAULT_UPLOAD_FORMATS)


def allowed_upload_content_types() -> set[str]:
    content_types: set[str] = set()
    for extension in allowed_upload_extensions():
        content_types.update(UPLOAD_CONTENT_TYPE_MAP.get(extension, set()))
    return content_types


def current_business_hours() -> dict[str, Any]:
    return get_governance_policy()["businessHours"]


def get_client_ip() -> str:
    forwarded = request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
    return forwarded or request.remote_addr or "unknown"


def parse_client_fingerprint() -> dict[str, Any]:
    raw = request.headers.get("X-Client-Fingerprint", "").strip()
    if not raw:
        return {}
    try:
        decoded = base64.b64decode(raw.encode("utf-8")).decode("utf-8")
        parsed = json.loads(decoded)
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def build_request_fingerprint() -> dict[str, Any]:
    fingerprint = parse_client_fingerprint()
    fingerprint.setdefault("userAgent", request.headers.get("User-Agent", ""))
    return fingerprint


def fingerprint_hash(fingerprint: dict[str, Any]) -> str:
    serialized = json.dumps(
        {
            "userAgent": fingerprint.get("userAgent", ""),
            "language": fingerprint.get("language", ""),
            "timezone": fingerprint.get("timezone", ""),
            "platform": fingerprint.get("platform", ""),
            "screen": fingerprint.get("screen", ""),
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    import hashlib

    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _address_matches(rule_address: str, client_ip: str) -> bool:
    try:
        if "/" in rule_address:
            return ipaddress.ip_address(client_ip) in ipaddress.ip_network(rule_address, strict=False)
        return ipaddress.ip_address(client_ip) == ipaddress.ip_address(rule_address)
    except ValueError:
        return rule_address.strip() == client_ip.strip()


def evaluate_ip_rules(client_ip: str) -> tuple[bool, str | None]:
    db = get_db()
    allowed_rules = list(db.ip_rules.find({"status": "Allowed"}))
    blocked_rules = list(db.ip_rules.find({"status": "Blocked"}))

    if any(_address_matches(rule.get("address", ""), client_ip) for rule in blocked_rules):
        return False, "blocked"
    if allowed_rules and not any(_address_matches(rule.get("address", ""), client_ip) for rule in allowed_rules):
        return False, "not_whitelisted"
    return True, None


def ip_policy_message(reason: str | None, *, login: bool = False) -> str:
    prefix = "Login blocked" if login else "Access denied"
    if reason == "blocked":
        return f"{prefix}: IP is blocked by policy."
    if reason == "not_whitelisted":
        return f"{prefix}: IP is not on the allowlist."
    return f"{prefix}: network policy restriction."


def is_business_hours_allowed(user: dict[str, Any]) -> bool:
    if user.get("role") != "Mining Manager":
        return True

    business_hours = current_business_hours()
    tz = ZoneInfo(str(business_hours.get("timezone") or current_app.config["BUSINESS_HOURS_TIMEZONE"]))
    now = datetime.now(tz)
    allowed_days = business_hours.get("allowedDays") or list(current_app.config["BUSINESS_HOURS_ALLOWED_DAYS"])
    start_hour = int(business_hours.get("startHour", current_app.config["BUSINESS_HOURS_START_HOUR"]))
    end_hour = int(business_hours.get("endHour", current_app.config["BUSINESS_HOURS_END_HOUR"]))

    if now.weekday() not in allowed_days:
        return False
    return start_hour <= now.hour < end_hour


def record_audit_event(
    action: str,
    *,
    user: dict[str, Any] | None = None,
    resource_type: str,
    resource_id: str | None = None,
    status: str = "success",
    severity: str = "info",
    metadata: dict[str, Any] | None = None,
) -> None:
    db = get_db()
    fingerprint = build_request_fingerprint()
    now = utc_now()
    db.audit_logs.insert_one(
        {
            "id": next_public_id("audit_logs", "AUD"),
            "action": action,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "status": status,
            "severity": severity,
            "user_id": user.get("id") if user else None,
            "user_name": user.get("name") if user else None,
            "user_role": user.get("role") if user else None,
            "client_ip": get_client_ip(),
            "device": {
                "userAgent": request.headers.get("User-Agent", ""),
                "fingerprint": fingerprint,
            },
            "metadata": metadata or {},
            "created_at": now,
        }
    )


def queue_security_alert(event_type: str, *, title: str, detail: str, metadata: dict[str, Any] | None = None) -> None:
    db = get_db()
    now = utc_now()
    payload = {
        "id": next_public_id("security_alerts", "ALT"),
        "event_type": event_type,
        "title": title,
        "detail": detail,
        "metadata": metadata or {},
        "created_at": now,
    }
    db.security_alerts.insert_one(payload)
    for admin in db.users.find({"role": "Admin", "status": "Active"}):
        notification = {
            "id": next_public_id("notifications", "NTF"),
            "user_id": admin["id"],
            "title": title,
            "detail": detail,
            "href": "/admin/security",
            "document_id": None,
            "source_comment_id": f"security-alert:{payload['id']}",
            "type": "security_alert",
            "read": False,
            "created_at": now,
            "read_at": None,
            "metadata": metadata or {},
        }
        try:
            db.notifications.insert_one(notification)
        except DuplicateKeyError:
            # A duplicate alert notification should never take down auth or request handling.
            continue


def session_is_stale(last_seen: Any) -> bool:
    seen_at = ensure_utc(last_seen)
    if not seen_at:
        return False
    idle_seconds = max(60, int(current_app.config["AUTO_LOGOUT_MINUTES"]) * 60)
    return (utc_now() - seen_at).total_seconds() > idle_seconds
