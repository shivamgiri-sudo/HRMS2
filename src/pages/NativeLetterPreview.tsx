// src/pages/NativeLetterPreview.tsx
// Full-fidelity letter viewer — renders the backend HTML in an iframe.
// Provides Print (browser dialog → PDF) and Download HTML buttons.
// Route: /letters/:id/preview

import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Download, Printer, CheckCircle2, Loader } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { getAuthToken } from "@/lib/hrmsApi";

const API_BASE = import.meta.env.VITE_HRMS_API_URL?.replace(/\/$/, "") ?? (import.meta.env.DEV ? "http://localhost:5055" : "");

export default function NativeLetterPreview() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [htmlContent, setHtmlContent] = useState("");
  const [acking, setAcking] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError("");

    const token = getAuthToken();
    fetch(`${API_BASE}/api/letters/${id}/html`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((html) => {
        setHtmlContent(html);
        setLoading(false);
      })
      .catch((e) => {
        setError(e?.message ?? "Failed to load letter");
        setLoading(false);
      });
  }, [id]);

  // Inject HTML into iframe after it loads
  useEffect(() => {
    if (!htmlContent || !iframeRef.current) return;
    const doc = iframeRef.current.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(htmlContent);
    doc.close();
  }, [htmlContent]);

  function handlePrint() {
    if (!iframeRef.current) return;
    iframeRef.current.contentWindow?.print();
  }

  function handleDownload() {
    if (!htmlContent) return;
    const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `letter_${id}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleAcknowledge() {
    if (!id) return;
    setAcking(true);
    try {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE}/api/letters/${id}/acknowledge`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({ title: "Letter acknowledged successfully" });
    } catch (e: any) {
      toast({ title: e?.message ?? "Failed to acknowledge", variant: "destructive" });
    } finally {
      setAcking(false);
    }
  }

  return (
    <div className="flex flex-col h-screen bg-slate-100">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b shadow-sm flex-shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <h1 className="font-bold text-slate-900 text-sm">Letter Preview</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleDownload} disabled={!htmlContent}>
            <Download className="w-4 h-4 mr-1.5" /> Download
          </Button>
          <Button variant="outline" size="sm" onClick={handlePrint} disabled={!htmlContent}>
            <Printer className="w-4 h-4 mr-1.5" /> Print / Save PDF
          </Button>
          <Button size="sm" onClick={handleAcknowledge} disabled={acking || !htmlContent}>
            <CheckCircle2 className="w-4 h-4 mr-1.5" />
            {acking ? "Acknowledging…" : "Acknowledge"}
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {loading && (
          <div className="flex items-center justify-center h-full">
            <Loader className="w-8 h-8 animate-spin text-slate-400" />
            <span className="ml-3 text-slate-500">Loading letter…</span>
          </div>
        )}
        {error && (
          <div className="flex items-center justify-center h-full">
            <p className="text-rose-600 font-medium">{error}</p>
          </div>
        )}
        {!loading && !error && (
          <iframe
            ref={iframeRef}
            title="Letter Preview"
            className="w-full h-full border-0 bg-white"
            sandbox="allow-same-origin allow-modals"
          />
        )}
      </div>
    </div>
  );
}
