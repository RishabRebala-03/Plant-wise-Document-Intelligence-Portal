import { useEffect, useState } from "react";
import {
  FileText, Building2, Clock, FolderOpen,
  ArrowRight, AlertCircle,
} from "lucide-react";
import { useNavigate } from "react-router";
import { LIVE_SYNC_INTERVAL_MS, dashboardApi } from "../lib/api";
import type { CeoDashboardData } from "../lib/types";

export function CeoDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<CeoDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadDashboard(options?: { silent?: boolean }) {
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      setData(await dashboardApi.ceo());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load dashboard.");
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

      <div className="data-table-panel mb-8">
        <div className="data-table-toolbar">
          <span className="text-[#1a1a1a]" style={{ fontSize: 14, fontWeight: 500 }}>Executive KPIs</span>
        </div>
        <div className="data-table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Value</th>
                <th>Context</th>
              </tr>
            </thead>
            <tbody>
              {kpis.map((kpi) => (
                <tr key={kpi.label}>
                  <td className="text-strong">
                    <span className="inline-flex items-center gap-2">
                      <kpi.icon size={15} style={{ color: kpi.color }} />
                      {kpi.label}
                    </span>
                  </td>
                  <td className="text-strong">{kpi.value}</td>
                  <td>{kpi.sub}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="data-table-panel">
          <div className="px-5 py-4 border-b border-[#f0f0f0] flex items-center gap-2">
            <AlertCircle size={14} className="text-[#E9730C]" />
            <span className="text-[#1a1a1a]" style={{ fontSize: 14, fontWeight: 500 }}>
              Alerts & Notices
            </span>
          </div>
          <div className="data-table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Notice</th>
                </tr>
              </thead>
              <tbody>
                {data.alerts.length === 0 ? (
                  <tr><td colSpan={2}>No active alerts.</td></tr>
                ) : (
                  data.alerts.map((alert, index) => (
                    <tr key={`${alert.text}-${index}`}>
                      <td>{index + 1}</td>
                      <td className="text-strong">{alert.text}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-2 data-table-panel">
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
          <div className="data-table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Plant</th>
                  <th>Documents</th>
                  <th>Last Upload</th>
                </tr>
              </thead>
              <tbody>
                {data.plants.map((plant) => (
                  <tr key={plant.id}>
                    <td className="text-strong">{plant.name}</td>
                    <td>{plant.documents}</td>
                    <td>{plant.lastUpload || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="data-table-panel">
        <div className="px-5 py-4 border-b border-[#f0f0f0] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText size={14} className="text-[#0A6ED1]" />
            <span className="text-[#1a1a1a]" style={{ fontSize: 14, fontWeight: 500 }}>
              Recent Documents
            </span>
          </div>
        </div>
        <div className="data-table-scroll">
        <table className="data-table">
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
    </div>
  );
}
