import { useRef, useState } from "react";
import { FileSpreadsheet, Upload, Download, CheckCircle2, AlertTriangle, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { hrmsApi } from "@/lib/hrmsApi";

// ── Types ────────────────────────────────────────────────────────────────────

export type PnlUploadType =
  | "monthly_plan"
  | "revenue_rules"
  | "contracts"
  | "rate_cards"
  | "delivery_actuals"
  | "revenue_components"
  | "cost_components"
  | "classification_rules";

interface UploadTypeMeta {
  label: string;
  columns: string[];
  fieldMap: Record<string, string>; // header → API field name
}

// ── Column definitions ────────────────────────────────────────────────────────

const UPLOAD_TYPES: Record<PnlUploadType, UploadTypeMeta> = {
  monthly_plan: {
    label: "Monthly Operating Plan",
    columns: [
      "Process ID",
      "Period (YYYY-MM)",
      "Contracted Seats",
      "Productive HC",
      "Roster HC",
      "Shrinkage %",
      "Buffer %",
      "Revenue Budget",
      "Direct Cost Budget",
      "Indirect Cost Budget",
      "Profit Budget",
    ],
    fieldMap: {
      "Process ID": "processId",
      "Period (YYYY-MM)": "period",
      "Contracted Seats": "contractedSeats",
      "Productive HC": "requiredProductiveHc",
      "Roster HC": "requiredRosterHc",
      "Shrinkage %": "plannedShrinkagePct",
      "Buffer %": "bufferTargetPct",
      "Revenue Budget": "revenueBudget",
      "Direct Cost Budget": "directCostBudget",
      "Indirect Cost Budget": "indirectCostBudget",
      "Profit Budget": "profitBudget",
    },
  },
  revenue_rules: {
    label: "Revenue Rules",
    columns: [
      "Process ID",
      "Rule Name",
      "Billing Model",
      "Metric Key",
      "Rate",
      "Currency",
      "FX to INR",
      "Monthly Minimum",
      "Included Units",
      "Overage Rate",
      "Mandated Seats",
      "Quality Gate %",
      "SLA Gate %",
      "Effective From",
    ],
    fieldMap: {
      "Process ID": "processId",
      "Rule Name": "ruleName",
      "Billing Model": "billingModel",
      "Metric Key": "metricKey",
      "Rate": "rate",
      "Currency": "currency",
      "FX to INR": "fxToInr",
      "Monthly Minimum": "monthlyMinimum",
      "Included Units": "includedUnits",
      "Overage Rate": "overageRate",
      "Mandated Seats": "mandatedSeats",
      "Quality Gate %": "qualityGatePct",
      "SLA Gate %": "slaGatePct",
      "Effective From": "effectiveFrom",
    },
  },
  contracts: {
    label: "Contracts",
    columns: [
      "Process ID",
      "Client ID",
      "Contract Name",
      "Billing Type",
      "Base Rate",
      "Currency",
      "Monthly Minimum",
      "Effective From",
    ],
    fieldMap: {
      "Process ID": "processId",
      "Client ID": "clientId",
      "Contract Name": "contractName",
      "Billing Type": "billingType",
      "Base Rate": "baseRate",
      "Currency": "currency",
      "Monthly Minimum": "monthlyMinimum",
      "Effective From": "effectiveFrom",
    },
  },
  rate_cards: {
    label: "Rate Cards",
    columns: [
      "Process ID",
      "Contract ID",
      "Rate Type",
      "Amount",
      "Unit",
      "Effective From",
    ],
    fieldMap: {
      "Process ID": "processId",
      "Contract ID": "contractId",
      "Rate Type": "rateType",
      "Amount": "rateAmount",
      "Unit": "unit",
      "Effective From": "effectiveFrom",
    },
  },
  delivery_actuals: {
    label: "Delivery Actuals",
    columns: [
      "Process ID",
      "Period (YYYY-MM)",
      "Activity Date",
      "Metric Key",
      "Planned Units",
      "Delivered Units",
      "Accepted Units",
      "Rejected Units",
      "Billable Units",
      "Productive Hours",
      "Login Hours",
      "Talk Minutes",
      "Quality %",
      "SLA %",
    ],
    fieldMap: {
      "Process ID": "processId",
      "Period (YYYY-MM)": "period",
      "Activity Date": "activityDate",
      "Metric Key": "metricKey",
      "Planned Units": "plannedUnits",
      "Delivered Units": "deliveredUnits",
      "Accepted Units": "acceptedUnits",
      "Rejected Units": "rejectedUnits",
      "Billable Units": "billableUnits",
      "Productive Hours": "productiveHours",
      "Login Hours": "loginHours",
      "Talk Minutes": "talkMinutes",
      "Quality %": "qualityScore",
      "SLA %": "slaScore",
    },
  },
  revenue_components: {
    label: "Revenue Components",
    columns: [
      "Process ID",
      "Period (YYYY-MM)",
      "Component Type",
      "Direction",
      "Description",
      "Amount INR",
      "Recognition Date",
      "Invoice Reference",
    ],
    fieldMap: {
      "Process ID": "processId",
      "Period (YYYY-MM)": "period",
      "Component Type": "componentType",
      "Direction": "direction",
      "Description": "description",
      "Amount INR": "amountInr",
      "Recognition Date": "recognitionDate",
      "Invoice Reference": "invoiceReference",
    },
  },
  cost_components: {
    label: "Cost Components",
    columns: [
      "Process ID",
      "Branch ID",
      "Cost Type",
      "Period (YYYY-MM)",
      "Description",
      "Amount INR",
      "Allocation Driver",
      "Manual Allocation %",
    ],
    fieldMap: {
      "Process ID": "processId",
      "Branch ID": "branchId",
      "Cost Type": "costType",
      "Period (YYYY-MM)": "period",
      "Description": "description",
      "Amount INR": "amountInr",
      "Allocation Driver": "allocationDriver",
      "Manual Allocation %": "manualAllocationPct",
    },
  },
  classification_rules: {
    label: "Classification Rules",
    columns: [
      "Rule Name",
      "Scope Type",
      "Scope Key",
      "Process ID",
      "Branch ID",
      "P&L Bucket",
      "Priority",
      "Effective From",
      "Effective To",
    ],
    fieldMap: {
      "Rule Name": "ruleName",
      "Scope Type": "scopeType",
      "Scope Key": "scopeKey",
      "Process ID": "processId",
      "Branch ID": "branchId",
      "P&L Bucket": "pnlBucket",
      "Priority": "priority",
      "Effective From": "effectiveFrom",
      "Effective To": "effectiveTo",
    },
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function mapRow(raw: Record<string, unknown>, fieldMap: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [header, field] of Object.entries(fieldMap)) {
    const val = raw[header];
    out[field] = val === "" || val === undefined ? null : val;
  }
  return out;
}

async function downloadTemplate(type: PnlUploadType) {
  const meta = UPLOAD_TYPES[type];
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet([meta.columns]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, meta.label.slice(0, 31));
  XLSX.writeFile(wb, `pnl-${type}-template.xlsx`);
}

async function parseFile(file: File): Promise<Record<string, unknown>[]> {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("File has no sheets");
  const ws = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
}

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

type Step = "select" | "preview" | "result";

interface RowError { row: number; message: string }

export function PnlBulkUploadDialog({ open, onOpenChange, onSuccess }: Props) {
  const [step, setStep] = useState<Step>("select");
  const [uploadType, setUploadType] = useState<PnlUploadType>("monthly_plan");
  const [parsedRows, setParsedRows] = useState<Record<string, unknown>[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ imported: number; errors: RowError[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const meta = UPLOAD_TYPES[uploadType];

  function reset() {
    setStep("select");
    setParsedRows([]);
    setParseError(null);
    setFileName(null);
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleClose(v: boolean) {
    if (!v) reset();
    onOpenChange(v);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParseError(null);
    setParsedRows([]);
    try {
      const raw = await parseFile(file);
      if (raw.length === 0) {
        setParseError("File is empty or has no data rows.");
        return;
      }
      const mapped = raw.map((r) => mapRow(r, meta.fieldMap));
      setParsedRows(mapped);
      setStep("preview");
    } catch (err: unknown) {
      setParseError(err instanceof Error ? err.message : "Could not parse file.");
    }
  }

  async function handleImport() {
    if (parsedRows.length === 0) return;
    setSubmitting(true);
    try {
      const res = await hrmsApi.post("/finance/pnl/bulk-upload", {
        type: uploadType,
        rows: parsedRows,
      });
      const data = res.data as { imported: number; errors: RowError[] };
      setResult(data);
      setStep("result");
      if (data.imported > 0) {
        toast.success(`Imported ${data.imported} row${data.imported !== 1 ? "s" : ""}`);
        onSuccess();
      }
    } catch (err: unknown) {
      const msg =
        (err as any)?.response?.data?.error ??
        (err instanceof Error ? err.message : "Upload failed");
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const previewCols = meta.columns.slice(0, 6); // show first 6 cols in preview table

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold text-slate-800">
            <FileSpreadsheet className="h-5 w-5 text-sky-500" />
            Bulk Upload — P&L Configuration
          </DialogTitle>
        </DialogHeader>

        {/* Step indicators */}
        <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
          {(["select", "preview", "result"] as Step[]).map((s, i) => (
            <span key={s} className="flex items-center gap-1">
              {i > 0 && <span className="text-slate-300">›</span>}
              <span className={step === s ? "font-semibold text-sky-600" : ""}>
                {i + 1}. {s === "select" ? "Select & Download" : s === "preview" ? "Preview" : "Result"}
              </span>
            </span>
          ))}
        </div>

        {/* ── Step 1: Select type + download template ── */}
        {step === "select" && (
          <div className="space-y-5">
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                Upload Type
              </Label>
              <select
                className="flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                value={uploadType}
                onChange={(e) => {
                  setUploadType(e.target.value as PnlUploadType);
                  setParsedRows([]);
                  setParseError(null);
                  setFileName(null);
                  if (fileRef.current) fileRef.current.value = "";
                }}
              >
                {(Object.keys(UPLOAD_TYPES) as PnlUploadType[]).map((t) => (
                  <option key={t} value={t}>
                    {UPLOAD_TYPES[t].label}
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 space-y-3">
              <p className="text-xs text-slate-500 leading-5">
                Download the template, fill it in, then upload it below.
                Required columns for <strong>{meta.label}</strong>:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {meta.columns.map((c) => (
                  <Badge key={c} variant="outline" className="text-xs font-normal">
                    {c}
                  </Badge>
                ))}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                onClick={() => downloadTemplate(uploadType)}
              >
                <Download className="h-4 w-4" />
                Download Template (.xlsx)
              </Button>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                Upload File
              </Label>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="block w-full cursor-pointer rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none file:mr-3 file:rounded-lg file:border-0 file:bg-sky-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-sky-700 hover:file:bg-sky-100"
                onChange={handleFileChange}
              />
              {fileName && !parseError && parsedRows.length === 0 && (
                <p className="text-xs text-slate-500">Parsing {fileName}…</p>
              )}
              {parseError && (
                <p className="flex items-center gap-1.5 text-xs text-red-600">
                  <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                  {parseError}
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Step 2: Preview ── */}
        {step === "preview" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-700">
                <span className="font-semibold">{parsedRows.length}</span> row
                {parsedRows.length !== 1 ? "s" : ""} parsed from{" "}
                <span className="font-medium">{fileName}</span>
              </p>
              <Button size="sm" variant="ghost" className="gap-1.5 text-xs" onClick={reset}>
                <X className="h-3.5 w-3.5" />
                Change file
              </Button>
            </div>

            <div className="overflow-auto rounded-xl border border-slate-200 max-h-64">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-slate-500 w-12">#</th>
                    {previewCols.map((c) => (
                      <th key={c} className="px-3 py-2 text-left font-semibold text-slate-500 whitespace-nowrap">
                        {c}
                      </th>
                    ))}
                    {meta.columns.length > 6 && (
                      <th className="px-3 py-2 text-left font-semibold text-slate-400">
                        +{meta.columns.length - 6} more cols
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {parsedRows.slice(0, 20).map((row, i) => (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="px-3 py-1.5 text-slate-400">{i + 2}</td>
                      {previewCols.map((c) => {
                        const field = meta.fieldMap[c];
                        const val = row[field];
                        return (
                          <td key={c} className="px-3 py-1.5 text-slate-700 whitespace-nowrap max-w-[160px] truncate">
                            {val === null || val === undefined || val === "" ? (
                              <span className="text-slate-300">—</span>
                            ) : (
                              String(val)
                            )}
                          </td>
                        );
                      })}
                      {meta.columns.length > 6 && <td className="px-3 py-1.5 text-slate-300">…</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsedRows.length > 20 && (
                <p className="px-3 py-2 text-xs text-slate-400 bg-slate-50 border-t border-slate-100">
                  Showing first 20 of {parsedRows.length} rows
                </p>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-1">
              <Button variant="outline" size="sm" onClick={reset}>
                Back
              </Button>
              <Button
                size="sm"
                className="gap-2 bg-sky-600 hover:bg-sky-700 text-white"
                disabled={submitting}
                onClick={handleImport}
              >
                <Upload className="h-4 w-4" />
                {submitting ? "Importing…" : `Import ${parsedRows.length} rows`}
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 3: Result ── */}
        {step === "result" && result && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4">
              {result.imported > 0 ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-500 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
              )}
              <div>
                <p className="text-sm font-semibold text-slate-800">
                  {result.imported > 0
                    ? `${result.imported} row${result.imported !== 1 ? "s" : ""} imported successfully`
                    : "No rows were imported"}
                </p>
                {result.errors.length > 0 && (
                  <p className="text-xs text-slate-500 mt-0.5">
                    {result.errors.length} row{result.errors.length !== 1 ? "s" : ""} had errors
                  </p>
                )}
              </div>
            </div>

            {result.errors.length > 0 && (
              <div className="overflow-auto rounded-xl border border-red-100 max-h-48">
                <table className="min-w-full text-xs">
                  <thead className="bg-red-50 border-b border-red-100 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-red-600">Row</th>
                      <th className="px-3 py-2 text-left font-semibold text-red-600">Error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-red-50">
                    {result.errors.map((e, i) => (
                      <tr key={i}>
                        <td className="px-3 py-1.5 text-slate-500 w-16">{e.row}</td>
                        <td className="px-3 py-1.5 text-red-700">{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex justify-end gap-3">
              <Button variant="outline" size="sm" onClick={reset}>
                Upload Another File
              </Button>
              <Button size="sm" onClick={() => handleClose(false)}>
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
