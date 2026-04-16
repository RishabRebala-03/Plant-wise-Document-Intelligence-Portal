from __future__ import annotations

from datetime import timedelta

from itsdangerous import BadSignature, SignatureExpired
from flask import Blueprint, current_app, request

from ..auth import issue_tokens, register_active_session, require_auth, revoke_refresh_token, rotate_refresh_token, verify_password
from ..db import get_db
from ..security import evaluate_ip_rules, get_client_ip, is_business_hours_allowed, queue_security_alert, record_audit_event
from ..serializers import serialize_user
from ..utils import ensure_utc, error_response, parse_json_body, success_response, utc_now


auth_bp = Blueprint("auth", __name__)


def _client_ip() -> str:
    return get_client_ip()


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
        record_audit_event(
            "Login Failed",
            resource_type="auth",
            resource_id=email or None,
            status="failed",
            severity="medium",
            metadata={"reason": "user_not_found"},
        )
        return error_response("Invalid credentials", 401)
    if user.get("status") != "Active":
        record_audit_event(
            "Login Rejected",
            user=user,
            resource_type="auth",
            resource_id=user["id"],
            status="blocked",
            severity="medium",
            metadata={"reason": "user_disabled"},
        )
        return error_response("User is disabled", 403)
    lock_until = ensure_utc(user.get("security", {}).get("lock_until"))
    if lock_until and utc_now() < lock_until:
        record_audit_event(
            "Login Rejected",
            user=user,
            resource_type="auth",
            resource_id=user["id"],
            status="blocked",
            severity="high",
            metadata={"reason": "account_locked", "lockUntil": lock_until.isoformat()},
        )
        return error_response("Account is temporarily locked due to repeated failed sign-in attempts", 403)
    if not verify_password(password, user["password_hash"]):
        failed_attempts = int(user.get("security", {}).get("failed_login_attempts", 0)) + 1
        security_updates = {"security.failed_login_attempts": failed_attempts, "updated_at": utc_now()}
        if failed_attempts >= current_app.config["FAILED_LOGIN_LIMIT"]:
            lock_until = utc_now().replace(microsecond=0) + timedelta(minutes=current_app.config["FAILED_LOGIN_LOCK_MINUTES"])
            security_updates["security.lock_until"] = lock_until
            queue_security_alert(
                "failed_login_threshold",
                title="Account lock triggered",
                detail=f"{user['name']} reached the failed login threshold.",
                metadata={"userId": user["id"], "email": user["email"]},
            )
        db.users.update_one({"id": user["id"]}, {"$set": security_updates})
        record_audit_event(
            "Login Failed",
            user=user,
            resource_type="auth",
            resource_id=user["id"],
            status="failed",
            severity="medium",
            metadata={"reason": "invalid_password", "failedAttempts": failed_attempts},
        )
        return error_response("Invalid credentials", 401)
    client_ip = _client_ip()
    ip_allowed, ip_reason = evaluate_ip_rules(client_ip)
    if not ip_allowed:
        record_audit_event(
            "Login Rejected",
            user=user,
            resource_type="auth",
            resource_id=user["id"],
            status="blocked",
            severity="high",
            metadata={"reason": ip_reason, "clientIp": client_ip},
        )
        queue_security_alert(
            "blocked_login_ip",
            title="Blocked login attempt detected",
            detail=f"Blocked login for {user['name']} from IP {client_ip}.",
            metadata={"userId": user["id"], "clientIp": client_ip, "reason": ip_reason},
        )
        return error_response("Login is not allowed from this IP address", 403)
    if not is_business_hours_allowed(user):
        record_audit_event(
            "Login Rejected",
            user=user,
            resource_type="auth",
            resource_id=user["id"],
            status="blocked",
            severity="high",
            metadata={"reason": "outside_business_hours", "clientIp": client_ip},
        )
        queue_security_alert(
            "outside_business_hours_login",
            title="Off-hours login blocked",
            detail=f"Login outside business hours was blocked for {user['name']}.",
            metadata={"userId": user["id"], "clientIp": client_ip},
        )
        return error_response("Login is allowed only during configured business hours", 403)

    tokens = issue_tokens(user, replace_existing=True)
    refreshed_user = db.users.find_one({"id": user["id"]}) or user
    register_active_session(refreshed_user, tokens["session_id"])
    db.users.update_one(
        {"id": refreshed_user["id"]},
        {
            "$set": {
                "security.failed_login_attempts": 0,
                "security.lock_until": None,
                "updated_at": utc_now(),
            }
        },
    )
    _insert_auth_activity("Login", refreshed_user, clientIp=client_ip, sessionId=refreshed_user.get("active_session_id"))
    record_audit_event(
        "Login Succeeded",
        user=refreshed_user,
        resource_type="auth",
        resource_id=refreshed_user["id"],
        metadata={"clientIp": client_ip, "sessionId": refreshed_user.get("active_session_id")},
    )
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
    register_active_session(user, tokens["session_id"])
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
        record_audit_event("Logout", user=user, resource_type="auth", resource_id=user["id"])
    return success_response({"message": "Logged out"})


@auth_bp.get("/auth/me")
@require_auth()
def me():
    from ..auth import current_user

    return success_response(serialize_user(current_user()))
