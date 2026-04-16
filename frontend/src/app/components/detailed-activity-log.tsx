import { useMemo, useState } from "react";
import { Clock3, Download, Eye, FileSpreadsheet, MessageSquare, Pencil, Search, Trash2, Upload, X } from "lucide-react";
import type { Activity } from "../lib/types";

interface DetailedActivityLogProps {
  activities: Activity[];
}

interface DetailRow {
  label: string;
  value: string;
}

function formatDate(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function formatSize(value: unknown) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function fallbackValue(value: unknown) {
  if (value === null || value === undefined) return "Not available";
  if (typeof value === "string" && !value.trim()) return "Not available";
  if (Array.isArray(value) && value.length === 0) return "Not available";
  return Array.isArray(value) ? value.join(", ") : String(value);
}

function formatRole(value: unknown) {
  const role = fallbackValue(value);
  if (role === "Mining Manager") return "Manager";
  return role;
}

function formatEntityType(value: string) {
  const normalized = value.replace(/[_-]+/g, " ");
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

function activityTitle(activity: Activity) {
  const metadata = activity.metadata || {};
  return fallbackValue(
    activity.documentName ||
    metadata.targetUserName ||
    metadata.fileName ||
    activity.entityId,
  );
}

function activitySummary(activity: Activity) {
  const metadata = activity.metadata || {};
  const actor = activity.userName || activity.userId || "An authorized user";
  const target = activity.documentName || String(metadata.targetUserName || activity.entityId || "the selected record");
  const plant = metadata.plantName ? ` for ${metadata.plantName}` : "";

  switch (activity.action) {
    case "Login":
      return `${actor} signed in to the platform.`;
    case "Logout":
      return `${actor} signed out of the platform.`;
    case "Uploaded":
      return `${actor} uploaded ${target}${plant}.`;
    case "Viewed":
      return `${actor} viewed ${target}${plant}.`;
    case "Downloaded":
      return `${actor} downloaded ${target}${plant}.`;
    case "Updated":
      return `${actor} updated ${target}${plant}.`;
    case "Commented":
      return `${actor} added a comment on ${target}${plant}.`;
    case "Deleted":
      return `${actor} deleted ${target}${plant}.`;
    default:
      return `${actor} recorded a ${activity.action.toLowerCase()} event on ${target}.`;
  }
}

function activityMeta(action: string) {
  switch (action) {
    case "Uploaded":
      return { icon: Upload, badge: "Upload", accent: "text-sky-700", badgeClass: "bg-sky-100 text-sky-700", panelClass: "bg-sky-50" };
    case "Viewed":
      return { icon: Eye, badge: "Viewed", accent: "text-amber-600", badgeClass: "bg-amber-100 text-amber-700", panelClass: "bg-amber-50" };
    case "Downloaded":
      return { icon: Download, badge: "Download", accent: "text-emerald-700", badgeClass: "bg-emerald-100 text-emerald-700", panelClass: "bg-emerald-50" };
    case "Updated":
      return { icon: Pencil, badge: "Updated", accent: "text-violet-700", badgeClass: "bg-violet-100 text-violet-700", panelClass: "bg-violet-50" };
    case "Commented":
      return { icon: MessageSquare, badge: "Commented", accent: "text-orange-700", badgeClass: "bg-orange-100 text-orange-700", panelClass: "bg-orange-50" };
    case "Deleted":
      return { icon: Trash2, badge: "Deleted", accent: "text-rose-700", badgeClass: "bg-rose-100 text-rose-700", panelClass: "bg-rose-50" };
    default:
      return { icon: Clock3, badge: action, accent: "text-slate-600", badgeClass: "bg-slate-100 text-slate-700", panelClass: "bg-slate-100" };
  }
}

function detailRows(activity: Activity) {
  const metadata = activity.metadata || {};
  const rows: DetailRow[] = [];
  const pushRow = (label: string, value: unknown, options?: { always?: boolean; formatter?: (raw: unknown) => string }) => {
    const formatted = options?.formatter ? options.formatter(value) : fallbackValue(value);
    if (!options?.always && formatted === "Not available") return;
    rows.push({ label, value: formatted });
  };

  pushRow("Actor", activity.userName || activity.userId, { always: true });
  pushRow("Actor Role", metadata.userRole || metadata.user_role || metadata.role, { formatter: formatRole });
  pushRow("Business Unit", metadata.plantName || metadata.plantId);
  pushRow("Document / Record", activity.documentName || metadata.targetUserName || activity.entityId, { always: true });
  pushRow("Record Type", formatEntityType(activity.entityType), { always: true });
  pushRow("Category", metadata.documentCategory);
  pushRow("Current Status", metadata.documentStatus || metadata.status || metadata.targetStatus);
  pushRow("Version", metadata.version);
  pushRow("Changed Fields", metadata.updatedFields);
  pushRow("Comment Visibility", metadata.visibility);
  pushRow("Comment Length", metadata.commentLength ? `${metadata.commentLength} characters` : null);
  pushRow("Upload Note", metadata.uploadComment);
  pushRow("Target User", metadata.targetUserName);
  pushRow("Target Role", metadata.targetRole, { formatter: formatRole });
  pushRow("Assigned Plants", metadata.assignedPlants);
  pushRow("File Name", metadata.fileName);
  pushRow("File Format", metadata.contentType);
  pushRow("File Size", formatSize(metadata.sizeBytes));
  pushRow("Email Address", metadata.email);
  pushRow("IP Address", metadata.clientIp);
  pushRow("Session ID", metadata.sessionId);
  pushRow("Audit Reference", activity.id, { always: true });
  pushRow("Document Reference", activity.documentId || activity.entityId);

  const coveredKeys = new Set([
    "plantName",
    "plantId",
    "documentCategory",
    "documentStatus",
    "status",
    "version",
    "updatedFields",
    "visibility",
    "commentLength",
    "uploadComment",
    "targetUserName",
    "targetRole",
    "targetStatus",
    "assignedPlants",
    "fileName",
    "contentType",
    "sizeBytes",
    "email",
    "clientIp",
    "sessionId",
    "role",
    "userRole",
    "user_role",
  ]);

  Object.entries(metadata).forEach(([key, rawValue]) => {
    if (coveredKeys.has(key)) return;
    const value = fallbackValue(rawValue);
    if (value === "Not available") return;
    rows.push({
      label: formatEntityType(key),
      value,
    });
  });

  return rows;
}

function flattenActivity(activity: Activity) {
  const metadata = activity.metadata || {};
  return {
    auditReference: activity.id,
    eventTime: formatDate(activity.createdAt),
    activityType: activity.action || "Not available",
    actor: activity.userName || activity.userId || "Not available",
    actorRole: formatRole(metadata.userRole || metadata.user_role || metadata.role),
    businessUnit: String(metadata.plantName || metadata.plantId || "Not available"),
    documentOrRecord: activity.documentName || String(metadata.targetUserName || activity.entityId || "Not available"),
    recordType: formatEntityType(activity.entityType || "Not available"),
    recordReference: activity.documentId || activity.entityId || "Not available",
    category: String(metadata.documentCategory || "Not available"),
    currentStatus: String(metadata.documentStatus || metadata.status || metadata.targetStatus || "Not available"),
    version: String(metadata.version || "Not available"),
    changedFields: Array.isArray(metadata.updatedFields) && metadata.updatedFields.length > 0 ? metadata.updatedFields.join(", ") : "Not available",
    commentVisibility: String(metadata.visibility || "Not available"),
    uploadNote: String(metadata.uploadComment || "Not available"),
    targetRole: formatRole(metadata.targetRole),
    assignedPlants: fallbackValue(metadata.assignedPlants),
    fileName: String(metadata.fileName || "Not available"),
    fileFormat: String(metadata.contentType || "Not available"),
    fileSize: formatSize(metadata.sizeBytes) || "Not available",
    emailAddress: String(metadata.email || "Not available"),
    ipAddress: String(metadata.clientIp || "Not available"),
    sessionId: String(metadata.sessionId || "Not available"),
    rawMetadata: JSON.stringify(metadata),
  };
}

function downloadBlob(content: BlobPart, fileName: string, type: string) {
  const blob = new Blob([content], { type });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function escapeCsv(value: string) {
  const normalized = value.replace(/"/g, "\"\"");
  return /[",\n]/.test(normalized) ? `"${normalized}"` : normalized;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function DetailedActivityLog({ activities }: DetailedActivityLogProps) {
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("");

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return activities.filter((activity) => {
      const matchesSearch =
        !needle ||
        activity.action.toLowerCase().includes(needle) ||
        (activity.documentName || "").toLowerCase().includes(needle) ||
        (activity.userName || "").toLowerCase().includes(needle) ||
        String(activity.metadata?.plantName || "").toLowerCase().includes(needle);
      const matchesAction =
        !actionFilter ||
        activity.action.toLowerCase() === actionFilter ||
        activity.action.toLowerCase().includes(actionFilter);
      return matchesSearch && matchesAction;
    });
  }, [activities, actionFilter, search]);

  const grouped = useMemo(() => {
    const today = new Date().toDateString();
    const todayItems = filtered.filter((item) => item.createdAt && new Date(item.createdAt).toDateString() === today);
    const earlierItems = filtered.filter((item) => !item.createdAt || new Date(item.createdAt).toDateString() !== today);
    return [
      ...(todayItems.length ? [{ title: "Today", items: todayItems }] : []),
      ...(earlierItems.length ? [{ title: "Earlier", items: earlierItems }] : []),
    ];
  }, [filtered]);

  const counts = useMemo(() => {
    return {
      total: activities.length,
      uploaded: activities.filter((item) => item.action === "Uploaded").length,
      viewed: activities.filter((item) => item.action === "Viewed").length,
      downloaded: activities.filter((item) => item.action === "Downloaded").length,
      updated: activities.filter((item) => item.action === "Updated").length,
    };
  }, [activities]);

  const exportRows = useMemo(() => activities.map(flattenActivity), [activities]);

  function exportCsv() {
    const headers = Object.keys(exportRows[0] || {
      id: "",
      createdAt: "",
      action: "",
      entityType: "",
      entityId: "",
      documentName: "",
      documentId: "",
      userName: "",
      userId: "",
      plant: "",
      category: "",
      status: "",
      version: "",
      fileName: "",
      fileType: "",
      fileSize: "",
      uploadNote: "",
      updatedFields: "",
      commentVisibility: "",
      commentLength: "",
      metadata: "",
    });
    const lines = [
      headers.join(","),
      ...exportRows.map((row) => headers.map((header) => escapeCsv(String(row[header as keyof typeof row] ?? ""))).join(",")),
    ];
    downloadBlob(`\uFEFF${lines.join("\n")}`, `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8;");
  }

  function exportExcel() {
    const headers = Object.keys(exportRows[0] || {
      id: "",
      createdAt: "",
      action: "",
      entityType: "",
      entityId: "",
      documentName: "",
      documentId: "",
      userName: "",
      userId: "",
      plant: "",
      category: "",
      status: "",
      version: "",
      fileName: "",
      fileType: "",
      fileSize: "",
      uploadNote: "",
      updatedFields: "",
      commentVisibility: "",
      commentLength: "",
      metadata: "",
    });
    const tableRows = exportRows.map((row) => (
      `<tr>${headers.map((header) => `<td>${escapeHtml(String(row[header as keyof typeof row] ?? ""))}</td>`).join("")}</tr>`
    )).join("");
    const workbook = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
        <head>
          <meta charset="UTF-8" />
        </head>
        <body>
          <table>
            <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
            <tbody>${tableRows}</tbody>
          </table>
        </body>
      </html>
    `;
    downloadBlob(workbook, `audit-logs-${new Date().toISOString().slice(0, 10)}.xls`, "application/vnd.ms-excel;charset=utf-8;");
  }

  return (
    <div>
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        {[
          { key: "", label: "All Activity", value: counts.total, icon: Clock3, colorClass: "text-sky-700", bgClass: "bg-sky-50" },
          { key: "uploaded", label: "Uploads", value: counts.uploaded, icon: Upload, colorClass: "text-sky-700", bgClass: "bg-sky-50" },
          { key: "viewed", label: "Views", value: counts.viewed, icon: Eye, colorClass: "text-amber-600", bgClass: "bg-amber-50" },
          { key: "downloaded", label: "Downloads", value: counts.downloaded, icon: Download, colorClass: "text-emerald-700", bgClass: "bg-emerald-50" },
          { key: "updated", label: "Updates", value: counts.updated, icon: Pencil, colorClass: "text-violet-700", bgClass: "bg-violet-50" },
        ].map((stat) => (
          <button
            key={stat.label}
            type="button"
            onClick={() => setActionFilter(actionFilter === stat.key ? "" : stat.key)}
            className={`flex items-center gap-3 rounded-[28px] border px-4 py-5 text-left shadow-[0_18px_40px_rgba(15,23,42,0.07)] transition ${
              actionFilter === stat.key
                ? "border-teal-300 bg-white ring-2 ring-teal-100"
                : "border-white/80 bg-white/90 hover:-translate-y-0.5 hover:shadow-[0_22px_46px_rgba(15,23,42,0.1)]"
            }`}
          >
            <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${stat.bgClass}`}>
              <stat.icon size={18} className={stat.colorClass} />
            </div>
            <div>
              <div className="text-[2rem] font-semibold leading-none tracking-tight text-slate-950">{stat.value}</div>
              <div className="mt-1 text-sm font-medium text-slate-500">{stat.label}</div>
            </div>
          </button>
        ))}
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-[28px] border border-white/70 bg-white/90 px-5 py-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur">
        <div className="relative min-w-[240px] max-w-sm flex-1">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search logs"
            className="h-11 w-full rounded-2xl border border-slate-200 bg-white pl-11 pr-4 text-sm text-slate-700 outline-none transition focus:border-teal-500"
          />
        </div>

        {[
          { key: "", label: "All Types" },
          { key: "uploaded", label: "Uploads" },
          { key: "viewed", label: "Views" },
          { key: "downloaded", label: "Downloads" },
          { key: "updated", label: "Updates" },
          { key: "commented", label: "Comments" },
          { key: "deleted", label: "Deleted" },
        ].map((chip) => (
          <button
            key={chip.label}
            type="button"
            onClick={() => setActionFilter(actionFilter === chip.key ? "" : chip.key)}
            className={`h-10 rounded-2xl border px-4 text-sm font-medium transition ${
              actionFilter === chip.key
                ? "border-teal-300 bg-teal-50 text-teal-700"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {chip.label}
          </button>
        ))}

        {(search || actionFilter) && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setActionFilter("");
            }}
            className="inline-flex h-10 items-center gap-2 rounded-2xl border border-rose-200 px-4 text-sm font-medium text-rose-700 transition hover:bg-rose-50"
          >
            <X size={14} /> Clear
          </button>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex h-10 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <Download size={14} /> Export CSV
          </button>
          <button
            type="button"
            onClick={exportExcel}
            className="inline-flex h-10 items-center gap-2 rounded-2xl bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            <FileSpreadsheet size={14} /> Export Excel
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-[32px] border border-white/70 bg-white/90 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur">
        <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <Clock3 size={16} className="text-teal-700" />
            <span className="text-base font-semibold text-slate-900">Detailed Activity Log</span>
          </div>
          <div className="text-sm text-slate-500">
            {filtered.length} matching event{filtered.length === 1 ? "" : "s"}
          </div>
        </div>

        {grouped.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500">
            No activity matched your current filters.
          </div>
        ) : (
          grouped.map((group) => (
            <div key={group.title} className="border-b border-slate-100 last:border-b-0">
              <div className="bg-slate-50/80 px-5 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                {group.title}
              </div>
              <div className="divide-y divide-slate-100">
                {group.items.map((activity) => {
                  const meta = activityMeta(activity.action);
                  const rows = detailRows(activity);
                  return (
                    <div key={activity.id} className="px-5 py-5 transition-colors hover:bg-slate-50/50">
                      <div className="mb-4 flex items-start justify-between gap-4">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${meta.panelClass}`}>
                            <meta.icon size={16} className={meta.accent} />
                          </div>
                          <div className="min-w-0">
                            <div className="mb-1 flex flex-wrap items-center gap-2">
                              <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${meta.badgeClass}`}>
                                {meta.badge}
                              </span>
                              <span className="text-sm font-semibold text-slate-900">
                                {activityTitle(activity)}
                              </span>
                            </div>
                            <div className="text-sm text-slate-500">
                              {activitySummary(activity)}
                            </div>
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-sm font-medium text-slate-800">
                            {formatDate(activity.createdAt)}
                          </div>
                          <div className="mt-1 text-xs text-slate-400">
                            {activity.id}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-x-8 gap-y-2 md:grid-cols-2">
                        {rows.map((row) => (
                          <div key={`${activity.id}-${row.label}`} className="flex gap-3 text-sm">
                            <span className="w-32 shrink-0 text-slate-500">{row.label}</span>
                            <span className="break-words text-slate-800">{row.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
