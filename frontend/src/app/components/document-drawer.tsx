import { useEffect, useRef, useState } from "react";
import { X, Save, Lock, Globe, MessageSquare, Download } from "lucide-react";
import { categoryOptions } from "../lib/api";
import type { Comment, DocumentRecord } from "../lib/types";
import { documentsApi } from "../lib/api";

interface DocumentDrawerProps {
  doc: DocumentRecord;
  onClose: () => void;
  comments?: Comment[];
  onAddComment?: (documentId: string, text: string, visibility: "private" | "public") => Promise<void>;
  autoFocusCommentComposer?: boolean;
  onUpdateDocument?: (documentId: string, payload: FormData) => Promise<void>;
  autoStartEdit?: boolean;
}

function formatFileSize(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "Not available";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentDrawer({
  doc,
  onClose,
  comments = [],
  onAddComment,
  autoFocusCommentComposer = false,
  onUpdateDocument,
  autoStartEdit = false,
}: DocumentDrawerProps) {
  const [commentText, setCommentText] = useState("");
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [fileName, setFileName] = useState<string | null>(doc.file?.name || null);
  const [fileError, setFileError] = useState("");
  const commentInputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [editForm, setEditForm] = useState({
    name: doc.name,
    category: doc.category,
    company: doc.company || "",
    uploadComment: doc.uploadComment || "",
  });
  const [replacementFile, setReplacementFile] = useState<File | null>(null);
  const [updateError, setUpdateError] = useState("");

  const showCommentComposer = Boolean(onAddComment);
  const hasAttachedFile = Boolean(doc.file?.storageId);
  const showUpdateForm = Boolean(onUpdateDocument);
  const detailRows = [
    ["Document ID", doc.id],
    ["Document Name", doc.name],
    ["Company", doc.company || "Midwest Ltd"],
    ["Plant", doc.plant],
    ["Plant ID", doc.plantId],
    ["Category", doc.category],
    ["Uploaded By", doc.uploadedBy],
    ["Upload Date", doc.date || "-"],
    ["Version", `v${doc.version}`],
    ["Original File", fileName || doc.file?.name || "Not attached"],
    ["File Type", doc.file?.contentType || "Not available"],
    ["File Size", formatFileSize(doc.file?.sizeBytes)],
    ["Created At", doc.createdAt || "-"],
    ["Last Updated", doc.updatedAt || "-"],
  ];

  useEffect(() => {
    if (!autoFocusCommentComposer || !showCommentComposer) return;
    commentInputRef.current?.focus();
  }, [autoFocusCommentComposer, doc.id, showCommentComposer]);

  useEffect(() => {
    setEditForm({
      name: doc.name,
      category: doc.category,
      company: doc.company || "",
      uploadComment: doc.uploadComment || "",
    });
    setReplacementFile(null);
    setEditing(autoStartEdit && Boolean(onUpdateDocument));
    setUpdateError("");
    setFileName(doc.file?.name || null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [autoStartEdit, doc, onUpdateDocument]);

  async function handleSave() {
    if (!commentText.trim() || !onAddComment) return;
    setSaving(true);
    try {
      await onAddComment(doc.id, commentText.trim(), visibility);
      setCommentText("");
    } finally {
      setSaving(false);
    }
  }

  async function handleDownload() {
    try {
      const { blob, fileName: downloadedName } = await documentsApi.downloadFile(doc.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = downloadedName || fileName || doc.file?.name || `${doc.id}.bin`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setFileError(err instanceof Error ? err.message : "Unable to download the original document.");
    }
  }

  async function handleUpdate() {
    if (!onUpdateDocument) return;
    setUpdating(true);
    setUpdateError("");
    try {
      const formData = new FormData();
      formData.append("name", editForm.name);
      formData.append("category", editForm.category);
      formData.append("company", editForm.company);
      formData.append("uploadComment", editForm.uploadComment);
      if (replacementFile) {
        formData.append("file", replacementFile);
      }
      await onUpdateDocument(doc.id, formData);
      setEditing(false);
      setReplacementFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : "Unable to update this document.");
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-[#0c1628]/32 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative h-full w-full max-w-[600px] overflow-hidden border-l border-[#d9e1ec] bg-[#f5f8fc] shadow-2xl">
        <div className="flex h-full flex-col">
          <div className="shrink-0 border-b border-white/10 bg-[linear-gradient(135deg,#111827_0%,#243b53_100%)] px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/55">
                  Document Workspace
                </div>
                <span className="mt-2 block text-white" style={{ fontSize: 22, fontWeight: 600 }}>
                  Document Details
                </span>
                <p className="mt-1 text-sm text-white/72">
                  Review metadata, manage the original file, and keep notes in one place.
                </p>
              </div>
              <button
                onClick={onClose}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/12 bg-white/6 text-white/70 transition hover:bg-white/10 hover:text-white cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto px-5 py-5 sm:px-6">
            <div className="space-y-5">
              <section className="rounded-[28px] border border-[#dce4f0] bg-white p-5 shadow-[0_18px_55px_rgba(17,24,39,0.08)]">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-[#1f2937]" style={{ fontSize: 18, fontWeight: 600 }}>
                      {doc.name}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
                      <span className="rounded-full bg-[#e8f0fb] px-3 py-1 font-medium text-[#0A6ED1]">
                        {doc.category}
                      </span>
                      <span className="rounded-full bg-[#eef3f8] px-3 py-1 font-medium text-[#47607a]">
                        {doc.plant}
                      </span>
                      <span className="rounded-full bg-[#f4f6fb] px-3 py-1 text-[#6a7685]">
                        v{doc.version}
                      </span>
                    </div>
                  </div>
                  <div className="min-w-[180px] rounded-2xl border border-[#e6edf5] bg-[#f8fbff] px-4 py-3">
                    <div className="text-[#66788a]" style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase" }}>
                      Uploaded By
                    </div>
                    <div className="mt-1 text-[#1f2937]" style={{ fontSize: 14, fontWeight: 600 }}>
                      {doc.uploadedBy}
                    </div>
                    <div className="mt-1 text-[#718096]" style={{ fontSize: 12 }}>
                      {doc.date || "Date unavailable"}
                    </div>
                  </div>
                </div>
              </section>

              <section className="rounded-[28px] border border-[#dce4f0] bg-white p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-[#1f2937]" style={{ fontSize: 16, fontWeight: 600 }}>
                      Original Document
                    </div>
                    <p className="mt-1 max-w-[28rem] text-[#66788a]" style={{ fontSize: 13, lineHeight: 1.6 }}>
                      The file preview is hidden here. Use the actions below to open or download the original upload.
                    </p>
                  </div>
                  {hasAttachedFile && (
                    <button
                      onClick={() => void handleDownload()}
                      className="inline-flex h-10 items-center gap-2 rounded-full border border-[#d6e1ee] bg-[#f8fbff] px-4 text-[#27415e] transition hover:border-[#b8cadf] hover:bg-[#eef5fc] cursor-pointer"
                      style={{ fontSize: 13, fontWeight: 500 }}
                    >
                      <Download size={14} /> Download
                    </button>
                  )}
                </div>
                {fileError && (
                  <div className="mt-4 rounded-2xl border border-[#f0c4c4] bg-[#fff5f5] px-4 py-3 text-[#BB0000]" style={{ fontSize: 12 }}>
                    {fileError}
                  </div>
                )}
              </section>

              <section className="rounded-[28px] border border-[#dce4f0] bg-white p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-[#1f2937]" style={{ fontSize: 16, fontWeight: 600 }}>
                      Metadata
                    </h4>
                    <p className="mt-1 text-[#66788a]" style={{ fontSize: 13 }}>
                      Keep the document profile aligned with the rest of the registry.
                    </p>
                  </div>
                  {showUpdateForm && (
                    <button
                      onClick={() => {
                        setEditing((prev) => !prev);
                        setUpdateError("");
                      }}
                      className={`inline-flex h-10 items-center rounded-full border px-4 transition cursor-pointer ${
                        editing
                          ? "border-[#f2d1d1] bg-[#fff6f6] text-[#8b3d3d] hover:bg-[#ffefef]"
                          : "border-[#d6e1ee] bg-[#f8fbff] text-[#27415e] hover:border-[#b8cadf] hover:bg-[#eef5fc]"
                      }`}
                      style={{ fontSize: 13, fontWeight: 500 }}
                    >
                      {editing ? "Cancel Edit" : "Edit Upload"}
                    </button>
                  )}
                </div>

                {editing ? (
                  <div className="space-y-4 rounded-[24px] border border-[#e4ebf3] bg-[#f8fbff] p-4">
                    <div>
                      <label className="mb-2 block text-[#425466]" style={{ fontSize: 12, fontWeight: 600 }}>Document Name</label>
                      <input
                        value={editForm.name}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                        className="h-11 w-full rounded-2xl border border-[#d6e1ee] bg-white px-4 text-[#1f2937] transition focus:border-[#0A6ED1] focus:outline-none focus:ring-4 focus:ring-[#0A6ED1]/10"
                        style={{ fontSize: 14 }}
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-[#425466]" style={{ fontSize: 12, fontWeight: 600 }}>Category</label>
                      <select
                        value={editForm.category}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, category: e.target.value }))}
                        className="h-11 w-full rounded-2xl border border-[#d6e1ee] bg-white px-4 text-[#1f2937] transition focus:border-[#0A6ED1] focus:outline-none focus:ring-4 focus:ring-[#0A6ED1]/10"
                        style={{ fontSize: 14 }}
                      >
                        {categoryOptions.map((category) => (
                          <option key={category} value={category}>{category}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-2 block text-[#425466]" style={{ fontSize: 12, fontWeight: 600 }}>Company</label>
                      <input
                        value={editForm.company}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, company: e.target.value }))}
                        className="h-11 w-full rounded-2xl border border-[#d6e1ee] bg-white px-4 text-[#1f2937] transition focus:border-[#0A6ED1] focus:outline-none focus:ring-4 focus:ring-[#0A6ED1]/10"
                        style={{ fontSize: 14 }}
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-[#425466]" style={{ fontSize: 12, fontWeight: 600 }}>Upload Note</label>
                      <textarea
                        value={editForm.uploadComment}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, uploadComment: e.target.value }))}
                        rows={4}
                        className="w-full rounded-2xl border border-[#d6e1ee] bg-white px-4 py-3 text-[#1f2937] transition focus:border-[#0A6ED1] focus:outline-none focus:ring-4 focus:ring-[#0A6ED1]/10 resize-none"
                        style={{ fontSize: 14 }}
                      />
                    </div>
                    <div className="rounded-2xl border border-dashed border-[#cdd9e7] bg-white px-4 py-4">
                      <label className="mb-2 block text-[#425466]" style={{ fontSize: 12, fontWeight: 600 }}>Replace Uploaded File</label>
                      <input
                        ref={fileInputRef}
                        type="file"
                        onChange={(e) => setReplacementFile(e.target.files?.[0] || null)}
                        className="block w-full text-[#334155]"
                        style={{ fontSize: 13 }}
                      />
                      <div className="mt-2 text-[#718096]" style={{ fontSize: 12 }}>
                        {replacementFile ? replacementFile.name : "Leave empty to keep the current file."}
                      </div>
                    </div>
                    {updateError && (
                      <div className="rounded-2xl border border-[#f0c4c4] bg-[#fff5f5] px-4 py-3 text-[#BB0000]" style={{ fontSize: 12 }}>
                        {updateError}
                      </div>
                    )}
                    <button
                      onClick={() => void handleUpdate()}
                      disabled={!editForm.name.trim() || !editForm.category.trim() || updating}
                      className="inline-flex h-11 items-center gap-2 rounded-full bg-[#0A6ED1] px-5 text-white shadow-[0_10px_24px_rgba(10,110,209,0.28)] transition hover:bg-[#0854A0] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                      style={{ fontSize: 13, fontWeight: 600 }}
                    >
                      <Save size={14} /> {updating ? "Saving..." : "Save Changes"}
                    </button>
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {detailRows.map(([label, value]) => (
                      <div key={label} className="rounded-2xl border border-[#e7edf5] bg-[#fbfcfe] px-4 py-3">
                        <div className="text-[#718096]" style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                          {label}
                        </div>
                        <div className="mt-1 break-words text-[#1f2937]" style={{ fontSize: 14, fontWeight: 500 }}>
                          {value}
                        </div>
                      </div>
                    ))}
                    {doc.uploadComment && (
                      <div className="rounded-2xl border border-[#dbe7f3] bg-[#f6faff] px-4 py-4 sm:col-span-2">
                        <div className="text-[#718096]" style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                          Upload Note
                        </div>
                        <div className="mt-2 text-[#27415e]" style={{ fontSize: 14, lineHeight: 1.7 }}>
                          {doc.uploadComment}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </section>

              {(showCommentComposer || comments.length > 0) && (
                <section className="rounded-[28px] border border-[#dce4f0] bg-white p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#e8f0fb] text-[#0A6ED1]">
                      <MessageSquare size={16} />
                    </div>
                    <div>
                      <h4 className="text-[#1f2937]" style={{ fontSize: 16, fontWeight: 600 }}>
                        Executive Notes
                      </h4>
                      <p className="text-[#66788a]" style={{ fontSize: 13 }}>
                        Capture internal context and optional shared updates.
                      </p>
                    </div>
                  </div>

                  {showCommentComposer && (
                    <div className="mb-4 rounded-[24px] border border-[#e4ebf3] bg-[#f8fbff] p-4">
                      <textarea
                        ref={commentInputRef}
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        placeholder="Add a note on this document..."
                        rows={4}
                        className="mb-4 w-full rounded-2xl border border-[#d6e1ee] bg-white px-4 py-3 text-[#1f2937] placeholder-[#9aa7b6] transition focus:border-[#0A6ED1] focus:outline-none focus:ring-4 focus:ring-[#0A6ED1]/10 resize-none"
                        style={{ fontSize: 14 }}
                      />

                      <div className="mb-4 flex flex-wrap items-center gap-2">
                        <span className="text-[#66788a]" style={{ fontSize: 12, fontWeight: 500 }}>
                          Visibility
                        </span>
                        <div className="inline-flex rounded-full border border-[#d6e1ee] bg-white p-1">
                          <button
                            type="button"
                            onClick={() => setVisibility("private")}
                            className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3 transition cursor-pointer ${
                              visibility === "private" ? "bg-[#354A5F] text-white shadow-sm" : "text-[#6a7685] hover:bg-[#f4f7fb]"
                            }`}
                            style={{ fontSize: 12, fontWeight: 500 }}
                          >
                            <Lock size={12} /> Private
                          </button>
                          <button
                            type="button"
                            onClick={() => setVisibility("public")}
                            className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3 transition cursor-pointer ${
                              visibility === "public" ? "bg-[#0A6ED1] text-white shadow-sm" : "text-[#6a7685] hover:bg-[#f4f7fb]"
                            }`}
                            style={{ fontSize: 12, fontWeight: 500 }}
                          >
                            <Globe size={12} /> Public
                          </button>
                        </div>
                      </div>

                      <button
                        onClick={() => void handleSave()}
                        disabled={!commentText.trim() || saving}
                        className="inline-flex h-11 items-center gap-2 rounded-full bg-[#0A6ED1] px-5 text-white shadow-[0_10px_24px_rgba(10,110,209,0.28)] transition hover:bg-[#0854A0] disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                        style={{ fontSize: 13, fontWeight: 600 }}
                      >
                        <Save size={14} /> {saving ? "Saving..." : "Save Note"}
                      </button>
                    </div>
                  )}

                  {comments.length > 0 ? (
                    <div className="space-y-3">
                      {comments.map((comment) => (
                        <div
                          key={comment.id}
                          className={`rounded-2xl border px-4 py-4 ${
                            comment.visibility === "private"
                              ? "border-[#ecdca6] bg-[#fffaf0]"
                              : "border-[#d8e5f4] bg-[#f7fbff]"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <p className="flex-1 text-[#1f2937]" style={{ fontSize: 14, lineHeight: 1.65 }}>
                              {comment.text}
                            </p>
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 shrink-0 ${
                                comment.visibility === "private"
                                  ? "bg-[#f5e9c0] text-[#7a5c00]"
                                  : "bg-[#dceeff] text-[#0A6ED1]"
                              }`}
                              style={{ fontSize: 11, fontWeight: 600 }}
                            >
                              {comment.visibility === "private" ? <><Lock size={10} /> Private</> : <><Globe size={10} /> Public</>}
                            </span>
                          </div>
                          <p className="mt-2 text-[#6a7685]" style={{ fontSize: 12 }}>
                            {comment.author} · {comment.date || "-"}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    !showCommentComposer && (
                      <p className="rounded-2xl border border-dashed border-[#d6e1ee] bg-[#fbfdff] px-4 py-5 text-[#6a7685]" style={{ fontSize: 13 }}>
                        No visible notes yet.
                      </p>
                    )
                  )}
                </section>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
