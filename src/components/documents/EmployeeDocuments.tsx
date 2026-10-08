import { useState, useRef } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Upload, FileText, Trash2, Download, Loader2, Eye, Clock, CheckCircle2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useEmployeeDocuments, useUploadDocument, useDeleteDocument } from "@/hooks/useEmployeeDocuments";
import { formatISTDate } from "@/lib/utils";
import { DocumentViewerDialog } from "./DocumentViewerDialog";
import { useIsReadOnly } from "@/contexts/AuthContext";
import { apiBaseUrl } from "@/lib/apiBase";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

// Employees uploading to their own record may add only these (the backend enforces it too).
const SELF_SERVICE_TYPES = [
  { value: "pan_card", label: "PAN Card" },
  { value: "aadhaar_card", label: "Aadhaar" },
  { value: "bank_passbook", label: "Bank Passbook" },
  { value: "investment_proof", label: "Investment Proof (tax)" },
  { value: "declaration_form", label: "Tax Declaration" },
];

const DOCUMENT_TYPES = [
  ...SELF_SERVICE_TYPES,
  { value: "id_proof", label: "ID Proof" },
  { value: "resume", label: "Resume" },
  { value: "offer_letter", label: "Offer Letter" },
  { value: "contract", label: "Contract" },
  { value: "form_16", label: "Form 16" },
  { value: "tax_certificate", label: "Tax Certificate" },
  { value: "other", label: "Others" },
];

// Closed checklist statuses: mirrors recalculateDocumentProgress on the server.
const CLOSED_CHECKLIST_STATUSES = new Set([
  "verified", "signed_verified", "completed", "esign_completed", "wet_signed_uploaded", "waived", "not_applicable",
]);

interface PendingItem { id: string; document_name: string; status: string; mandatory: number; owner_type?: string; action_type?: string; verification_remarks?: string | null }

/** Employee view: only what is still pending against their joining checklist, each with an upload slot. */
function PendingDocumentsUploader({ employeeId }: { employeeId: string }) {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["employee-pending-documents", employeeId],
    queryFn: async () => (await hrmsApi.get<{ data: { checklist: PendingItem[] } }>(`/api/employees/${employeeId}/joining-documents`)).data.checklist ?? [],
  });
  const pending = (data ?? []).filter((i) => Number(i.mandatory) === 1 && !CLOSED_CHECKLIST_STATUSES.has(String(i.status ?? "").toLowerCase()));

  const upload = async (item: PendingItem, file: File | undefined) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast.error("File size must not exceed 10 MB."); return; }
    setBusyId(item.id);
    try {
      const form = new FormData();
      form.append("file", file);
      await hrmsApi.postForm(`/api/employees/${employeeId}/joining-documents/checklist/${item.id}/upload`, form);
      toast.success(`${item.document_name} uploaded — HR will review it.`);
      await qc.invalidateQueries({ queryKey: ["employee-pending-documents", employeeId] });
      await qc.invalidateQueries({ queryKey: ["employee-documents", employeeId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusyId(null);
    }
  };

  if (isLoading) return null;
  if (pending.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
        <CheckCircle2 className="h-4 w-4" /> No documents are pending from you.
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50/50 p-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-amber-900"><Clock className="h-4 w-4" /> Pending from you ({pending.length})</p>
      {pending.map((item) => (
        <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded border bg-white p-2">
          <div className="min-w-0">
            <div className="text-sm font-medium">{item.document_name}</div>
            <div className="text-xs text-muted-foreground">
              {String(item.status ?? "pending").replace(/_/g, " ")}{item.verification_remarks ? ` — ${item.verification_remarks}` : ""}
            </div>
          </div>
          <label className="cursor-pointer">
            <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp" disabled={busyId === item.id}
              onChange={(e) => { void upload(item, e.target.files?.[0]); e.target.value = ""; }} />
            <span className="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium hover:bg-slate-50">
              {busyId === item.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Upload className="mr-1 h-3 w-3" />} Upload
            </span>
          </label>
        </div>
      ))}
    </div>
  );
}

interface EmployeeDocumentsProps {
  employeeId: string;
  canUpload?: boolean;
  canDelete?: boolean;
  /** Own-profile upload limited to PAN / Aadhaar / bank passbook (for non-HR employees). */
  selfServiceUpload?: boolean;
}

export function EmployeeDocuments({ employeeId, canUpload = false, canDelete = false, selfServiceUpload = false }: EmployeeDocumentsProps) {
  const showUpload = canUpload || selfServiceUpload;
  const typeOptions = canUpload ? DOCUMENT_TYPES : SELF_SERVICE_TYPES;
  const [selectedType, setSelectedType] = useState<string>(canUpload ? "contract" : "pan_card");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [viewingDocument, setViewingDocument] = useState<{
    id: string;
    document_name: string;
    document_type: string;
    file_url: string;
    uploaded_at: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: documents, isLoading } = useEmployeeDocuments(employeeId);
  const uploadMutation = useUploadDocument();
  const deleteMutation = useDeleteDocument();
  const isReadOnly = useIsReadOnly();

  const ALLOWED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
  const MAX_BYTES = 10 * 1024 * 1024;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_TYPES.has(file.type)) {
      alert("Only PDF, JPEG, PNG, or WebP files are allowed.");
      e.target.value = "";
      return;
    }
    if (file.size > MAX_BYTES) {
      alert("File size must not exceed 10 MB.");
      e.target.value = "";
      return;
    }
    setSelectedFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    await uploadMutation.mutateAsync({
      employeeId,
      file: selectedFile,
      documentType: selectedType,
    });

    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleDownload = async (fileUrl: string, fileName: string) => {
    if (!fileUrl) {
      console.error("Download error: file URL is missing");
      return;
    }
    const HRMS_API = apiBaseUrl();
    // file_url already contains the correct path like /api/files/employee-documents/<filename>
    // Fall back to constructing the URL only if it's a bare filename (legacy records)
    const url = fileUrl.startsWith("http") ? fileUrl
      : fileUrl.startsWith("/api/") ? `${HRMS_API}${fileUrl}`
      : `${HRMS_API}/api/files/employee-documents/${fileUrl}`;
    try {
      const token = localStorage.getItem("hrms_access_token");
      const resp = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) throw new Error(`Server returned ${resp.status}`);
      const data = await resp.blob();
      const blobUrl = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error("Download error:", err);
    }
  };

  const getTypeBadgeVariant = (type: string) => {
    switch (type) {
      case "contract":
        return "default";
      case "id_proof":
        return "secondary";
      case "offer_letter":
        return "secondary";
      case "resume":
        return "outline";
      default:
        return "secondary";
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Documents
        </CardTitle>
        <CardDescription>
          Manage employee documents like ID proof, resumes, offer letters, and contracts
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!canUpload && !isReadOnly && <PendingDocumentsUploader employeeId={employeeId} />}
        {showUpload && !isReadOnly && (
          <div className="flex flex-col sm:flex-row gap-3">
            <Select value={selectedType} onValueChange={setSelectedType}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Document type" />
              </SelectTrigger>
              <SelectContent>
                {typeOptions.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              ref={fileInputRef}
              type="file"
              onChange={handleFileSelect}
              className="flex-1"
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
            />
            <Button
              onClick={handleUpload}
              disabled={!selectedFile || uploadMutation.isPending}
            >
              {uploadMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Upload className="h-4 w-4 mr-2" />
              )}
              Upload
            </Button>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : documents && documents.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Document Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((doc) => (
                <TableRow key={doc.id}>
                  <TableCell className="font-medium">{doc.document_name}</TableCell>
                  <TableCell>
                    <Badge variant={getTypeBadgeVariant(doc.document_type)}>
                      {DOCUMENT_TYPES.find((t) => t.value === doc.document_type)?.label || doc.document_type}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {formatISTDate(doc.uploaded_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {doc.file_url ? (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setViewingDocument(doc)}
                            title="View document"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDownload(doc.file_url, doc.document_name)}
                            title="Download document"
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                        </>
                      ) : (
                        // The server withholds the file from the owner: show review status only.
                        <Badge variant={doc.verified ? "default" : "outline"}>{doc.verified ? "Verified" : "Under review"}</Badge>
                      )}
                      {canDelete && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Document</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete "{doc.document_name}"? This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() =>
                                  deleteMutation.mutate({
                                    documentId: doc.id,
                                    fileUrl: doc.file_url,
                                    employeeId,
                                  })
                                }
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            No documents uploaded yet
          </div>
        )}
      </CardContent>

      {/* Document Viewer Dialog */}
      <DocumentViewerDialog
        open={!!viewingDocument}
        onOpenChange={(open) => !open && setViewingDocument(null)}
        documentInfo={viewingDocument}
      />
    </Card>
  );
}
