import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getAuthToken, hrmsApi } from "@/lib/hrmsApi";
import { DocumentActionBar } from "./DocumentActionBar";
import { DocumentAuditTimeline } from "./DocumentAuditTimeline";
import { DocumentMetadataPanel } from "./DocumentMetadataPanel";
import { DocumentReuploadRequestModal } from "./DocumentReuploadRequestModal";
import { DocumentThumbnailRail } from "./DocumentThumbnailRail";
import type { CandidateDocument, DocumentAuditEntry } from "./types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: CandidateDocument | null;
  documents?: CandidateDocument[];
  onSelectDocument?: (document: CandidateDocument) => void;
  onChanged?: () => void;
};

function apiBase(): string {
  const configured = import.meta.env.VITE_HRMS_API_URL;
  if (configured !== undefined) return String(configured).replace(/\/$/, "");
  return import.meta.env.DEV ? "http://localhost:5055" : "";
}

async function fetchSecureBlob(path: string): Promise<Blob> {
  const token = getAuthToken();
  const normalized = apiBase() === "/api" && path.startsWith("/api/") ? path.replace(/^\/api/, "") : path;
  const response = await fetch(`${apiBase()}${normalized}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error(await response.text() || `HTTP ${response.status}`);
  return response.blob();
}

export function SecureDocumentViewer({ open, onOpenChange, document, documents = [], onSelectDocument, onChanged }: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [audit, setAudit] = useState<DocumentAuditEntry[]>([]);
  const [reuploadOpen, setReuploadOpen] = useState(false);

  const isImage = useMemo(() => document?.mime_type?.startsWith("image/"), [document]);
  const isPdf = useMemo(() => document?.mime_type?.includes("pdf"), [document]);

  useEffect(() => {
    let active = true;
    let currentUrl: string | null = null;
    setBlobUrl(null);
    setError("");
    setAudit([]);
    if (!open || !document) return;
    fetchSecureBlob(document.preview_url)
      .then((blob) => {
        if (!active) return;
        currentUrl = URL.createObjectURL(blob);
        setBlobUrl(currentUrl);
      })
      .catch((err) => active && setError(err.message || "Unable to load document"));
    hrmsApi.get<{ success: boolean; data: DocumentAuditEntry[] }>(`/api/ats/documents/${document.id}/audit`)
      .then((res) => active && setAudit(res.data || []))
      .catch(() => undefined);
    return () => {
      active = false;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [document?.id, open]);

  const verify = async () => {
    if (!document) return;
    setBusy(true);
    try {
      await hrmsApi.post(`/api/ats/documents/${document.id}/verify`, {});
      onChanged?.();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!document || !rejectReason.trim()) return;
    setBusy(true);
    try {
      await hrmsApi.post(`/api/ats/documents/${document.id}/reject`, { reason: rejectReason });
      setRejectReason("");
      onChanged?.();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    if (!document) return;
    const blob = await fetchSecureBlob(document.download_url);
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = document.file_name || "document";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const requestReupload = async (reason: string) => {
    if (!document) return;
    await hrmsApi.post(`/api/ats/documents/${document.id}/request-reupload`, { reason });
    onChanged?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-6xl overflow-hidden p-0">
        <DialogHeader className="border-b border-slate-200 px-4 py-3">
          <DialogTitle>{document?.document_name || "Secure document viewer"}</DialogTitle>
        </DialogHeader>
        {document && (
          <>
            <DocumentActionBar
              onZoomIn={() => setZoom((value) => Math.min(value + 0.15, 2.5))}
              onZoomOut={() => setZoom((value) => Math.max(value - 0.15, 0.5))}
              onRotate={() => setRotation((value) => value + 90)}
              onFullscreen={() => blobUrl && window.open(blobUrl, "_blank", "noopener,noreferrer")}
              onDownload={download}
              onVerify={verify}
              onReject={reject}
              busy={busy}
            />
            <div className="flex max-h-[62vh] flex-col md:flex-row">
              <div className="relative flex min-h-[420px] flex-1 items-center justify-center overflow-auto bg-slate-100">
                <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center text-5xl font-black uppercase tracking-widest text-slate-300/40">Team MAS Confidential</div>
                {error ? <div className="rounded bg-white px-4 py-3 text-sm text-red-700">{error}</div> : null}
                {!error && !blobUrl ? <div className="text-sm text-slate-500">Loading secure preview...</div> : null}
                {blobUrl && isImage ? (
                  <img src={blobUrl} alt={document.document_name} className="max-h-full max-w-full object-contain" style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }} />
                ) : null}
                {blobUrl && isPdf ? (
                  <iframe title={document.document_name} src={blobUrl} className="h-[58vh] w-full border-0 bg-white" style={{ transform: `scale(${zoom})`, transformOrigin: "center top" }} />
                ) : null}
                {blobUrl && !isImage && !isPdf ? (
                  <div className="rounded bg-white p-6 text-center">
                    <div className="font-semibold text-slate-900">Preview is not available for this file type.</div>
                    <Button type="button" className="mt-4" onClick={download}>Download securely</Button>
                  </div>
                ) : null}
              </div>
              <DocumentMetadataPanel document={document} />
            </div>
            <div className="grid gap-3 border-t border-slate-200 p-4 md:grid-cols-[1fr_auto]">
              <Textarea value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} placeholder="Rejection remarks" />
              <div className="flex gap-2 md:flex-col">
                <Button type="button" variant="outline" onClick={() => setReuploadOpen(true)}>Re-upload</Button>
                <Button type="button" variant="outline" onClick={reject} disabled={!rejectReason.trim() || busy}>Reject with remarks</Button>
              </div>
            </div>
            <DocumentAuditTimeline entries={audit} />
            {documents.length > 1 && onSelectDocument && (
              <DocumentThumbnailRail documents={documents} selectedId={document.id} onSelect={onSelectDocument} />
            )}
            <DocumentReuploadRequestModal open={reuploadOpen} onOpenChange={setReuploadOpen} onSubmit={requestReupload} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
