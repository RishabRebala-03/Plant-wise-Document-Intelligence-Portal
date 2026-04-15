from __future__ import annotations

import logging

from flask import Flask, request
from flask_cors import CORS

from .api import register_blueprints
from .config import Config
from .db import get_db, init_db
from .security import evaluate_ip_rules, get_client_ip, queue_security_alert, record_audit_event
from .seed_data import seed_demo_data
from .utils import error_response, success_response, utc_now


def _configure_logging(app: Flask) -> None:
    log_level_name = app.config.get("LOG_LEVEL", "INFO")
    log_level = getattr(logging, log_level_name, logging.INFO)
    formatter = logging.Formatter(
        "%(asctime)s | %(levelname)s | %(name)s | %(message)s"
    )

    if not app.logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(formatter)
        app.logger.addHandler(handler)
    else:
        for handler in app.logger.handlers:
            handler.setFormatter(formatter)

    app.logger.setLevel(log_level)
    app.logger.propagate = False


def create_app() -> Flask:
    app = Flask(__name__)
    app.config.from_object(Config)
    _configure_logging(app)
    init_db(app)
    CORS(app, resources={rf"{app.config['API_PREFIX']}/*": {"origins": app.config["CORS_ORIGINS"]}})
    register_blueprints(app)
    app.logger.info("App initialized", extra={"event": "app_initialized", "env": app.config["ENV"]})

    @app.before_request
    def enforce_network_controls():
        if not request.path.startswith(app.config["API_PREFIX"]):
            return None
        if request.method == "OPTIONS":
            return None
        client_ip = get_client_ip()
        allowed, reason = evaluate_ip_rules(client_ip)
        if allowed:
            return None
        record_audit_event(
            "IP Policy Blocked Request",
            resource_type="network",
            resource_id=request.path,
            status="blocked",
            severity="high",
            metadata={"clientIp": client_ip, "reason": reason, "method": request.method},
        )
        queue_security_alert(
            "network_policy_block",
            title="Network policy blocked a request",
            detail=f"Blocked {request.method} {request.path} from IP {client_ip}.",
            metadata={"clientIp": client_ip, "reason": reason, "path": request.path},
        )
        return error_response("Access denied by network policy", 403)

    @app.after_request
    def apply_security_headers(response):
        if not app.config.get("SECURITY_HEADERS_ENABLED", True):
            return response
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
            "script-src 'self'; connect-src 'self' http://localhost:5173 http://127.0.0.1:5173; frame-ancestors 'none'; base-uri 'self';",
        )
        if request.is_secure or request.headers.get("X-Forwarded-Proto", "").lower() == "https":
            response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        if request.path.startswith(f"{app.config['API_PREFIX']}/auth/"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response

    @app.get("/healthz")
    def healthcheck():
        return success_response({"status": "ok", "time": utc_now().isoformat()})

    @app.errorhandler(404)
    def not_found(_error):
        return error_response("Route not found", 404)

    @app.errorhandler(413)
    def request_entity_too_large(_error):
        return error_response("Uploaded payload exceeds the maximum allowed size", 413)

    @app.errorhandler(500)
    def internal_error(_error):
        return error_response("Internal server error", 500)

    should_seed_demo = app.config["AUTO_SEED_DEMO"]
    if not should_seed_demo and app.config["ENV"] != "production":
        with app.app_context():
            should_seed_demo = get_db().users.count_documents({}) == 0

    if should_seed_demo:
        with app.app_context():
            seed_demo_data()
            app.logger.info("Demo data seeded", extra={"event": "demo_seeded"})

    with app.app_context():
        from .api.documents import backfill_ceo_comment_notifications, cleanup_manager_comment_notifications

        removed = cleanup_manager_comment_notifications()
        created = backfill_ceo_comment_notifications()
        app.logger.info(
            "Document notification maintenance completed",
            extra={
                "event": "document_notification_maintenance_completed",
                "removedNotifications": removed,
                "createdNotifications": created,
            },
        )

    return app
