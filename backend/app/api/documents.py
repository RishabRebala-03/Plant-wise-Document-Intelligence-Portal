from __future__ import annotations

import csv
import io
from flask import Blueprint, Response, current_app, request, send_file

from ..auth import current_user, require_auth
from ..db import get_db, get_fs, next_public_id
from ..serializers import serialize_comment, serialize_document
from ..utils import error_response, get_pagination, parse_bool, parse_json_body, success_response, utc_now


documents_bp = Blueprint("documents", __name__)


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
            "metadata": metadata or {},
            "created_at": utc_now(),
        }
    )


def _document_query_for_user(user: dict) -> dict:
    base = {"deleted_at": None}
    if user["role"] == "Mining Manager" and request.args.get("scope") == "mine":
        base["uploaded_by_id"] = user["id"]
    return base


def _visible_comments(document_id: str, user: dict) -> list[dict]:
    db = get_db()
    query = {"document_id": document_id}
    if user["role"] not in {"CEO", "Admin"}:
        query["visibility"] = "public"
    return list(db.comments.find(query).sort("created_at", -1))


def _can_manage_document(user: dict, document: dict) -> bool:
    if user["role"] in {"CEO", "Admin"}:
        return True
    return document.get("uploaded_by_id") == user["id"]


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
    form = request.form.to_dict() if request.files or request.form else parse_json_body()
    plant_id = form.get("plantId") or form.get("plant_id")
    plant_name = form.get("plant") or form.get("plantName")
    name = (form.get("name") or "").strip()
    category = (form.get("category") or "").strip()
    upload_comment = (form.get("uploadComment") or form.get("comments") or "").strip()
    company = (form.get("company") or "Midwest Ltd").strip()
    status = (form.get("status") or "In Review").strip()

    if not name or not category:
        return error_response("Document name and category are required", 400)
    if not plant_id and not plant_name:
        return error_response("Plant selection is required", 400)

    plant = db.plants.find_one({"id": plant_id}) if plant_id else db.plants.find_one({"name": plant_name})
    if not plant:
        return error_response("Plant not found", 404)
    if user["role"] == "Mining Manager" and user.get("plant_id") and user["plant_id"] != plant["id"]:
        return error_response("Managers can only upload documents for their assigned plant", 403)

    file = request.files.get("file")
    file_storage_id = None
    file_name = None
    content_type = None
    size_bytes = None
    if file and file.filename:
        data = file.read()
        size_bytes = len(data)
        if size_bytes > current_app.config["MAX_CONTENT_LENGTH"]:
            return error_response("Uploaded file exceeds the configured size limit", 413)
        file_storage_id = get_fs().upload_from_stream(file.filename, io.BytesIO(data), metadata={"content_type": file.mimetype})
        file_name = file.filename
        content_type = file.mimetype

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
    }
    db.documents.insert_one(document)
    db.plants.update_one(
        {"id": plant["id"]},
        {"$inc": {"documents_count": 1}, "$set": {"last_upload_at": now, "updated_at": now}},
    )
    _record_activity("Uploaded", document, user)
    return success_response(serialize_document(document, []), 201)


@documents_bp.get("/documents/<document_id>")
@require_auth()
def get_document(document_id: str):
    user = current_user()
    db = get_db()
    document = db.documents.find_one({"id": document_id, "deleted_at": None})
    if not document:
        return error_response("Document not found", 404)
    comments = _visible_comments(document_id, user)
    _record_activity("Viewed", document, user)
    return success_response({"document": serialize_document(document, comments), "comments": [serialize_comment(c) for c in comments]})


@documents_bp.patch("/documents/<document_id>")
@require_auth()
def update_document(document_id: str):
    user = current_user()
    db = get_db()
    document = db.documents.find_one({"id": document_id, "deleted_at": None})
    if not document:
        return error_response("Document not found", 404)
    if not _can_manage_document(user, document):
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
            return error_response("Only executives and admins can change document status", 403)
        updates["status"] = status

    file = request.files.get("file")
    if file and file.filename:
        data = file.read()
        size_bytes = len(data)
        if size_bytes > current_app.config["MAX_CONTENT_LENGTH"]:
            return error_response("Uploaded file exceeds the configured size limit", 413)
        file_storage_id = get_fs().upload_from_stream(file.filename, io.BytesIO(data), metadata={"content_type": file.mimetype})
        updates.update(
            {
                "file_storage_id": file_storage_id,
                "file_name": file.filename,
                "content_type": file.mimetype,
                "size_bytes": size_bytes,
                "version": int(document.get("version", 1)) + 1,
            }
        )

    if not updates:
        return error_response("No updates were supplied", 400)

    updates["updated_at"] = utc_now()
    db.documents.update_one({"id": document_id}, {"$set": updates})
    updated = db.documents.find_one({"id": document_id})
    _record_activity("Updated", updated, user, {"updatedFields": sorted(updates.keys())})
    comments = _visible_comments(document_id, user)
    return success_response(serialize_document(updated, comments))


@documents_bp.delete("/documents/<document_id>")
@require_auth()
def delete_document(document_id: str):
    user = current_user()
    db = get_db()
    document = db.documents.find_one({"id": document_id, "deleted_at": None})
    if not document:
        return error_response("Document not found", 404)
    if not _can_manage_document(user, document):
        return error_response("You do not have permission to delete this document", 403)

    now = utc_now()
    db.documents.update_one({"id": document_id}, {"$set": {"deleted_at": now, "updated_at": now}})
    db.plants.update_one({"id": document["plant_id"]}, {"$inc": {"documents_count": -1}, "$set": {"updated_at": now}})
    _record_activity("Deleted", document, user)
    return success_response({"message": "Document deleted"})


@documents_bp.get("/documents/<document_id>/download")
@require_auth()
def download_document(document_id: str):
    db = get_db()
    document = db.documents.find_one({"id": document_id, "deleted_at": None})
    if not document:
        return error_response("Document not found", 404)
    if not document.get("file_storage_id"):
        return error_response("No file is attached to this document", 404)

    stream = io.BytesIO()
    get_fs().download_to_stream(document["file_storage_id"], stream)
    stream.seek(0)
    _record_activity("Downloaded", document, current_user())
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
    document = db.documents.find_one({"id": document_id, "deleted_at": None})
    if not document:
        return error_response("Document not found", 404)
    comments = _visible_comments(document_id, current_user())
    return success_response([serialize_comment(comment) for comment in comments])


@documents_bp.post("/documents/<document_id>/comments")
@require_auth(["CEO", "Admin"])
def add_comment(document_id: str):
    user = current_user()
    db = get_db()
    document = db.documents.find_one({"id": document_id, "deleted_at": None})
    if not document:
        return error_response("Document not found", 404)

    body = parse_json_body()
    text = (body.get("text") or "").strip()
    visibility = body.get("visibility", "private")
    if not text:
        return error_response("Comment text is required", 400)
    if visibility not in {"private", "public"}:
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
    _record_activity("Commented", document, user, {"visibility": visibility})
    return success_response(serialize_comment(comment), 201)
