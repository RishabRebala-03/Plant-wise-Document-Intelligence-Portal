import { useMemo, useState } from "react";
import { Clock3, Download, Eye, FileSpreadsheet, Pencil, Upload, X } from "lucide-react";
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
  const [focusFilter, setFocusFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");

  const focusOptions = useMemo(
    () =>
      Array.from(
        new Set(
          activities.flatMap((activity) => [
            activity.userName || "",
            activity.documentName || "",
            String(activity.metadata?.plantName || ""),
          ]).filter((value) => value.trim()),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [activities],
  );

  const filtered = useMemo(() => {
    return activities.filter((activity) => {
      const matchesFocus =
        !focusFilter ||
        activity.action === focusFilter ||
        (activity.documentName || "") === focusFilter ||
        (activity.userName || "") === focusFilter ||
        String(activity.metadata?.plantName || "") === focusFilter;
      const matchesAction =
        !actionFilter ||
        activity.action.toLowerCase() === actionFilter ||
        activity.action.toLowerCase().includes(actionFilter);
      return matchesFocus && matchesAction;
    });
  }, [activities, actionFilter, focusFilter]);

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
      <div className="data-table-panel mb-6">
        <div className="data-table-toolbar flex items-center gap-2">
          <Clock3 size={16} className="text-teal-700" />
          <span className="text-base font-semibold text-slate-900">Activity Summary</span>
        </div>
        <div className="data-table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Count</th>
                <th>Filter</th>
              </tr>
            </thead>
            <tbody>
              {[
                { key: "", label: "All Activity", value: counts.total },
                { key: "uploaded", label: "Uploads", value: counts.uploaded },
                { key: "viewed", label: "Views", value: counts.viewed },
                { key: "downloaded", label: "Downloads", value: counts.downloaded },
                { key: "updated", label: "Updates", value: counts.updated },
              ].map((stat) => (
                <tr key={stat.label}>
                  <td className="text-strong">{stat.label}</td>
                  <td>{stat.value}</td>
                  <td>
                    <button
                      type="button"
                      onClick={() => setActionFilter(actionFilter === stat.key ? "" : stat.key)}
                      className={`h-8 border px-3 text-sm ${
                        actionFilter === stat.key
                          ? "border-teal-300 bg-teal-50 text-teal-700"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {actionFilter === stat.key ? "Active" : "Apply"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-[28px] border border-white/70 bg-white/90 px-5 py-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur">
        <select
          value={focusFilter}
          onChange={(e) => setFocusFilter(e.target.value)}
          className="h-11 min-w-[240px] max-w-sm flex-1 rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-700 outline-none transition focus:border-teal-500"
        >
          <option value="">All actors and records</option>
          {focusOptions.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>

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

        {(focusFilter || actionFilter) && (
          <button
            type="button"
            onClick={() => {
              setFocusFilter("");
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

      <div className="data-table-panel">
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
          <div className="data-table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Time</th>
                  <th>Action</th>
                  <th>Title</th>
                  <th>Summary</th>
                  <th>Actor</th>
                  <th>Record Type</th>
                  <th>Details</th>
                  <th>Audit Reference</th>
                </tr>
              </thead>
              <tbody>
                {grouped.flatMap((group) =>
                  group.items.map((activity) => {
                    const rows = detailRows(activity);
                    return (
                      <tr key={activity.id}>
                        <td>{group.title}</td>
                        <td>{formatDate(activity.createdAt)}</td>
                        <td className="text-strong">{activity.action}</td>
                        <td className="text-strong">{activityTitle(activity)}</td>
                        <td className="min-w-[320px]">{activitySummary(activity)}</td>
                        <td>{activity.userName || activity.userId || "Not available"}</td>
                        <td>{formatEntityType(activity.entityType)}</td>
                        <td className="min-w-[420px]">
                          {rows.map((row) => `${row.label}: ${row.value}`).join(" | ")}
                        </td>
                        <td>{activity.id}</td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
