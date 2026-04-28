import { useEffect, useState } from "react";
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

      <div className="data-table-panel mb-8">
        <div className="data-table-toolbar">
          <span className="text-[#1a1a1a]" style={{ fontSize: 14, fontWeight: 500 }}>Plant Summary</span>
        </div>
        <div className="data-table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Total Plants</th>
                <th>Operational</th>
                <th>Needs Attention</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="text-strong">{summary.totalPlants}</td>
                <td className="text-strong">{summary.operational}</td>
                <td className="text-strong">{summary.needsAttention}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="data-table-panel">
        <div className="data-table-toolbar">
          <span className="text-[#1a1a1a]" style={{ fontSize: 14, fontWeight: 500 }}>All Plants</span>
        </div>
        <div className="data-table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Plant</th>
                <th>Location</th>
                <th>Documents</th>
                <th>Capacity</th>
                <th>Manager</th>
                <th>Last Upload</th>
              </tr>
            </thead>
            <tbody>
              {plants.map((plant) => (
                <tr key={plant.id}>
                  <td className="text-strong">{plant.name}</td>
                  <td>{plant.location || "-"}</td>
                  <td>{plant.documents}</td>
                  <td>{plant.capacity || "-"}</td>
                  <td>{plant.manager || "-"}</td>
                  <td>{plant.lastUpload || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
