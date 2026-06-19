import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { hrmsApi } from "@/lib/hrmsApi";
import { Upload, FileSpreadsheet, Table2, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

interface QualityDataUploadProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

type SourceType = "excel" | "google_sheet" | "database";

export function QualityDataUpload({ open, onOpenChange, onSuccess }: QualityDataUploadProps) {
  const [sourceType, setSourceType] = useState<SourceType>("excel");
  const [processName, setProcessName] = useState("");
  const [loading, setLoading] = useState(false);

  // Excel upload
  const [file, setFile] = useState<File | null>(null);

  // Google Sheets
  const [sheetId, setSheetId] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [credentialsFile, setCredentialsFile] = useState<File | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (sourceType === "excel" && !selectedFile.name.endsWith('.xlsx') && !selectedFile.name.endsWith('.xls')) {
        toast.error("Please upload an Excel file (.xlsx or .xls)");
        return;
      }
      if (sourceType === "google_sheet" && !selectedFile.name.endsWith('.json')) {
        toast.error("Please upload a Google credentials JSON file");
        return;
      }
      setFile(selectedFile);
    }
  };

  const handleExcelUpload = async () => {
    if (!file || !processName) {
      toast.error("Please select a file and enter process name");
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('process_name', processName);

      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/performance-feedback/quality/upload`, {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });

      const result = await response.json();

      if (result.success) {
        toast.success(`Uploaded ${result.records} quality records successfully!`);
        onSuccess?.();
        handleClose();
      } else {
        toast.error(result.message || "Upload failed");
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to upload Excel file");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSheetsConnect = async () => {
    if (!sheetId || !sheetName || !credentialsFile || !processName) {
      toast.error("Please fill in all Google Sheets fields");
      return;
    }

    setLoading(true);
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const credentialsJson = e.target?.result as string;

        const response = await hrmsApi.post('/api/performance-feedback/quality/connect-sheet', {
          sheet_id: sheetId,
          sheet_name: sheetName,
          credentials: credentialsJson,
          process_name: processName
        });

        if (response.success) {
          toast.success("Connected to Google Sheet successfully!");
          onSuccess?.();
          handleClose();
        } else {
          toast.error(response.message || "Connection failed");
        }
      };
      reader.readAsText(credentialsFile);
    } catch (error: any) {
      toast.error(error.message || "Failed to connect to Google Sheet");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = () => {
    if (sourceType === "excel") {
      handleExcelUpload();
    } else if (sourceType === "google_sheet") {
      handleGoogleSheetsConnect();
    }
  };

  const handleClose = () => {
    setSourceType("excel");
    setProcessName("");
    setFile(null);
    setSheetId("");
    setSheetName("");
    setCredentialsFile(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-blue-600" />
            Upload Quality Data
          </DialogTitle>
          <DialogDescription>
            Import quality assessment data from Excel files or Google Sheets
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Source Type */}
          <div className="space-y-2">
            <Label>Data Source</Label>
            <Select value={sourceType} onValueChange={(v) => setSourceType(v as SourceType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="excel">
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet className="h-4 w-4" />
                    Excel File (.xlsx)
                  </div>
                </SelectItem>
                <SelectItem value="google_sheet">
                  <div className="flex items-center gap-2">
                    <Table2 className="h-4 w-4" />
                    Google Sheets
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Process Name */}
          <div className="space-y-2">
            <Label htmlFor="process">Process/Campaign Name *</Label>
            <Input
              id="process"
              placeholder="e.g., Bellavita IN, GNC Inbound, Clovia Support"
              value={processName}
              onChange={(e) => setProcessName(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              This helps identify which process this quality data belongs to
            </p>
          </div>

          {/* Excel Upload */}
          {sourceType === "excel" && (
            <div className="space-y-2">
              <Label htmlFor="file">Excel File *</Label>
              <Input
                id="file"
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileChange}
              />
              {file && (
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <CheckCircle2 className="h-4 w-4" />
                  {file.name}
                </div>
              )}
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  <strong>Expected columns:</strong><br />
                  Employee_Code, Call_Date, Quality_Score, Total_Score, Max_Score, Parameter_Name, Parameter_Pass
                </AlertDescription>
              </Alert>
            </div>
          )}

          {/* Google Sheets */}
          {sourceType === "google_sheet" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="sheetId">Google Sheet ID *</Label>
                <Input
                  id="sheetId"
                  placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
                  value={sheetId}
                  onChange={(e) => setSheetId(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Found in the sheet URL: docs.google.com/spreadsheets/d/<strong>[SHEET_ID]</strong>/edit
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="sheetName">Sheet Name *</Label>
                <Input
                  id="sheetName"
                  placeholder="Sheet1"
                  value={sheetName}
                  onChange={(e) => setSheetName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="credentials">Service Account Credentials *</Label>
                <Input
                  id="credentials"
                  type="file"
                  accept=".json"
                  onChange={(e) => setCredentialsFile(e.target.files?.[0] || null)}
                />
                {credentialsFile && (
                  <div className="flex items-center gap-2 text-sm text-green-600">
                    <CheckCircle2 className="h-4 w-4" />
                    {credentialsFile.name}
                  </div>
                )}
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    <strong>How to get credentials:</strong><br />
                    1. Go to Google Cloud Console<br />
                    2. Create a Service Account<br />
                    3. Download JSON credentials<br />
                    4. Share your Google Sheet with the service account email
                  </AlertDescription>
                </Alert>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {sourceType === "excel" ? "Uploading..." : "Connecting..."}
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                {sourceType === "excel" ? "Upload File" : "Connect Sheet"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
