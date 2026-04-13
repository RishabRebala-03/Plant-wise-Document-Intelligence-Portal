import { useEffect, useMemo, useState } from "react";
import {
  Search, Filter, Eye, Download, Trash2, X, ChevronDown, Clock,
  CheckCircle2, AlertCircle, FileText,
} from "lucide-react";
import { categoryOptions, dashboardApi, documentsApi, plantsApi } from "../lib/api";
import type { Activity, DocumentRecord, Plant } from "../lib/types";
import { DocumentDrawer } from "./document-drawer";

interface ManagerDocumentsProps {
  mine?: boolean;
  activity?: boolean;
}

export function ManagerDocuments({ mine = true, activity = false }: ManagerDocumentsProps) {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<DocumentRecord | null>(null);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterPlant, setFilterPlant] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    const [docsResult, plantsResult, dashboard] = await Promise.all([
      documentsApi.list({
        scope: mine ? "mine" : undefined,
        q: search || undefined,
        category: filterCategory || undefined,
        status: filterStatus || undefined,
        plant_id: !mine ? filterPlant || undefined : undefined,
      }),
      plantsApi.list(),
      dashboardApi.manager(),
    ]);
    setDocuments(docsResult.items);
    setPlants(plantsResult.items);
    setActivities(dashboard.activity);
  }

  useEffect(() => {
    load()
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to load documents."))
      .finally(() => setLoading(false));
  }, [filterCategory, filterPlant, filterStatus, mine, search]);

  async function openDocument(document: DocumentRecord) {
    const result = await documentsApi.get(document.id);
    setSelectedDoc(result.document);
  }

  async function deleteDocument(documentId: string) {
    if (!window.confirm("Remove this document?")) return;
    await documentsApi.remove(documentId);
    await load();
  }

  const pageTitle = activity ? "Recent Activity" : mine ? "My Documents" : "All Documents";
  const pageDesc = activity ? "Your recent upload and edit history" : mine ? "Documents uploaded by you" : "All accessible documents";
  const hasFilter = search || filterCategory || filterStatus || filterPlant;

  const summary = useMemo(() => {
    return {
      total: documents.length,
      approved: documents.filter((doc) => doc.status === "Approved").length,
      inReview: documents.filter((doc) => doc.status === "In Review").length,
      actionRequired: documents.filter((doc) => doc.status === "Action Required").length,
    };
  }, [documents]);

  if (loading) return <div className="p-7 text-[#6a6d70]">Loading {pageTitle.toLowerCase()}...</div>;
  if (error) return <div className="p-7 text-[#BB0000]">{error}</div>;

  if (activity) {
    return (
      <div className="p-7 max-w-[1400px]">
        <div className="mb-7">
          <h1 className="text-[#1a1a1a]" style={{ fontSize: 20, fontWeight: 600 }}>{pageTitle}</h1>
          <p className="text-[#6a6d70] mt-1" style={{ fontSize: 14 }}>{pageDesc}</p>
        </div>

        <div className="bg-white border border-[#e8e8e8]">
          <div className="px-5 py-4 border-b border-[#f0f0f0] flex items-center gap-2">
            <Clock size={14} className="text-[#0A6ED1]" />
            <span className="text-[#1a1a1a]" style={{ fontSize: 14, fontWeight: 500 }}>Activity Log</span>
          </div>
          <div className="divide-y divide-[#f7f7f7]">
            {activities.map((activityItem) => (
              <div key={activityItem.id} className="px-5 py-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div style={{ fontSize: 13 }}>
                    <span className="text-[#6a6d70]">{activityItem.action}: </span>
                    <span className="text-[#333]">{activityItem.documentName || activityItem.entityId}</span>
                  </div>
                </div>
                <div className="text-[#999] shrink-0" style={{ fontSize: 12 }}>
                  {activityItem.createdAt || "-"}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-7 max-w-[1400px]">
      <div className="mb-7 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[#1a1a1a]" style={{ fontSize: 20, fontWeight: 600 }}>{pageTitle}</h1>
          <p className="text-[#6a6d70] mt-1" style={{ fontSize: 14 }}>{pageDesc}</p>
        </div>
        <a
          href={documentsApi.exportUrl()}
          className="h-9 px-4 border border-[#d9d9d9] bg-white text-[#333] hover:bg-[#f5f5f5] inline-flex items-center gap-2 cursor-pointer transition-colors shrink-0"
          style={{ fontSize: 13 }}
        >
          <Download size={14} /> Export
        </a>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-7">
        {[
          { label: "Total", value: summary.total, icon: FileText, color: "#0A6ED1", bg: "#EBF4FD", status: "" },
          { label: "Approved", value: summary.approved, icon: CheckCircle2, color: "#107E3E", bg: "#EBF5EF", status: "Approved" },
          { label: "In Review", value: summary.inReview, icon: Clock, color: "#E9730C", bg: "#FEF3E7", status: "In Review" },
          { label: "Action Required", value: summary.actionRequired, icon: AlertCircle, color: "#BB0000", bg: "#FFF0F0", status: "Action Required" },
        ].map((stat) => (
          <button
            key={stat.label}
            onClick={() => setFilterStatus(filterStatus === stat.status ? "" : stat.status)}
            className={`bg-white border px-4 py-4 flex items-center gap-3 cursor-pointer transition-all text-left ${
              filterStatus === stat.status && stat.status ? "border-[#0A6ED1] bg-[#EBF4FD]/30" : "border-[#e8e8e8]"
            }`}
          >
            <div className="w-8 h-8 flex items-center justify-center shrink-0" style={{ background: stat.bg }}>
              <stat.icon size={15} style={{ color: stat.color }} />
            </div>
            <div>
              <div className="text-[#1a1a1a]" style={{ fontSize: 20, fontWeight: 600 }}>{stat.value}</div>
              <div className="text-[#6a6d70]" style={{ fontSize: 11 }}>{stat.label}</div>
            </div>
          </button>
        ))}
      </div>

      <div className="bg-white border border-[#e8e8e8] px-5 py-4 mb-5 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#999]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search documents..."
            className="w-full h-9 pl-9 pr-8 border border-[#d9d9d9] bg-white text-[#333] placeholder-[#bbb] focus:border-[#0A6ED1] focus:outline-none"
            style={{ fontSize: 13 }}
          />
        </div>

        <div className="relative">
          <Filter size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#999]" />
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="h-9 pl-8 pr-8 border border-[#d9d9d9] bg-white text-[#333] focus:border-[#0A6ED1] focus:outline-none appearance-none cursor-pointer"
            style={{ fontSize: 13 }}
          >
            <option value="">All Categories</option>
            {categoryOptions.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
          <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#999] pointer-events-none" />
        </div>

        {!mine && (
          <div className="relative">
            <select
              value={filterPlant}
              onChange={(e) => setFilterPlant(e.target.value)}
              className="h-9 px-3 pr-8 border border-[#d9d9d9] bg-white text-[#333] focus:border-[#0A6ED1] focus:outline-none appearance-none cursor-pointer"
              style={{ fontSize: 13 }}
            >
              <option value="">All Plants</option>
              {plants.map((plant) => (
                <option key={plant.id} value={plant.id}>{plant.name}</option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#999] pointer-events-none" />
          </div>
        )}

        {hasFilter && (
          <button
            onClick={() => { setSearch(""); setFilterCategory(""); setFilterStatus(""); setFilterPlant(""); }}
            className="h-9 px-3 text-[#BB0000] hover:bg-[#fff5f5] border border-[#e8c0c0] inline-flex items-center gap-1.5 cursor-pointer"
            style={{ fontSize: 13 }}
          >
            <X size={13} /> Clear
          </button>
        )}
      </div>

      <div className="bg-white border border-[#e8e8e8]">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-[#fafafa] border-b border-[#f0f0f0] text-left">
                {["Document Name", "Plant", "Category", "Date", "Status", "Notes", "Actions"].map((heading) => (
                  <th key={heading} className="px-5 py-3 text-[#6a6d70]" style={{ fontSize: 12, fontWeight: 500 }}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f7f7f7]">
              {documents.map((document) => (
                <tr key={document.id} className="hover:bg-[#fafafa] transition-colors">
                  <td className="px-5 py-4">
                    <button onClick={() => void openDocument(document)} className="text-[#0A6ED1] hover:underline text-left cursor-pointer" style={{ fontSize: 13, fontWeight: 500 }}>
                      {document.name}
                    </button>
                    <div className="text-[#999] mt-0.5" style={{ fontSize: 11 }}>v{document.version} · by {document.uploadedBy}</div>
                  </td>
                  <td className="px-5 py-4 text-[#6a6d70]" style={{ fontSize: 13 }}>{document.plant}</td>
                  <td className="px-5 py-4 text-[#6a6d70]" style={{ fontSize: 13 }}>{document.category}</td>
                  <td className="px-5 py-4 text-[#6a6d70]" style={{ fontSize: 13 }}>{document.date || "-"}</td>
                  <td className="px-5 py-4 text-[#333]" style={{ fontSize: 13 }}>{document.status}</td>
                  <td className="px-5 py-4 text-[#6a6d70]" style={{ fontSize: 12 }}>{document.noteSummary?.count || 0}</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <button onClick={() => void openDocument(document)} className="h-8 px-3 border border-[#d9d9d9] text-[#333] hover:bg-[#f5f5f5] inline-flex items-center gap-1.5 cursor-pointer" style={{ fontSize: 12 }}>
                        <Eye size={12} /> Open
                      </button>
                      <button onClick={() => void deleteDocument(document.id)} className="h-8 px-3 border border-[#f0c0c0] text-[#BB0000] hover:bg-[#fff5f5] inline-flex items-center gap-1.5 cursor-pointer" style={{ fontSize: 12 }}>
                        <Trash2 size={12} /> Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedDoc && <DocumentDrawer doc={selectedDoc} onClose={() => setSelectedDoc(null)} />}
    </div>
  );
}
