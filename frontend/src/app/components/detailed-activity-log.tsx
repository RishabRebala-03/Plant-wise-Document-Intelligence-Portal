import { useMemo, useState } from "react";
import { Clock, Download, Eye, MessageSquare, Pencil, Search, Upload, X, Trash2 } from "lucide-react";
import type { Activity } from "../lib/types";

interface DetailedActivityLogProps {
  activities: Activity[];
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

function activityMeta(action: string) {
  switch (action) {
    case "Uploaded":
      return { icon: Upload, badge: "Upload", accent: "#0A6ED1", bg: "#EBF4FD" };
    case "Viewed":
      return { icon: Eye, badge: "Viewed", accent: "#E9730C", bg: "#FEF3E7" };
    case "Downloaded":
      return { icon: Download, badge: "Download", accent: "#107E3E", bg: "#EBF5EF" };
    case "Updated":
      return { icon: Pencil, badge: "Updated", accent: "#7B4CC2", bg: "#F3ECFF" };
    case "Commented":
      return { icon: MessageSquare, badge: "Commented", accent: "#B35C00", bg: "#FFF1E5" };
    case "Deleted":
      return { icon: Trash2, badge: "Deleted", accent: "#BB0000", bg: "#FFF0F0" };
    default:
      return { icon: Clock, badge: action, accent: "#5B738B", bg: "#EEF3F6" };
  }
}

function detailRows(activity: Activity) {
  const metadata = activity.metadata || {};
  const fallback = (value: unknown) => {
    if (value === null || value === undefined) return "Not available";
    if (typeof value === "string" && !value.trim()) return "Not available";
    return String(value);
  };
  const rows: { label: string; value: string }[] = [
    { label: "Performed By", value: fallback(activity.userName || activity.userId) },
    { label: "Action Type", value: fallback(activity.action) },
    { label: "Entity Type", value: fallback(activity.entityType) },
    { label: "Entity ID", value: fallback(activity.entityId) },
    { label: "Document", value: fallback(activity.documentName || activity.entityId) },
    { label: "Document ID", value: fallback(activity.documentId || activity.entityId) },
    { label: "Plant", value: fallback(metadata.plantName || metadata.plantId) },
    { label: "Category", value: fallback(metadata.documentCategory) },
    { label: "Status", value: fallback(metadata.documentStatus) },
    { label: "Version", value: fallback(metadata.version) },
  ];

  rows.push({ label: "File Name", value: fallback(metadata.fileName) });
  rows.push({ label: "File Type", value: fallback(metadata.contentType) });
  const size = formatSize(metadata.sizeBytes);
  rows.push({ label: "File Size", value: size || "Not available" });
  rows.push({ label: "Upload Note", value: fallback(metadata.uploadComment) });
  if (Array.isArray(metadata.updatedFields) && metadata.updatedFields.length > 0) {
    rows.push({ label: "Updated Fields", value: metadata.updatedFields.join(", ") });
  } else {
    rows.push({ label: "Updated Fields", value: "Not available" });
  }
  rows.push({ label: "Comment Visibility", value: fallback(metadata.visibility) });
  rows.push({
    label: "Comment Length",
    value: metadata.commentLength ? `${metadata.commentLength} chars` : "Not available",
  });

  Object.entries(metadata).forEach(([key, rawValue]) => {
    if (rows.some((row) => row.label.toLowerCase() === key.toLowerCase())) return;
    const value = Array.isArray(rawValue) ? rawValue.join(", ") : fallback(rawValue);
    rows.push({
      label: key.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase()),
      value,
    });
  });

  return rows;
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
      const matchesAction = !actionFilter || activity.action.toLowerCase() === actionFilter;
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

  return (
    <div>
      <div className="grid grid-cols-5 gap-4 mb-6">
        {[
          { key: "", label: "All Activity", value: counts.total, icon: Clock, color: "#0A6ED1", bg: "#EBF4FD" },
          { key: "uploaded", label: "Uploads", value: counts.uploaded, icon: Upload, color: "#0A6ED1", bg: "#EBF4FD" },
          { key: "viewed", label: "Views", value: counts.viewed, icon: Eye, color: "#E9730C", bg: "#FEF3E7" },
          { key: "downloaded", label: "Downloads", value: counts.downloaded, icon: Download, color: "#107E3E", bg: "#EBF5EF" },
          { key: "updated", label: "Updates", value: counts.updated, icon: Pencil, color: "#7B4CC2", bg: "#F3ECFF" },
        ].map((stat) => (
          <button
            key={stat.label}
            onClick={() => setActionFilter(actionFilter === stat.key ? "" : stat.key)}
            className={`bg-white border px-4 py-4 flex items-center gap-3 text-left cursor-pointer transition-all ${
              actionFilter === stat.key ? "border-[#0A6ED1] bg-[#F8FBFF]" : "border-[#e8e8e8]"
            }`}
          >
            <div className="w-9 h-9 flex items-center justify-center shrink-0" style={{ background: stat.bg }}>
              <stat.icon size={16} style={{ color: stat.color }} />
            </div>
            <div>
              <div className="text-[#1a1a1a]" style={{ fontSize: 20, fontWeight: 600 }}>{stat.value}</div>
              <div className="text-[#6a6d70]" style={{ fontSize: 11 }}>{stat.label}</div>
            </div>
          </button>
        ))}
      </div>

      <div className="bg-white border border-[#e8e8e8] px-5 py-4 mb-5 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#999]" />
            <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder=""
            className="w-full h-9 pl-9 pr-3 border border-[#d9d9d9] bg-white text-[#333] placeholder-[#bbb] focus:border-[#0A6ED1] focus:outline-none"
            style={{ fontSize: 13 }}
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
            onClick={() => setActionFilter(actionFilter === chip.key ? "" : chip.key)}
            className={`h-8 px-3 border cursor-pointer transition-colors ${
              actionFilter === chip.key
                ? "border-[#0A6ED1] bg-[#EBF4FD] text-[#0A6ED1]"
                : "border-[#d9d9d9] bg-white text-[#555] hover:bg-[#f5f5f5]"
            }`}
            style={{ fontSize: 12, fontWeight: 500 }}
          >
            {chip.label}
          </button>
        ))}
        {(search || actionFilter) && (
          <button
            onClick={() => { setSearch(""); setActionFilter(""); }}
            className="h-8 px-3 text-[#BB0000] hover:bg-[#fff5f5] border border-[#e8c0c0] inline-flex items-center gap-1.5 cursor-pointer"
            style={{ fontSize: 12 }}
          >
            <X size={12} /> Clear
          </button>
        )}
      </div>

      <div className="bg-white border border-[#e8e8e8] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#f0f0f0] flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Clock size={14} className="text-[#0A6ED1]" />
            <span className="text-[#1a1a1a]" style={{ fontSize: 14, fontWeight: 500 }}>Detailed Activity Log</span>
          </div>
          <div className="text-[#6a6d70]" style={{ fontSize: 12 }}>
            {filtered.length} matching event{filtered.length === 1 ? "" : "s"}
          </div>
        </div>

        {grouped.length === 0 ? (
          <div className="px-5 py-10 text-center text-[#6a6d70]" style={{ fontSize: 13 }}>
            No activity matched your current filters.
          </div>
        ) : (
          grouped.map((group) => (
            <div key={group.title} className="border-b last:border-b-0 border-[#f3f3f3]">
              <div className="px-5 py-3 bg-[#fafafa] text-[#6a6d70]" style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase" }}>
                {group.title}
              </div>
              <div className="divide-y divide-[#f7f7f7]">
                {group.items.map((activity) => {
                  const meta = activityMeta(activity.action);
                  const rows = detailRows(activity);
                  return (
                    <div key={activity.id} className="px-5 py-5 hover:bg-[#fcfcfc]">
                      <div className="flex items-start justify-between gap-4 mb-4">
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="w-10 h-10 flex items-center justify-center shrink-0 rounded-sm" style={{ background: meta.bg }}>
                            <meta.icon size={16} style={{ color: meta.accent }} />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span
                                className="inline-flex items-center px-2 py-0.5 rounded-sm"
                                style={{ fontSize: 10, fontWeight: 600, color: meta.accent, background: meta.bg, textTransform: "uppercase", letterSpacing: 0.3 }}
                              >
                                {meta.badge}
                              </span>
                              <span className="text-[#333]" style={{ fontSize: 14, fontWeight: 600 }}>
                                {activity.documentName || activity.entityId}
                              </span>
                            </div>
                            <div className="text-[#6a6d70]" style={{ fontSize: 12 }}>
                              {activity.userName || activity.userId || "Unknown user"} performed a {activity.action.toLowerCase()} action on this document.
                            </div>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[#333]" style={{ fontSize: 12, fontWeight: 500 }}>
                            {formatDate(activity.createdAt)}
                          </div>
                          <div className="text-[#999] mt-1" style={{ fontSize: 11 }}>
                            {activity.id}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-x-8 gap-y-2">
                        {rows.map((row) => (
                          <div key={`${activity.id}-${row.label}`} className="flex gap-3" style={{ fontSize: 12 }}>
                            <span className="w-28 shrink-0 text-[#6a6d70]">{row.label}</span>
                            <span className="text-[#333] break-words">{row.value}</span>
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
