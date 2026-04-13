import { useEffect, useMemo, useState } from "react";
import {
  Search, Filter, Download, Eye, MessageSquare,
  Lock, Globe, SlidersHorizontal, X, ChevronDown,
} from "lucide-react";
import { categoryOptions, documentsApi, plantsApi } from "../lib/api";
import type { Comment, DocumentRecord, Plant } from "../lib/types";
import { DocumentDrawer } from "./document-drawer";

export function CeoDocuments() {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<DocumentRecord | null>(null);
  const [selectedComments, setSelectedComments] = useState<Comment[]>([]);
  const [search, setSearch] = useState("");
  const [filterPlant, setFilterPlant] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [sortBy, setSortBy] = useState<"date" | "name" | "plant">("date");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadDocuments() {
    const result = await documentsApi.list({
      q: search || undefined,
      plant_id: filterPlant || undefined,
      category: filterCategory || undefined,
      sort_by: sortBy,
    });
    setDocuments(result.items);
  }

  useEffect(() => {
    Promise.all([loadDocuments(), plantsApi.list()])
      .then(([, plantsResult]) => setPlants(plantsResult.items))
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to load documents."))
      .finally(() => setLoading(false));
  }, [filterCategory, filterPlant, search, sortBy]);

  async function openDocument(document: DocumentRecord) {
    const result = await documentsApi.get(document.id);
    setSelectedDoc(result.document);
    setSelectedComments(result.comments);
  }

  async function addComment(documentId: string, text: string, visibility: "private" | "public") {
    const created = await documentsApi.addComment(documentId, text, visibility);
    setSelectedComments((prev) => [created, ...prev]);
    await loadDocuments();
  }

  const hasFilter = search || filterPlant || filterCategory;

  const visibleDocuments = useMemo(() => documents, [documents]);

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
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a
            href={documentsApi.exportUrl()}
            className="h-9 px-4 border border-[#d9d9d9] bg-white text-[#333] hover:bg-[#f5f5f5] inline-flex items-center gap-2 cursor-pointer transition-colors"
            style={{ fontSize: 13 }}
          >
            <Download size={14} /> Export CSV
          </a>
          <button className="h-9 px-4 border border-[#d9d9d9] bg-white text-[#333] inline-flex items-center gap-2" style={{ fontSize: 13 }}>
            <SlidersHorizontal size={14} /> Live View
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
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-[#fafafa] border-b border-[#f0f0f0] text-left">
                {["Document Name", "Plant", "Category", "Uploaded By", "Date", "CEO Notes", "Actions"].map((heading) => (
                  <th key={heading} className="px-5 py-3 text-[#6a6d70]" style={{ fontSize: 12, fontWeight: 500, whiteSpace: "nowrap" }}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f7f7f7]">
              {visibleDocuments.map((document) => (
                <tr key={document.id} className="hover:bg-[#fafafa] transition-colors">
                  <td className="px-5 py-4">
                    <button onClick={() => void openDocument(document)} className="text-[#0A6ED1] hover:underline text-left cursor-pointer" style={{ fontSize: 13, fontWeight: 500 }}>
                      {document.name}
                    </button>
                    <div className="text-[#999] mt-0.5" style={{ fontSize: 11 }}>v{document.version}</div>
                  </td>
                  <td className="px-5 py-4 text-[#555]" style={{ fontSize: 13 }}>{document.plant}</td>
                  <td className="px-5 py-4 text-[#555]" style={{ fontSize: 13 }}>{document.category}</td>
                  <td className="px-5 py-4 text-[#6a6d70]" style={{ fontSize: 13 }}>{document.uploadedBy}</td>
                  <td className="px-5 py-4 text-[#6a6d70]" style={{ fontSize: 13 }}>{document.date || "-"}</td>
                  <td className="px-5 py-4">
                    {document.noteSummary?.count ? (
                      <span className="inline-flex items-center gap-1.5">
                        <MessageSquare size={12} className="text-[#0A6ED1]" />
                        <span className="text-[#0A6ED1]" style={{ fontSize: 12 }}>
                          {document.noteSummary.count} note{document.noteSummary.count > 1 ? "s" : ""}
                        </span>
                        {document.noteSummary.latest?.visibility === "private" ? (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-[#f5e9c0] text-[#7a5c00]" style={{ fontSize: 10 }}>
                            <Lock size={8} /> Private
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-[#dceeff] text-[#0A6ED1]" style={{ fontSize: 10 }}>
                            <Globe size={8} /> Public
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-[#999]" style={{ fontSize: 12 }}>No notes</span>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <button onClick={() => void openDocument(document)} className="h-8 px-3 border border-[#d9d9d9] text-[#333] hover:bg-[#f5f5f5] inline-flex items-center gap-1.5 cursor-pointer" style={{ fontSize: 12 }}>
                      <Eye size={12} /> Open
                    </button>
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
          onClose={() => {
            setSelectedDoc(null);
            setSelectedComments([]);
          }}
          onAddComment={addComment}
        />
      )}
    </div>
  );
}
