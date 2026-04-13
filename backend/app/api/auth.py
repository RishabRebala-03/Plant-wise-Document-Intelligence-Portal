from __future__ import annotations

from itsdangerous import BadSignature, SignatureExpired
from flask import Blueprint

from ..auth import issue_tokens, require_auth, revoke_refresh_token, rotate_refresh_token, verify_password
from ..db import get_db
from ..serializers import serialize_user
from ..utils import error_response, parse_json_body, success_response


auth_bp = Blueprint("auth", __name__)


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

    tokens = issue_tokens(user)
    return success_response({"user": serialize_user(user), **tokens})


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
    if refresh_token:
        revoke_refresh_token(refresh_token)
    return success_response({"message": "Logged out"})


@auth_bp.get("/auth/me")
@require_auth()
def me():
    from ..auth import current_user

    return success_response(serialize_user(current_user()))
