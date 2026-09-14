import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { hrmsApi } from "@/lib/hrmsApi";
import { Download, AlertTriangle, Info, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Establishment {
  id: string;
  establishment_code: string;
  establishment_name: string;
}
interface EstablishmentsResponse {
  success: boolean;
  data: Establishment[];
}

function getISTMonth(): string {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function EcrDownloadTab() {
  const [month, setMonth] = useState(getISTMonth());
  const [establishmentId, setEstablishmentId] = useState("");
  const [downloading, setDownloading] = useState(false);
  const { toast } = useToast();

  const { data: estResp, isLoading: estLoading } = useQuery<EstablishmentsResponse>({
    queryKey: ["pf-establishments"],
    queryFn: () => hrmsApi.get<EstablishmentsResponse>("/api/payroll/pf/establishments"),
    staleTime: 10 * 60 * 1000,
  });
  const establishments = estResp?.data ?? [];

  const downloadPath = establishmentId && month
    ? `/api/payroll/pf/ecr-monthly?month=${month}&establishmentId=${establishmentId}`
    : null;

  const selectedEst = establishments.find((e) => e.id === establishmentId);

  const handleDownload = async () => {
    if (!downloadPath || !selectedEst) return;
    setDownloading(true);
    try {
      const blob = await hrmsApi.getBlob(downloadPath);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ECR_${selectedEst.establishment_code}_${month.replace("-", "")}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      // getBlob throws the raw response body text on a non-2xx response — this route returns a
      // JSON error envelope, so pull out the real message (e.g. "No finalised salary run found
      // for 2026-07") instead of leaving the user with a downloaded error page or nothing at all,
      // which the old <a href download> silently did on 401/409.
      let message = "Failed to download ECR file.";
      try {
        const parsed = JSON.parse(e?.message ?? "");
        message = parsed?.message ?? parsed?.error ?? message;
      } catch {
        if (e?.message) message = e.message;
      }
      toast({ variant: "destructive", title: "ECR download failed", description: message });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Info banner */}
      <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
        <Info className="h-5 w-5 text-blue-500 mt-0.5 shrink-0" />
        <div className="text-sm text-blue-800">
          <p className="font-medium">EPFO ECR2 Monthly Contribution File</p>
          <p className="mt-0.5 text-blue-700">
            Downloads the Electronic Challan cum Return (ECR2) text file for upload to the EPFO
            Unified Portal. Requires a finalised salary run for the selected month.
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Wage Month <span className="text-red-500">*</span></Label>
          <Input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-full"
          />
        </div>

        <div className="space-y-1.5">
          <Label>PF Establishment <span className="text-red-500">*</span></Label>
          <Select
            value={establishmentId}
            onValueChange={setEstablishmentId}
            disabled={estLoading || establishments.length === 0}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={
                  estLoading ? "Loading…" :
                  establishments.length === 0 ? "No establishments configured" :
                  "Select establishment…"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {establishments.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.establishment_code} — {e.establishment_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Selected establishment details */}
      {selectedEst && (
        <div className="rounded-lg border bg-slate-50 px-4 py-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-700">{selectedEst.establishment_name}</span>
            <Badge variant="outline" className="text-xs">{selectedEst.establishment_code}</Badge>
          </div>
          <p className="text-slate-500 mt-0.5 text-xs">
            File will be named: ECR_{selectedEst.establishment_code}_{month.replace("-", "")}.txt
          </p>
        </div>
      )}

      {/* Download button */}
      {downloadPath ? (
        <Button
          onClick={handleDownload}
          disabled={downloading}
          className="gap-2 bg-emerald-600 hover:bg-emerald-700"
        >
          {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {downloading ? "Downloading…" : `Download ECR File — ${month}`}
        </Button>
      ) : (
        <Button disabled className="gap-2">
          <Download className="h-4 w-4" />
          Select month and establishment first
        </Button>
      )}

      {/* Format reminder */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
        <div className="flex items-center gap-2 text-amber-800 text-sm font-medium mb-1">
          <AlertTriangle className="h-4 w-4" />
          Before uploading to EPFO Portal
        </div>
        <ul className="text-xs text-amber-700 space-y-0.5 list-disc list-inside">
          <li>Verify the employee count matches the payroll run headcount.</li>
          <li>Confirm the wage month matches the challan payment period.</li>
          <li>Upload at: <span className="font-mono">https://unifiedportal-emp.epfindia.gov.in/</span></li>
        </ul>
      </div>
    </div>
  );
}
