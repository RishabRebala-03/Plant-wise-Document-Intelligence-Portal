from __future__ import annotations

from flask import Blueprint

from ..auth import current_user, require_auth
from ..db import get_db
from ..serializers import serialize_notification
from ..utils import ensure_utc, error_response, success_response, utc_now


notifications_bp = Blueprint("notifications", __name__)


def _build_exec_notifications(user: dict) -> list[dict]:
    db = get_db()
    preferences = user.get("notification_preferences", {})
    notifications: list[dict] = []

    if preferences.get("new_document_upload", True):
        recent_uploads = (
            db.activities.find({"action": "Uploaded", "document_id": {"$ne": None}})
            .sort("created_at", -1)
            .limit(5)
        )
        for activity in recent_uploads:
            metadata = activity.get("metadata", {})
            plant_name = metadata.get("plantName") or "Unknown plant"
            notifications.append(
                {
                    "id": f"exec-upload-{activity['id']}",
                    "user_id": user["id"],
                    "title": "New document uploaded",
                    "detail": f"{activity.get('user_name', 'A manager')} uploaded {activity.get('document_name', 'a document')} for {plant_name}.",
                    "href": f"/documents?docId={activity['document_id']}",
                    "document_id": activity.get("document_id"),
                    "type": "new_document_upload",
                    "read": False,
                    "created_at": activity.get("created_at"),
                    "read_at": None,
                }
            )

    if preferences.get("document_approval", True):
        approved_documents = (
            db.documents.find({"deleted_at": None, "status": "Approved"})
            .sort("updated_at", -1)
            .limit(5)
        )
        for document in approved_documents:
            updated_at = ensure_utc(document.get("updated_at"))
            uploaded_at = ensure_utc(document.get("uploaded_at"))
            if uploaded_at and updated_at and updated_at <= uploaded_at:
                continue
            notifications.append(
                {
                    "id": f"exec-approval-{document['id']}",
                    "user_id": user["id"],
                    "title": "Approval update",
                    "detail": f"{document['name']} is approved and ready for executive review.",
                    "href": f"/documents?docId={document['id']}",
                    "document_id": document["id"],
                    "type": "document_approval",
                    "read": False,
                    "created_at": document.get("updated_at") or document.get("uploaded_at"),
                    "read_at": None,
                }
            )

    if preferences.get("weekly_summary_report", False):
        recent_upload_count = db.documents.count_documents({"deleted_at": None})
        notifications.append(
            {
                "id": "exec-weekly-summary",
                "user_id": user["id"],
                "title": "Weekly summary available",
                "detail": f"{recent_upload_count} total documents are available in the latest system snapshot.",
                "href": "/analytics",
                "document_id": None,
                "type": "weekly_summary_report",
                "read": False,
                "created_at": utc_now(),
                "read_at": None,
            }
        )

    if preferences.get("system_alerts", True):
        action_required_document = db.documents.find_one(
            {"deleted_at": None, "status": "Action Required"},
            sort=[("updated_at", -1)],
        )
        if action_required_document:
            notifications.append(
                {
                    "id": f"exec-system-alert-{action_required_document['id']}",
                    "user_id": user["id"],
                    "title": "System alert",
                    "detail": f"{action_required_document['name']} still requires follow-up action.",
                    "href": f"/documents?docId={action_required_document['id']}",
                    "document_id": action_required_document["id"],
                    "type": "system_alert",
                    "read": False,
                    "created_at": action_required_document.get("updated_at") or action_required_document.get("uploaded_at"),
                    "read_at": None,
                }
            )

    notifications.sort(key=lambda item: ensure_utc(item.get("created_at")) or utc_now(), reverse=True)
    return notifications[:20]


@notifications_bp.get("/notifications")
@require_auth()
def list_notifications():
    user = current_user()
    db = get_db()

    if user["role"] in {"CEO", "Admin"}:
        notifications = _build_exec_notifications(user)
        return success_response(
            {
                "items": [serialize_notification(notification) for notification in notifications],
                "unreadCount": len(notifications),
            }
        )

    notifications = []
    cursor = db.notifications.find({"user_id": user["id"]}).sort("created_at", -1)
    for notification in cursor:
        if notification.get("type") == "ceo_comment":
            source_comment_id = notification.get("source_comment_id")
            if not source_comment_id:
                continue
            comment = db.comments.find_one({"id": source_comment_id})
            if not comment or comment.get("role") != "CEO" or comment.get("visibility") != "public":
                continue
        notifications.append(notification)
        if len(notifications) >= 20:
            break

    return success_response(
        {
            "items": [serialize_notification(notification) for notification in notifications],
            "unreadCount": sum(1 for notification in notifications if not notification.get("read")),
        }
    )


@notifications_bp.post("/notifications/<notification_id>/read")
@require_auth()
def mark_notification_read(notification_id: str):
    user = current_user()
    db = get_db()
    notification = db.notifications.find_one({"id": notification_id, "user_id": user["id"]})
    if not notification:
        return error_response("Notification not found", 404)
    if not notification.get("read"):
        db.notifications.update_one(
            {"id": notification_id, "user_id": user["id"]},
            {"$set": {"read": True, "read_at": utc_now()}},
        )
    updated = db.notifications.find_one({"id": notification_id, "user_id": user["id"]})
    return success_response(serialize_notification(updated))
