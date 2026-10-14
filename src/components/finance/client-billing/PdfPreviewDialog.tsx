// src/components/finance/client-billing/PdfPreviewDialog.tsx
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { previewInvoicePdfUrl } from "@/lib/clientBillingApi";

export interface PdfTarget { kind: "proforma" | "invoice" | "credit-note"; id: string; label: string }

/** Inline PDF preview dialog — fetches the same PDF the download button would, but renders
 *  it in an <iframe> (browsers render application/pdf blobs natively) instead of forcing a
 *  save, so an approver can see exactly what will print before downloading it. Revokes its
 *  object URL on close to avoid leaking blob memory across many previews in one session. */
export function PdfPreviewDialog({
  target, onOpenChange,
}: {
  target: PdfTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [letterhead, setLetterhead] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    previewInvoicePdfUrl(target.kind, target.id, letterhead)
      .then((objectUrl) => { if (!cancelled) setUrl(objectUrl); })
      .catch((error) => {
        if (!cancelled) {
          setError(error instanceof Error ? error.message : "Unable to load PDF preview");
          toast({
            title: "Preview failed",
            description: error instanceof Error ? error.message : "Unable to load PDF preview",
            variant: "destructive",
          });
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id, target?.kind, letterhead]);

  useEffect(() => {
    if (!target) {
      if (url) URL.revokeObjectURL(url);
      setUrl(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return (
    <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-w-4xl flex-col gap-0 p-0">
        <DialogHeader className="flex-row items-center justify-between border-b px-4 py-3">
          <DialogTitle className="text-sm font-semibold">Preview — {target?.label}</DialogTitle>
          <div className="flex items-center gap-1 pr-8 text-xs">
            <Button
              size="sm" variant={letterhead ? "default" : "outline"} className="h-7 text-xs"
              onClick={() => setLetterhead(true)}
            >
              Letterhead
            </Button>
            <Button
              size="sm" variant={!letterhead ? "default" : "outline"} className="h-7 text-xs"
              onClick={() => setLetterhead(false)}
            >
              Plain
            </Button>
          </div>
        </DialogHeader>
        <div className="flex-1 bg-slate-100">
          {error && !loading ? (
            <div className="flex h-full items-center justify-center p-6">
              <p role="alert" className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">Preview failed: {error}</p>
            </div>
          ) : loading || !url ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : (
            <iframe title="PDF preview" src={url} className="h-full w-full border-0" />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
