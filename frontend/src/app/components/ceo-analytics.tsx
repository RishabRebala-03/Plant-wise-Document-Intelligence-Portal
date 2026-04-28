import { useEffect, useState } from "react";
import { BarChart2, TrendingUp, Activity, Calendar, RefreshCw } from "lucide-react";
import { LIVE_SYNC_INTERVAL_MS, analyticsApi } from "../lib/api";
import type { AnalyticsData } from "../lib/types";

export function CeoAnalytics() {
  const [period, setPeriod] = useState("6m");
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [liveViewEnabled, setLiveViewEnabled] = useState(true);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function loadAnalytics(options?: { silent?: boolean }) {
    if (options?.silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError("");
    try {
      const result = await analyticsApi.overview(period);
      setData(result);
      setLastSyncedAt(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load analytics.");
    } finally {
      if (options?.silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    void loadAnalytics();
  }, [period]);

  useEffect(() => {
    if (!liveViewEnabled) return;

    const timer = window.setInterval(() => {
      void loadAnalytics({ silent: true });
    }, LIVE_SYNC_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [liveViewEnabled, period]);

  if (loading) return <div className="p-7 text-[#6a6d70]">Loading analytics...</div>;
  if (error || !data) return <div className="p-7 text-[#BB0000]">{error || "Analytics unavailable."}</div>;

  return (
    <div className="p-7 max-w-[1400px]">
      <div className="mb-7 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[#1a1a1a]" style={{ fontSize: 20, fontWeight: 600 }}>
            Analytics
          </h1>
          <p className="text-[#6a6d70] mt-1" style={{ fontSize: 14 }}>
            Backend-powered trends and distribution.
          </p>
          <p className="text-[#6a6d70] mt-1" style={{ fontSize: 12 }}>
            {liveViewEnabled
              ? `Live analytics is on. Refreshing every ${LIVE_SYNC_INTERVAL_MS / 1000} seconds${lastSyncedAt ? ` • Last synced at ${lastSyncedAt}` : ""}`
              : `Live analytics is off${lastSyncedAt ? ` • Last synced at ${lastSyncedAt}` : ""}`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex border border-[#d9d9d9] overflow-hidden">
            {["1m", "3m", "6m", "1y"].map((value) => (
              <button
                key={value}
                onClick={() => setPeriod(value)}
                className={`px-3 h-8 cursor-pointer transition-colors ${
                  period === value ? "bg-[#0A6ED1] text-white" : "bg-white text-[#6a6d70] hover:bg-[#f5f5f5]"
                } ${value !== "1m" ? "border-l border-[#d9d9d9]" : ""}`}
                style={{ fontSize: 12 }}
              >
                {value}
              </button>
            ))}
          </div>
          <button
            onClick={() => setLiveViewEnabled((prev) => !prev)}
            className={`h-8 px-3 border inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
              liveViewEnabled
                ? "border-[#0A6ED1] bg-[#EBF4FD] text-[#0A6ED1]"
                : "border-[#d9d9d9] bg-white text-[#333] hover:bg-[#f5f5f5]"
            }`}
            style={{ fontSize: 12 }}
          >
            {refreshing ? <RefreshCw size={13} className="animate-spin" /> : <Activity size={13} />}
            {liveViewEnabled ? "Live On" : "Live"}
          </button>
        </div>
      </div>

      <div className="data-table-panel mb-8">
        <div className="data-table-toolbar flex items-center gap-2">
          <BarChart2 size={14} className="text-[#0A6ED1]" />
          <span className="text-[#1a1a1a]" style={{ fontSize: 14, fontWeight: 500 }}>Analytics Summary</span>
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
              {[
                { label: "Total Uploads", value: data.summary.totalUploads, sub: "All time" },
                { label: "Monthly Avg.", value: data.summary.monthlyAverage, sub: "Per selected period" },
                { label: "Peak Month", value: data.summary.peakMonth.month || "-", sub: `${data.summary.peakMonth.uploads} uploads` },
                { label: "Top Plant", value: data.summary.topPlant.name || "-", sub: `${data.summary.topPlant.documents} documents` },
              ].map((kpi) => (
                <tr key={kpi.label}>
                  <td className="text-strong">{kpi.label}</td>
                  <td className="text-strong">{kpi.value}</td>
                  <td>{kpi.sub}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="data-table-panel">
          <div className="px-5 py-4 border-b border-[#f0f0f0] flex items-center gap-2">
            <TrendingUp size={14} className="text-[#0A6ED1]" />
            <span className="text-[#1a1a1a]" style={{ fontSize: 14, fontWeight: 500 }}>
              Monthly Upload Trend
            </span>
          </div>
          <div className="data-table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Uploads</th>
                </tr>
              </thead>
              <tbody>
                {data.monthlyUploads.map((row) => (
                  <tr key={row.month}>
                    <td className="text-strong">{row.month}</td>
                    <td>{row.uploads}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="data-table-panel">
          <div className="px-5 py-4 border-b border-[#f0f0f0] flex items-center gap-2">
            <BarChart2 size={14} className="text-[#0A6ED1]" />
            <span className="text-[#1a1a1a]" style={{ fontSize: 14, fontWeight: 500 }}>
              Category Distribution
            </span>
          </div>
          <div className="data-table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Share</th>
                  <th>Color</th>
                </tr>
              </thead>
              <tbody>
                {data.categoryDistribution.map((row) => (
                  <tr key={row.category}>
                    <td className="text-strong">{row.category}</td>
                    <td>{row.pct}%</td>
                    <td>
                      <span className="inline-flex items-center gap-2">
                        <span className="h-3 w-3 border border-[#d9d9d9]" style={{ background: row.color }} />
                        {row.color}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="data-table-panel">
          <div className="px-5 py-4 border-b border-[#f0f0f0]">
            <span className="text-[#1a1a1a]" style={{ fontSize: 14, fontWeight: 500 }}>
              Plant Document Volume
            </span>
          </div>
          <div className="data-table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Plant</th>
                  <th>Documents</th>
                  <th>Last Upload</th>
                  <th>Share of Uploads</th>
                </tr>
              </thead>
              <tbody>
                {data.plantVolume.map((plant) => {
                  const pct = Math.round((plant.documents / Math.max(data.summary.totalUploads, 1)) * 100);
                  return (
                    <tr key={plant.id}>
                      <td className="text-strong">{plant.name}</td>
                      <td>{plant.documents}</td>
                      <td>{plant.lastUpload || "-"}</td>
                      <td>{pct}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="data-table-panel">
          <div className="px-5 py-4 border-b border-[#f0f0f0] flex items-center justify-between">
            <span className="text-[#1a1a1a]" style={{ fontSize: 14, fontWeight: 500 }}>
              Top Uploaders
            </span>
            <div className="flex items-center gap-1 text-[#6a6d70]" style={{ fontSize: 12 }}>
              <Calendar size={12} /> Current data
            </div>
          </div>
          <div className="data-table-scroll">
          <table className="data-table">
            <thead>
              <tr className="bg-[#fafafa] border-b border-[#f0f0f0] text-left">
                {["#", "Name", "Documents", "Plants"].map((heading) => (
                  <th key={heading} className="px-5 py-2.5 text-[#6a6d70]" style={{ fontSize: 12, fontWeight: 500 }}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f7f7f7]">
              {data.topUploaders.map((uploader, index) => (
                <tr key={uploader.name}>
                  <td className="px-5 py-3.5 text-[#999]" style={{ fontSize: 12 }}>{index + 1}</td>
                  <td className="px-5 py-3.5 text-[#333]" style={{ fontSize: 13 }}>{uploader.name}</td>
                  <td className="px-5 py-3.5 text-[#333]" style={{ fontSize: 13 }}>{uploader.docs}</td>
                  <td className="px-5 py-3.5 text-[#6a6d70]" style={{ fontSize: 12 }}>{uploader.plants}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      </div>
    </div>
  );
}
