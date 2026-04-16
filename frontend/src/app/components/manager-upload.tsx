import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, Clock3, FileText, FolderKanban, Paperclip, Upload, UploadCloud } from "lucide-react";
import { ApiError, LIVE_SYNC_INTERVAL_MS, categoryOptions, dashboardApi, documentsApi, plantsApi, settingsApi } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { DocumentRecord, GovernancePolicy, ManagerDashboardData, Plant } from "../lib/types";
import { assignDocumentToProject, persistPortalState, readPortalState, type ProjectRecord } from "../lib/portal";
import { DocumentDrawer } from "./document-drawer";

function scopedPlantIds(user: { assignedPlantIds?: string[]; plantId?: string | null }) {
  return user.assignedPlantIds?.length ? user.assignedPlantIds : user.plantId ? [user.plantId] : [];
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
              Plants, projects, and recent uploads shown here are limited to what is assigned to your account. The upload flow now mirrors the rest of the portal with scoped cards, guided selections, and clearer review states.
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

      <div className="grid gap-4 md:grid-cols-3">
        <button type="button" onClick={() => navigate("/documents")} className="rounded-3xl border border-white/80 bg-gradient-to-br from-[#D1E8FF]/80 to-[#EAF3FC] p-5 text-left shadow-[0_18px_40px_rgba(15,23,42,0.07)] transition hover:-translate-y-0.5 hover:shadow-[0_22px_48px_rgba(15,23,42,0.12)]">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-500">Scoped documents</span>
            <div className="rounded-2xl bg-white/80 p-2 text-[#0A6ED1]"><FileText size={18} /></div>
          </div>
          <div className="text-3xl font-semibold tracking-tight text-slate-950">{data.stats.myDocuments}</div>
          <div className="mt-2 text-sm text-slate-500">Documents currently tied to your assigned scope.</div>
        </button>
        <div className="rounded-3xl border border-white/80 bg-gradient-to-br from-[#107E3E]/12 to-[#D5F6DE]/40 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.07)]">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-500">Uploaded this week</span>
            <div className="rounded-2xl bg-white/80 p-2 text-[#107E3E]"><Clock3 size={18} /></div>
          </div>
          <div className="text-3xl font-semibold tracking-tight text-slate-950">{data.stats.uploadedThisWeek}</div>
          <div className="mt-2 text-sm text-slate-500">Recent document movement attributed to your upload lane.</div>
        </div>
        <div className="rounded-3xl border border-white/80 bg-gradient-to-br from-[#EAECEE] to-[#F5F6F7] p-5 shadow-[0_18px_40px_rgba(15,23,42,0.07)]">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-500">Available projects</span>
            <div className="rounded-2xl bg-white/80 p-2 text-[#354A5F]"><FolderKanban size={18} /></div>
          </div>
          <div className="text-3xl font-semibold tracking-tight text-slate-950">{availableProjects.length}</div>
          <div className="mt-2 text-sm text-slate-500">Projects available for the currently selected plant.</div>
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

          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
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
            className={`mb-6 rounded-[28px] border-2 border-dashed px-6 py-10 text-center transition ${dragOver ? "border-teal-500 bg-teal-50" : "border-slate-200 bg-slate-50"}`}
          >
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-white shadow-sm">
              <UploadCloud size={28} className={dragOver ? "text-teal-600" : "text-slate-500"} />
            </div>
            <div className="mt-4 text-lg font-semibold text-slate-900">Drop a file here or browse from your device</div>
            <div className="mt-2 text-sm text-slate-500">
              Accepted formats: {governancePolicy.allowedUploadFormats.map((value) => value.toUpperCase()).join(", ")} up to 25 MB.
            </div>
            <button type="button" onClick={(event) => { event.stopPropagation(); fileInputRef.current?.click(); }} className="mt-4 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">
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
              <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">
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
          <div className="space-y-3">
            {data.recentUploads.map((document) => (
              <button key={document.id} onClick={() => void openDocument(document)} className="w-full rounded-3xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-slate-300 hover:bg-white">
                <div className="font-semibold text-slate-900">{document.name}</div>
                <div className="mt-2 text-sm text-slate-500">{document.plant} · {document.category}</div>
                <div className="mt-2 text-xs uppercase tracking-[0.16em] text-slate-400">{document.date || "-"}</div>
              </button>
            ))}
            {!data.recentUploads.length ? (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
                No recent uploads are available for your assigned scope yet.
              </div>
            ) : null}
          </div>
        </section>
      </div>

      {selectedDoc ? <DocumentDrawer doc={selectedDoc} onClose={() => setSelectedDoc(null)} /> : null}
    </div>
  );
}
