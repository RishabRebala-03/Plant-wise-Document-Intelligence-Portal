import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import {
  Search, Filter, Eye, Download, Trash2, X, ChevronDown,
} from "lucide-react";
import { categoryOptions, documentsApi, plantsApi } from "../lib/api";
import type { Comment, DocumentRecord, Plant } from "../lib/types";
import { DocumentDrawer } from "./document-drawer";

interface ManagerDocumentsProps {
  mine?: boolean;
}

export function ManagerDocuments({ mine = true }: ManagerDocumentsProps) {
  const location = useLocation();
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<DocumentRecord | null>(null);
  const [selectedComments, setSelectedComments] = useState<Comment[]>([]);
  const [startInEditMode, setStartInEditMode] = useState(false);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterPlant, setFilterPlant] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    const [docsResult, plantsResult] = await Promise.all([
      documentsApi.list({
        scope: mine ? "mine" : undefined,
        q: search || undefined,
        category: filterCategory || undefined,
        plant_id: !mine ? filterPlant || undefined : undefined,
      }),
      plantsApi.list(),
    ]);
    setDocuments(docsResult.items);
    setPlants(plantsResult.items);
  }

  useEffect(() => {
    load()
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to load documents."))
      .finally(() => setLoading(false));
  }, [filterCategory, filterPlant, mine, search]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const docId = params.get("docId");
    const edit = params.get("edit") === "1";
    if (!docId) return;

    documentsApi
      .get(docId)
      .then((result) => {
        setSelectedDoc(result.document);
        setSelectedComments(result.comments);
        setStartInEditMode(edit);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to open the selected document."));
  }, [location.search]);

  async function openDocumentDetails(document: DocumentRecord) {
    const result = await documentsApi.get(document.id);
    setSelectedDoc(result.document);
    setSelectedComments(result.comments);
    setStartInEditMode(false);
  }

  async function openOriginalDocument(document: DocumentRecord) {
    if (document.file?.storageId) {
      await documentsApi.openFileInNewTab(document.id);
      return;
    }
    await openDocumentDetails(document);
  }

  async function updateDocument(documentId: string, payload: FormData) {
    const updated = await documentsApi.update(documentId, payload);
    const refreshed = await documentsApi.get(documentId);
    setSelectedDoc(refreshed.document);
    setSelectedComments(refreshed.comments);
    setDocuments((prev) => prev.map((item) => (item.id === documentId ? updated : item)));
  }

  async function deleteDocument(documentId: string) {
    if (!window.confirm("Remove this document?")) return;
    await documentsApi.remove(documentId);
    await load();
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

  const pageTitle = mine ? "My Documents" : "All Documents";
  const pageDesc = mine ? "Documents uploaded by you" : "All accessible documents";
  const hasFilter = search || filterCategory || filterPlant;

  if (loading) return <div className="p-7 text-[#6a6d70]">Loading {pageTitle.toLowerCase()}...</div>;
  if (error) return <div className="p-7 text-[#BB0000]">{error}</div>;

  return (
    <div className="p-7 max-w-[1400px]">
      <div className="mb-7 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[#1a1a1a]" style={{ fontSize: 20, fontWeight: 600 }}>{pageTitle}</h1>
          <p className="text-[#6a6d70] mt-1" style={{ fontSize: 14 }}>{pageDesc}</p>
        </div>
        <button
          onClick={() => void exportDocuments()}
          className="h-9 px-4 border border-[#d9d9d9] bg-white text-[#333] hover:bg-[#f5f5f5] inline-flex items-center gap-2 cursor-pointer transition-colors shrink-0"
          style={{ fontSize: 13 }}
        >
          <Download size={14} /> Export
        </button>
      </div>

      <div className="bg-white border border-[#e8e8e8] px-5 py-4 mb-5 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#999]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search documents..."
            className="w-full h-9 pl-9 pr-8 border border-[#d9d9d9] bg-white text-[#333] placeholder-[#bbb] focus:border-[#0A6ED1] focus:outline-none"
            style={{ fontSize: 13 }}
          />
        </div>

        <div className="relative">
          <Filter size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#999]" />
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="h-9 pl-8 pr-8 border border-[#d9d9d9] bg-white text-[#333] focus:border-[#0A6ED1] focus:outline-none appearance-none cursor-pointer"
            style={{ fontSize: 13 }}
          >
            <option value="">All Categories</option>
            {categoryOptions.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
          <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#999] pointer-events-none" />
        </div>

        {!mine && (
          <div className="relative">
            <select
              value={filterPlant}
              onChange={(e) => setFilterPlant(e.target.value)}
              className="h-9 px-3 pr-8 border border-[#d9d9d9] bg-white text-[#333] focus:border-[#0A6ED1] focus:outline-none appearance-none cursor-pointer"
              style={{ fontSize: 13 }}
            >
              <option value="">All Plants</option>
              {plants.map((plant) => (
                <option key={plant.id} value={plant.id}>{plant.name}</option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#999] pointer-events-none" />
          </div>
        )}

        {hasFilter && (
          <button
            onClick={() => { setSearch(""); setFilterCategory(""); setFilterPlant(""); }}
            className="h-9 px-3 text-[#BB0000] hover:bg-[#fff5f5] border border-[#e8c0c0] inline-flex items-center gap-1.5 cursor-pointer"
            style={{ fontSize: 13 }}
          >
            <X size={13} /> Clear
          </button>
        )}
      </div>

      <div className="bg-white border border-[#e8e8e8]">
        <div className="overflow-x-auto">
          <table className="w-full">
            <colgroup>
              <col className="w-[26%]" />
              <col className="w-[20%]" />
              <col className="w-[19%]" />
              <col className="w-[17%]" />
              <col className="w-[18%] min-w-[280px]" />
            </colgroup>
            <thead>
              <tr className="bg-[#fafafa] border-b border-[#f0f0f0] text-left">
                {["Document Name", "Plant", "Category", "Date", "Actions"].map((heading) => (
                  <th key={heading} className="px-5 py-3 text-[#6a6d70]" style={{ fontSize: 12, fontWeight: 500 }}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f7f7f7]">
              {documents.map((document) => (
                <tr key={document.id} className="hover:bg-[#fafafa] transition-colors">
                  <td className="px-5 py-4">
                    <button onClick={() => void openDocumentDetails(document)} className="text-[#0A6ED1] hover:underline text-left cursor-pointer" style={{ fontSize: 13, fontWeight: 500 }}>
                      {document.name}
                    </button>
                    <div className="text-[#999] mt-0.5" style={{ fontSize: 11 }}>v{document.version} · by {document.uploadedBy}</div>
                  </td>
                  <td className="px-5 py-4 text-[#6a6d70]" style={{ fontSize: 13 }}>{document.plant}</td>
                  <td className="px-5 py-4 text-[#6a6d70]" style={{ fontSize: 13 }}>{document.category}</td>
                  <td className="px-5 py-4 text-[#6a6d70]" style={{ fontSize: 13 }}>{document.date || "-"}</td>
                  <td className="px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2 min-w-[280px]">
                      <button onClick={() => void openDocumentDetails(document)} className="h-8 min-w-[120px] px-3 border border-[#d9d9d9] text-[#333] hover:bg-[#f5f5f5] inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer" style={{ fontSize: 12 }}>
                        <Eye size={12} /> View Details
                      </button>
                      {document.file?.storageId && (
                        <button onClick={() => void openOriginalDocument(document)} className="h-8 min-w-[108px] px-3 border border-[#d9d9d9] text-[#333] hover:bg-[#f5f5f5] inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer" style={{ fontSize: 12 }}>
                          <Download size={12} /> Open File
                        </button>
                      )}
                      <button onClick={() => void deleteDocument(document.id)} className="h-8 min-w-[96px] px-3 border border-[#f0c0c0] text-[#BB0000] hover:bg-[#fff5f5] inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer" style={{ fontSize: 12 }}>
                        <Trash2 size={12} /> Delete
                      </button>
                    </div>
                  </td>
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
          autoStartEdit={startInEditMode}
          onUpdateDocument={updateDocument}
          onClose={() => {
            setSelectedDoc(null);
            setSelectedComments([]);
            setStartInEditMode(false);
          }}
        />
      )}
    </div>
  );
}
