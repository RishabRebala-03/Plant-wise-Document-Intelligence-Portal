import { useEffect, useState } from "react";
import { Building2, TrendingUp, AlertCircle, MapPin, Clock } from "lucide-react";
import { LIVE_SYNC_INTERVAL_MS, plantsApi } from "../lib/api";
import type { Plant } from "../lib/types";

export function CeoPlants() {
  const [plants, setPlants] = useState<Plant[]>([]);
  const [summary, setSummary] = useState({ totalPlants: 0, operational: 0, needsAttention: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadPlants(options?: { silent?: boolean }) {
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      const result = await plantsApi.list();
      setPlants(result.items);
      setSummary({
        totalPlants: result.summary.totalPlants ?? result.items.length,
        operational: result.summary.operational ?? 0,
        needsAttention: result.summary.needsAttention ?? 0,
      });
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load plants.");
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    void loadPlants();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadPlants({ silent: true });
    }, LIVE_SYNC_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  if (loading) return <div className="p-7 text-[#6a6d70]">Loading plants...</div>;
  if (error) return <div className="p-7 text-[#BB0000]">{error}</div>;

  return (
    <div className="p-7 max-w-[1400px]">
      <div className="mb-7">
        <h1 className="text-[#1a1a1a]" style={{ fontSize: 20, fontWeight: 600 }}>
          Plants
        </h1>
        <p className="text-[#6a6d70] mt-1" style={{ fontSize: 14 }}>
          Operational overview from the backend.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-5 mb-8">
        {[
          { label: "Total Plants", value: summary.totalPlants, icon: Building2, color: "#0A6ED1", bg: "#EBF4FD" },
          { label: "Operational", value: summary.operational, icon: TrendingUp, color: "#107E3E", bg: "#EBF5EF" },
          { label: "Needs Attention", value: summary.needsAttention, icon: AlertCircle, color: "#E9730C", bg: "#FEF3E7" },
        ].map((stat) => (
          <div key={stat.label} className="bg-white border border-[#e8e8e8] px-5 py-4 flex items-center gap-4">
            <div className="w-10 h-10 flex items-center justify-center shrink-0" style={{ background: stat.bg }}>
              <stat.icon size={18} style={{ color: stat.color }} />
            </div>
            <div>
              <div className="text-[#1a1a1a]" style={{ fontSize: 24, fontWeight: 600 }}>{stat.value}</div>
              <div className="text-[#6a6d70]" style={{ fontSize: 12 }}>{stat.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5">
        {plants.map((plant) => (
          <div key={plant.id} className="bg-white border border-[#e8e8e8]">
            <div className="h-1.5 bg-[#0A6ED1]" />
            <div className="p-5">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <span className="text-[#1a1a1a]" style={{ fontSize: 14, fontWeight: 600 }}>
                    {plant.name}
                  </span>
                  <div className="flex items-center gap-1 text-[#6a6d70] mt-1" style={{ fontSize: 12 }}>
                    <MapPin size={11} /> {plant.location || "-"}
                  </div>
                </div>
                <span
                  className="px-2 py-0.5 shrink-0"
                  style={{
                    fontSize: 11,
                    background: plant.status === "Operational" ? "#EBF5EF" : "#FEF3E7",
                    color: plant.status === "Operational" ? "#107E3E" : "#E9730C",
                  }}
                >
                  {plant.status}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-4">
                {[
                  { label: "Documents", value: plant.documents },
                  { label: "Capacity", value: plant.capacity || "-" },
                  { label: "Manager", value: plant.manager || "-" },
                ].map((item) => (
                  <div key={item.label} className="bg-[#fafafa] px-3 py-2.5">
                    <div className="text-[#1a1a1a]" style={{ fontSize: 13, fontWeight: 600 }}>{item.value}</div>
                    <div className="text-[#999]" style={{ fontSize: 10 }}>{item.label}</div>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-1 text-[#6a6d70]" style={{ fontSize: 12 }}>
                <Clock size={11} /> Last upload: {plant.lastUpload || "-"}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
