import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  FileText, Clock, Activity,
  ArrowRight, AlertCircle, BarChart2,
} from "lucide-react";
import { LIVE_SYNC_INTERVAL_MS, dashboardApi, documentsApi } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { DocumentRecord, ManagerDashboardData } from "../lib/types";
import { DocumentDrawer } from "./document-drawer";

export function ManagerDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState<ManagerDashboardData | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<DocumentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function loadDashboard(options?: { silent?: boolean }) {
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      setData(await dashboardApi.manager());
      setMessage("");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Unable to load manager dashboard.");
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadDashboard({ silent: true });
    }, LIVE_SYNC_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  async function openDocument(document: DocumentRecord) {
    if (document.file?.storageId) {
      await documentsApi.openFileInNewTab(document.id);
      return;
    }
    const result = await documentsApi.get(document.id);
    setSelectedDoc(result.document);
  }

  const insightCards = useMemo(() => {
    if (!data) return [];
    return [
      { label: "My Documents", value: data.stats.myDocuments, icon: FileText, color: "#0A6ED1", bg: "#EBF4FD", note: "Documents in your plant scope" },
      { label: "Uploaded This Week", value: data.stats.uploadedThisWeek, icon: Clock, color: "#E9730C", bg: "#FEF3E7", note: "Recent document velocity" },
      { label: "Recent Activity", value: data.activity.length, icon: Activity, color: "#107E3E", bg: "#EBF5EF", note: "Tracked actions in your document workspace" },
    ];
  }, [data]);

  if (loading) return <div className="p-7 text-[#6a6d70]">Loading manager dashboard...</div>;
  if (!data) return <div className="p-7 text-[#BB0000]">{message || "Manager dashboard unavailable."}</div>;

  return (
    <div className="p-7 max-w-[1400px]">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[#1a1a1a]" style={{ fontSize: 20, fontWeight: 600 }}>
            Plant Dashboard
          </h1>
          <p className="text-[#6a6d70] mt-1" style={{ fontSize: 14 }}>
            Insights and activity for {user?.plant || "your assigned plant"}.
          </p>
        </div>
        <button
          onClick={() => navigate("/manager/docs")}
          className="h-9 px-4 border border-[#d9d9d9] bg-white text-[#333] hover:bg-[#f5f5f5] inline-flex items-center gap-2 cursor-pointer transition-colors shrink-0"
          style={{ fontSize: 13 }}
        >
          <FileText size={14} /> My Documents <ArrowRight size={13} />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
        {insightCards.map((card) => (
          <div key={card.label} className="bg-white border border-[#e8e8e8] p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 flex items-center justify-center" style={{ background: card.bg }}>
                <card.icon size={18} style={{ color: card.color }} />
              </div>
              <BarChart2 size={14} className="text-[#5B738B]" />
            </div>
            <div className="text-[#1a1a1a]" style={{ fontSize: 28, fontWeight: 600, lineHeight: 1 }}>
              {card.value}
            </div>
            <div className="text-[#6a6d70] mt-1" style={{ fontSize: 12 }}>
              {card.label}
            </div>
            <div className="text-[#6a6d70] mt-2" style={{ fontSize: 11 }}>
              {card.note}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-[#e8e8e8]">
          <div className="px-5 py-4 border-b border-[#f0f0f0] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText size={14} className="text-[#0A6ED1]" />
              <span className="text-[#1a1a1a]" style={{ fontSize: 14, fontWeight: 500 }}>
                Recent Uploads
              </span>
            </div>
            <button
              onClick={() => navigate("/manager/all")}
              className="text-[#0A6ED1] hover:underline inline-flex items-center gap-1 cursor-pointer"
              style={{ fontSize: 12 }}
            >
              View all <ArrowRight size={12} />
            </button>
          </div>
          <table className="w-full">
            <thead>
              <tr className="bg-[#fafafa] text-left border-b border-[#f0f0f0]">
                {["Document Name", "Category", "Date"].map((heading) => (
                  <th key={heading} className="px-5 py-3 text-[#6a6d70]" style={{ fontSize: 12, fontWeight: 500 }}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f7f7f7]">
              {data.recentUploads.map((document) => (
                <tr key={document.id} className="hover:bg-[#fafafa] transition-colors">
                  <td className="px-5 py-4">
                    <button
                      onClick={() => void openDocument(document)}
                      className="text-[#0A6ED1] hover:underline text-left cursor-pointer"
                      style={{ fontSize: 13, fontWeight: 500 }}
                    >
                      {document.name}
                    </button>
                  </td>
                  <td className="px-5 py-4 text-[#6a6d70]" style={{ fontSize: 13 }}>{document.category}</td>
                  <td className="px-5 py-4 text-[#6a6d70]" style={{ fontSize: 13 }}>{document.date || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-white border border-[#e8e8e8]">
          <div className="px-5 py-4 border-b border-[#f0f0f0] flex items-center gap-2">
            <Activity size={14} className="text-[#107E3E]" />
            <span className="text-[#1a1a1a]" style={{ fontSize: 14, fontWeight: 500 }}>
              Recent Activity
            </span>
          </div>
          <div className="divide-y divide-[#f7f7f7]">
            {data.activity.length === 0 ? (
              <div className="px-5 py-6 text-[#6a6d70]" style={{ fontSize: 13 }}>
                No recent activity.
              </div>
            ) : (
              data.activity.slice(0, 6).map((item) => (
                <div key={item.id} className="px-5 py-4">
                  <div className="text-[#333]" style={{ fontSize: 13, fontWeight: 500 }}>
                    {item.action}
                  </div>
                  <div className="text-[#6a6d70] mt-1" style={{ fontSize: 11 }}>
                    {item.documentName || item.entityType} · {item.createdAt || "-"}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 bg-white border border-[#e8e8e8]">
        <div className="px-5 py-4 border-b border-[#f0f0f0] flex items-center gap-2">
          <AlertCircle size={14} className="text-[#E9730C]" />
          <span className="text-[#1a1a1a]" style={{ fontSize: 14, fontWeight: 500 }}>
            Focus Areas
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-5">
          <div className="border border-[#e8e8e8] bg-[#fafafa] p-4">
            <div className="text-[#333]" style={{ fontSize: 13, fontWeight: 500 }}>Submission cadence</div>
            <div className="text-[#6a6d70] mt-1" style={{ fontSize: 12 }}>
              {data.stats.uploadedThisWeek} uploads recorded this week.
            </div>
          </div>
          <div className="border border-[#e8e8e8] bg-[#fafafa] p-4">
            <div className="text-[#333]" style={{ fontSize: 13, fontWeight: 500 }}>Approval health</div>
            <div className="text-[#6a6d70] mt-1" style={{ fontSize: 12 }}>
              {data.stats.approved} documents are already approved.
            </div>
          </div>
          <div className="border border-[#e8e8e8] bg-[#fafafa] p-4">
            <div className="text-[#333]" style={{ fontSize: 13, fontWeight: 500 }}>Next action</div>
            <button
              onClick={() => navigate("/manager")}
              className="mt-2 text-[#0A6ED1] hover:underline cursor-pointer"
              style={{ fontSize: 12, fontWeight: 500 }}
            >
              Go to upload workflow
            </button>
          </div>
        </div>
      </div>

      {selectedDoc && (
        <DocumentDrawer
          doc={selectedDoc}
          onClose={() => setSelectedDoc(null)}
        />
      )}
    </div>
  );
}
