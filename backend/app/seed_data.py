from __future__ import annotations

import sys
from pathlib import Path
from datetime import datetime, timezone

from flask import Flask

try:
    from .auth import hash_password
    from .config import Config
    from .db import get_db, init_db, set_sequence_value
    from .utils import utc_now
except ImportError:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from app.auth import hash_password
    from app.config import Config
    from app.db import get_db, init_db, set_sequence_value
    from app.utils import utc_now


PLANTS = [
    {
        "id": "P001",
        "name": "Plant Alpha - Bloomington",
        "company": "Midwest Ltd",
        "documents_count": 142,
        "last_upload_at": datetime(2026, 4, 8, tzinfo=timezone.utc),
        "status": "Operational",
        "capacity": "3.2M tons/yr",
        "location": "Bloomington, IL",
        "manager_name": "John Carter",
    },
    {
        "id": "P002",
        "name": "Plant Beta - Springfield",
        "company": "Midwest Ltd",
        "documents_count": 98,
        "last_upload_at": datetime(2026, 4, 7, tzinfo=timezone.utc),
        "status": "Operational",
        "capacity": "2.1M tons/yr",
        "location": "Springfield, IL",
        "manager_name": "Sarah Miller",
    },
    {
        "id": "P003",
        "name": "Plant Gamma - Decatur",
        "company": "Midwest Ltd",
        "documents_count": 67,
        "last_upload_at": datetime(2026, 4, 5, tzinfo=timezone.utc),
        "status": "Operational",
        "capacity": "1.8M tons/yr",
        "location": "Decatur, IL",
        "manager_name": "Tom Bradley",
    },
    {
        "id": "P004",
        "name": "Plant Delta - Peoria",
        "company": "Midwest Ltd",
        "documents_count": 53,
        "last_upload_at": datetime(2026, 3, 29, tzinfo=timezone.utc),
        "status": "Review Required",
        "capacity": "1.4M tons/yr",
        "location": "Peoria, IL",
        "manager_name": "Mike Reynolds",
    },
    {
        "id": "P005",
        "name": "Plant Epsilon - Rockford",
        "company": "Midwest Ltd",
        "documents_count": 31,
        "last_upload_at": datetime(2026, 4, 10, tzinfo=timezone.utc),
        "status": "Operational",
        "capacity": "0.9M tons/yr",
        "location": "Rockford, IL",
        "manager_name": "Sarah Miller",
    },
]


USERS = [
    {"id": "U001", "name": "David Richardson", "email": "d.richardson@midwestltd.com", "role": "CEO", "status": "Active", "plant_name": "All"},
    {"id": "U002", "name": "John Carter", "email": "j.carter@midwestltd.com", "role": "Mining Manager", "status": "Active", "plant_name": "Plant Alpha - Bloomington"},
    {"id": "U003", "name": "Sarah Miller", "email": "s.miller@midwestltd.com", "role": "Mining Manager", "status": "Active", "plant_name": "Plant Beta - Springfield"},
    {"id": "U004", "name": "Mike Reynolds", "email": "m.reynolds@midwestltd.com", "role": "Mining Manager", "status": "Active", "plant_name": "Plant Alpha - Bloomington"},
    {"id": "U005", "name": "Admin User", "email": "admin@midwestltd.com", "role": "Admin", "status": "Active", "plant_name": "All"},
    {"id": "U006", "name": "Tom Bradley", "email": "t.bradley@midwestltd.com", "role": "Mining Manager", "status": "Disabled", "plant_name": "Plant Gamma - Decatur"},
]


DOCUMENTS = [
    {"id": "D001", "name": "Q1 Safety Audit Report", "plant_name": "Plant Alpha - Bloomington", "category": "Safety Report", "uploaded_by": "John Carter", "uploaded_at": datetime(2026, 4, 8, tzinfo=timezone.utc), "version": 2, "upload_comment": "Q1 mandatory audit - all sections reviewed and signed off.", "status": "Approved"},
    {"id": "D002", "name": "Environmental Impact Assessment", "plant_name": "Plant Beta - Springfield", "category": "Environmental Compliance", "uploaded_by": "Sarah Miller", "uploaded_at": datetime(2026, 4, 7, tzinfo=timezone.utc), "version": 1, "upload_comment": "Annual EIA submission for regulatory filing.", "status": "Approved"},
    {"id": "D003", "name": "Conveyor Belt Inspection - March", "plant_name": "Plant Gamma - Decatur", "category": "Equipment Inspection", "uploaded_by": "John Carter", "uploaded_at": datetime(2026, 4, 5, tzinfo=timezone.utc), "version": 1, "upload_comment": "Routine monthly inspection - minor wear noted on belt #3.", "status": "In Review"},
    {"id": "D004", "name": "Production Log - Week 14", "plant_name": "Plant Alpha - Bloomington", "category": "Production Log", "uploaded_by": "Mike Reynolds", "uploaded_at": datetime(2026, 4, 4, tzinfo=timezone.utc), "version": 1, "upload_comment": "Weekly production metrics, targets met at 98%.", "status": "Approved"},
    {"id": "D005", "name": "Incident Report - Near Miss #47", "plant_name": "Plant Delta - Peoria", "category": "Incident Report", "uploaded_by": "Sarah Miller", "uploaded_at": datetime(2026, 4, 3, tzinfo=timezone.utc), "version": 1, "upload_comment": "Near miss during shift change. Full RCA attached.", "status": "Action Required"},
    {"id": "D006", "name": "Crusher Maintenance Log", "plant_name": "Plant Epsilon - Rockford", "category": "Maintenance Record", "uploaded_by": "John Carter", "uploaded_at": datetime(2026, 4, 10, tzinfo=timezone.utc), "version": 3, "upload_comment": "Third revision following replacement of crusher jaw plates.", "status": "Approved"},
    {"id": "D007", "name": "Mining Permit Renewal 2026", "plant_name": "Plant Beta - Springfield", "category": "Permit", "uploaded_by": "Admin User", "uploaded_at": datetime(2026, 4, 1, tzinfo=timezone.utc), "version": 1, "upload_comment": "Annual permit renewal submitted to state authority.", "status": "In Review"},
    {"id": "D008", "name": "Blasting Safety Protocol v4", "plant_name": "Plant Alpha - Bloomington", "category": "Safety Report", "uploaded_by": "Mike Reynolds", "uploaded_at": datetime(2026, 3, 30, tzinfo=timezone.utc), "version": 4, "upload_comment": "Updated protocol with new exclusion zone distances.", "status": "Approved"},
    {"id": "D009", "name": "Water Discharge Compliance", "plant_name": "Plant Gamma - Decatur", "category": "Environmental Compliance", "uploaded_by": "Sarah Miller", "uploaded_at": datetime(2026, 3, 28, tzinfo=timezone.utc), "version": 2, "upload_comment": "Revised after Q4 regulatory feedback.", "status": "Approved"},
    {"id": "D010", "name": "Heavy Equipment Check - Loader #3", "plant_name": "Plant Delta - Peoria", "category": "Equipment Inspection", "uploaded_by": "John Carter", "uploaded_at": datetime(2026, 3, 25, tzinfo=timezone.utc), "version": 1, "upload_comment": "Pre-shift equipment inspection log for Loader #3.", "status": "Draft"},
]


COMMENTS = {
    "D001": [
        {"id": "CC001", "text": "Reviewed - no issues found. Approved for board filing.", "created_at": datetime(2026, 4, 9, tzinfo=timezone.utc), "visibility": "private", "author": "David Richardson"},
        {"id": "CC002", "text": "Share summary with shareholders in Q1 report.", "created_at": datetime(2026, 4, 9, tzinfo=timezone.utc), "visibility": "public", "author": "David Richardson"},
    ],
    "D002": [
        {"id": "CC003", "text": "EIA looks thorough. Good work by Springfield team.", "created_at": datetime(2026, 4, 8, tzinfo=timezone.utc), "visibility": "public", "author": "David Richardson"},
    ],
    "D005": [
        {"id": "CC004", "text": "Serious concern - follow up directly with site manager for RCA completion.", "created_at": datetime(2026, 4, 5, tzinfo=timezone.utc), "visibility": "private", "author": "David Richardson"},
        {"id": "CC005", "text": "Escalate to HSE committee for review.", "created_at": datetime(2026, 4, 6, tzinfo=timezone.utc), "visibility": "private", "author": "David Richardson"},
    ],
    "D008": [
        {"id": "CC006", "text": "Protocol update is approved. Communicate to all blasting crews.", "created_at": datetime(2026, 4, 1, tzinfo=timezone.utc), "visibility": "public", "author": "David Richardson"},
    ],
}


ACTIVITIES = [
    {"id": "EVT001", "action": "Uploaded", "document_id": "D001", "document_name": "Q1 Safety Audit Report", "user_name": "John Carter", "created_at": datetime(2026, 4, 8, 9, 14, tzinfo=timezone.utc)},
    {"id": "EVT002", "action": "Replaced", "document_id": "D006", "document_name": "Crusher Maintenance Log", "user_name": "John Carter", "created_at": datetime(2026, 4, 10, 11, 32, tzinfo=timezone.utc)},
    {"id": "EVT003", "action": "Viewed", "document_id": "D004", "document_name": "Production Log - Week 14", "user_name": "John Carter", "created_at": datetime(2026, 4, 4, 14, 5, tzinfo=timezone.utc)},
    {"id": "EVT004", "action": "Uploaded", "document_id": "D003", "document_name": "Conveyor Belt Inspection - March", "user_name": "John Carter", "created_at": datetime(2026, 4, 5, 8, 47, tzinfo=timezone.utc)},
    {"id": "EVT005", "action": "Uploaded", "document_id": "D010", "document_name": "Heavy Equipment Check - Loader #3", "user_name": "John Carter", "created_at": datetime(2026, 3, 25, 10, 22, tzinfo=timezone.utc)},
    {"id": "EVT006", "action": "Downloaded", "document_id": "D001", "document_name": "Q1 Safety Audit Report", "user_name": "John Carter", "created_at": datetime(2026, 4, 9, 15, 0, tzinfo=timezone.utc)},
]


def seed_demo_data():
    db = get_db()
    if db.users.count_documents({}) > 0:
        return

    now = utc_now()
    db.plants.insert_many(PLANTS)
    plant_by_name = {plant["name"]: plant for plant in PLANTS}

    password_hash = hash_password(Config.DEFAULT_DEMO_PASSWORD)
    user_docs = []
    for user in USERS:
        first_name, last_name = user["name"].split(" ", 1)
        plant = plant_by_name.get(user["plant_name"])
        user_docs.append(
            {
                **user,
                "first_name": first_name,
                "last_name": last_name,
                "plant_id": plant["id"] if plant else None,
                "password_hash": password_hash,
                "notification_preferences": {
                    "new_document_upload": True,
                    "document_approval": True,
                    "weekly_summary_report": False,
                    "system_alerts": True,
                    "ceo_note_added": user["role"] == "Mining Manager",
                },
                "display_preferences": {
                    "table_density": "Default",
                    "language": "English (US)",
                    "date_format": "YYYY-MM-DD",
                },
                "security": {
                    "two_factor_enabled": False,
                    "last_password_change_at": now,
                },
                "created_at": now,
                "updated_at": now,
            }
        )
    db.users.insert_many(user_docs)
    users_by_name = {user["name"]: user for user in user_docs}

    document_docs = []
    for document in DOCUMENTS:
        plant = plant_by_name[document["plant_name"]]
        uploader = users_by_name[document["uploaded_by"]]
        document_docs.append(
            {
                **document,
                "plant_id": plant["id"],
                "company": plant["company"],
                "uploaded_by_id": uploader["id"],
                "uploaded_by_name": uploader["name"],
                "file_name": None,
                "content_type": None,
                "size_bytes": None,
                "file_storage_id": None,
                "created_at": document["uploaded_at"],
                "updated_at": document["uploaded_at"],
                "deleted_at": None,
            }
        )
    db.documents.insert_many(document_docs)

    comment_docs = []
    for document_id, rows in COMMENTS.items():
        for comment in rows:
            author = users_by_name[comment["author"]]
            comment_docs.append(
                {
                    "id": comment["id"],
                    "document_id": document_id,
                    "author_id": author["id"],
                    "author_name": author["name"],
                    "role": author["role"],
                    "text": comment["text"],
                    "visibility": comment["visibility"],
                    "created_at": comment["created_at"],
                    "updated_at": comment["created_at"],
                }
            )
    if comment_docs:
        db.comments.insert_many(comment_docs)

    activity_docs = []
    for activity in ACTIVITIES:
        user = users_by_name[activity["user_name"]]
        activity_docs.append(
            {
                **activity,
                "user_id": user["id"],
                "entity_type": "document",
                "entity_id": activity["document_id"],
                "metadata": {},
            }
        )
    if activity_docs:
        db.activities.insert_many(activity_docs)

    set_sequence_value("users", 6)
    set_sequence_value("plants", 5)
    set_sequence_value("documents", 10)
    set_sequence_value("comments", 6)
    set_sequence_value("activities", 6)
    set_sequence_value("notifications", 0)


def create_seed_app() -> Flask:
    app = Flask(__name__)
    app.config.from_object(Config)
    init_db(app)
    return app


if __name__ == "__main__":
    app = create_seed_app()
    with app.app_context():
        seed_demo_data()
        print("Demo data seeded.")
