import { useEffect, useState } from "react";
import { Eye, FileCheck2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { hrmsApi } from "@/lib/hrmsApi";
import { SecureDocumentViewer } from "./SecureDocumentViewer";
import type { CandidateDocument } from "./types";

export function SecureDocumentList({ candidateId }: { candidateId: string | null }) {
  const [documents, setDocuments] = useState<CandidateDocument[]>([]);
  const [selected, setSelected] = useState<CandidateDocument | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    if (!candidateId) return;
    setLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: CandidateDocument[] }>(`/api/ats/candidates/${candidateId}/documents`);
      setDocuments(res.data || []);
    } catch (err: any) {
      setError(err.message || "Unable to load documents");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [candidateId]);

  const openDocument = (document: CandidateDocument) => {
    setSelected(document);
    setViewerOpen(true);
  };

  if (!candidateId) return <div className="rounded border border-slate-200 bg-white p-6 text-sm text-slate-500">Select a candidate to review documents.</div>;

  return (
    <div className="rounded border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div className="font-semibold text-slate-900">Uploaded Documents</div>
        <Button type="button" size="sm" variant="outline" onClick={load} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
      </div>
      {error && <div className="m-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Document</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Name match</th>
              <th className="px-4 py-3">Uploaded</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((document) => (
              <tr key={document.id} className="border-t border-slate-100">
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-900">{document.document_name}</div>
                  <div className="text-xs text-slate-500">{document.document_type}</div>
                </td>
                <td className="px-4 py-3">{document.document_category}</td>
                <td className="px-4 py-3"><Badge variant={document.verification_status === "verified" ? "default" : "outline"}>{document.verification_status}</Badge></td>
                <td className="px-4 py-3">{document.name_match_status}</td>
                <td className="px-4 py-3">{document.uploaded_at ? new Date(document.uploaded_at).toLocaleDateString() : "-"}</td>
                <td className="px-4 py-3 text-right">
                  <Button type="button" size="sm" variant="outline" onClick={() => openDocument(document)}><Eye className="mr-2 h-4 w-4" />View</Button>
                </td>
              </tr>
            ))}
            {!documents.length && (
              <tr><td className="px-4 py-8 text-center text-slate-500" colSpan={6}><FileCheck2 className="mx-auto mb-2 h-6 w-6" />No candidate documents found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <SecureDocumentViewer
        open={viewerOpen}
        onOpenChange={setViewerOpen}
        document={selected}
        documents={documents}
        onSelectDocument={setSelected}
        onChanged={load}
      />
    </div>
  );
}
