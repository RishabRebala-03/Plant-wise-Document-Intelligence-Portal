from __future__ import annotations

from flask import Blueprint

from ..auth import current_user, require_auth
from ..db import get_db, next_public_id
from ..serializers import serialize_message_entry, serialize_message_thread, serialize_user
from ..utils import error_response, parse_json_body, success_response, utc_now


messages_bp = Blueprint("messages", __name__)


def _resolve_participants(participant_ids: list[str]) -> list[dict]:
    db = get_db()
    participants = list(db.users.find({"id": {"$in": participant_ids}, "status": "Active"}))
    participants_by_id = {participant["id"]: participant for participant in participants}
    return [participants_by_id[participant_id] for participant_id in participant_ids if participant_id in participants_by_id]


def _resolve_linked_documents(document_ids: list[str], viewer: dict) -> list[dict]:
    db = get_db()
    rows = []
    for document in db.documents.find({"id": {"$in": document_ids}, "deleted_at": None}):
        rows.append(
            {
                "id": document["id"],
                "name": document["name"],
                "plant": document.get("plant_name"),
                "category": document.get("category"),
            }
        )
    rows_by_id = {row["id"]: row for row in rows}
    return [rows_by_id[document_id] for document_id in document_ids if document_id in rows_by_id]


def _participant_state(thread: dict, user_id: str) -> dict | None:
    for participant in thread.get("participant_state", []):
        if participant.get("user_id") == user_id:
            return participant
    return None


def _participant_name(thread: dict, user_id: str) -> str | None:
    for participant in thread.get("participants", []):
        if participant.get("id") == user_id:
            return participant.get("name")
    return None


def _unread_count(thread: dict, user_id: str) -> int:
    db = get_db()
    state = _participant_state(thread, user_id)
    last_read_at = state.get("last_read_at") if state else None
    query = {"thread_id": thread["id"], "author_id": {"$ne": user_id}}
    if last_read_at:
        query["created_at"] = {"$gt": last_read_at}
    return int(db.message_entries.count_documents(query))


def _decorate_message(message: dict, thread: dict, viewer_id: str) -> dict:
    participant_state = thread.get("participant_state", [])
    recipient_count = max(len(thread.get("participant_ids", [])) - 1, 0)
    read_by_user_ids = [
        state.get("user_id")
        for state in participant_state
        if state.get("user_id") != message["author_id"]
        and state.get("last_read_at")
        and state["last_read_at"] >= message["created_at"]
    ]
    read_by_names = [
        name
        for user_id in read_by_user_ids
        if (name := _participant_name(thread, user_id))
    ]
    last_read_at = None
    if read_by_user_ids:
        last_read_at = max(
            state.get("last_read_at")
            for state in participant_state
            if state.get("user_id") in read_by_user_ids and state.get("last_read_at")
        )

    receipt_status = None
    if viewer_id == message["author_id"]:
        if read_by_user_ids:
            receipt_status = "read"
        elif recipient_count:
            receipt_status = "delivered"
        else:
            receipt_status = "sent"

    return {
        **message,
        "recipient_count": recipient_count,
        "read_by_count": len(read_by_user_ids),
        "read_by_names": read_by_names,
        "receipt_status": receipt_status,
        "last_read_at": last_read_at,
    }


def _record_message_activity(action: str, thread: dict, user: dict, metadata: dict | None = None):
    db = get_db()
    db.activities.insert_one(
        {
            "id": next_public_id("activities", "EVT"),
            "action": action,
            "entity_type": "message_thread",
            "entity_id": thread["id"],
            "user_id": user["id"],
            "user_name": user["name"],
            "metadata": {
                "threadId": thread["id"],
                "threadTitle": thread.get("title"),
                "threadKind": thread.get("kind", "direct"),
                "participantIds": thread.get("participant_ids", []),
                "participantNames": [participant.get("name") for participant in thread.get("participants", [])],
                "linkedDocumentIds": [document.get("id") for document in thread.get("linked_documents", [])],
                **(metadata or {}),
            },
            "created_at": utc_now(),
        }
    )


def _create_portal_message_notification(*, recipient_id: str, detail: str, href: str, now, thread_id: str, message_id: str | None = None):
    db = get_db()
    notification_id = next_public_id("notifications", "NTF")
    source_key = f"{thread_id}:{message_id or 'thread'}:{recipient_id}:{notification_id}"
    db.notifications.insert_one(
        {
            "id": notification_id,
            "user_id": recipient_id,
            "title": "New portal message",
            "detail": detail,
            "href": href,
            "type": "portal_message",
            "source_comment_id": source_key,
            "source_conversation_id": source_key,
            "read": False,
            "created_at": now,
            "read_at": None,
        }
    )


def _hydrate_thread(thread: dict, user_id: str) -> dict:
    state = _participant_state(thread, user_id)
    last_message_at = thread.get("last_message_at")
    last_read_at = state.get("last_read_at") if state else None
    unread_count = _unread_count(thread, user_id)
    return {
        **thread,
        "unread": unread_count > 0,
        "unread_count": unread_count,
    }


@messages_bp.get("/messages/threads")
@require_auth()
def list_message_threads():
    db = get_db()
    user = current_user()
    threads = list(
        db.message_threads.find({"participant_ids": user["id"]}).sort("updated_at", -1)
    )
    return success_response([serialize_message_thread(_hydrate_thread(thread, user["id"])) for thread in threads])


@messages_bp.get("/messages/contacts")
@require_auth()
def list_message_contacts():
    db = get_db()
    user = current_user()
    contacts = list(
        db.users.find({"status": "Active", "id": {"$ne": user["id"]}}).sort("name", 1)
    )
    return success_response([serialize_user(contact) for contact in contacts])


@messages_bp.post("/messages/threads")
@require_auth()
def create_message_thread():
    db = get_db()
    user = current_user()
    body = parse_json_body()
    title = (body.get("title") or "").strip()
    participant_ids = body.get("participantIds") or []
    document_ids = body.get("documentIds") or []
    opening_text = (body.get("openingText") or "").strip()

    if not isinstance(participant_ids, list) or not participant_ids:
        return error_response("Select at least one participant", 400)
    if not isinstance(document_ids, list):
        return error_response("documentIds must be a list", 400)

    deduped_participant_ids = []
    for participant_id in participant_ids:
        if isinstance(participant_id, str) and participant_id not in deduped_participant_ids and participant_id != user["id"]:
            deduped_participant_ids.append(participant_id)

    resolved_participants = _resolve_participants([user["id"], *deduped_participant_ids])
    if len(resolved_participants) < 2:
        return error_response("At least one valid participant is required", 400)

    all_participant_ids = [participant["id"] for participant in resolved_participants]
    linked_documents = _resolve_linked_documents([document_id for document_id in document_ids if isinstance(document_id, str)], user)
    kind = "group" if len(all_participant_ids) > 2 else "direct"
    now = utc_now()

    existing = None
    if kind == "direct":
        existing = db.message_threads.find_one({"kind": "direct", "participant_ids": {"$all": all_participant_ids, "$size": len(all_participant_ids)}})
    if existing:
        return success_response(serialize_message_thread(_hydrate_thread(existing, user["id"])))

    thread = {
        "id": next_public_id("message_threads", "THR"),
        "title": title or None,
        "kind": kind,
        "participant_ids": all_participant_ids,
        "participants": [
            {"id": participant["id"], "name": participant["name"], "role": participant["role"]}
            for participant in resolved_participants
        ],
        "participant_state": [
            {"user_id": participant["id"], "last_read_at": now if participant["id"] == user["id"] else None}
            for participant in resolved_participants
        ],
        "linked_documents": linked_documents,
        "last_message_preview": opening_text[:120] if opening_text else None,
        "last_message_at": now if opening_text else None,
        "created_at": now,
        "updated_at": now,
    }
    db.message_threads.insert_one(thread)

    if opening_text:
        message = {
            "id": next_public_id("message_entries", "MSG"),
            "thread_id": thread["id"],
            "author_id": user["id"],
            "author_name": user["name"],
            "author_role": user["role"],
            "text": opening_text,
            "linked_documents": linked_documents,
            "created_at": now,
            "updated_at": now,
        }
        db.message_entries.insert_one(message)
        db.message_threads.update_one(
            {"id": thread["id"]},
            {"$set": {"last_message_preview": opening_text[:120], "last_message_at": now, "updated_at": now}},
        )

    _record_message_activity(
        "Message Thread Created",
        thread,
        user,
        {
            "openingMessage": bool(opening_text),
            "recipientCount": max(len(all_participant_ids) - 1, 0),
        },
    )

    for participant in resolved_participants:
        if participant["id"] == user["id"]:
            continue
        _create_portal_message_notification(
            recipient_id=participant["id"],
            detail=f"{user['name']} started a conversation with you.",
            href=f"/messages?threadId={thread['id']}",
            now=now,
            thread_id=thread["id"],
        )

    stored = db.message_threads.find_one({"id": thread["id"]})
    return success_response(serialize_message_thread(_hydrate_thread(stored, user["id"])), 201)


@messages_bp.get("/messages/threads/<thread_id>/messages")
@require_auth()
def list_thread_messages(thread_id: str):
    db = get_db()
    user = current_user()
    thread = db.message_threads.find_one({"id": thread_id})
    if not thread:
        return error_response("Thread not found", 404)
    if user["id"] not in thread.get("participant_ids", []):
        return error_response("You do not have permission to view this thread", 403)

    now = utc_now()
    prior_last_read_at = _participant_state(thread, user["id"]).get("last_read_at") if _participant_state(thread, user["id"]) else None
    unread_before_open = db.message_entries.count_documents(
        {
            "thread_id": thread_id,
            "author_id": {"$ne": user["id"]},
            **({"created_at": {"$gt": prior_last_read_at}} if prior_last_read_at else {}),
        }
    )
    db.message_threads.update_one(
        {"id": thread_id, "participant_state.user_id": user["id"]},
        {"$set": {"participant_state.$.last_read_at": now, "updated_at": now}},
    )
    if unread_before_open:
        db.notifications.update_many(
            {
                "user_id": user["id"],
                "type": "portal_message",
                "href": f"/messages?threadId={thread_id}",
                "read": False,
            },
            {"$set": {"read": True, "read_at": now}},
        )
        _record_message_activity(
            "Message Thread Read",
            thread,
            user,
            {"unreadMessagesCleared": int(unread_before_open)},
        )
    thread = db.message_threads.find_one({"id": thread_id}) or thread
    messages = list(db.message_entries.find({"thread_id": thread_id}).sort("created_at", 1))
    return success_response([serialize_message_entry(_decorate_message(message, thread, user["id"])) for message in messages])


@messages_bp.post("/messages/threads/<thread_id>/messages")
@require_auth()
def post_thread_message(thread_id: str):
    db = get_db()
    user = current_user()
    thread = db.message_threads.find_one({"id": thread_id})
    if not thread:
        return error_response("Thread not found", 404)
    if user["id"] not in thread.get("participant_ids", []):
        return error_response("You do not have permission to post in this thread", 403)

    body = parse_json_body()
    text = (body.get("text") or "").strip()
    document_ids = body.get("documentIds") or []
    if not text:
        return error_response("Message text is required", 400)
    if not isinstance(document_ids, list):
        return error_response("documentIds must be a list", 400)

    linked_documents = _resolve_linked_documents([document_id for document_id in document_ids if isinstance(document_id, str)], user)
    now = utc_now()
    message = {
        "id": next_public_id("message_entries", "MSG"),
        "thread_id": thread_id,
        "author_id": user["id"],
        "author_name": user["name"],
        "author_role": user["role"],
        "text": text,
        "linked_documents": linked_documents,
        "created_at": now,
        "updated_at": now,
    }
    db.message_entries.insert_one(message)
    db.message_threads.update_one(
        {"id": thread_id},
        {
            "$set": {
                "last_message_preview": text[:120],
                "last_message_at": now,
                "updated_at": now,
            }
        },
    )
    db.message_threads.update_one(
        {"id": thread_id, "participant_state.user_id": user["id"]},
        {"$set": {"participant_state.$.last_read_at": now}},
    )
    _record_message_activity(
        "Message Sent",
        thread,
        user,
        {
            "messageId": message["id"],
            "characterCount": len(text),
            "attachmentCount": len(linked_documents),
        },
    )

    for participant in thread.get("participants", []):
        participant_id = participant.get("id")
        if not participant_id or participant_id == user["id"]:
            continue
        _create_portal_message_notification(
            recipient_id=participant_id,
            detail=f"{user['name']}: {text[:80]}{'...' if len(text) > 80 else ''}",
            href=f"/messages?threadId={thread_id}",
            now=now,
            thread_id=thread_id,
            message_id=message["id"],
        )

    updated_thread = db.message_threads.find_one({"id": thread_id}) or thread
    return success_response(serialize_message_entry(_decorate_message(message, updated_thread, user["id"])), 201)
