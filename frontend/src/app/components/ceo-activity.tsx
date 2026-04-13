import { useEffect, useState } from "react";
import { dashboardApi } from "../lib/api";
import type { Activity } from "../lib/types";
import { DetailedActivityLog } from "./detailed-activity-log";

export function CeoActivity() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    dashboardApi
      .manager()
      .then((data) => setActivities(data.activity))
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to load activity logs."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-7 text-[#6a6d70]">Loading activity logs...</div>;
  if (error) return <div className="p-7 text-[#BB0000]">{error}</div>;

  return (
    <div className="p-7 max-w-[1400px]">
      <div className="mb-7">
        <h1 className="text-[#1a1a1a]" style={{ fontSize: 20, fontWeight: 600 }}>Activity Logs</h1>
        <p className="text-[#6a6d70] mt-1" style={{ fontSize: 14 }}>
          Detailed activity events for the CEO persona.
        </p>
      </div>
      <DetailedActivityLog activities={activities} />
    </div>
  );
}
