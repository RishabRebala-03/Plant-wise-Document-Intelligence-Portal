from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime

from flask import Blueprint, request

from ..auth import require_auth
from ..db import get_db
from ..serializers import summarize_categories
from ..utils import ensure_utc, success_response


analytics_bp = Blueprint("analytics", __name__)


@analytics_bp.get("/analytics/overview")
@require_auth(["CEO", "Admin"])
def analytics_overview():
    db = get_db()
    period = request.args.get("period", "6m")
    month_limits = {"1m": 1, "3m": 3, "6m": 6, "1y": 12}
    months = month_limits.get(period, 6)

    documents = list(db.documents.find({"deleted_at": None}))
    plants = list(db.plants.find({}))
    users = list(db.users.find({}))

    monthly_buckets: dict[str, int] = defaultdict(int)
    for doc in documents:
        uploaded_at = ensure_utc(doc.get("uploaded_at"))
        if not uploaded_at:
            continue
        label = uploaded_at.strftime("%b %Y")
        monthly_buckets[label] += 1
    monthly_rows = [
        {"month": label, "uploads": count}
        for label, count in sorted(
            monthly_buckets.items(),
            key=lambda item: datetime.strptime(item[0], "%b %Y"),
        )[-months:]
    ]

    uploader_counter = Counter(doc["uploaded_by_name"] for doc in documents)
    uploader_rows = []
    for name, count in uploader_counter.most_common(5):
        uploader = next((user for user in users if user["name"] == name), None)
        uploader_rows.append(
            {
                "name": name,
                "docs": count,
                "plants": uploader.get("plant_name", "All") if uploader else "All",
            }
        )

    plant_rows = []
    for plant in plants:
        count = len([doc for doc in documents if doc["plant_id"] == plant["id"]])
        plant_rows.append(
            {
                "id": plant["id"],
                "name": plant["name"],
                "documents": count,
                "lastUpload": ensure_utc(plant.get("last_upload_at")).date().isoformat() if ensure_utc(plant.get("last_upload_at")) else None,
            }
        )

    total_uploads = len(documents)
    monthly_average = round(total_uploads / max(len(monthly_rows), 1), 1)
    peak_month = max(monthly_rows, key=lambda row: row["uploads"], default={"month": None, "uploads": 0})
    top_plant = max(plant_rows, key=lambda row: row["documents"], default={"name": None, "documents": 0})

    return success_response(
        {
            "summary": {
                "totalUploads": total_uploads,
                "monthlyAverage": monthly_average,
                "peakMonth": peak_month,
                "topPlant": top_plant,
            },
            "monthlyUploads": monthly_rows,
            "categoryDistribution": summarize_categories(documents),
            "topUploaders": uploader_rows,
            "plantVolume": plant_rows,
        }
    )
