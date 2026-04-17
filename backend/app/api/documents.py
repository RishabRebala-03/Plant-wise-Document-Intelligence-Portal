from __future__ import annotations

import csv
import io
from pathlib import Path
from flask import Blueprint, Response, current_app, request, send_file
from werkzeug.utils import secure_filename

from ..auth import current_user, require_auth
from ..db import get_db, get_fs, next_public_id
from ..permissions import user_has_capability
from ..security import allowed_upload_content_types, allowed_upload_extensions, record_audit_event
from ..serializers import serialize_comment, serialize_document, serialize_document_conversation
from ..utils import error_response, get_pagination, parse_bool, parse_json_body, success_response, utc_now


documents_bp = Blueprint("documents", __name__)


def _log_document_event(level: str, message: str, **details):
    logger = current_app.logger
    log_method = getattr(logger, level.lower(), logger.info)
    context = ", ".join(f"{key}={value!r}" for key, value in details.items() if value is not None)
    log_method(f"{message}{' | ' + context if context else ''}")


def _user_log_context(user: dict | None) -> dict:
    if not user:
        return {}
    return {
        "userId": user.get("id"),
        "userName": user.get("name"),
        "userRole": user.get("role"),
        "userPlantId": user.get("plant_id"),
    }


def _document_log_context(document: dict | None) -> dict:
    if not document:
        return {}
    return {
        "documentId": document.get("id"),
        "documentName": document.get("name"),
        "documentStatus": document.get("status"),
        "documentVersion": document.get("version"),
        "plantId": document.get("plant_id"),
        "plantName": document.get("plant_name"),
        "category": document.get("category"),
    }


def _record_activity(action: str, document: dict, user: dict, metadata: dict | None = None):
    db = get_db()
    db.activities.insert_one(
        {
            "id": next_public_id("activities", "EVT"),
            "action": action,
            "entity_type": "document",
            "entity_id": document["id"],
            "document_id": document["id"],
            "document_name": document["name"],
            "user_id": user["id"],
            "user_name": user["name"],
            "metadata": {
                "documentCategory": document.get("category"),
                "documentStatus": document.get("status"),
                "plantId": document.get("plant_id"),
                "plantName": document.get("plant_name"),
                "version": document.get("version"),
                **(metadata or {}),
            },
            "created_at": utc_now(),
        }
    )


def _create_manager_notifications_for_comment(
    document: dict,
    user: dict,
    visibility: str,
    text: str,
    *,
    source_comment_id: str | None = None,
    created_at=None,
):
    db = get_db()
    if visibility != "public":
        return

    recipient_map = {}

    for recipient in db.users.find(
        {
            "role": "Mining Manager",
            "status": "Active",
            "plant_id": document.get("plant_id"),
        }
    ):
        recipient_map[recipient["id"]] = recipient

    uploaded_by_id = document.get("uploaded_by_id")
    if uploaded_by_id:
        uploader = db.users.find_one(
            {
                "id": uploaded_by_id,
                "role": "Mining Manager",
                "status": "Active",
            }
        )
        if uploader:
            recipient_map[uploader["id"]] = uploader

    recipients = list(recipient_map.values())
    now = created_at or utc_now()
    detail = (
        f"{user['name']} commented: {text[:80]}{'...' if len(text) > 80 else ''}"
    )
    for recipient in recipients:
        if source_comment_id and db.notifications.find_one(
            {"user_id": recipient["id"], "source_comment_id": source_comment_id}
        ):
            continue
        db.notifications.insert_one(
            {
                "id": next_public_id("notifications", "NTF"),
                "user_id": recipient["id"],
                "title": "CEO comment added",
                "detail": detail,
                "href": f"/manager/all?docId={document['id']}&edit=1",
                "document_id": document["id"],
                "source_comment_id": source_comment_id,
                "type": "ceo_comment",
                "read": False,
                "created_at": now,
                "read_at": None,
            }
        )


def _visible_conversations(document_id: str, user: dict) -> list[dict]:
    db = get_db()
    base_query = {"document_id": document_id}
    if user["role"] in {"CEO", "Admin"}:
        return list(db.document_conversations.find(base_query).sort("created_at", -1))

    visibility_query = {
        "$or": [
            {"audience": "workspace"},
            {"audience": "uploader", "$or": [{"author_id": user["id"]}, {"mention_ids": user["id"]}, {"document_uploader_id": user["id"]}]},
        ]
    }
    return list(db.document_conversations.find({**base_query, **visibility_query}).sort("created_at", -1))


def _create_notifications_for_conversation(document: dict, author: dict, message: dict):
    db = get_db()
    mention_ids = [value for value in message.get("mention_ids", []) if value and value != author["id"]]
    recipient_ids = set(mention_ids)

    if message.get("audience") == "uploader" and document.get("uploaded_by_id") and document.get("uploaded_by_id") != author["id"]:
        recipient_ids.add(document["uploaded_by_id"])

    now = message.get("created_at") or utc_now()
    detail = f"{author['name']} mentioned you on {document['name']}: {message['text'][:80]}{'...' if len(message['text']) > 80 else ''}"
    for recipient_id in recipient_ids:
        recipient = db.users.find_one({"id": recipient_id, "status": "Active"})
        if not recipient:
            continue
        if db.notifications.find_one({"user_id": recipient_id, "source_conversation_id": message["id"]}):
            continue
        db.notifications.insert_one(
            {
                "id": next_public_id("notifications", "NTF"),
                "user_id": recipient_id,
                "title": "Document conversation mention",
                "detail": detail,
                "href": f"/documents/{document['id']}",
                "document_id": document["id"],
                "source_conversation_id": message["id"],
                "type": "document_conversation",
                "read": False,
                "created_at": now,
                "read_at": None,
            }
        )


def backfill_ceo_comment_notifications() -> int:
    db = get_db()
    created = 0
    comments = db.comments.find({"role": "CEO", "visibility": "public"}).sort("created_at", 1)

    for comment in comments:
        comment_id = comment.get("id")
        if comment_id and db.notifications.find_one({"source_comment_id": comment_id}):
            continue

        document = db.documents.find_one({"id": comment["document_id"], "deleted_at": None})
        if not document:
            continue

        author = db.users.find_one({"id": comment["author_id"], "role": "CEO"})
        if not author:
            continue

        before = db.notifications.count_documents({"source_comment_id": comment_id})
        _create_manager_notifications_for_comment(
            document,
            author,
            comment.get("visibility", "private"),
            comment.get("text", ""),
            source_comment_id=comment_id,
            created_at=comment.get("created_at"),
        )
        after = db.notifications.count_documents({"source_comment_id": comment_id})
        created += max(0, after - before)

    return created


def cleanup_manager_comment_notifications() -> int:
    db = get_db()
    removed = 0
    notifications = db.notifications.find({"type": "ceo_comment"})

    for notification in notifications:
        source_comment_id = notification.get("source_comment_id")
        if not source_comment_id:
            continue

        comment = db.comments.find_one({"id": source_comment_id})
        if not comment or comment.get("role") != "CEO" or comment.get("visibility") != "public":
            db.notifications.delete_one({"id": notification["id"]})
            removed += 1

    return removed


def _document_query_for_user(user: dict) -> dict:
    base = {"deleted_at": None}
    if user["role"] == "Mining Manager":
        assigned = user.get("assigned_plant_ids") or ([user["plant_id"]] if user.get("plant_id") else [])
        if assigned:
            base["plant_id"] = {"$in": assigned}
    if user["role"] == "Mining Manager" and request.args.get("scope") == "mine":
        base["uploaded_by_id"] = user["id"]
    return base


def _visible_comments(document_id: str, user: dict) -> list[dict]:
    db = get_db()
    if user["role"] in {"CEO", "Admin"}:
        return list(db.comments.find({"document_id": document_id}).sort("created_at", -1))
    return list(db.comments.find({"document_id": document_id, "visibility": "public"}).sort("created_at", -1))


def _can_edit_document(user: dict, document: dict) -> bool:
    if user["role"] in {"CEO", "Admin"} and user_has_capability(user, "canEditDocuments", get_db()):
        return True
    if document.get("accessed_by"):
        return False
    return document.get("uploaded_by_id") == user["id"] and user_has_capability(user, "canEditDocuments", get_db())


def _can_delete_document(user: dict, document: dict) -> bool:
    if user["role"] in {"CEO", "Admin"} and user_has_capability(user, "canDeleteDocuments", get_db()):
        return True
    if document.get("accessed_by"):
        return False
    return document.get("uploaded_by_id") == user["id"] and user_has_capability(user, "canDeleteDocuments", get_db())


def _can_view_document(user: dict, document: dict) -> bool:
    if user["role"] in {"CEO", "Admin"}:
        return True
    assigned = user.get("assigned_plant_ids") or ([user["plant_id"]] if user.get("plant_id") else [])
    return document.get("plant_id") in assigned


def _validate_uploaded_file(file) -> tuple[str, str] | None:
    file_name = secure_filename(file.filename or "")
    extension = Path(file_name).suffix.lstrip(".").lower()
    content_type = (file.mimetype or "").lower()
    if not file_name:
        return None
    if extension not in allowed_upload_extensions():
        return None
    if content_type not in allowed_upload_content_types():
        return None
    return file_name, content_type


def _mark_document_accessed(document_id: str, user: dict, *, mode: str):
    if user["role"] not in {"CEO", "Admin"}:
        return
    db = get_db()
    existing = db.documents.find_one({"id": document_id, "accessed_by.user_id": user["id"]}, {"id": 1})
    if existing:
        db.documents.update_one(
            {"id": document_id, "accessed_by.user_id": user["id"]},
            {"$set": {"last_receiver_access_at": utc_now(), "updated_at": utc_now()}},
        )
        return
    db.documents.update_one(
        {"id": document_id},
        {
            "$push": {
                "accessed_by": {
                    "user_id": user["id"],
                    "user_name": user["name"],
                    "role": user["role"],
                    "accessed_at": utc_now(),
                    "mode": mode,
                }
            },
            "$set": {"last_receiver_access_at": utc_now(), "updated_at": utc_now()},
        },
    )


@documents_bp.get("/documents")
@require_auth()
def list_documents():
    user = current_user()
    db = get_db()
    page, page_size = get_pagination()
    query = _document_query_for_user(user)
    q = request.args.get("q", "").strip()
    plant_id = request.args.get("plant_id", "").strip()
    category = request.args.get("category", "").strip()
    status = request.args.get("status", "").strip()
    uploaded_by_id = request.args.get("uploaded_by_id", "").strip()
    include_deleted = parse_bool(request.args.get("include_deleted"), False)

    if include_deleted and user["role"] == "Admin":
        query.pop("deleted_at", None)
    if q:
        query["$or"] = [
            {"name": {"$regex": q, "$options": "i"}},
            {"uploaded_by_name": {"$regex": q, "$options": "i"}},
        ]
    if plant_id:
        query["plant_id"] = plant_id
    if category:
        query["category"] = category
    if status:
        query["status"] = status
    if uploaded_by_id:
        query["uploaded_by_id"] = uploaded_by_id

    sort_by = request.args.get("sort_by", "uploaded_at")
    direction = -1 if request.args.get("order", "desc") == "desc" else 1
    sort_field = {
        "date": "uploaded_at",
        "uploaded_at": "uploaded_at",
        "name": "name",
        "plant": "plant_name",
        "status": "status",
    }.get(sort_by, "uploaded_at")

    total = db.documents.count_documents(query)
    cursor = (
        db.documents.find(query)
        .sort(sort_field, direction)
        .skip((page - 1) * page_size)
        .limit(page_size)
    )
    rows = []
    for document in cursor:
        comments = _visible_comments(document["id"], user)
        rows.append(serialize_document(document, comments))

    return success_response(
        {
            "items": rows,
            "pagination": {
                "page": page,
                "pageSize": page_size,
                "total": total,
            },
        }
    )


@documents_bp.get("/documents/export.csv")
@require_auth()
def export_documents():
    user = current_user()
    db = get_db()
    query = _document_query_for_user(user)
    rows = list(db.documents.find(query).sort("uploaded_at", -1))
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Document ID", "Name", "Plant", "Category", "Uploaded By", "Uploaded At", "Status", "Version"])
    for document in rows:
        writer.writerow(
            [
                document["id"],
                document["name"],
                document["plant_name"],
                document["category"],
                document["uploaded_by_name"],
                document["uploaded_at"].date().isoformat(),
                document.get("status", "Draft"),
                document.get("version", 1),
            ]
        )
    return Response(
        output.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=documents.csv"},
    )


@documents_bp.post("/documents")
@require_auth(["Mining Manager", "Admin", "CEO"])
def create_document():
    user = current_user()
    db = get_db()
    if not user_has_capability(user, "canUploadDocuments", db):
        return error_response("You do not have permission to upload documents", 403)

    form = request.form.to_dict() if request.files or request.form else parse_json_body()
    plant_id = form.get("plantId") or form.get("plant_id")
    plant_name = form.get("plant") or form.get("plantName")
    name = (form.get("name") or "").strip()
    category = (form.get("category") or "").strip()
    upload_comment = (form.get("uploadComment") or form.get("comments") or "").strip()
    company = (form.get("company") or "Midwest Ltd").strip()
    status = (form.get("status") or "In Review").strip()
    _log_document_event(
        "info",
        "Document upload request received",
        **_user_log_context(user),
        requestedPlantId=plant_id,
        requestedPlantName=plant_name,
        documentName=name,
        category=category,
        hasFile=bool(request.files.get("file")),
        requestedStatus=status,
    )

    if not name or not category:
        _log_document_event(
            "warning",
            "Document upload validation failed",
            **_user_log_context(user),
            reason="missing_name_or_category",
            documentName=name,
            category=category,
        )
        return error_response("Document name and category are required", 400)
    if not plant_id and not plant_name:
        _log_document_event(
            "warning",
            "Document upload validation failed",
            **_user_log_context(user),
            reason="missing_plant_selection",
            documentName=name,
        )
        return error_response("Plant selection is required", 400)

    plant = db.plants.find_one({"id": plant_id}) if plant_id else db.plants.find_one({"name": plant_name})
    if not plant:
        _log_document_event(
            "warning",
            "Document upload failed because plant was not found",
            **_user_log_context(user),
            requestedPlantId=plant_id,
            requestedPlantName=plant_name,
            documentName=name,
        )
        return error_response("Plant not found", 404)
    assigned_plant_ids = user.get("assigned_plant_ids") or ([user["plant_id"]] if user.get("plant_id") else [])
    if user["role"] == "Mining Manager" and assigned_plant_ids and plant["id"] not in assigned_plant_ids:
        _log_document_event(
            "warning",
            "Document upload denied due to plant mismatch",
            **_user_log_context(user),
            requestedPlantId=plant["id"],
            requestedPlantName=plant["name"],
            documentName=name,
        )
        return error_response("Managers can only upload documents for their assigned plant", 403)

    file = request.files.get("file")
    file_storage_id = None
    file_name = None
    content_type = None
    size_bytes = None
    if file and file.filename:
        validated = _validate_uploaded_file(file)
        if not validated:
            allowed_formats = ", ".join(ext.upper() for ext in allowed_upload_extensions())
            return error_response(f"Unsupported file type. Allowed uploads are: {allowed_formats}.", 400)
        safe_file_name, normalized_content_type = validated
        data = file.read()
        size_bytes = len(data)
        _log_document_event(
            "info",
            "Document file received for upload",
            **_user_log_context(user),
            fileName=file.filename,
            contentType=file.mimetype,
            sizeBytes=size_bytes,
            maxAllowedBytes=current_app.config["MAX_CONTENT_LENGTH"],
        )
        if size_bytes > current_app.config["MAX_CONTENT_LENGTH"]:
            _log_document_event(
                "warning",
                "Document upload rejected because file is too large",
                **_user_log_context(user),
                fileName=file.filename,
                sizeBytes=size_bytes,
                maxAllowedBytes=current_app.config["MAX_CONTENT_LENGTH"],
            )
            return error_response("Uploaded file exceeds the configured size limit", 413)
        file_storage_id = get_fs().upload_from_stream(
            safe_file_name,
            io.BytesIO(data),
            metadata={"content_type": normalized_content_type},
        )
        file_name = safe_file_name
        content_type = normalized_content_type
        _log_document_event(
            "info",
            "Document file stored in GridFS",
            **_user_log_context(user),
            fileName=file_name,
            contentType=content_type,
            sizeBytes=size_bytes,
            storageId=str(file_storage_id),
        )
    else:
        _log_document_event(
            "info",
            "Document upload continuing without attached file",
            **_user_log_context(user),
            documentName=name,
        )

    now = utc_now()
    document = {
        "id": next_public_id("documents", "D"),
        "name": name,
        "plant_id": plant["id"],
        "plant_name": plant["name"],
        "category": category,
        "company": company,
        "uploaded_by_id": user["id"],
        "uploaded_by_name": user["name"],
        "uploaded_at": now,
        "version": 1,
        "upload_comment": upload_comment or None,
        "status": status,
        "file_name": file_name,
        "content_type": content_type,
        "size_bytes": size_bytes,
        "file_storage_id": file_storage_id,
        "created_at": now,
        "updated_at": now,
        "deleted_at": None,
        "accessed_by": [],
        "last_receiver_access_at": None,
    }
    _log_document_event(
        "info",
        "Document metadata prepared for persistence",
        **_user_log_context(user),
        **_document_log_context(document),
        fileName=file_name,
        contentType=content_type,
        sizeBytes=size_bytes,
        uploadCommentPresent=bool(upload_comment),
    )
    db.documents.insert_one(document)
    db.plants.update_one(
        {"id": plant["id"]},
        {"$inc": {"documents_count": 1}, "$set": {"last_upload_at": now, "updated_at": now}},
    )
    _record_activity(
        "Uploaded",
        document,
        user,
        {
            "uploadComment": document.get("upload_comment"),
            "fileName": document.get("file_name"),
            "contentType": document.get("content_type"),
            "sizeBytes": document.get("size_bytes"),
        },
    )
    _log_document_event(
        "info",
        "Document upload completed successfully",
        **_user_log_context(user),
        **_document_log_context(document),
        fileName=document.get("file_name"),
        contentType=document.get("content_type"),
        sizeBytes=document.get("size_bytes"),
    )
    record_audit_event(
        "Document Uploaded",
        user=user,
        resource_type="document",
        resource_id=document["id"],
        metadata={"plantId": document["plant_id"], "status": document["status"], "version": document["version"]},
    )
    return success_response(serialize_document(document, []), 201)


@documents_bp.get("/documents/<document_id>")
@require_auth()
def get_document(document_id: str):
    user = current_user()
    db = get_db()
    _log_document_event("info", "Document detail requested", **_user_log_context(user), documentId=document_id)
    document = db.documents.find_one({"id": document_id, "deleted_at": None})
    if not document:
        _log_document_event("warning", "Document detail request failed", **_user_log_context(user), documentId=document_id, reason="not_found")
        return error_response("Document not found", 404)
    if not _can_view_document(user, document):
        return error_response("You do not have permission to view this document", 403)
    _mark_document_accessed(document_id, user, mode="detail")
    comments = _visible_comments(document_id, user)
    _record_activity("Viewed", document, user, {"viewMode": "document"})
    _log_document_event(
        "info",
        "Document detail returned successfully",
        **_user_log_context(user),
        **_document_log_context(document),
        visibleComments=len(comments),
    )
    record_audit_event("Document Viewed", user=user, resource_type="document", resource_id=document_id)
    return success_response({"document": serialize_document(document, comments), "comments": [serialize_comment(c) for c in comments]})


@documents_bp.patch("/documents/<document_id>")
@require_auth()
def update_document(document_id: str):
    user = current_user()
    db = get_db()
    if not user_has_capability(user, "canEditDocuments", db):
        return error_response("You do not have permission to update documents", 403)
    _log_document_event("info", "Document update request received", **_user_log_context(user), documentId=document_id)
    document = db.documents.find_one({"id": document_id, "deleted_at": None})
    if not document:
        _log_document_event("warning", "Document update failed", **_user_log_context(user), documentId=document_id, reason="not_found")
        return error_response("Document not found", 404)
    if not _can_edit_document(user, document):
        _log_document_event(
            "warning",
            "Document update denied",
            **_user_log_context(user),
            **_document_log_context(document),
            reason="permission_denied",
        )
        if document.get("accessed_by") and user["role"] == "Mining Manager":
            return error_response("Document is locked after executive access and can no longer be changed by the uploader", 403)
        return error_response("You do not have permission to update this document", 403)

    body = request.form.to_dict() if request.files or request.form else parse_json_body()
    updates = {}
    for field, key in (("name", "name"), ("category", "category"), ("upload_comment", "uploadComment"), ("company", "company")):
        value = body.get(key)
        if value is not None:
            updates[field] = value.strip() if isinstance(value, str) else value

    status = body.get("status")
    if status is not None:
        if user["role"] not in {"CEO", "Admin"} and status != document.get("status"):
            _log_document_event(
                "warning",
                "Document status change denied",
                **_user_log_context(user),
                **_document_log_context(document),
                requestedStatus=status,
                currentStatus=document.get("status"),
            )
            return error_response("Only executives and admins can change document status", 403)
        updates["status"] = status
        _log_document_event(
            "info",
            "Document status change requested",
            **_user_log_context(user),
            **_document_log_context(document),
            previousStatus=document.get("status"),
            requestedStatus=status,
            approvalAction=status == "Approved",
        )

    file = request.files.get("file")
    if file and file.filename:
        validated = _validate_uploaded_file(file)
        if not validated:
            allowed_formats = ", ".join(ext.upper() for ext in allowed_upload_extensions())
            return error_response(f"Unsupported file type. Allowed uploads are: {allowed_formats}.", 400)
        safe_file_name, normalized_content_type = validated
        data = file.read()
        size_bytes = len(data)
        _log_document_event(
            "info",
            "Replacement file received for document update",
            **_user_log_context(user),
            **_document_log_context(document),
            fileName=file.filename,
            contentType=file.mimetype,
            sizeBytes=size_bytes,
            nextVersion=int(document.get("version", 1)) + 1,
        )
        if size_bytes > current_app.config["MAX_CONTENT_LENGTH"]:
            _log_document_event(
                "warning",
                "Document update rejected because replacement file is too large",
                **_user_log_context(user),
                **_document_log_context(document),
                fileName=file.filename,
                sizeBytes=size_bytes,
                maxAllowedBytes=current_app.config["MAX_CONTENT_LENGTH"],
            )
            return error_response("Uploaded file exceeds the configured size limit", 413)
        file_storage_id = get_fs().upload_from_stream(
            safe_file_name,
            io.BytesIO(data),
            metadata={"content_type": normalized_content_type},
        )
        updates.update(
            {
                "file_storage_id": file_storage_id,
                "file_name": safe_file_name,
                "content_type": normalized_content_type,
                "size_bytes": size_bytes,
                "version": int(document.get("version", 1)) + 1,
            }
        )
        _log_document_event(
            "info",
            "Replacement file stored in GridFS",
            **_user_log_context(user),
            **_document_log_context(document),
            fileName=file.filename,
            contentType=file.mimetype,
            sizeBytes=size_bytes,
            storageId=str(file_storage_id),
            nextVersion=updates["version"],
        )

    if not updates:
        _log_document_event(
            "warning",
            "Document update request contained no changes",
            **_user_log_context(user),
            **_document_log_context(document),
        )
        return error_response("No updates were supplied", 400)

    updates["updated_at"] = utc_now()
    changed_fields = sorted(updates.keys())
    previous_status = document.get("status")
    db.documents.update_one({"id": document_id}, {"$set": updates})
    updated = db.documents.find_one({"id": document_id})
    _record_activity(
        "Updated",
        updated,
        user,
        {
            "updatedFields": sorted(updates.keys()),
            "fileName": updated.get("file_name"),
            "contentType": updated.get("content_type"),
            "sizeBytes": updated.get("size_bytes"),
        },
    )
    _log_document_event(
        "info",
        "Document update completed successfully",
        **_user_log_context(user),
        **_document_log_context(updated),
        previousStatus=previous_status,
        updatedFields=changed_fields,
        fileName=updated.get("file_name"),
        contentType=updated.get("content_type"),
        sizeBytes=updated.get("size_bytes"),
        approvalCompleted=previous_status != updated.get("status") and updated.get("status") == "Approved",
    )
    record_audit_event(
        "Document Updated",
        user=user,
        resource_type="document",
        resource_id=document_id,
        metadata={"updatedFields": changed_fields, "status": updated.get("status"), "version": updated.get("version")},
    )
    comments = _visible_comments(document_id, user)
    return success_response(serialize_document(updated, comments))


@documents_bp.delete("/documents/<document_id>")
@require_auth()
def delete_document(document_id: str):
    user = current_user()
    db = get_db()
    if not user_has_capability(user, "canDeleteDocuments", db):
        return error_response("You do not have permission to delete documents", 403)
    _log_document_event("info", "Document delete request received", **_user_log_context(user), documentId=document_id)
    document = db.documents.find_one({"id": document_id, "deleted_at": None})
    if not document:
        _log_document_event("warning", "Document delete failed", **_user_log_context(user), documentId=document_id, reason="not_found")
        return error_response("Document not found", 404)
    if not _can_delete_document(user, document):
        _log_document_event(
            "warning",
            "Document delete denied",
            **_user_log_context(user),
            **_document_log_context(document),
            reason="permission_denied",
        )
        if document.get("accessed_by") and user["role"] == "Mining Manager":
            return error_response("Document is locked after executive access and can no longer be deleted by the uploader", 403)
        return error_response("You do not have permission to delete this document", 403)

    now = utc_now()
    db.documents.update_one({"id": document_id}, {"$set": {"deleted_at": now, "updated_at": now}})
    db.plants.update_one({"id": document["plant_id"]}, {"$inc": {"documents_count": -1}, "$set": {"updated_at": now}})
    _record_activity("Deleted", document, user, {"deletedAt": now.isoformat()})
    _log_document_event(
        "info",
        "Document deleted successfully",
        **_user_log_context(user),
        **_document_log_context(document),
        deletedAt=now.isoformat(),
    )
    record_audit_event("Document Deleted", user=user, resource_type="document", resource_id=document_id)
    return success_response({"message": "Document deleted"})


@documents_bp.get("/documents/<document_id>/download")
@require_auth()
def download_document(document_id: str):
    db = get_db()
    user = current_user()
    _log_document_event("info", "Document download requested", **_user_log_context(user), documentId=document_id)
    document = db.documents.find_one({"id": document_id, "deleted_at": None})
    if not document:
        _log_document_event("warning", "Document download failed", **_user_log_context(user), documentId=document_id, reason="not_found")
        return error_response("Document not found", 404)
    if not _can_view_document(user, document):
        return error_response("You do not have permission to download this document", 403)
    if not document.get("file_storage_id"):
        _log_document_event(
            "warning",
            "Document download failed because file is missing",
            **_user_log_context(user),
            **_document_log_context(document),
        )
        return error_response("No file is attached to this document", 404)
    _mark_document_accessed(document_id, user, mode="download")

    stream = io.BytesIO()
    get_fs().download_to_stream(document["file_storage_id"], stream)
    stream.seek(0)
    _record_activity(
        "Downloaded",
        document,
        user,
        {
            "fileName": document.get("file_name"),
            "contentType": document.get("content_type"),
            "sizeBytes": document.get("size_bytes"),
        },
    )
    _log_document_event(
        "info",
        "Document download prepared successfully",
        **_user_log_context(user),
        **_document_log_context(document),
        fileName=document.get("file_name"),
        contentType=document.get("content_type"),
        sizeBytes=document.get("size_bytes"),
    )
    record_audit_event("Document Downloaded", user=user, resource_type="document", resource_id=document_id)
    return send_file(
        stream,
        download_name=document.get("file_name") or f"{document_id}.bin",
        as_attachment=True,
        mimetype=document.get("content_type") or "application/octet-stream",
    )


@documents_bp.get("/documents/<document_id>/comments")
@require_auth()
def list_comments(document_id: str):
    db = get_db()
    user = current_user()
    _log_document_event("info", "Document comments requested", **_user_log_context(user), documentId=document_id)
    document = db.documents.find_one({"id": document_id, "deleted_at": None})
    if not document:
        _log_document_event("warning", "Document comments request failed", **_user_log_context(user), documentId=document_id, reason="not_found")
        return error_response("Document not found", 404)
    if not _can_view_document(user, document):
        return error_response("You do not have permission to view these comments", 403)
    comments = _visible_comments(document_id, user)
    _log_document_event(
        "info",
        "Document comments returned successfully",
        **_user_log_context(user),
        **_document_log_context(document),
        visibleComments=len(comments),
    )
    return success_response([serialize_comment(comment) for comment in comments])


@documents_bp.get("/documents/<document_id>/conversations")
@require_auth()
def list_document_conversations(document_id: str):
    db = get_db()
    user = current_user()
    _log_document_event("info", "Document conversations requested", **_user_log_context(user), documentId=document_id)
    document = db.documents.find_one({"id": document_id, "deleted_at": None})
    if not document:
        _log_document_event("warning", "Document conversations request failed", **_user_log_context(user), documentId=document_id, reason="not_found")
        return error_response("Document not found", 404)
    if not _can_view_document(user, document):
        return error_response("You do not have permission to view these conversations", 403)
    conversations = _visible_conversations(document_id, user)
    _log_document_event(
        "info",
        "Document conversations returned successfully",
        **_user_log_context(user),
        **_document_log_context(document),
        visibleConversations=len(conversations),
    )
    return success_response([serialize_document_conversation(message) for message in conversations])


@documents_bp.post("/documents/<document_id>/comments")
@require_auth(["CEO", "Admin"])
def add_comment(document_id: str):
    user = current_user()
    db = get_db()
    _log_document_event("info", "Document comment request received", **_user_log_context(user), documentId=document_id)
    document = db.documents.find_one({"id": document_id, "deleted_at": None})
    if not document:
        _log_document_event("warning", "Document comment failed", **_user_log_context(user), documentId=document_id, reason="not_found")
        return error_response("Document not found", 404)

    body = parse_json_body()
    text = (body.get("text") or "").strip()
    visibility = body.get("visibility", "private")
    if not text:
        _log_document_event(
            "warning",
            "Document comment validation failed",
            **_user_log_context(user),
            **_document_log_context(document),
            reason="missing_text",
        )
        return error_response("Comment text is required", 400)
    if visibility not in {"private", "public"}:
        _log_document_event(
            "warning",
            "Document comment validation failed",
            **_user_log_context(user),
            **_document_log_context(document),
            reason="invalid_visibility",
            visibility=visibility,
        )
        return error_response("Visibility must be either private or public", 400)

    now = utc_now()
    comment = {
        "id": next_public_id("comments", "CC"),
        "document_id": document_id,
        "author_id": user["id"],
        "author_name": user["name"],
        "role": user["role"],
        "text": text,
        "visibility": visibility,
        "created_at": now,
        "updated_at": now,
    }
    db.comments.insert_one(comment)
    if user["role"] == "CEO":
        _create_manager_notifications_for_comment(
            document,
            user,
            visibility,
            text,
            source_comment_id=comment["id"],
            created_at=now,
        )
        _log_document_event(
            "info",
            "CEO comment notification workflow executed",
            **_user_log_context(user),
            **_document_log_context(document),
            visibility=visibility,
            commentId=comment["id"],
        )
    _record_activity(
        "Commented",
        document,
        user,
        {
            "visibility": visibility,
            "commentLength": len(text),
        },
    )
    _log_document_event(
        "info",
        "Document comment added successfully",
        **_user_log_context(user),
        **_document_log_context(document),
        commentId=comment["id"],
        visibility=visibility,
        commentLength=len(text),
    )
    record_audit_event(
        "Document Commented",
        user=user,
        resource_type="document",
        resource_id=document_id,
        metadata={"visibility": visibility, "commentLength": len(text)},
    )
    return success_response(serialize_comment(comment), 201)


@documents_bp.post("/documents/<document_id>/conversations")
@require_auth()
def add_document_conversation(document_id: str):
    user = current_user()
    db = get_db()
    _log_document_event("info", "Document conversation request received", **_user_log_context(user), documentId=document_id)
    document = db.documents.find_one({"id": document_id, "deleted_at": None})
    if not document:
        _log_document_event("warning", "Document conversation failed", **_user_log_context(user), documentId=document_id, reason="not_found")
        return error_response("Document not found", 404)
    if not _can_view_document(user, document):
        return error_response("You do not have permission to post to this document conversation", 403)

    body = parse_json_body()
    text = (body.get("text") or "").strip()
    audience = (body.get("audience") or "workspace").strip()
    mention_ids = body.get("mentionIds") or []
    attachments = body.get("attachments") or []

    if not text:
        return error_response("Conversation text is required", 400)
    if audience not in {"workspace", "executive", "uploader"}:
        return error_response("Audience must be workspace, executive, or uploader", 400)
    if audience == "executive" and user["role"] not in {"CEO", "Admin"}:
        return error_response("Only executives and admins can post executive-only conversations", 403)
    if not isinstance(mention_ids, list):
        return error_response("mentionIds must be a list", 400)
    if not isinstance(attachments, list):
        return error_response("attachments must be a list", 400)

    sanitized_mention_ids = []
    mention_names = []
    for value in mention_ids[:10]:
        if not isinstance(value, str):
            continue
        recipient = db.users.find_one({"id": value, "status": "Active"})
        if not recipient:
            continue
        if audience == "executive" and recipient.get("role") not in {"CEO", "Admin"}:
            continue
        sanitized_mention_ids.append(recipient["id"])
        mention_names.append(recipient["name"])

    sanitized_attachments = [value for value in attachments[:5] if isinstance(value, str) and value.strip()]

    now = utc_now()
    message = {
        "id": next_public_id("document_conversations", "MSG"),
        "document_id": document_id,
        "document_uploader_id": document.get("uploaded_by_id"),
        "author_id": user["id"],
        "author_name": user["name"],
        "author_role": user["role"],
        "audience": audience,
        "text": text,
        "mention_ids": sanitized_mention_ids,
        "mention_names": mention_names,
        "attachments": sanitized_attachments,
        "created_at": now,
        "updated_at": now,
    }
    db.document_conversations.insert_one(message)
    _create_notifications_for_conversation(document, user, message)
    _record_activity(
        "Conversation Posted",
        document,
        user,
        {
            "audience": audience,
            "mentionCount": len(sanitized_mention_ids),
            "conversationLength": len(text),
        },
    )
    record_audit_event(
        "Document Conversation Posted",
        user=user,
        resource_type="document",
        resource_id=document_id,
        metadata={"audience": audience, "mentionCount": len(sanitized_mention_ids), "conversationLength": len(text)},
    )
    _log_document_event(
        "info",
        "Document conversation added successfully",
        **_user_log_context(user),
        **_document_log_context(document),
        conversationId=message["id"],
        audience=audience,
        mentionCount=len(sanitized_mention_ids),
    )
    return success_response(serialize_document_conversation(message), 201)
