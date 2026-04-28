import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router";
import {
  Eye, Download, Trash2, X,
} from "lucide-react";
import { LIVE_SYNC_INTERVAL_MS, categoryOptions, documentsApi, plantsApi } from "../lib/api";
import type { Comment, DocumentRecord, Plant } from "../lib/types";
import { DocumentDrawer } from "./document-drawer";
import { ValueHelp } from "./ui/value-help";

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
  const searchOptions = useMemo(
    () =>
      Array.from(new Set(documents.map((document) => document.name).filter((value) => value.trim())))
        .sort((a, b) => a.localeCompare(b))
        .map((option) => ({ value: option, label: option, meta: "Document" })),
    [documents],
  );
  const categoryValueHelpOptions = useMemo(
    () => categoryOptions.map((category) => ({ value: category, label: category, meta: "Category" })),
    [],
  );
  const plantValueHelpOptions = useMemo(
    () => plants.map((plant) => ({ value: plant.id, label: plant.name, meta: "Plant" })),
    [plants],
  );

  async function load(options?: { keepCurrentSelection?: boolean }) {
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
    if (options?.keepCurrentSelection && selectedDoc) {
      const refreshed = docsResult.items.find((item) => item.id === selectedDoc.id);
      if (refreshed) {
        const detail = await documentsApi.get(refreshed.id);
        setSelectedDoc(detail.document);
        setSelectedComments(detail.comments);
      }
    }
  }

  useEffect(() => {
    load()
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to load documents."))
      .finally(() => setLoading(false));
  }, [filterCategory, filterPlant, mine, search]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void load({ keepCurrentSelection: Boolean(selectedDoc) }).catch(() => undefined);
    }, LIVE_SYNC_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [filterCategory, filterPlant, mine, search, selectedDoc]);

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
        <ValueHelp
          placeholder="All documents"
          emptyLabel="No matching documents."
          options={searchOptions}
          value={search}
          onChange={setSearch}
          containerClassName="min-w-[200px] max-w-xs flex-1"
          triggerClassName="h-9 rounded-md border-[#d9d9d9] px-3 text-[#333] focus-visible:border-[#0A6ED1] focus-visible:ring-[#0A6ED1]/10"
          popoverClassName="border-[#d9d9d9]"
        />

        <ValueHelp
          placeholder="All categories"
          emptyLabel="No matching categories."
          options={categoryValueHelpOptions}
          value={filterCategory}
          onChange={setFilterCategory}
          containerClassName="min-w-[180px]"
          triggerClassName="h-9 rounded-md border-[#d9d9d9] px-3 text-[#333] focus-visible:border-[#0A6ED1] focus-visible:ring-[#0A6ED1]/10"
          popoverClassName="border-[#d9d9d9]"
        />

        {!mine && (
          <ValueHelp
            placeholder="All plants"
            emptyLabel="No matching plants."
            options={plantValueHelpOptions}
            value={filterPlant}
            onChange={setFilterPlant}
            containerClassName="min-w-[180px]"
            triggerClassName="h-9 rounded-md border-[#d9d9d9] px-3 text-[#333] focus-visible:border-[#0A6ED1] focus-visible:ring-[#0A6ED1]/10"
            popoverClassName="border-[#d9d9d9]"
          />
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

      <div className="data-table-panel">
        <div className="data-table-scroll">
          <table className="data-table">
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
