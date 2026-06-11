import { useState } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
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
import { Download, FileText, Files, Eye } from "lucide-react";
import { format } from "date-fns";
import { DocumentViewerDialog } from "@/components/documents/DocumentViewerDialog";

interface TaxDocumentsViewerProps {
  employeeId: string;
}

const TAX_DOCUMENT_TYPES = ["W-2", "1099", "Tax Statement", "Tax Certificate"];

export function TaxDocumentsViewer({ employeeId }: TaxDocumentsViewerProps) {
  const [viewingDocument, setViewingDocument] = useState<{
    id: string;
    document_name: string;
    document_type: string;
    file_url: string;
    uploaded_at: string;
  } | null>(null);

  // Fetch tax-related documents for the employee
  const { data: documents, isLoading } = useQuery({
    queryKey: ["my-tax-documents", employeeId],
    queryFn: async () => {
      const res = await hrmsApi.get<{success:boolean;data:any}>("/api/employee-docs");
      return res.data ?? [];
    },
    enabled: !!employeeId,
  });

  const handleDownload = async (fileUrl: string, fileName: string) => {
    try {
      // Extract the path from the full URL if needed
      const pathMatch = fileUrl.match(/employee-documents\/(.+)/);
      const filePath = pathMatch ? pathMatch[1] : fileUrl;

      const HRMS_API = import.meta.env.VITE_HRMS_API_URL || "http://localhost:5055";
      const url = filePath?.startsWith("https://") ? filePath : `${HRMS_API}/api/files/documents/${filePath}`;
      const resp = await fetch(url);
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

        {/* Document Types Legend */}
        <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span className="font-medium">Available document types:</span>
          {TAX_DOCUMENT_TYPES.map((type) => (
            <Badge key={type} variant="outline" className={getDocumentBadgeColor(type)}>
              {type}
            </Badge>
          ))}
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
