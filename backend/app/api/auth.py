from __future__ import annotations

from itsdangerous import BadSignature, SignatureExpired
from flask import Blueprint, current_app, request

from ..auth import issue_tokens, require_auth, revoke_refresh_token, rotate_refresh_token, verify_password
from ..db import get_db
from ..serializers import serialize_user
from ..utils import error_response, parse_json_body, success_response, utc_now


auth_bp = Blueprint("auth", __name__)


def _client_ip() -> str:
    forwarded = request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
    return forwarded or request.remote_addr or "unknown"
def _next_activity_id():
    from ..db import next_public_id

    return next_public_id("activities", "EVT")


def _insert_auth_activity(action: str, user: dict, **metadata):
    db = get_db()
    db.activities.insert_one(
        {
            "id": _next_activity_id(),
            "action": action,
            "entity_type": "auth",
            "entity_id": user["id"],
            "user_id": user["id"],
            "user_name": user["name"],
            "metadata": {
                "role": user.get("role"),
                "email": user.get("email"),
                **metadata,
            },
            "created_at": utc_now(),
        }
    )


@auth_bp.post("/auth/login")
def login():
    body = parse_json_body()
    email = body.get("email", "").strip().lower()
    password = body.get("password", "")
    if not email or not password:
        return error_response("Email and password are required", 400)

    db = get_db()
    user = db.users.find_one({"email": email})
    if not user:
        return error_response("Invalid credentials", 401)
    if user.get("status") != "Active":
        return error_response("User is disabled", 403)
    if not verify_password(password, user["password_hash"]):
        return error_response("Invalid credentials", 401)
    client_ip = _client_ip()
    blocked_rule = db.ip_rules.find_one({"address": client_ip, "status": "Blocked"})
    if blocked_rule:
        return error_response("Login blocked from this IP address", 403)
    allowed_rules = list(db.ip_rules.find({"status": "Allowed"}))
    if allowed_rules and not any(rule.get("address") == client_ip for rule in allowed_rules):
        return error_response("Login is allowed only from approved IP addresses", 403)

    tokens = issue_tokens(user, replace_existing=True)
    refreshed_user = db.users.find_one({"id": user["id"]}) or user
    _insert_auth_activity("Login", refreshed_user, clientIp=client_ip, sessionId=refreshed_user.get("active_session_id"))
    return success_response({"user": serialize_user(refreshed_user), **tokens})


@auth_bp.post("/auth/refresh")
def refresh():
    body = parse_json_body()
    refresh_token = body.get("refreshToken", "")
    if not refresh_token:
        return error_response("Refresh token is required", 400)
    try:
        user, tokens = rotate_refresh_token(refresh_token)
    except SignatureExpired:
        return error_response("Refresh token expired", 401)
    except BadSignature:
        return error_response("Invalid refresh token", 401)

    if not user or not tokens:
        return error_response("Refresh token is no longer valid", 401)
    return success_response({"user": serialize_user(user), **tokens})


@auth_bp.post("/auth/logout")
def logout():
    body = parse_json_body()
    refresh_token = body.get("refreshToken")
    user = None
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header.split(" ", 1)[1].strip()
        try:
            from ..auth import _decode_token

            payload = _decode_token(
                token,
                current_app.config["ACCESS_TOKEN_TTL_SECONDS"],
                "access",
            )
            user = get_db().users.find_one({"id": payload.get("sub")})
        except Exception:
            user = None
    if refresh_token:
        revoke_refresh_token(refresh_token)
    if user:
        _insert_auth_activity("Logout", user, clientIp=_client_ip())
    return success_response({"message": "Logged out"})


@auth_bp.get("/auth/me")
@require_auth()
def me():
    from ..auth import current_user

    return success_response(serialize_user(current_user()))
