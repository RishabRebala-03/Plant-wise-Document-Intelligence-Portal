from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from bson import ObjectId
from flask import jsonify, request


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def ensure_utc(value: Any) -> datetime | None:
    if value is None:
        return None
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def to_iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        normalized = ensure_utc(value)
        return normalized.isoformat() if normalized else None
    return str(value)


def serialize_object_id(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, ObjectId):
        return str(value)
    return str(value)


def success_response(data: Any = None, status: int = 200):
    payload = {"success": True}
    if data is not None:
        payload["data"] = data
    return jsonify(payload), status


def error_response(message: str, status: int = 400, details: Any = None):
    payload = {"success": False, "error": message}
    if details is not None:
        payload["details"] = details
    return jsonify(payload), status


def parse_json_body() -> dict[str, Any]:
    return request.get_json(silent=True) or {}


def parse_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def parse_int(value: str | None, default: int, minimum: int | None = None, maximum: int | None = None) -> int:
    try:
        parsed = int(value) if value is not None else default
    except (TypeError, ValueError):
        parsed = default
    if minimum is not None:
        parsed = max(parsed, minimum)
    if maximum is not None:
        parsed = min(parsed, maximum)
    return parsed


def get_pagination() -> tuple[int, int]:
    page = parse_int(request.args.get("page"), 1, minimum=1)
    page_size_value = request.args.get("page_size")
    if page_size_value is None:
        page_size_value = request.args.get("pageSize")
    page_size = parse_int(page_size_value, 25, minimum=1, maximum=100)
    return page, page_size
