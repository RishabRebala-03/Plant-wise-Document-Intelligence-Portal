from __future__ import annotations

from typing import Any

from flask import current_app
from gridfs import GridFSBucket
from pymongo import ASCENDING, DESCENDING, MongoClient, ReturnDocument
from pymongo.errors import OperationFailure


def init_db(app):
    client = MongoClient(app.config["MONGO_URI"], serverSelectionTimeoutMS=3000)
    db = client[app.config["MONGO_DB_NAME"]]
    app.extensions["mongo_client"] = client
    app.extensions["mongo_db"] = db
    app.extensions["gridfs_bucket"] = GridFSBucket(db, bucket_name="document_files")
    app.extensions["mongo_indexes_ready"] = False


def get_db():
    ensure_indexes()
    return current_app.extensions["mongo_db"]


def get_fs():
    return current_app.extensions["gridfs_bucket"]


def ensure_indexes():
    if current_app.extensions.get("mongo_indexes_ready"):
        return
    db = current_app.extensions["mongo_db"]
    db.users.create_index([("id", ASCENDING)], unique=True)
    db.users.create_index([("email", ASCENDING)], unique=True)
    db.users.create_index([("assigned_plant_ids", ASCENDING)])
    db.users.create_index([("active_session_id", ASCENDING)])
    db.plants.create_index([("id", ASCENDING)], unique=True)
    db.documents.create_index([("id", ASCENDING)], unique=True)
    db.documents.create_index([("plant_id", ASCENDING), ("created_at", DESCENDING)])
    db.documents.create_index([("uploaded_by_id", ASCENDING), ("created_at", DESCENDING)])
    db.comments.create_index([("id", ASCENDING)], unique=True)
    db.comments.create_index([("document_id", ASCENDING), ("created_at", DESCENDING)])
    db.document_conversations.create_index([("id", ASCENDING)], unique=True)
    db.document_conversations.create_index([("document_id", ASCENDING), ("created_at", DESCENDING)])
    db.document_conversations.create_index([("mention_ids", ASCENDING)])
    db.message_threads.create_index([("id", ASCENDING)], unique=True)
    db.message_threads.create_index([("participant_ids", ASCENDING)])
    db.message_threads.create_index([("updated_at", DESCENDING)])
    db.message_entries.create_index([("id", ASCENDING)], unique=True)
    db.message_entries.create_index([("thread_id", ASCENDING), ("created_at", DESCENDING)])
    db.activities.create_index([("id", ASCENDING)], unique=True)
    db.activities.create_index([("user_id", ASCENDING), ("created_at", DESCENDING)])
    db.notifications.create_index([("id", ASCENDING)], unique=True)
    db.notifications.create_index([("user_id", ASCENDING), ("read", ASCENDING), ("created_at", DESCENDING)])
    db.notification_reads.create_index([("user_id", ASCENDING), ("notification_id", ASCENDING)], unique=True)
    db.notification_reads.create_index([("user_id", ASCENDING), ("read_at", DESCENDING)])
    _recreate_partial_notification_index(
        db,
        "user_id_1_source_comment_id_1",
        [("user_id", ASCENDING), ("source_comment_id", ASCENDING)],
        "source_comment_id",
    )
    _recreate_partial_notification_index(
        db,
        "user_id_1_source_conversation_id_1",
        [("user_id", ASCENDING), ("source_conversation_id", ASCENDING)],
        "source_conversation_id",
    )
    db.refresh_tokens.create_index([("jti", ASCENDING)], unique=True)
    db.refresh_tokens.create_index([("user_id", ASCENDING), ("revoked", ASCENDING)])
    db.refresh_tokens.create_index([("expires_at", ASCENDING)], expireAfterSeconds=0)
    db.active_sessions.create_index([("session_id", ASCENDING)], unique=True)
    db.active_sessions.create_index([("user_id", ASCENDING), ("revoked_at", ASCENDING)])
    db.audit_logs.create_index([("id", ASCENDING)], unique=True)
    db.audit_logs.create_index([("user_id", ASCENDING), ("created_at", DESCENDING)])
    db.audit_logs.create_index([("resource_id", ASCENDING), ("created_at", DESCENDING)])
    db.security_alerts.create_index([("id", ASCENDING)], unique=True)
    db.security_alerts.create_index([("created_at", DESCENDING)])
    db.ip_rules.create_index([("id", ASCENDING)], unique=True)
    db.ip_rules.create_index([("address", ASCENDING)])
    db.counters.create_index([("_id", ASCENDING)])
    current_app.extensions["mongo_indexes_ready"] = True


def next_sequence(name: str) -> int:
    db = get_db()
    counter = db.counters.find_one_and_update(
        {"_id": name},
        {"$inc": {"value": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return int(counter["value"])


def next_public_id(sequence: str, prefix: str, width: int = 3) -> str:
    return f"{prefix}{next_sequence(sequence):0{width}d}"


def set_sequence_value(name: str, value: int):
    db = get_db()
    db.counters.update_one({"_id": name}, {"$set": {"value": value}}, upsert=True)


def serialize_mongo_id(document: dict[str, Any] | None) -> dict[str, Any] | None:
    if not document:
        return None
    document = dict(document)
    if "_id" in document:
        document["_id"] = str(document["_id"])
    return document


def _recreate_partial_notification_index(db, name: str, keys: list[tuple[str, int]], field_name: str):
    try:
        db.notifications.drop_index(name)
    except OperationFailure:
        pass
    db.notifications.create_index(
        keys,
        name=name,
        unique=True,
        partialFilterExpression={field_name: {"$exists": True, "$type": "string"}},
    )
