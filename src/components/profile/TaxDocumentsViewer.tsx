import { useState } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { apiBaseUrl } from "@/lib/apiBase";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, FileText, Files, Eye, Upload, Loader } from "lucide-react";
import { format } from "date-fns";
import { DocumentViewerDialog } from "@/components/documents/DocumentViewerDialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface TaxDocumentsViewerProps {
  employeeId: string;
}

const TAX_DOCUMENT_TYPES = ["form_16", "investment_proof", "tax_certificate", "declaration_form"];

export function TaxDocumentsViewer({ employeeId }: TaxDocumentsViewerProps) {
  const [viewingDocument, setViewingDocument] = useState<{
    id: string;
    document_name: string;
    document_type: string;
    file_url: string;
    uploaded_at: string;
  } | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState<string>("");
  const [uploading, setUploading] = useState(false);

  // Fetch tax-related documents for the employee
  const { data: documents, isLoading } = useQuery({
    queryKey: ["my-tax-documents", employeeId],
    queryFn: async () => {
      const res = await hrmsApi.get<{success:boolean;data:any}>(`/api/employee-docs/${employeeId}`);
      return res.data ?? [];
    },
    enabled: !!employeeId,
  });

  const handleDownload = async (fileUrl: string, fileName: string) => {
    try {
      // Extract the path from the full URL if needed
      const pathMatch = fileUrl.match(/employee-documents\/(.+)/);
      const filePath = pathMatch ? pathMatch[1] : fileUrl;

      const HRMS_API = apiBaseUrl();
      const fetchUrl = filePath?.startsWith("https://") ? filePath : `${HRMS_API}/api/files/documents/${filePath}`;
      const resp = await fetch(fetchUrl);
      const data = await resp.blob();

      // Create download link
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Download error:", error);
    }
  };

  const getDocumentBadgeColor = (type: string) => {
    switch (type) {
      case "W-2":
        return "bg-blue-500/10 text-blue-600 border-blue-500/20";
      case "1099":
        return "bg-purple-500/10 text-purple-600 border-purple-500/20";
      case "Tax Statement":
        return "bg-green-500/10 text-green-600 border-green-500/20";
      case "Tax Certificate":
        return "bg-orange-500/10 text-orange-600 border-orange-500/20";
      default:
        return "";
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Files className="h-5 w-5 text-primary" />
          <div>
            <CardTitle>Tax Documents</CardTitle>
            <CardDescription>Download your tax-related documents</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : documents && documents.length > 0 ? (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{doc.document_name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={getDocumentBadgeColor(doc.document_type)}>
                        {doc.document_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {format(new Date(doc.uploaded_at), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setViewingDocument(doc)}
                          title="View document"
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          View
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDownload(doc.file_url, doc.document_name)}
                          title="Download document"
                        >
                          <Download className="h-4 w-4 mr-1" />
                          Download
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Files className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">No Tax Documents</p>
            <p className="text-sm text-muted-foreground">
              No tax documents have been uploaded yet. Contact HR for assistance.
            </p>
          </div>
        )}

        {/* Upload Section */}
        <div className="mt-6 pt-6 border-t">
          <h3 className="font-medium mb-4">Upload Tax Document</h3>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Select value={documentType} onValueChange={setDocumentType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select document type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="form_16">Form 16</SelectItem>
                  <SelectItem value="investment_proof">Investment Proof</SelectItem>
                  <SelectItem value="tax_certificate">Tax Certificate</SelectItem>
                  <SelectItem value="declaration_form">Declaration Form</SelectItem>
                </SelectContent>
              </Select>
              <input
                type="file"
                id="tax-file-input"
                className="hidden"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
              />
              <Button
                variant="outline"
                onClick={() => document.getElementById("tax-file-input")?.click()}
                className="justify-start"
              >
                <Upload className="h-4 w-4 mr-2" />
                {selectedFile ? selectedFile.name : "Choose file"}
              </Button>
              <Button
                onClick={async () => {
                  if (!selectedFile || !documentType) {
                    alert("Please select both document type and file");
                    return;
                  }
                  const formData = new FormData();
                  formData.append("file", selectedFile);
                  formData.append("documentType", documentType);
                  setUploading(true);
                  try {
                    await hrmsApi.post(`/api/employee-docs/${employeeId}/upload`, formData, {
                      headers: { "Content-Type": "multipart/form-data" },
                    });
                    setSelectedFile(null);
                    setDocumentType("");
                    alert("Document uploaded successfully");
                  } catch (error) {
                    alert("Upload failed");
                    console.error(error);
                  } finally {
                    setUploading(false);
                  }
                }}
                disabled={!selectedFile || !documentType || uploading}
              >
                {uploading ? <Loader className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                {uploading ? "Uploading..." : "Upload"}
              </Button>
            </div>
          </div>
        </div>

        {/* Document Viewer Dialog */}
        <DocumentViewerDialog
          open={!!viewingDocument}
          onOpenChange={(open) => !open && setViewingDocument(null)}
          documentInfo={viewingDocument}
        />
      </CardContent>
    </Card>
  );
}
