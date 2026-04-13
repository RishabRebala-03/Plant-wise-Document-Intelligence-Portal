import { useEffect, useState } from "react";
import {
  FileText, Building2, Clock, FolderOpen,
  TrendingUp, ArrowRight, AlertCircle,
} from "lucide-react";
import { useNavigate } from "react-router";
import { dashboardApi } from "../lib/api";
import type { CeoDashboardData } from "../lib/types";

export function CeoDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<CeoDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    dashboardApi
      .ceo()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to load dashboard."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-7 text-[#6a6d70]">Loading dashboard...</div>;
  if (error || !data) return <div className="p-7 text-[#BB0000]">{error || "Dashboard unavailable."}</div>;

  const kpis = [
    {
      label: "Total Documents",
      value: data.kpis.totalDocuments,
      sub: `${data.kpis.recentUploads} recent uploads`,
      icon: FileText,
      color: "#0A6ED1",
      bg: "#EBF4FD",
    },
    {
      label: "Active Plants",
      value: data.kpis.activePlants,
      sub: "Operational footprint",
      icon: Building2,
      color: "#107E3E",
      bg: "#EBF5EF",
    },
    {
      label: "Recent Uploads",
      value: data.kpis.recentUploads,
      sub: "Last 7 days",
      icon: Clock,
      color: "#E9730C",
      bg: "#FEF3E7",
    },
    {
      label: "Categories",
      value: data.kpis.categories,
      sub: "Document types",
      icon: FolderOpen,
      color: "#5B738B",
      bg: "#EEF2F5",
    },
  ];

  return (
    <div className="p-7 max-w-[1400px]">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[#1a1a1a]" style={{ fontSize: 20, fontWeight: 600 }}>
            Executive Overview
          </h1>
          <p className="text-[#6a6d70] mt-1" style={{ fontSize: 14 }}>
            Live data from your local Flask backend.
          </p>
        </div>
        <button
          onClick={() => navigate("/documents")}
          className="h-9 px-4 bg-[#0A6ED1] text-white hover:bg-[#0854A0] inline-flex items-center gap-2 cursor-pointer shrink-0 transition-colors"
          style={{ fontSize: 13 }}
        >
          <FileText size={14} /> View All Documents
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="bg-white border border-[#e8e8e8] p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="w-9 h-9 flex items-center justify-center" style={{ background: kpi.bg }}>
                <kpi.icon size={17} style={{ color: kpi.color }} />
              </div>
              <TrendingUp size={14} className="text-[#107E3E]" />
            </div>
            <div className="text-[#1a1a1a]" style={{ fontSize: 30, fontWeight: 600, lineHeight: 1 }}>
              {kpi.value}
            </div>
            <div className="text-[#6a6d70] mt-1" style={{ fontSize: 12 }}>
              {kpi.label}
            </div>
            <div className="mt-2 text-[#6a6d70]" style={{ fontSize: 11 }}>
              {kpi.sub}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="bg-white border border-[#e8e8e8]">
          <div className="px-5 py-4 border-b border-[#f0f0f0] flex items-center gap-2">
            <AlertCircle size={14} className="text-[#E9730C]" />
            <span className="text-[#1a1a1a]" style={{ fontSize: 14, fontWeight: 500 }}>
              Alerts & Notices
            </span>
          </div>
          <div className="divide-y divide-[#f5f5f5]">
            {data.alerts.length === 0 ? (
              <div className="px-5 py-6 text-[#6a6d70]" style={{ fontSize: 13 }}>
                No active alerts.
              </div>
            ) : (
              data.alerts.map((alert, index) => (
                <div key={`${alert.text}-${index}`} className="px-5 py-4">
                  <span className="text-[#333]" style={{ fontSize: 13, lineHeight: 1.5 }}>
                    {alert.text}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="lg:col-span-2 bg-white border border-[#e8e8e8]">
          <div className="px-5 py-4 border-b border-[#f0f0f0] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Building2 size={14} className="text-[#0A6ED1]" />
              <span className="text-[#1a1a1a]" style={{ fontSize: 14, fontWeight: 500 }}>
                Plant Summary
              </span>
            </div>
            <button
              onClick={() => navigate("/plants")}
              className="text-[#0A6ED1] hover:underline inline-flex items-center gap-1 cursor-pointer"
              style={{ fontSize: 12 }}
            >
              View all <ArrowRight size={12} />
            </button>
          </div>
          <div className="divide-y divide-[#f5f5f5]">
            {data.plants.map((plant) => (
              <div key={plant.id} className="px-5 py-4 flex items-center gap-5">
                <div className="min-w-0 flex-1">
                  <div className="text-[#333] truncate" style={{ fontSize: 13, fontWeight: 500 }}>
                    {plant.name}
                  </div>
                  <div className="text-[#6a6d70] mt-0.5" style={{ fontSize: 11 }}>
                    Last upload: {plant.lastUpload || "-"}
                  </div>
                </div>
                <span className="text-[#333]" style={{ fontSize: 13, fontWeight: 500 }}>
                  {plant.documents}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white border border-[#e8e8e8]">
        <div className="px-5 py-4 border-b border-[#f0f0f0] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText size={14} className="text-[#0A6ED1]" />
            <span className="text-[#1a1a1a]" style={{ fontSize: 14, fontWeight: 500 }}>
              Recent Documents
            </span>
          </div>
        </div>
        <table className="w-full">
          <thead>
            <tr className="bg-[#fafafa] text-left border-b border-[#f0f0f0]">
              {["Document Name", "Plant", "Category", "Date"].map((heading) => (
                <th key={heading} className="px-5 py-3 text-[#6a6d70]" style={{ fontSize: 12, fontWeight: 500 }}>
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f7f7f7]">
            {data.recentDocuments.map((document) => (
              <tr key={document.id} className="hover:bg-[#fafafa] transition-colors">
                <td className="px-5 py-4 text-[#333]" style={{ fontSize: 13, fontWeight: 500 }}>{document.name}</td>
                <td className="px-5 py-4 text-[#6a6d70]" style={{ fontSize: 13 }}>{document.plant}</td>
                <td className="px-5 py-4 text-[#6a6d70]" style={{ fontSize: 13 }}>{document.category}</td>
                <td className="px-5 py-4 text-[#6a6d70]" style={{ fontSize: 13 }}>{document.date || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
