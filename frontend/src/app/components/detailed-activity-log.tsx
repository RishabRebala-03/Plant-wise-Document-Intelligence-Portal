import { useMemo, useState } from "react";
import { Clock3, Download, FileSpreadsheet, X } from "lucide-react";
import type { Activity } from "../lib/types";
import { ValueHelp, type ValueHelpOption } from "./ui/value-help";

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
  const [actorFilter, setActorFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [plantFilter, setPlantFilter] = useState("");
  const [recordFilter, setRecordFilter] = useState("");
  const [entityFilter, setEntityFilter] = useState("");
  const [ipFilter, setIpFilter] = useState("");
  const [sessionFilter, setSessionFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [sortOrder, setSortOrder] = useState("time-desc");

  const focusOptions = useMemo(() => {
    const registry = new Map<string, ValueHelpOption>();
    activities.forEach((activity) => {
      const actor = (activity.userName || "").trim();
      const record = (activity.documentName || "").trim();
      const plant = String(activity.metadata?.plantName || "").trim();

      if (actor) {
        registry.set(`actor:${actor}`, {
          value: actor,
          label: actor,
          meta: "Actor",
        });
      }
      if (record) {
        registry.set(`record:${record}`, {
          value: record,
          label: record,
          meta: "Document or record",
        });
      }
      if (plant) {
        registry.set(`plant:${plant}`, {
          value: plant,
          label: plant,
          meta: "Business unit",
        });
      }
    });

    return Array.from(registry.values()).sort((a, b) => {
      if (a.label === b.label) return (a.meta || "").localeCompare(b.meta || "");
      return a.label.localeCompare(b.label);
    });
  }, [activities]);

  const actionOptions = useMemo(
    () =>
      Array.from(
        new Set(
          activities
            .map((activity) => activity.action?.trim())
            .filter((value): value is string => Boolean(value)),
        ),
      )
        .sort((a, b) => a.localeCompare(b))
        .map((action) => ({
          value: action.toLowerCase(),
          label: action,
          meta: "Activity type",
        })),
    [activities],
  );
  const actorOptions = useMemo(
    () =>
      Array.from(new Set(activities.map((activity) => (activity.userName || activity.userId || "").trim()).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ value, label: value, meta: "Actor" })),
    [activities],
  );
  const roleOptions = useMemo(
    () =>
      Array.from(new Set(activities.map((activity) => formatRole(activity.metadata?.userRole || activity.metadata?.user_role || activity.metadata?.role)).filter((value) => value !== "Not available")))
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ value, label: value, meta: "Actor role" })),
    [activities],
  );
  const plantOptions = useMemo(
    () =>
      Array.from(new Set(activities.map((activity) => String(activity.metadata?.plantName || activity.metadata?.plantId || "").trim()).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ value, label: value, meta: "Business unit" })),
    [activities],
  );
  const recordOptions = useMemo(
    () =>
      Array.from(new Set(activities.map((activity) => (activity.documentName || activity.entityId || "").trim()).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ value, label: value, meta: "Document or record" })),
    [activities],
  );
  const entityOptions = useMemo(
    () =>
      Array.from(new Set(activities.map((activity) => formatEntityType(activity.entityType)).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ value, label: value, meta: "Record type" })),
    [activities],
  );
  const ipOptions = useMemo(
    () =>
      Array.from(new Set(activities.map((activity) => String(activity.metadata?.clientIp || "").trim()).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ value, label: value, meta: "IP address" })),
    [activities],
  );
  const sessionOptions = useMemo(
    () =>
      Array.from(new Set(activities.map((activity) => String(activity.metadata?.sessionId || "").trim()).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ value, label: value, meta: "Session ID" })),
    [activities],
  );
  const dateOptions = useMemo(
    () =>
      Array.from(new Set(activities.map((activity) => activity.createdAt?.slice(0, 10)).filter((value): value is string => Boolean(value))))
        .sort((a, b) => b.localeCompare(a))
        .map((value) => ({ value, label: formatDate(value), meta: value })),
    [activities],
  );
  const sortOptions = useMemo(
    () => [
      { value: "time-desc", label: "Latest event first", meta: "Sort" },
      { value: "time-asc", label: "Oldest event first", meta: "Sort" },
      { value: "actor-asc", label: "Actor A-Z", meta: "Sort" },
      { value: "action-asc", label: "Activity type A-Z", meta: "Sort" },
      { value: "record-asc", label: "Record A-Z", meta: "Sort" },
      { value: "plant-asc", label: "Business unit A-Z", meta: "Sort" },
    ],
    [],
  );

  const filtered = useMemo(() => {
    return activities.filter((activity) => {
      const actor = activity.userName || activity.userId || "";
      const role = formatRole(activity.metadata?.userRole || activity.metadata?.user_role || activity.metadata?.role);
      const plant = String(activity.metadata?.plantName || activity.metadata?.plantId || "");
      const record = activity.documentName || activity.entityId || "";
      const entity = formatEntityType(activity.entityType);
      const ip = String(activity.metadata?.clientIp || "");
      const sessionId = String(activity.metadata?.sessionId || "");
      const activityDate = activity.createdAt?.slice(0, 10) || "";
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
      const matchesActor = !actorFilter || actor === actorFilter;
      const matchesRole = !roleFilter || role === roleFilter;
      const matchesPlant = !plantFilter || plant === plantFilter;
      const matchesRecord = !recordFilter || record === recordFilter;
      const matchesEntity = !entityFilter || entity === entityFilter;
      const matchesIp = !ipFilter || ip === ipFilter;
      const matchesSession = !sessionFilter || sessionId === sessionFilter;
      const matchesDate = !dateFilter || activityDate === dateFilter;
      return matchesFocus && matchesAction && matchesActor && matchesRole && matchesPlant && matchesRecord && matchesEntity && matchesIp && matchesSession && matchesDate;
    });
  }, [activities, actionFilter, actorFilter, dateFilter, entityFilter, focusFilter, ipFilter, plantFilter, recordFilter, roleFilter, sessionFilter]);

  const sorted = useMemo(() => {
    const next = [...filtered];
    next.sort((left, right) => {
      const leftActor = left.userName || left.userId || "";
      const rightActor = right.userName || right.userId || "";
      const leftRecord = left.documentName || left.entityId || "";
      const rightRecord = right.documentName || right.entityId || "";
      const leftPlant = String(left.metadata?.plantName || left.metadata?.plantId || "");
      const rightPlant = String(right.metadata?.plantName || right.metadata?.plantId || "");
      switch (sortOrder) {
        case "time-asc":
          return (left.createdAt || "").localeCompare(right.createdAt || "") || left.id.localeCompare(right.id);
        case "actor-asc":
          return leftActor.localeCompare(rightActor) || left.id.localeCompare(right.id);
        case "action-asc":
          return left.action.localeCompare(right.action) || left.id.localeCompare(right.id);
        case "record-asc":
          return leftRecord.localeCompare(rightRecord) || left.id.localeCompare(right.id);
        case "plant-asc":
          return leftPlant.localeCompare(rightPlant) || left.id.localeCompare(right.id);
        case "time-desc":
        default:
          return (right.createdAt || "").localeCompare(left.createdAt || "") || left.id.localeCompare(right.id);
      }
    });
    return next;
  }, [filtered, sortOrder]);

  const grouped = useMemo(() => {
    const today = new Date().toDateString();
    const todayItems = sorted.filter((item) => item.createdAt && new Date(item.createdAt).toDateString() === today);
    const earlierItems = sorted.filter((item) => !item.createdAt || new Date(item.createdAt).toDateString() !== today);
    return [
      ...(todayItems.length ? [{ title: "Today", items: todayItems }] : []),
      ...(earlierItems.length ? [{ title: "Earlier", items: earlierItems }] : []),
    ];
  }, [sorted]);

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

      <div className="mb-5 grid gap-4 rounded-[28px] border border-white/70 bg-white/90 px-5 py-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur md:grid-cols-2 xl:grid-cols-5">
        <ValueHelp
          label="Focus"
          placeholder="All actors and records"
          emptyLabel="No matching actors, records, or business units."
          options={focusOptions}
          value={focusFilter}
          onChange={setFocusFilter}
          containerClassName="min-w-[260px] flex-1"
        />

        <ValueHelp
          label="Activity Type"
          placeholder="All activity types"
          emptyLabel="No matching activity types."
          options={actionOptions}
          value={actionFilter}
          onChange={setActionFilter}
          containerClassName="w-full"
        />
        <ValueHelp label="Actor" placeholder="All actors" emptyLabel="No matching actors." options={actorOptions} value={actorFilter} onChange={setActorFilter} containerClassName="w-full" />
        <ValueHelp label="Role" placeholder="All roles" emptyLabel="No matching roles." options={roleOptions} value={roleFilter} onChange={setRoleFilter} containerClassName="w-full" />
        <ValueHelp label="Business Unit" placeholder="All plants" emptyLabel="No matching plants." options={plantOptions} value={plantFilter} onChange={setPlantFilter} containerClassName="w-full" />
        <ValueHelp label="Record" placeholder="All records" emptyLabel="No matching records." options={recordOptions} value={recordFilter} onChange={setRecordFilter} containerClassName="w-full" />
        <ValueHelp label="Record Type" placeholder="All record types" emptyLabel="No matching record types." options={entityOptions} value={entityFilter} onChange={setEntityFilter} containerClassName="w-full" />
        <ValueHelp label="IP Address" placeholder="All IPs" emptyLabel="No matching IPs." options={ipOptions} value={ipFilter} onChange={setIpFilter} containerClassName="w-full" />
        <ValueHelp label="Session" placeholder="All sessions" emptyLabel="No matching sessions." options={sessionOptions} value={sessionFilter} onChange={setSessionFilter} containerClassName="w-full" />
        <ValueHelp label="Date" placeholder="All dates" emptyLabel="No matching dates." options={dateOptions} value={dateFilter} onChange={setDateFilter} containerClassName="w-full" />
        <ValueHelp label="Sort By" placeholder="Default sort" emptyLabel="No sorting options." options={sortOptions} value={sortOrder} onChange={setSortOrder} containerClassName="w-full" clearLabel="Latest event first" clearDescription="Reset to the default sort order" />

        {(focusFilter || actionFilter || actorFilter || roleFilter || plantFilter || recordFilter || entityFilter || ipFilter || sessionFilter || dateFilter) && (
          <button
            type="button"
            onClick={() => {
              setFocusFilter("");
              setActionFilter("");
              setActorFilter("");
              setRoleFilter("");
              setPlantFilter("");
              setRecordFilter("");
              setEntityFilter("");
              setIpFilter("");
              setSessionFilter("");
              setDateFilter("");
              setSortOrder("time-desc");
            }}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-rose-200 px-4 text-sm font-medium text-rose-700 transition hover:bg-rose-50 xl:col-span-2"
          >
            <X size={14} /> Clear
          </button>
        )}

        <div className="flex flex-wrap items-center gap-2 xl:col-span-2 xl:justify-end">
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
