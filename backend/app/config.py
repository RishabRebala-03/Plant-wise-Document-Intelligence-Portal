from __future__ import annotations

import os

from dotenv import load_dotenv


load_dotenv()


def _as_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


class Config:
    API_PREFIX = "/api/v1"
    ENV = os.getenv("FLASK_ENV", "development").strip().lower()
    DEBUG = _as_bool(os.getenv("DEBUG"), False)
    LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").strip().upper()
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key")
    TOKEN_SALT = os.getenv("TOKEN_SALT", "midwest-docs-api")
    MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
    MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "midwest_document_intelligence")
    ACCESS_TOKEN_TTL_SECONDS = int(os.getenv("ACCESS_TOKEN_TTL_SECONDS", "3600"))
    REFRESH_TOKEN_TTL_DAYS = int(os.getenv("REFRESH_TOKEN_TTL_DAYS", "30"))
    MAX_UPLOAD_SIZE_MB = int(os.getenv("MAX_UPLOAD_SIZE_MB", "25"))
    MAX_CONTENT_LENGTH = MAX_UPLOAD_SIZE_MB * 1024 * 1024
    DEFAULT_DEMO_PASSWORD = os.getenv("DEFAULT_DEMO_PASSWORD", "Password123!")
    AUTO_SEED_DEMO = _as_bool(os.getenv("AUTO_SEED_DEMO"), False)
    CORS_ORIGINS = [
        origin.strip()
        for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
        if origin.strip()
    ]
