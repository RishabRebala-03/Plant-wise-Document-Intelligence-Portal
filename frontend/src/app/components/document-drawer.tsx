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
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative w-full max-w-[540px] bg-white border-l border-[#d9d9d9] h-full flex flex-col">
        <div className="h-11 bg-[#354A5F] flex items-center justify-between px-4 shrink-0">
          <span className="text-white" style={{ fontSize: 13, fontWeight: 500 }}>
            Document Details
          </span>
          <button onClick={onClose} className="text-white/70 hover:text-white cursor-pointer">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <div className="text-[#333]" style={{ fontSize: 13, fontWeight: 500 }}>
                Original Document
              </div>
              <div className="text-[#6a6d70] mt-1" style={{ fontSize: 12 }}>
                The file preview is hidden here. Use the file actions to open or download the original upload.
              </div>
            </div>
            {hasAttachedFile && (
              <button
                onClick={() => void handleDownload()}
                className="h-8 px-3 border border-[#d9d9d9] text-[#333] hover:bg-[#f5f5f5] inline-flex items-center gap-1.5 cursor-pointer"
                style={{ fontSize: 12 }}
              >
                <Download size={12} /> Download
              </button>
            )}
          </div>

          <div className="mb-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h4 className="text-[#333]" style={{ fontSize: 14, fontWeight: 500 }}>
                Document Details
              </h4>
              {showUpdateForm && (
                <button
                  onClick={() => {
                    setEditing((prev) => !prev);
                    setUpdateError("");
                  }}
                  className="h-8 px-3 border border-[#d9d9d9] text-[#333] hover:bg-[#f5f5f5] cursor-pointer"
                  style={{ fontSize: 12 }}
                >
                  {editing ? "Cancel Edit" : "Edit Upload"}
                </button>
              )}
            </div>

            {editing ? (
              <div className="space-y-4 border border-[#d9d9d9] bg-[#fafbfd] p-4">
                <div>
                  <label className="block text-[#444] mb-1.5" style={{ fontSize: 12, fontWeight: 500 }}>Document Name</label>
                  <input
                    value={editForm.name}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                    className="w-full h-9 px-3 border border-[#d9d9d9] bg-white text-[#333] focus:border-[#0A6ED1] focus:outline-none"
                    style={{ fontSize: 13 }}
                  />
                </div>
                <div>
                  <label className="block text-[#444] mb-1.5" style={{ fontSize: 12, fontWeight: 500 }}>Category</label>
                  <select
                    value={editForm.category}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, category: e.target.value }))}
                    className="w-full h-9 px-3 border border-[#d9d9d9] bg-white text-[#333] focus:border-[#0A6ED1] focus:outline-none"
                    style={{ fontSize: 13 }}
                  >
                    {categoryOptions.map((category) => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[#444] mb-1.5" style={{ fontSize: 12, fontWeight: 500 }}>Company</label>
                  <input
                    value={editForm.company}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, company: e.target.value }))}
                    className="w-full h-9 px-3 border border-[#d9d9d9] bg-white text-[#333] focus:border-[#0A6ED1] focus:outline-none"
                    style={{ fontSize: 13 }}
                  />
                </div>
                <div>
                  <label className="block text-[#444] mb-1.5" style={{ fontSize: 12, fontWeight: 500 }}>Upload Note</label>
                  <textarea
                    value={editForm.uploadComment}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, uploadComment: e.target.value }))}
                    rows={3}
                    className="w-full px-3 py-2 border border-[#d9d9d9] bg-white text-[#333] focus:border-[#0A6ED1] focus:outline-none resize-none"
                    style={{ fontSize: 13 }}
                  />
                </div>
                <div>
                  <label className="block text-[#444] mb-1.5" style={{ fontSize: 12, fontWeight: 500 }}>Replace Uploaded File</label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    onChange={(e) => setReplacementFile(e.target.files?.[0] || null)}
                    className="block w-full text-[#333]"
                    style={{ fontSize: 12 }}
                  />
                  <div className="text-[#6a6d70] mt-1" style={{ fontSize: 11 }}>
                    {replacementFile ? replacementFile.name : "Leave empty to keep the current file."}
                  </div>
                </div>
                {updateError && (
                  <div className="text-[#BB0000]" style={{ fontSize: 12 }}>
                    {updateError}
                  </div>
                )}
                <button
                  onClick={() => void handleUpdate()}
                  disabled={!editForm.name.trim() || !editForm.category.trim() || updating}
                  className="h-8 px-4 bg-[#0A6ED1] text-white hover:bg-[#0854A0] disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5 cursor-pointer"
                  style={{ fontSize: 12 }}
                >
                  <Save size={13} /> {updating ? "Saving..." : "Save Changes"}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {[
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
                ].map(([label, value]) => (
                  <div key={label} className="flex" style={{ fontSize: 13 }}>
                    <span className="w-36 text-[#6a6d70] shrink-0">{label}</span>
                    <span className="text-[#333]">{value}</span>
                  </div>
                ))}
                {doc.uploadComment && (
                  <div className="flex" style={{ fontSize: 13 }}>
                    <span className="w-36 text-[#6a6d70] shrink-0">Upload Note</span>
                    <span className="text-[#333] italic">{doc.uploadComment}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {(showCommentComposer || comments.length > 0) && (
            <div className="border-t border-[#d9d9d9] pt-4">
              <div className="flex items-center gap-2 mb-3">
                <MessageSquare size={14} className="text-[#0A6ED1]" />
                <h4 className="text-[#333]" style={{ fontSize: 14, fontWeight: 500 }}>
                  Executive Notes
                </h4>
              </div>

              {showCommentComposer && (
                <div className="bg-[#f7f9fd] border border-[#d9d9d9] p-3 mb-4">
                  <textarea
                    ref={commentInputRef}
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="Add a note on this document..."
                    rows={3}
                    className="w-full px-3 py-2 border border-[#d9d9d9] bg-white text-[#333] placeholder-[#bbb] focus:border-[#0A6ED1] focus:outline-none resize-none mb-3"
                    style={{ fontSize: 13 }}
                  />

                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[#6a6d70]" style={{ fontSize: 12 }}>
                      Visibility:
                    </span>
                    <div className="flex border border-[#d9d9d9] overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setVisibility("private")}
                        className={`flex items-center gap-1.5 px-3 h-7 cursor-pointer transition-colors ${
                          visibility === "private" ? "bg-[#354A5F] text-white" : "bg-white text-[#6a6d70] hover:bg-[#f5f5f5]"
                        }`}
                        style={{ fontSize: 12 }}
                      >
                        <Lock size={11} /> Private
                      </button>
                      <button
                        type="button"
                        onClick={() => setVisibility("public")}
                        className={`flex items-center gap-1.5 px-3 h-7 cursor-pointer transition-colors border-l border-[#d9d9d9] ${
                          visibility === "public" ? "bg-[#0A6ED1] text-white" : "bg-white text-[#6a6d70] hover:bg-[#f5f5f5]"
                        }`}
                        style={{ fontSize: 12 }}
                      >
                        <Globe size={11} /> Public
                      </button>
                    </div>
                  </div>

                  <button
                    onClick={() => void handleSave()}
                    disabled={!commentText.trim() || saving}
                    className="h-8 px-4 bg-[#0A6ED1] text-white hover:bg-[#0854A0] disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5 cursor-pointer"
                    style={{ fontSize: 12 }}
                  >
                    <Save size={13} /> {saving ? "Saving..." : "Save Note"}
                  </button>
                </div>
              )}

              {comments.length > 0 ? (
                <div className="space-y-2">
                  {comments.map((comment) => (
                    <div
                      key={comment.id}
                      className={`border p-3 ${
                        comment.visibility === "private" ? "bg-[#fdfaf3] border-[#e8d9a0]" : "bg-[#f5f9ff] border-[#c5d9f0]"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[#333] flex-1" style={{ fontSize: 13 }}>
                          {comment.text}
                        </p>
                        <span
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 shrink-0 ${
                            comment.visibility === "private" ? "bg-[#f5e9c0] text-[#7a5c00]" : "bg-[#dceeff] text-[#0A6ED1]"
                          }`}
                          style={{ fontSize: 10, fontWeight: 500 }}
                        >
                          {comment.visibility === "private" ? <><Lock size={9} /> Private</> : <><Globe size={9} /> Public</>}
                        </span>
                      </div>
                      <p className="text-[#6a6d70] mt-1" style={{ fontSize: 11 }}>
                        {comment.author} · {comment.date || "-"}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                !showCommentComposer && (
                  <p className="text-[#6a6d70]" style={{ fontSize: 12 }}>
                    No visible notes yet.
                  </p>
                )
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
