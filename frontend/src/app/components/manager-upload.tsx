import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, Clock3, FileText, FolderKanban, Paperclip, TriangleAlert, Upload, UploadCloud } from "lucide-react";
import { ApiError, LIVE_SYNC_INTERVAL_MS, categoryOptions, dashboardApi, documentsApi, plantsApi, settingsApi } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { DocumentRecord, GovernancePolicy, ManagerDashboardData, Plant } from "../lib/types";
import { assignDocumentToProject, persistPortalState, readPortalState, type ProjectRecord } from "../lib/portal";
import { DocumentDrawer } from "./document-drawer";

function scopedPlantIds(user: { assignedPlantIds?: string[]; plantId?: string | null }) {
  return user.assignedPlantIds?.length ? user.assignedPlantIds : user.plantId ? [user.plantId] : [];
}

const BUSINESS_DAY_OPTIONS = [
  { label: "Mon", value: 0 },
  { label: "Tue", value: 1 },
  { label: "Wed", value: 2 },
  { label: "Thu", value: 3 },
  { label: "Fri", value: 4 },
  { label: "Sat", value: 5 },
  { label: "Sun", value: 6 },
];

function getBusinessTimeParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const weekday = parts.find((part) => part.type === "weekday")?.value || "Mon";
  const hour = Number(parts.find((part) => part.type === "hour")?.value || "0");
  return { weekday, hour };
}

function formatBusinessHour(value: number) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2020, 0, 1, value, 0)));
}

function describeBusinessHours(policy: GovernancePolicy) {
  const dayLabels = BUSINESS_DAY_OPTIONS
    .filter((day) => policy.businessHours.allowedDays.includes(day.value))
    .map((day) => day.label)
    .join(", ");
  return `${dayLabels || "No active days"} • ${formatBusinessHour(policy.businessHours.startHour)} - ${formatBusinessHour(policy.businessHours.endHour)} • ${policy.businessHours.timezone}`;
}

function isWithinGovernanceBusinessHours(policy: GovernancePolicy, date = new Date()) {
  const { weekday, hour } = getBusinessTimeParts(date, policy.businessHours.timezone);
  const weekdayMap: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  const dayValue = weekdayMap[weekday] ?? 0;
  const isAllowedDay = policy.businessHours.allowedDays.includes(dayValue);
  if (!isAllowedDay) return false;
  return hour >= policy.businessHours.startHour && hour < policy.businessHours.endHour;
}

export function ManagerUpload() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [data, setData] = useState<ManagerDashboardData | null>(null);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<DocumentRecord | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error" | "">("");
  const [file, setFile] = useState<File | null>(null);
  const [governancePolicy, setGovernancePolicy] = useState<GovernancePolicy>({
    allowedUploadFormats: ["pdf", "doc", "docx", "xls", "xlsx", "png", "jpg", "jpeg"],
    businessHours: {
      timezone: "Asia/Kolkata",
      startHour: 7,
      endHour: 20,
      allowedDays: [0, 1, 2, 3, 4],
    },
  });
  const [form, setForm] = useState({
    company: "Midwest Ltd",
    plant: user?.plantId || "",
    projectId: "",
    name: "",
    category: "",
    comments: "",
  });

  const allowedPlantIds = useMemo(() => scopedPlantIds(user || {}), [user]);
  const uploadAllowedNow = useMemo(() => isWithinGovernanceBusinessHours(governancePolicy), [governancePolicy]);

  async function load() {
    const [dashboard, plantsResult, documentsResult, governanceResult] = await Promise.all([
      dashboardApi.manager(),
      plantsApi.list(),
      documentsApi.list({ page: 1, pageSize: 500 }),
      settingsApi.getGovernancePolicy().catch((error) => {
        if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
          return governancePolicy;
        }
        throw error;
      }),
    ]);
    const scopedPlants = plantsResult.items.filter((plant) => allowedPlantIds.includes(plant.id));
    const portalState = readPortalState(plantsResult.items, documentsResult.items);
    const scopedProjects = portalState.projects.filter((project) => allowedPlantIds.includes(project.plantId));
    const scopedUploads = dashboard.recentUploads.filter((document) => allowedPlantIds.includes(document.plantId));

    setData({ ...dashboard, recentUploads: scopedUploads });
    setPlants(scopedPlants);
    setProjects(scopedProjects);
    setGovernancePolicy(governanceResult);
  }

  useEffect(() => {
    load()
      .catch((err) => {
        setMessage(err instanceof Error ? err.message : "Unable to load upload workspace.");
        setMessageType("error");
      })
      .finally(() => setLoading(false));
  }, [user?.id]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void load().catch(() => undefined);
    }, LIVE_SYNC_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    const nextPlant = allowedPlantIds[0] || "";
    setForm((current) => ({
      ...current,
      plant: allowedPlantIds.includes(current.plant) ? current.plant : nextPlant,
      projectId: "",
    }));
  }, [allowedPlantIds, user]);

  const availableProjects = useMemo(
    () => projects.filter((project) => !form.plant || project.plantId === form.plant),
    [form.plant, projects],
  );

  function handleSelectedFile(nextFile: File | null) {
    if (!uploadAllowedNow) {
      setMessage(`Uploads are only allowed during ${describeBusinessHours(governancePolicy)}.`);
      setMessageType("error");
      if (fileInputRef.current) fileInputRef.current.value = "";
      setFile(null);
      return;
    }
    if (nextFile) {
      const extension = nextFile.name.split(".").pop()?.toLowerCase() || "";
      if (!governancePolicy.allowedUploadFormats.includes(extension)) {
        setMessage(`Only these file formats are allowed: ${governancePolicy.allowedUploadFormats.map((value) => value.toUpperCase()).join(", ")}.`);
        setMessageType("error");
        if (fileInputRef.current) fileInputRef.current.value = "";
        setFile(null);
        return;
      }
    }
    setFile(nextFile);
    setMessage("");
    setMessageType("");
    if (!nextFile) return;
    const inferredName = nextFile.name.replace(/\.[^.]+$/, "");
    setForm((prev) => ({
      ...prev,
      name: prev.name.trim() ? prev.name : inferredName,
    }));
  }

  async function handleUpload(event: React.FormEvent) {
    event.preventDefault();
    if (!form.plant || !form.projectId || !form.name || !form.category) {
      setMessage("Pick a plant, project, document name, and category.");
      setMessageType("error");
      return;
    }
    if (!file) {
      setMessage("Choose a file before submitting.");
      setMessageType("error");
      return;
    }
    if (!uploadAllowedNow) {
      setMessage(`Uploads are only allowed during ${describeBusinessHours(governancePolicy)}.`);
      setMessageType("error");
      return;
    }
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    if (!governancePolicy.allowedUploadFormats.includes(extension)) {
      setMessage(`Only these file formats are allowed: ${governancePolicy.allowedUploadFormats.map((value) => value.toUpperCase()).join(", ")}.`);
      setMessageType("error");
      return;
    }

    const formData = new FormData();
    formData.append("company", form.company);
    formData.append("plantId", form.plant);
    formData.append("projectId", form.projectId);
    formData.append("name", form.name);
    formData.append("category", form.category);
    formData.append("comments", form.comments);
    formData.append("file", file);

    setSubmitting(true);
    setMessage("");
    setMessageType("");
    try {
      const created = await documentsApi.create(formData);
      const latestDocuments = await documentsApi.list({ page: 1, pageSize: 500 });
      const portalState = readPortalState(plants, latestDocuments.items);
      persistPortalState(assignDocumentToProject(portalState, created.id, form.projectId));
      setForm({
        company: "Midwest Ltd",
        plant: allowedPlantIds[0] || "",
        projectId: "",
        name: "",
        category: "",
        comments: "",
      });
      setFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setMessage("Document uploaded successfully.");
      setMessageType("success");
      await load();
      if (created.file?.storageId) {
        await documentsApi.openFileInNewTab(created.id);
      } else {
        const detail = await documentsApi.get(created.id);
        setSelectedDoc(detail.document);
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Upload failed.");
      setMessageType("error");
    } finally {
      setSubmitting(false);
    }
  }

  async function openDocument(document: DocumentRecord) {
    if (document.file?.storageId) {
      await documentsApi.openFileInNewTab(document.id);
      return;
    }
    const result = await documentsApi.get(document.id);
    setSelectedDoc(result.document);
  }

  if (loading) return <div className="p-7 text-slate-500">Loading upload workspace...</div>;
  if (!data) return <div className="p-7 text-[#BB0000]">{message || "Upload workspace unavailable."}</div>;

  const acceptTypes = governancePolicy.allowedUploadFormats.map((value) => `.${value}`).join(",");

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] bg-[linear-gradient(135deg,_#0f172a,_#164e63)] px-6 py-8 text-white shadow-[0_28px_70px_rgba(15,23,42,0.2)]">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-3xl">
            <div className="text-xs uppercase tracking-[0.26em] text-white/55">Upload workspace</div>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">Submit documents inside your assigned operating scope</h1>
            <p className="mt-3 text-sm leading-6 text-white/72">
              Plants, projects, and recent uploads shown here are limited to what is assigned to your account. The upload flow uses structured tables, guided selections, and clearer review states.
            </p>
          </div>
          <div className="grid min-w-[280px] gap-3 rounded-[28px] border border-white/10 bg-white/6 p-4">
            <button onClick={() => navigate("/documents")} className="rounded-2xl bg-white px-4 py-3 text-left text-sm font-semibold text-slate-950 transition hover:bg-slate-100">
              Open document listing
            </button>
            <button onClick={() => navigate(`/plants/${allowedPlantIds[0] || ""}`)} className="rounded-2xl border border-white/15 px-4 py-3 text-left text-sm text-white transition hover:bg-white/10">
              Open assigned plant workspace
            </button>
          </div>
        </div>
      </section>

      <div className="data-table-panel">
        <div className="data-table-toolbar">
          <span className="text-sm font-semibold text-slate-900">Upload Workspace Summary</span>
        </div>
        <div className="data-table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Value</th>
                <th>Context</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="text-strong"><span className="inline-flex items-center gap-2"><FileText size={15} />Scoped documents</span></td>
                <td>{data.stats.myDocuments}</td>
                <td>Documents currently tied to your assigned scope.</td>
                <td><button type="button" onClick={() => navigate("/documents")} className="text-[#0A6ED1] hover:underline">Open listing</button></td>
              </tr>
              <tr>
                <td className="text-strong"><span className="inline-flex items-center gap-2"><Clock3 size={15} />Uploaded this week</span></td>
                <td>{data.stats.uploadedThisWeek}</td>
                <td>Recent document movement attributed to your upload lane.</td>
                <td>-</td>
              </tr>
              <tr>
                <td className="text-strong"><span className="inline-flex items-center gap-2"><FolderKanban size={15} />Available projects</span></td>
                <td>{availableProjects.length}</td>
                <td>Projects available for the currently selected plant.</td>
                <td>-</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-3xl border border-white/70 bg-white/90 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Document submission</h2>
              <p className="mt-1 text-sm text-slate-500">Only assigned plants and their projects are available in the selectors below.</p>
            </div>
            <div className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-medium text-white">
              {allowedPlantIds.length} scoped plant{allowedPlantIds.length === 1 ? "" : "s"}
            </div>
          </div>

          <div className="data-table-panel mb-6">
            <div className="data-table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>Configuration</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="text-strong">Allowed formats</td>
                    <td>{governancePolicy.allowedUploadFormats.map((value) => value.toUpperCase()).join(", ") || "No formats configured"}</td>
                    <td>Only these formats can be attached in this workspace.</td>
                  </tr>
                  <tr>
                    <td className="text-strong">Upload window</td>
                    <td>{describeBusinessHours(governancePolicy)}</td>
                    <td>{uploadAllowedNow ? "Uploads are currently allowed." : "Uploads are currently blocked outside the configured business hours."}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {!uploadAllowedNow ? (
            <div className="mb-6 rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
              <span className="inline-flex items-center gap-2 font-semibold">
                <TriangleAlert size={16} />
                Uploads are locked right now
              </span>
              <div className="mt-2">
                This manager workspace only accepts uploads during {describeBusinessHours(governancePolicy)}.
              </div>
            </div>
          ) : null}

          <div
            role="button"
            tabIndex={0}
            onClick={() => {
              if (!uploadAllowedNow) return;
              fileInputRef.current?.click();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (!uploadAllowedNow) return;
                fileInputRef.current?.click();
              }
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              handleSelectedFile(event.dataTransfer.files[0] || null);
            }}
            className={`mb-6 rounded-[28px] border-2 border-dashed px-6 py-10 text-center transition ${
              !uploadAllowedNow
                ? "cursor-not-allowed border-amber-200 bg-amber-50/70 opacity-80"
                : dragOver
                  ? "border-teal-500 bg-teal-50"
                  : "border-slate-200 bg-slate-50"
            }`}
          >
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-white shadow-sm">
              <UploadCloud size={28} className={!uploadAllowedNow ? "text-amber-600" : dragOver ? "text-teal-600" : "text-slate-500"} />
            </div>
            <div className="mt-4 text-lg font-semibold text-slate-900">
              {uploadAllowedNow ? "Drop a file here or browse from your device" : "Upload window is currently closed"}
            </div>
            <div className="mt-2 text-sm text-slate-500">
              Accepted formats: {governancePolicy.allowedUploadFormats.map((value) => value.toUpperCase()).join(", ")} up to 25 MB.
            </div>
            <button
              type="button"
              disabled={!uploadAllowedNow}
              onClick={(event) => {
                event.stopPropagation();
                if (!uploadAllowedNow) return;
                fileInputRef.current?.click();
              }}
              className="mt-4 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Choose document
            </button>
            {file ? (
              <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700">
                <Paperclip size={14} />
                {file.name}
              </div>
            ) : null}
          </div>

          <form onSubmit={handleUpload} className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm">
              <span className="font-medium text-slate-700">Company</span>
              <input
                value={form.company}
                readOnly
                aria-readonly="true"
                className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-100 px-4 text-slate-600 outline-none"
              />
              <div className="text-xs text-slate-500">Company context is fixed by the portal and cannot be changed during upload.</div>
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium text-slate-700">Plant</span>
              <select value={form.plant} onChange={(event) => setForm({ ...form, plant: event.target.value, projectId: "" })} className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500">
                <option value="">Select plant</option>
                {plants.map((plant) => (
                  <option key={plant.id} value={plant.id}>{plant.name}</option>
                ))}
              </select>
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium text-slate-700">Project</span>
              <select value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value })} className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500">
                <option value="">Select project</option>
                {availableProjects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium text-slate-700">Category</span>
              <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500">
                <option value="">Select category</option>
                {categoryOptions.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </label>
            <label className="space-y-2 text-sm md:col-span-2">
              <span className="font-medium text-slate-700">Document name</span>
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 outline-none transition focus:border-teal-500" />
            </label>
            <label className="space-y-2 text-sm md:col-span-2">
              <span className="font-medium text-slate-700">Upload notes</span>
              <textarea value={form.comments} onChange={(event) => setForm({ ...form, comments: event.target.value })} rows={4} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-teal-500" />
            </label>
            <div className="md:col-span-2">
              <input ref={fileInputRef} type="file" accept={acceptTypes} onChange={(event) => handleSelectedFile(event.target.files?.[0] || null)} className="hidden" />
            </div>
            <div className="md:col-span-2 flex flex-wrap items-center gap-3">
              <button type="submit" disabled={submitting || !uploadAllowedNow} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">
                <Upload size={14} />
                {submitting ? "Submitting..." : "Submit document"}
              </button>
              <button type="button" onClick={() => navigate("/documents")} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
                Review scoped documents
                <ArrowRight size={14} />
              </button>
              {message ? (
                <div className={`text-sm ${messageType === "error" ? "text-[#BB0000]" : messageType === "success" ? "text-[#107E3E]" : "text-slate-500"}`}>
                  {message}
                </div>
              ) : null}
            </div>
          </form>
        </section>

        <section className="rounded-3xl border border-white/70 bg-white/90 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-900">Recent uploads in your scope</h2>
            <p className="mt-1 text-sm text-slate-500">Only documents tied to your assigned plants are listed here.</p>
          </div>
          <div className="data-table-panel">
            <div className="data-table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>Plant</th>
                    <th>Category</th>
                    <th>Date</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentUploads.length ? (
                    data.recentUploads.map((document) => (
                      <tr key={document.id}>
                        <td className="text-strong">{document.name}</td>
                        <td>{document.plant}</td>
                        <td>{document.category}</td>
                        <td>{document.date || "-"}</td>
                        <td>
                          <button onClick={() => void openDocument(document)} className="text-[#0A6ED1] hover:underline">
                            Open
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr><td colSpan={5}>No recent uploads are available for your assigned scope yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>

      {selectedDoc ? <DocumentDrawer doc={selectedDoc} onClose={() => setSelectedDoc(null)} /> : null}
    </div>
  );
}
