import { useState, useEffect } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, Loader2, FileText, ExternalLink } from "lucide-react";
import { format } from "date-fns";

interface DocumentInfo {
  id: string;
  document_name: string;
  document_type: string;
  file_url: string;
  uploaded_at: string;
}

interface DocumentViewerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentInfo: DocumentInfo | null;
  bucketName?: string;
}

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  id_proof: "ID Proof",
  resume: "Resume",
  offer_letter: "Offer Letter",
  contract: "Contract",
  other: "Others",
  "W-2": "W-2",
  "1099": "1099",
  "Tax Statement": "Tax Statement",
  "Tax Certificate": "Tax Certificate",
};

export function DocumentViewerDialog({
  open,
  onOpenChange,
  documentInfo,
  bucketName = "employee-documents",
}: DocumentViewerDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileType, setFileType] = useState<"pdf" | "image" | "other">("other");

  useEffect(() => {
    if (open && documentInfo) {
      loadPreview();
    } else {
      setPreviewUrl(null);
      setFileType("other");
    }

    return () => {
      setPreviewUrl((prev) => {
        if (prev && prev.startsWith("blob:")) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [open, documentInfo]);

  const loadPreview = async () => {
    if (!documentInfo) return;

    setIsLoading(true);
    try {
      if (!documentInfo.file_url) {
        throw new Error("Document file URL is missing");
      }

      // Detect type from the actual file path (not display name)
      const filePath = documentInfo.file_url.toLowerCase();
      const isPdf = filePath.endsWith(".pdf");
      const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(filePath);
      setFileType(isPdf ? "pdf" : isImage ? "image" : "other");

      const HRMS_API = (import.meta.env.VITE_HRMS_API_URL || import.meta.env.VITE_API_URL || "http://localhost:5056").replace(/\/$/, "");
      const fileUrl = documentInfo.file_url.startsWith("http") ? documentInfo.file_url
        : documentInfo.file_url.startsWith("/api/") ? `${HRMS_API}${documentInfo.file_url}`
        : `${HRMS_API}/api/files/employee-documents/${documentInfo.file_url}`;

      // Fetch with auth header — endpoint requires authentication
      const token = localStorage.getItem("hrms_access_token");
      const resp = await fetch(fileUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
      });
      if (!resp.ok) throw new Error(`Server returned ${resp.status}`);
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      setPreviewUrl(blobUrl);
    } catch (error) {
      console.error("Error loading preview:", error);
      setPreviewUrl(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!documentInfo || !documentInfo.file_url) return;

    try {
      const HRMS_API = (import.meta.env.VITE_HRMS_API_URL || import.meta.env.VITE_API_URL || "http://localhost:5056").replace(/\/$/, "");
      const fileUrl = documentInfo.file_url.startsWith("http") ? documentInfo.file_url
        : documentInfo.file_url.startsWith("/api/") ? `${HRMS_API}${documentInfo.file_url}`
        : `${HRMS_API}/api/files/employee-documents/${documentInfo.file_url}`;
      const token = localStorage.getItem("hrms_access_token");
      const resp = await fetch(fileUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) throw new Error(`Server returned ${resp.status}`);
      const data = await resp.blob();

      const blobUrl = URL.createObjectURL(data);
      const a = window.document.createElement("a");
      a.href = blobUrl;
      a.download = documentInfo.document_name;
      window.document.body.appendChild(a);
      a.click();
      window.document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error("Download error:", error);
    }
  };

  const handleOpenInNewTab = () => {
    if (previewUrl && (previewUrl.startsWith("http://") || previewUrl.startsWith("https://") || previewUrl.startsWith("/"))) {
      window.open(previewUrl, "_blank", "noopener noreferrer");
    }
  };

  if (!documentInfo) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                {documentInfo.document_name}
              </DialogTitle>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Badge variant="secondary">
                  {DOCUMENT_TYPE_LABELS[documentInfo.document_type] || documentInfo.document_type}
                </Badge>
                <span>•</span>
                <span>Uploaded {format(new Date(documentInfo.uploaded_at), "MMM d, yyyy")}</span>
              </div>
            </div>
            <div className="flex gap-2">
              {previewUrl && (
                <Button variant="outline" size="sm" onClick={handleOpenInNewTab}>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open
                </Button>
              )}
              <Button variant="default" size="sm" onClick={handleDownload}>
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 mt-4 border rounded-lg bg-muted/50 overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center h-96">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : previewUrl ? (
            fileType === "pdf" ? (
              <iframe
                src={previewUrl}
                className="w-full h-[60vh]"
                title={documentInfo.document_name}
              />
            ) : fileType === "image" ? (
              <div className="flex items-center justify-center p-4 h-[60vh]">
                <img
                  src={previewUrl}
                  alt={documentInfo.document_name}
                  className="max-w-full max-h-full object-contain"
                />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-96 text-muted-foreground">
                <FileText className="h-16 w-16 mb-4" />
                <p className="text-lg font-medium">Preview not available</p>
                <p className="text-sm">This file type cannot be previewed in the browser.</p>
                <Button variant="outline" className="mt-4" onClick={handleDownload}>
                  <Download className="h-4 w-4 mr-2" />
                  Download to view
                </Button>
              </div>
            )
          ) : (
            <div className="flex flex-col items-center justify-center h-96 text-muted-foreground">
              <FileText className="h-16 w-16 mb-4" />
              <p className="text-lg font-medium">Unable to load preview</p>
              <p className="text-sm">Please try downloading the file instead.</p>
              <Button variant="outline" className="mt-4" onClick={handleDownload}>
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
