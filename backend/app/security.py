from __future__ import annotations

import base64
import ipaddress
import json
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from flask import current_app, request

from .db import get_db, next_public_id
from .utils import ensure_utc, utc_now


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


def is_business_hours_allowed(user: dict[str, Any]) -> bool:
    if user.get("role") != "Mining Manager":
        return True

    tz = ZoneInfo(current_app.config["BUSINESS_HOURS_TIMEZONE"])
    now = datetime.now(tz)
    allowed_days = current_app.config["BUSINESS_HOURS_ALLOWED_DAYS"]
    start_hour = current_app.config["BUSINESS_HOURS_START_HOUR"]
    end_hour = current_app.config["BUSINESS_HOURS_END_HOUR"]

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
        db.notifications.insert_one(
            {
                "id": next_public_id("notifications", "NTF"),
                "user_id": admin["id"],
                "title": title,
                "detail": detail,
                "href": "/admin/security",
                "document_id": None,
                "type": "security_alert",
                "read": False,
                "created_at": now,
                "read_at": None,
                "metadata": metadata or {},
            }
        )


def session_is_stale(last_seen: Any) -> bool:
    seen_at = ensure_utc(last_seen)
    if not seen_at:
        return False
    idle_seconds = max(60, int(current_app.config["AUTO_LOGOUT_MINUTES"]) * 60)
    return (utc_now() - seen_at).total_seconds() > idle_seconds
