from __future__ import annotations

from flask import Flask
from flask_cors import CORS

from .api import register_blueprints
from .config import Config
from .db import init_db
from .seed_data import seed_demo_data
from .utils import error_response, success_response, utc_now


def create_app() -> Flask:
    app = Flask(__name__)
    app.config.from_object(Config)
    init_db(app)
    CORS(app, resources={rf"{app.config['API_PREFIX']}/*": {"origins": app.config["CORS_ORIGINS"]}})
    register_blueprints(app)

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

    if app.config["AUTO_SEED_DEMO"]:
        with app.app_context():
            seed_demo_data()

    return app
