import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router";
import {
  Search, Filter, Download, Eye, MessageSquare,
  Lock, Globe, SlidersHorizontal, X, ChevronDown, RefreshCw, ChevronLeft, ChevronRight,
} from "lucide-react";
import { LIVE_SYNC_INTERVAL_MS, categoryOptions, documentsApi, plantsApi } from "../lib/api";
import type { Comment, DocumentRecord, Plant } from "../lib/types";
import { DocumentDrawer } from "./document-drawer";

type DocumentColumnId = "name" | "plant" | "category" | "uploadedBy" | "date" | "notes" | "actions";

const DOCUMENT_COLUMNS: Array<{
  id: DocumentColumnId;
  label: string;
  weight: number;
  minWidth?: number;
}> = [
  { id: "name", label: "Document Name", weight: 1.4, minWidth: 210 },
  { id: "plant", label: "Plant", weight: 1.1, minWidth: 170 },
  { id: "category", label: "Category", weight: 1.1, minWidth: 170 },
  { id: "uploadedBy", label: "Uploaded By", weight: 0.95, minWidth: 150 },
  { id: "date", label: "Date", weight: 1.15, minWidth: 170 },
  { id: "notes", label: "CEO Notes", weight: 1.4, minWidth: 230 },
  { id: "actions", label: "Actions", weight: 1.1, minWidth: 170 },
];

export function CeoDocuments() {
  const location = useLocation();
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<DocumentRecord | null>(null);
  const [selectedComments, setSelectedComments] = useState<Comment[]>([]);
  const [focusCommentComposer, setFocusCommentComposer] = useState(false);
  const [search, setSearch] = useState("");
  const [filterPlant, setFilterPlant] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [sortBy, setSortBy] = useState<"date" | "name" | "plant">("date");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [liveViewEnabled, setLiveViewEnabled] = useState(true);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [hiddenColumns, setHiddenColumns] = useState<DocumentColumnId[]>([]);
  const [error, setError] = useState("");

  async function loadDocuments(options?: { silent?: boolean; keepCurrentSelection?: boolean }) {
    if (!options?.silent) {
      setRefreshing(true);
    }

    try {
      const result = await documentsApi.list({
        q: search || undefined,
        plant_id: filterPlant || undefined,
        category: filterCategory || undefined,
        sort_by: sortBy,
      });
      setDocuments(result.items);
      setLastSyncedAt(new Date().toLocaleTimeString());
      setError("");

      if (options?.keepCurrentSelection && selectedDoc) {
        const refreshedSelectedDoc = result.items.find((document) => document.id === selectedDoc.id);
        if (refreshedSelectedDoc) {
          const detail = await documentsApi.get(refreshedSelectedDoc.id);
          setSelectedDoc(detail.document);
          setSelectedComments(detail.comments);
        }
      }
    } finally {
      if (!options?.silent) {
        setRefreshing(false);
      }
    }
  }

  useEffect(() => {
    Promise.all([loadDocuments(), plantsApi.list()])
      .then(([, plantsResult]) => setPlants(plantsResult.items))
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to load documents."))
      .finally(() => setLoading(false));
  }, [filterCategory, filterPlant, search, sortBy]);

  useEffect(() => {
    if (!liveViewEnabled) return;

    const timer = window.setInterval(() => {
      void loadDocuments({ silent: true, keepCurrentSelection: Boolean(selectedDoc) }).catch((err) => {
        setError(err instanceof Error ? err.message : "Live view refresh failed.");
      });
    }, LIVE_SYNC_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [liveViewEnabled, filterCategory, filterPlant, search, sortBy, selectedDoc]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const docId = params.get("docId");
    if (!docId) return;

    documentsApi
      .get(docId)
      .then((result) => {
        setSelectedDoc(result.document);
        setSelectedComments(result.comments);
        setFocusCommentComposer(false);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to open the selected document."));
  }, [location.search]);

  async function openDocumentDetails(document: DocumentRecord, options?: { focusCommentComposer?: boolean }) {
    const result = await documentsApi.get(document.id);
    setSelectedDoc(result.document);
    setSelectedComments(result.comments);
    setFocusCommentComposer(Boolean(options?.focusCommentComposer));
  }

  async function openOriginalDocument(document: DocumentRecord) {
    if (document.file?.storageId) {
      await documentsApi.openFileInNewTab(document.id);
      return;
    }
    await openDocumentDetails(document);
  }

  async function addComment(documentId: string, text: string, visibility: "private" | "public") {
    const created = await documentsApi.addComment(documentId, text, visibility);
    setSelectedComments((prev) => [created, ...prev]);
    await loadDocuments({ silent: true, keepCurrentSelection: true });
  }

  async function exportDocuments() {
    try {
      const { blob, fileName } = await documentsApi.exportCsv();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName || "documents.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to export documents.");
    }
  }

  const hasFilter = search || filterPlant || filterCategory;

  const visibleDocuments = useMemo(() => documents, [documents]);
  const visibleColumns = useMemo(
    () => DOCUMENT_COLUMNS.filter((column) => !hiddenColumns.includes(column.id)),
    [hiddenColumns],
  );
  const visibleColumnWeight = useMemo(
    () => visibleColumns.reduce((sum, column) => sum + column.weight, 0),
    [visibleColumns],
  );

  function toggleColumn(columnId: DocumentColumnId) {
    setHiddenColumns((prev) => {
      const isHidden = prev.includes(columnId);
      if (isHidden) {
        return prev.filter((id) => id !== columnId);
      }

      if (visibleColumns.length === 1) {
        return prev;
      }

      return [...prev, columnId];
    });
  }

  if (loading) return <div className="p-7 text-[#6a6d70]">Loading documents...</div>;
  if (error) return <div className="p-7 text-[#BB0000]">{error}</div>;

  return (
    <div className="p-7 max-w-[1400px]">
      <div className="mb-7 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[#1a1a1a]" style={{ fontSize: 20, fontWeight: 600 }}>
            Documents
          </h1>
          <p className="text-[#6a6d70] mt-1" style={{ fontSize: 14 }}>
            Real-time document records from the backend - {visibleDocuments.length} loaded
          </p>
          <p className="text-[#6a6d70] mt-1" style={{ fontSize: 12 }}>
            {liveViewEnabled
              ? `Live View is on. Refreshing every ${LIVE_SYNC_INTERVAL_MS / 1000} seconds${lastSyncedAt ? ` • Last synced at ${lastSyncedAt}` : ""}`
              : `Live View is off${lastSyncedAt ? ` • Last synced at ${lastSyncedAt}` : ""}`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => void exportDocuments()}
            className="h-9 px-4 border border-[#d9d9d9] bg-white text-[#333] hover:bg-[#f5f5f5] inline-flex items-center gap-2 cursor-pointer transition-colors"
            style={{ fontSize: 13 }}
          >
            <Download size={14} /> Export CSV
          </button>
          <button
            onClick={() => setLiveViewEnabled((prev) => !prev)}
            className={`h-9 px-4 border inline-flex items-center gap-2 cursor-pointer transition-colors ${
              liveViewEnabled
                ? "border-[#0A6ED1] bg-[#EBF4FD] text-[#0A6ED1]"
                : "border-[#d9d9d9] bg-white text-[#333] hover:bg-[#f5f5f5]"
            }`}
            style={{ fontSize: 13 }}
          >
            {refreshing ? <RefreshCw size={14} className="animate-spin" /> : <SlidersHorizontal size={14} />}
            {liveViewEnabled ? "Live View On" : "Live View"}
          </button>
        </div>
      </div>

      <div className="bg-white border border-[#e8e8e8] px-5 py-4 mb-5 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#999]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search documents or uploader..."
            className="w-full h-9 pl-9 pr-3 border border-[#d9d9d9] bg-white text-[#333] placeholder-[#bbb] focus:border-[#0A6ED1] focus:outline-none"
            style={{ fontSize: 13 }}
          />
        </div>

        <div className="relative">
          <Filter size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#999]" />
          <select
            value={filterPlant}
            onChange={(e) => setFilterPlant(e.target.value)}
            className="h-9 pl-8 pr-8 border border-[#d9d9d9] bg-white text-[#333] focus:border-[#0A6ED1] focus:outline-none appearance-none cursor-pointer"
            style={{ fontSize: 13 }}
          >
            <option value="">All Plants</option>
            {plants.map((plant) => (
              <option key={plant.id} value={plant.id}>{plant.name}</option>
            ))}
          </select>
          <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#999] pointer-events-none" />
        </div>

        <div className="relative">
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="h-9 px-3 pr-8 border border-[#d9d9d9] bg-white text-[#333] focus:border-[#0A6ED1] focus:outline-none appearance-none cursor-pointer"
            style={{ fontSize: 13 }}
          >
            <option value="">All Categories</option>
            {categoryOptions.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
          <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#999] pointer-events-none" />
        </div>

        <div className="relative ml-auto">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "date" | "name" | "plant")}
            className="h-9 px-3 pr-8 border border-[#d9d9d9] bg-white text-[#333] focus:border-[#0A6ED1] focus:outline-none appearance-none cursor-pointer"
            style={{ fontSize: 13 }}
          >
            <option value="date">Sort: Latest First</option>
            <option value="name">Sort: Name A-Z</option>
            <option value="plant">Sort: Plant</option>
          </select>
          <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#999] pointer-events-none" />
        </div>

        {hasFilter && (
          <button
            onClick={() => { setSearch(""); setFilterPlant(""); setFilterCategory(""); }}
            className="h-9 px-3 text-[#BB0000] hover:bg-[#fff5f5] border border-[#e8c0c0] inline-flex items-center gap-1.5 cursor-pointer transition-colors"
            style={{ fontSize: 13 }}
          >
            <X size={13} /> Clear
          </button>
        )}
      </div>

      <div className="bg-white border border-[#e8e8e8]">
        <div className="flex flex-wrap items-center gap-2 border-b border-[#f0f0f0] px-5 py-3">
          <span className="text-[#6a6d70]" style={{ fontSize: 12, fontWeight: 500 }}>
            Columns
          </span>
          {DOCUMENT_COLUMNS.map((column) => {
            const isHidden = hiddenColumns.includes(column.id);
            const isLastVisible = !isHidden && visibleColumns.length === 1;
            return (
              <button
                key={column.id}
                onClick={() => toggleColumn(column.id)}
                disabled={isLastVisible}
                className={`h-8 px-3 border inline-flex items-center gap-1.5 transition-colors ${
                  isHidden
                    ? "border-[#d9d9d9] bg-white text-[#6a6d70] hover:bg-[#f7f7f7]"
                    : "border-[#0A6ED1] bg-[#EBF4FD] text-[#0A6ED1] hover:bg-[#dcecff]"
                } ${isLastVisible ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
                style={{ fontSize: 12, fontWeight: 500 }}
              >
                {isHidden ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
                {column.label}
              </button>
            );
          })}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full table-fixed">
            <colgroup>
              {visibleColumns.map((column) => (
                <col
                  key={column.id}
                  style={{
                    width: `${(column.weight / Math.max(visibleColumnWeight, 1)) * 100}%`,
                    minWidth: column.minWidth,
                  }}
                />
              ))}
            </colgroup>
            <thead>
              <tr className="bg-[#fafafa] border-b border-[#f0f0f0] text-left">
                {visibleColumns.map((column) => (
                  <th key={column.id} className="px-5 py-3 text-[#6a6d70]" style={{ fontSize: 12, fontWeight: 500, whiteSpace: "nowrap" }}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f7f7f7]">
              {visibleDocuments.map((document) => (
                <tr key={document.id} className="hover:bg-[#fafafa] transition-colors">
                  {visibleColumns.map((column) => {
                    if (column.id === "name") {
                      return (
                        <td key={column.id} className="px-5 py-4 align-top">
                          <button onClick={() => void openDocumentDetails(document)} className="text-[#0A6ED1] hover:underline text-left cursor-pointer" style={{ fontSize: 13, fontWeight: 500 }}>
                            {document.name}
                          </button>
                          <div className="text-[#999] mt-0.5" style={{ fontSize: 11 }}>v{document.version}</div>
                        </td>
                      );
                    }

                    if (column.id === "plant") {
                      return <td key={column.id} className="px-5 py-4 align-top text-[#555]" style={{ fontSize: 13 }}>{document.plant}</td>;
                    }

                    if (column.id === "category") {
                      return <td key={column.id} className="px-5 py-4 align-top text-[#555]" style={{ fontSize: 13 }}>{document.category}</td>;
                    }

                    if (column.id === "uploadedBy") {
                      return <td key={column.id} className="px-5 py-4 align-top text-[#6a6d70]" style={{ fontSize: 13 }}>{document.uploadedBy}</td>;
                    }

                    if (column.id === "date") {
                      return <td key={column.id} className="px-5 py-4 align-top text-[#6a6d70]" style={{ fontSize: 13 }}>{document.date || "-"}</td>;
                    }

                    if (column.id === "notes") {
                      return (
                        <td key={column.id} className="px-5 py-4 align-top">
                          <div className="flex flex-col items-start gap-2">
                            {document.noteSummary?.count ? (
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                                  <MessageSquare size={12} className="text-[#0A6ED1]" />
                                  <span className="text-[#0A6ED1]" style={{ fontSize: 12, fontWeight: 500 }}>
                                    {document.noteSummary.count} note{document.noteSummary.count > 1 ? "s" : ""}
                                  </span>
                                </span>
                                {document.noteSummary.latest?.visibility === "private" ? (
                                  <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-sm bg-[#f5e9c0] px-1.5 py-0.5 text-[#7a5c00]" style={{ fontSize: 10 }}>
                                    <Lock size={8} /> Private
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-sm bg-[#dceeff] px-1.5 py-0.5 text-[#0A6ED1]" style={{ fontSize: 10 }}>
                                    <Globe size={8} /> Public
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-[#999]" style={{ fontSize: 12 }}>No notes</span>
                            )}
                            <button
                              onClick={() => void openDocumentDetails(document, { focusCommentComposer: true })}
                              className="h-8 w-full max-w-[180px] px-3 border border-[#d9d9d9] text-[#0A6ED1] hover:bg-[#f5f9ff] inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
                              style={{ fontSize: 12, fontWeight: 500 }}
                            >
                              <MessageSquare size={12} /> Add Comment
                            </button>
                          </div>
                        </td>
                      );
                    }

                    return (
                      <td key={column.id} className="px-5 py-4 align-top">
                        <div className="flex flex-wrap items-center gap-2">
                          <button onClick={() => void openDocumentDetails(document)} className="h-8 w-full max-w-[180px] px-3 border border-[#d9d9d9] text-[#333] hover:bg-[#f5f5f5] inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer" style={{ fontSize: 12 }}>
                            <Eye size={12} /> View Details
                          </button>
                          {document.file?.storageId && (
                            <button
                              onClick={() => void openOriginalDocument(document)}
                              className="h-8 w-full max-w-[180px] px-3 border border-[#d9d9d9] text-[#333] hover:bg-[#f5f5f5] inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
                              style={{ fontSize: 12 }}
                            >
                              <Download size={12} /> Open File
                            </button>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedDoc && (
        <DocumentDrawer
          doc={selectedDoc}
          comments={selectedComments}
          autoFocusCommentComposer={focusCommentComposer}
          onClose={() => {
            setSelectedDoc(null);
            setSelectedComments([]);
            setFocusCommentComposer(false);
          }}
          onAddComment={addComment}
        />
      )}
    </div>
  );
}
