from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta
from functools import wraps
from typing import Any, Callable

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from flask import current_app, g, request
from werkzeug.security import check_password_hash, generate_password_hash

from .db import get_db
from .utils import error_response, utc_now


def hash_password(password: str) -> str:
    return generate_password_hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return check_password_hash(password_hash, password)


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt=current_app.config["TOKEN_SALT"])


def _fingerprint(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _encode_token(payload: dict[str, Any]) -> str:
    return _serializer().dumps(payload)


def _decode_token(token: str, max_age: int, expected_type: str) -> dict[str, Any]:
    payload = _serializer().loads(token, max_age=max_age)
    if payload.get("type") != expected_type:
        raise BadSignature("Unexpected token type")
    return payload


def create_access_token(user: dict[str, Any]) -> str:
    return _encode_token(
        {
            "sub": user["id"],
            "role": user["role"],
            "type": "access",
        }
    )


def create_refresh_token(user: dict[str, Any]) -> tuple[str, str]:
    jti = secrets.token_urlsafe(24)
    token = _encode_token(
        {
            "sub": user["id"],
            "role": user["role"],
            "type": "refresh",
            "jti": jti,
        }
    )
    return token, jti


def issue_tokens(user: dict[str, Any]) -> dict[str, str]:
    db = get_db()
    access_token = create_access_token(user)
    refresh_token, jti = create_refresh_token(user)
    now = utc_now()
    db.refresh_tokens.insert_one(
        {
            "jti": jti,
            "user_id": user["id"],
            "token_hash": _fingerprint(refresh_token),
            "revoked": False,
            "created_at": now,
            "expires_at": now.replace(microsecond=0) + timedelta(days=current_app.config["REFRESH_TOKEN_TTL_DAYS"]),
        }
    )
    return {"access_token": access_token, "refresh_token": refresh_token}


def revoke_refresh_token(refresh_token: str):
    db = get_db()
    try:
        payload = _decode_token(
            refresh_token,
            current_app.config["REFRESH_TOKEN_TTL_DAYS"] * 24 * 60 * 60,
            "refresh",
        )
    except (BadSignature, SignatureExpired):
        return
    db.refresh_tokens.update_one(
        {"jti": payload.get("jti")},
        {"$set": {"revoked": True, "revoked_at": utc_now()}},
    )


def rotate_refresh_token(refresh_token: str) -> tuple[dict[str, Any] | None, dict[str, str] | None]:
    db = get_db()
    payload = _decode_token(
        refresh_token,
        current_app.config["REFRESH_TOKEN_TTL_DAYS"] * 24 * 60 * 60,
        "refresh",
    )
    token_record = db.refresh_tokens.find_one({"jti": payload.get("jti")})
    if not token_record or token_record.get("revoked"):
        return None, None
    if token_record.get("token_hash") != _fingerprint(refresh_token):
        return None, None
    user = db.users.find_one({"id": payload["sub"]})
    if not user or user.get("status") != "Active":
        return None, None
    db.refresh_tokens.update_one(
        {"jti": payload["jti"]},
        {"$set": {"revoked": True, "rotated_at": utc_now()}},
    )
    return user, issue_tokens(user)


def current_user() -> dict[str, Any] | None:
    return getattr(g, "current_user", None)


def require_auth(roles: list[str] | None = None):
    def decorator(fn: Callable):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            auth_header = request.headers.get("Authorization", "")
            if not auth_header.startswith("Bearer "):
                return error_response("Missing bearer token", 401)
            token = auth_header.split(" ", 1)[1].strip()
            try:
                payload = _decode_token(
                    token,
                    current_app.config["ACCESS_TOKEN_TTL_SECONDS"],
                    "access",
                )
            except SignatureExpired:
                return error_response("Access token expired", 401)
            except BadSignature:
                return error_response("Invalid access token", 401)

            db = get_db()
            user = db.users.find_one({"id": payload["sub"]})
            if not user or user.get("status") != "Active":
                return error_response("User is not active", 403)
            if roles and user.get("role") not in roles:
                return error_response("You do not have permission to perform this action", 403)

            g.current_user = user
            g.access_token_payload = payload
            return fn(*args, **kwargs)

        return wrapped

    return decorator
