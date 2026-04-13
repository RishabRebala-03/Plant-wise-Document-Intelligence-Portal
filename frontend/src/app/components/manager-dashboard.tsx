import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  Upload, FileText, Clock, CheckCircle2,
  CloudUpload, ArrowRight, Paperclip,
} from "lucide-react";
import { categoryOptions, dashboardApi, documentsApi, plantsApi } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { DocumentRecord, ManagerDashboardData, Plant } from "../lib/types";
import { DocumentDrawer } from "./document-drawer";

export function ManagerDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState<ManagerDashboardData | null>(null);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<DocumentRecord | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error" | "">("");
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [form, setForm] = useState({
    company: "Midwest Ltd",
    plant: user?.plantId || "",
    name: "",
    category: "",
    comments: "",
  });

  function handleSelectedFile(nextFile: File | null) {
    setFile(nextFile);
    if (!nextFile) return;

    const inferredName = nextFile.name.replace(/\.[^.]+$/, "");
    setForm((prev) => ({
      ...prev,
      name: prev.name.trim() ? prev.name : inferredName,
    }));
  }

  async function load() {
    const [dashboard, plantsResult] = await Promise.all([dashboardApi.manager(), plantsApi.list()]);
    setData(dashboard);
    setPlants(plantsResult.items);
  }

  useEffect(() => {
    load()
      .catch((err) => {
        setMessage(err instanceof Error ? err.message : "Unable to load manager dashboard.");
        setMessageType("error");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (user?.plantId) {
      setForm((prev) => ({ ...prev, plant: user.plantId || prev.plant }));
    }
  }, [user]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!form.plant || !form.name || !form.category) {
      setMessage("Please fill in plant, document name, and category.");
      setMessageType("error");
      return;
    }
    if (!file) {
      setMessage("Please choose a file to upload.");
      setMessageType("error");
      return;
    }

    const formData = new FormData();
    formData.append("company", form.company);
    formData.append("plantId", form.plant);
    formData.append("name", form.name);
    formData.append("category", form.category);
    formData.append("comments", form.comments);
    formData.append("file", file);

    setSubmitting(true);
    setMessage("");
    setMessageType("");
    try {
      const created = await documentsApi.create(formData);
      setForm({
        company: "Midwest Ltd",
        plant: user?.plantId || "",
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
      await openDocument(created);
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

  if (loading) return <div className="p-7 text-[#6a6d70]">Loading manager dashboard...</div>;
  if (!data) return <div className="p-7 text-[#BB0000]">{message || "Manager dashboard unavailable."}</div>;

  return (
    <div className="p-7 max-w-[1400px]">
      <div className="mb-7 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[#1a1a1a]" style={{ fontSize: 20, fontWeight: 600 }}>
            Document Management
          </h1>
          <p className="text-[#6a6d70] mt-1" style={{ fontSize: 14 }}>
            Upload and manage documents for {user?.plant || "your assigned plant"}
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

      <div className="grid grid-cols-3 gap-5 mb-8">
        {[
          { label: "My Documents", value: data.stats.myDocuments, icon: FileText, color: "#0A6ED1", bg: "#EBF4FD" },
          { label: "Uploaded This Week", value: data.stats.uploadedThisWeek, icon: Clock, color: "#E9730C", bg: "#FEF3E7" },
          { label: "Approved", value: data.stats.approved, icon: CheckCircle2, color: "#107E3E", bg: "#EBF5EF" },
        ].map((stat) => (
          <div key={stat.label} className="bg-white border border-[#e8e8e8] px-5 py-5 flex items-center gap-4">
            <div className="w-10 h-10 flex items-center justify-center shrink-0" style={{ background: stat.bg }}>
              <stat.icon size={18} style={{ color: stat.color }} />
            </div>
            <div>
              <div className="text-[#1a1a1a]" style={{ fontSize: 26, fontWeight: 600 }}>{stat.value}</div>
              <div className="text-[#6a6d70]" style={{ fontSize: 12 }}>{stat.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="bg-white border border-[#e8e8e8]">
            <div className="px-5 py-4 border-b border-[#f0f0f0]">
              <div className="flex items-center gap-2">
                <Upload size={14} className="text-[#0A6ED1]" />
                <span className="text-[#1a1a1a]" style={{ fontSize: 14, fontWeight: 500 }}>
                  Upload Document
                </span>
              </div>
            </div>

            <div className="p-5">
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  handleSelectedFile(e.dataTransfer.files[0] || null);
                }}
                className={`border-2 border-dashed mb-6 flex flex-col items-center justify-center py-8 transition-colors cursor-pointer ${
                  dragOver ? "border-[#0A6ED1] bg-[#EBF4FD]" : "border-[#d9d9d9] bg-[#fafafa]"
                }`}
              >
                <CloudUpload size={32} className={dragOver ? "text-[#0A6ED1]" : "text-[#bbb]"} />
                <p className="text-[#555] mt-2" style={{ fontSize: 13 }}>
                  Drag & drop your file here, or choose one below
                </p>
                <p className="text-[#999] mt-1" style={{ fontSize: 11 }}>
                  Supports PDF, DOCX, XLSX, PNG up to 25 MB
                </p>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                  className="mt-3 h-9 px-4 border border-[#0A6ED1] text-[#0A6ED1] bg-white hover:bg-[#EBF4FD] cursor-pointer"
                  style={{ fontSize: 13, fontWeight: 500 }}
                >
                  Choose Document
                </button>
                {file && (
                  <div className="mt-3 inline-flex items-center gap-2 px-3 py-2 bg-white border border-[#d9d9d9] text-[#333]" style={{ fontSize: 12 }}>
                    <Paperclip size={12} />
                    {file.name}
                  </div>
                )}
              </div>

              <form onSubmit={handleUpload}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
                  <div>
                    <label className="block text-[#444] mb-1.5" style={{ fontSize: 13, fontWeight: 500 }}>Company</label>
                    <input
                      value={form.company}
                      onChange={(e) => setForm({ ...form, company: e.target.value })}
                      className="w-full h-9 px-3 border border-[#d9d9d9] bg-white text-[#333] focus:border-[#0A6ED1] focus:outline-none"
                      style={{ fontSize: 13 }}
                    />
                  </div>
                  <div>
                    <label className="block text-[#444] mb-1.5" style={{ fontSize: 13, fontWeight: 500 }}>Plant</label>
                    <select
                      value={form.plant}
                      onChange={(e) => setForm({ ...form, plant: e.target.value })}
                      className="w-full h-9 px-3 border border-[#d9d9d9] bg-white text-[#333] focus:border-[#0A6ED1] focus:outline-none"
                      style={{ fontSize: 13 }}
                    >
                      <option value="">Select Plant</option>
                      {plants.map((plant) => (
                        <option key={plant.id} value={plant.id}>{plant.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[#444] mb-1.5" style={{ fontSize: 13, fontWeight: 500 }}>Document Name</label>
                    <input
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="w-full h-9 px-3 border border-[#d9d9d9] bg-white text-[#333] focus:border-[#0A6ED1] focus:outline-none"
                      style={{ fontSize: 13 }}
                    />
                  </div>
                  <div>
                    <label className="block text-[#444] mb-1.5" style={{ fontSize: 13, fontWeight: 500 }}>Category</label>
                    <select
                      value={form.category}
                      onChange={(e) => setForm({ ...form, category: e.target.value })}
                      className="w-full h-9 px-3 border border-[#d9d9d9] bg-white text-[#333] focus:border-[#0A6ED1] focus:outline-none"
                      style={{ fontSize: 13 }}
                    >
                      <option value="">Select Category</option>
                      {categoryOptions.map((category) => (
                        <option key={category} value={category}>{category}</option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-[#444] mb-1.5" style={{ fontSize: 13, fontWeight: 500 }}>Upload Notes</label>
                    <textarea
                      value={form.comments}
                      onChange={(e) => setForm({ ...form, comments: e.target.value })}
                      rows={3}
                      className="w-full px-3 py-2.5 border border-[#d9d9d9] bg-white text-[#333] focus:border-[#0A6ED1] focus:outline-none resize-none"
                      style={{ fontSize: 13 }}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-[#444] mb-1.5" style={{ fontSize: 13, fontWeight: 500 }}>File</label>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                      onChange={(e) => handleSelectedFile(e.target.files?.[0] || null)}
                    />
                    {file && <div className="text-[#6a6d70] mt-2" style={{ fontSize: 12 }}>{file.name}</div>}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button type="submit" disabled={submitting} className="h-9 px-5 bg-[#0A6ED1] text-white hover:bg-[#0854A0] inline-flex items-center gap-2 cursor-pointer transition-colors disabled:opacity-60" style={{ fontSize: 13, fontWeight: 500 }}>
                    <Upload size={14} /> {submitting ? "Submitting..." : "Submit Document"}
                  </button>
                  {message && (
                    <span
                      className={messageType === "error" ? "text-[#BB0000]" : messageType === "success" ? "text-[#107E3E]" : "text-[#6a6d70]"}
                      style={{ fontSize: 13 }}
                    >
                      {message}
                    </span>
                  )}
                </div>
              </form>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-5">
          <div className="bg-white border border-[#e8e8e8]">
            <div className="px-5 py-4 border-b border-[#f0f0f0]">
              <span className="text-[#1a1a1a]" style={{ fontSize: 14, fontWeight: 500 }}>
                Recent Uploads
              </span>
            </div>
            <div className="divide-y divide-[#f7f7f7]">
              {data.recentUploads.map((document) => (
                <button
                  key={document.id}
                  onClick={() => void openDocument(document)}
                  className="w-full text-left px-5 py-4 hover:bg-[#fafafa] cursor-pointer"
                >
                  <div className="text-[#333]" style={{ fontSize: 13, fontWeight: 500 }}>{document.name}</div>
                  <div className="text-[#6a6d70] mt-1" style={{ fontSize: 11 }}>{document.category} · {document.date || "-"}</div>
                </button>
              ))}
            </div>
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
