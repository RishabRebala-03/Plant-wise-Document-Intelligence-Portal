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
    AUTO_LOGOUT_MINUTES = int(os.getenv("AUTO_LOGOUT_MINUTES", "2"))
    BUSINESS_HOURS_TIMEZONE = os.getenv("BUSINESS_HOURS_TIMEZONE", "Asia/Kolkata")
    BUSINESS_HOURS_START_HOUR = int(os.getenv("BUSINESS_HOURS_START_HOUR", "7"))
    BUSINESS_HOURS_END_HOUR = int(os.getenv("BUSINESS_HOURS_END_HOUR", "20"))
    BUSINESS_HOURS_ALLOWED_DAYS = tuple(
        int(day.strip()) for day in os.getenv("BUSINESS_HOURS_ALLOWED_DAYS", "0,1,2,3,4").split(",") if day.strip()
    )
    FAILED_LOGIN_LIMIT = int(os.getenv("FAILED_LOGIN_LIMIT", "5"))
    FAILED_LOGIN_LOCK_MINUTES = int(os.getenv("FAILED_LOGIN_LOCK_MINUTES", "15"))
    SECURITY_HEADERS_ENABLED = _as_bool(os.getenv("SECURITY_HEADERS_ENABLED"), True)
    ALLOWED_UPLOAD_EXTENSIONS = {
        value.strip().lower()
        for value in os.getenv("ALLOWED_UPLOAD_EXTENSIONS", "pdf,doc,docx,xls,xlsx,png,jpg,jpeg").split(",")
        if value.strip()
    }
    ALLOWED_UPLOAD_CONTENT_TYPES = {
        value.strip().lower()
        for value in os.getenv(
            "ALLOWED_UPLOAD_CONTENT_TYPES",
            "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,"
            "application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/png,image/jpeg",
        ).split(",")
        if value.strip()
    }
    CORS_ORIGINS = [
        origin.strip()
        for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
        if origin.strip()
    ]
