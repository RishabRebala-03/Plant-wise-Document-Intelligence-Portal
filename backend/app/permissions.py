from __future__ import annotations

from typing import Any


DEFAULT_ACCESS_RULES = [
    {
        "role": "CEO",
        "plantsScope": "All plants",
        "canCreateProjects": False,
        "canUploadDocuments": False,
        "canEditDocuments": True,
        "canDeleteDocuments": True,
        "canManageUsers": True,
        "canConfigureIp": False,
    },
    {
        "role": "Mining Manager",
        "plantsScope": "Assigned plant only",
        "canCreateProjects": True,
        "canUploadDocuments": True,
        "canEditDocuments": False,
        "canDeleteDocuments": False,
        "canManageUsers": False,
        "canConfigureIp": False,
    },
    {
        "role": "Admin",
        "plantsScope": "Governance view",
        "canCreateProjects": False,
        "canUploadDocuments": False,
        "canEditDocuments": True,
        "canDeleteDocuments": True,
        "canManageUsers": True,
        "canConfigureIp": True,
    },
]


def get_access_rules(db) -> list[dict[str, Any]]:
    settings = db.app_settings.find_one({"_id": "access_rules"})
    if settings and isinstance(settings.get("rules"), list):
        return settings["rules"]
    db.app_settings.update_one(
        {"_id": "access_rules"},
        {"$setOnInsert": {"rules": DEFAULT_ACCESS_RULES}},
        upsert=True,
    )
    return DEFAULT_ACCESS_RULES


def save_access_rules(db, rules: list[dict[str, Any]]) -> list[dict[str, Any]]:
    db.app_settings.update_one(
        {"_id": "access_rules"},
        {"$set": {"rules": rules}},
        upsert=True,
    )
    return rules


def get_access_rule_for_role(db, role: str) -> dict[str, Any]:
    rules = get_access_rules(db)
    for rule in rules:
        if rule.get("role") == role:
            return rule
    for rule in DEFAULT_ACCESS_RULES:
        if rule.get("role") == role:
            return rule
    return {"role": role, "plantsScope": "Controlled by administrator"}


def user_capabilities(user: dict[str, Any], db) -> dict[str, bool]:
    if user.get("role") == "Admin":
        return {
            "canCreateProjects": True,
            "canUploadDocuments": True,
            "canEditDocuments": True,
            "canDeleteDocuments": True,
            "canManageUsers": True,
            "canConfigureIp": True,
        }

    rule = get_access_rule_for_role(db, user.get("role", ""))
    return {
        "canCreateProjects": bool(rule.get("canCreateProjects")),
        "canUploadDocuments": bool(rule.get("canUploadDocuments")),
        "canEditDocuments": bool(rule.get("canEditDocuments")),
        "canDeleteDocuments": bool(rule.get("canDeleteDocuments")),
        "canManageUsers": bool(rule.get("canManageUsers")),
        "canConfigureIp": bool(rule.get("canConfigureIp")),
    }


def user_has_capability(user: dict[str, Any], capability: str, db) -> bool:
    return user_capabilities(user, db).get(capability, False)
