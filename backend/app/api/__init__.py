from .activities import activities_bp
from .analytics import analytics_bp
from .auth import auth_bp
from .dashboard import dashboard_bp
from .documents import documents_bp
from .notifications import notifications_bp
from .plants import plants_bp
from .settings import settings_bp
from .users import users_bp


def register_blueprints(app):
    for blueprint in (
        activities_bp,
        auth_bp,
        dashboard_bp,
        documents_bp,
        notifications_bp,
        plants_bp,
        analytics_bp,
        users_bp,
        settings_bp,
    ):
        app.register_blueprint(blueprint, url_prefix=app.config["API_PREFIX"])
