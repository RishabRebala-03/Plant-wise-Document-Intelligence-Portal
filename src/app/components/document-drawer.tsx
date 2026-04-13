import { useState } from "react";
import { X, FileText, Save, Lock, Globe, MessageSquare } from "lucide-react";
import type { Comment, DocumentRecord } from "../lib/types";

interface DocumentDrawerProps {
  doc: DocumentRecord;
  onClose: () => void;
  comments?: Comment[];
  onAddComment?: (documentId: string, text: string, visibility: "private" | "public") => Promise<void>;
}

export function DocumentDrawer({ doc, onClose, comments = [], onAddComment }: DocumentDrawerProps) {
  const [commentText, setCommentText] = useState("");
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [saving, setSaving] = useState(false);

  const showCommentComposer = Boolean(onAddComment);

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

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative w-full max-w-[540px] bg-white border-l border-[#d9d9d9] h-full flex flex-col">
        <div className="h-11 bg-[#354A5F] flex items-center justify-between px-4 shrink-0">
          <span className="text-white" style={{ fontSize: 13, fontWeight: 500 }}>
            Document Preview
          </span>
          <button onClick={onClose} className="text-white/70 hover:text-white cursor-pointer">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5">
          <div className="bg-[#f5f5f5] border border-[#d9d9d9] h-56 flex items-center justify-center mb-5">
            <div className="text-center text-[#6a6d70]">
              <FileText size={40} className="mx-auto mb-2 text-[#bbb]" />
              <p style={{ fontSize: 13 }}>Document Preview</p>
              <p style={{ fontSize: 11 }}>{doc.name}</p>
            </div>
          </div>

          <div className="mb-5">
            <h4 className="text-[#333] mb-3" style={{ fontSize: 14, fontWeight: 500 }}>
              Document Details
            </h4>
            <div className="space-y-2">
              {[
                ["Document Name", doc.name],
                ["Plant", doc.plant],
                ["Category", doc.category],
                ["Uploaded By", doc.uploadedBy],
                ["Upload Date", doc.date || "-"],
                ["Status", doc.status],
                ["Version", `v${doc.version}`],
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
