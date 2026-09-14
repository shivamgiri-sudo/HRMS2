import { useState, useRef } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Upload, FileText, Trash2, Download, Loader2, Eye } from "lucide-react";
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

const DOCUMENT_TYPES = [
  { value: "id_proof", label: "ID Proof" },
  { value: "resume", label: "Resume" },
  { value: "offer_letter", label: "Offer Letter" },
  { value: "contract", label: "Contract" },
  { value: "other", label: "Others" },
];

interface EmployeeDocumentsProps {
  employeeId: string;
  canUpload?: boolean;
  canDelete?: boolean;
}

export function EmployeeDocuments({ employeeId, canUpload = false, canDelete = false }: EmployeeDocumentsProps) {
  const [selectedType, setSelectedType] = useState<string>("contract");
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
        {canUpload && !isReadOnly && (
          <div className="flex flex-col sm:flex-row gap-3">
            <Select value={selectedType} onValueChange={setSelectedType}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Document type" />
              </SelectTrigger>
              <SelectContent>
                {DOCUMENT_TYPES.map((type) => (
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
