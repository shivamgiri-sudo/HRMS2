import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardPaste, Download, FileSpreadsheet, Upload, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type {
  BranchBudgetLineInput,
  BudgetAttributionScope,
  BudgetGstType,
  BudgetTaxTreatment,
  ManualAllocationInput,
} from "@/hooks/useBranchBudget";

// ── Column template ─────────────────────────────────────────────────────────

const COLUMNS = [
  "Head",
  "Sub-head",
  "Item / Service",
  "Description",
  "Quantity",
  "Unit",
  "Unit Rate",
  "Tax Treatment",
  "GST Rate",
  "GST Type",
  "Recoverable GST %",
  "Attribution Scope",
  "Cost Centre Code",
  "Process Name",
  "Sharing Method",
  "Manual Allocations",
  "Preferred Vendor Code",
  "Business Justification",
] as const;

const REQUIRED_COLUMNS = new Set([
  "Head",
  "Item / Service",
  "Quantity",
  "Unit",
  "Unit Rate",
  "Tax Treatment",
  "GST Rate",
  "Attribution Scope",
  "Business Justification",
]);

const TAX_TREATMENTS: BudgetTaxTreatment[] = ["exclusive", "inclusive", "exempt", "reverse_charge", "non_gst"];
const GST_TYPES: BudgetGstType[] = ["cgst_sgst", "igst", "none"];
const ATTRIBUTION_SCOPES: BudgetAttributionScope[] = ["branch_common", "cost_centre", "process"];
const SHARING_METHODS = ["total_manpower", "agent_headcount", "revenue_share", "equal_split", "manual", "meter_wise"];

/** Drivers offered for cost-centre / process attributed lines (mirrors ALLOCATION_DRIVERS in
 *  BranchBudgetManagementWorkspace). These lines are attributed whole rather than split, but the
 *  workspace still requires a driver on every line, so imported ones must carry one too. */
const DIRECT_ALLOCATION_DRIVERS = [
  "agent_headcount", "total_manpower", "revenue_share", "seat_count", "device_count",
  "floor_area", "usage_units", "hiring_volume", "direct_tagging",
];
const DEFAULT_DIRECT_DRIVER = "direct_tagging";

// ── Parsing helpers ──────────────────────────────────────────────────────────

async function downloadTemplate() {
  const XLSX = await import("xlsx");
  const example = [
    "Facilities", "Rent", "Office rent", "Monthly office rent", "1", "Month", "50000",
    "exclusive", "18", "cgst_sgst", "100", "branch_common", "", "", "equal_split", "",
    "", "Standard monthly rent as per lease agreement",
  ];
  const ws = XLSX.utils.aoa_to_sheet([[...COLUMNS], example]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Budget lines");
  XLSX.writeFile(wb, "branch-budget-lines-template.xlsx");
}

async function parseFile(file: File): Promise<Record<string, unknown>[]> {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("File has no sheets");
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: "" });
}

/** Parses a block of text copied from Excel (tab-separated, first line = headers). */
export function parsePastedText(text: string): Record<string, unknown>[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) throw new Error("Paste at least a header row and one data row");
  const headers = lines[0].split("\t").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    const row: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? "";
    });
    return row;
  });
}

function str(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function num(value: unknown): number {
  const n = Number(String(value ?? "").trim());
  return Number.isFinite(n) ? n : NaN;
}

// ── Row resolution (mirrors validateLines() in BranchBudgetManagementWorkspace.tsx
//    and the server's validateLine/validateAttribution in branch-budget.service.ts) ──

export interface LookupOption {
  id: string;
  code?: string | null;
  name: string;
}

export interface ResolvedRow {
  rowNumber: number;
  line: BranchBudgetLineInput | null;
  error: string | null;
}

function findByCodeOrName(options: LookupOption[], query: string): LookupOption | undefined {
  const needle = query.trim().toLowerCase();
  return options.find(
    (o) => (o.code ?? "").toLowerCase() === needle || o.name.toLowerCase() === needle
  );
}

export function resolveRow(
  raw: Record<string, unknown>,
  rowNumber: number,
  lookups: { costCentres: LookupOption[]; processes: LookupOption[]; vendors: LookupOption[] }
): ResolvedRow {
  const fail = (message: string): ResolvedRow => ({ rowNumber, line: null, error: message });

  for (const column of REQUIRED_COLUMNS) {
    if (!str(raw[column])) return fail(`"${column}" is required`);
  }

  const head = str(raw["Head"]);
  const subHead = str(raw["Sub-head"]) || null;
  const itemName = str(raw["Item / Service"]);
  const itemDescription = str(raw["Description"]) || null;
  const quantity = num(raw["Quantity"]);
  if (!(quantity > 0)) return fail("Quantity must be greater than zero");
  const unit = str(raw["Unit"]);
  const unitRate = num(raw["Unit Rate"]);
  if (!(unitRate >= 0)) return fail("Unit rate cannot be negative");

  const taxTreatment = str(raw["Tax Treatment"]).toLowerCase() as BudgetTaxTreatment;
  if (!TAX_TREATMENTS.includes(taxTreatment)) {
    return fail(`Tax Treatment must be one of: ${TAX_TREATMENTS.join(", ")}`);
  }
  const gstRate = num(raw["GST Rate"]);
  if (!(gstRate >= 0 && gstRate <= 100)) return fail("GST Rate must be between 0 and 100");
  const gstTypeRaw = str(raw["GST Type"]).toLowerCase();
  const gstType: BudgetGstType = (GST_TYPES as string[]).includes(gstTypeRaw) ? (gstTypeRaw as BudgetGstType) : "cgst_sgst";
  const recoverableTaxPctRaw = raw["Recoverable GST %"];
  const recoverableTaxPct = str(recoverableTaxPctRaw) ? num(recoverableTaxPctRaw) : 100;
  if (!(recoverableTaxPct >= 0 && recoverableTaxPct <= 100)) {
    return fail("Recoverable GST % must be between 0 and 100");
  }

  const scope = str(raw["Attribution Scope"]).toLowerCase() as BudgetAttributionScope;
  if (!ATTRIBUTION_SCOPES.includes(scope)) {
    return fail(`Attribution Scope must be one of: ${ATTRIBUTION_SCOPES.join(", ")}`);
  }

  const justification = str(raw["Business Justification"]);

  let costCentreId: string | null = null;
  let processId: string | null = null;
  let allocationDriver: string | null = null;
  let planningLevel: BranchBudgetLineInput["planningLevel"] = "cost_centre";
  let manualAllocations: ManualAllocationInput[] | undefined;

  // Cost-centre and process attributed lines are not split across cost centres, but the workspace
  // validates that EVERY line carries an allocation driver. Without this the import produced lines
  // that could never be saved ("Allocation driver is mandatory") until the user set the driver by
  // hand on each card. The Sharing Method column doubles as the driver for these scopes.
  // Accepts a direct driver when one is supplied, otherwise falls back to direct tagging. It does
  // NOT reject branch-common sharing methods here: the column is named "Sharing Method" and is
  // primarily meant for branch_common rows, so a direct row carrying e.g. "equal_split" is a
  // harmless copy from the template rather than an error worth blocking the whole import for.
  const directDriver = (): string => {
    const supplied = str(raw["Sharing Method"]).toLowerCase();
    return DIRECT_ALLOCATION_DRIVERS.includes(supplied) ? supplied : DEFAULT_DIRECT_DRIVER;
  };

  if (scope === "cost_centre") {
    const code = str(raw["Cost Centre Code"]);
    if (!code) return fail("Cost Centre Code is required when Attribution Scope is cost_centre");
    const match = findByCodeOrName(lookups.costCentres, code);
    if (!match) return fail(`Cost centre "${code}" was not found`);
    costCentreId = match.id;
    planningLevel = "cost_centre";
    allocationDriver = directDriver();
  } else if (scope === "process") {
    const name = str(raw["Process Name"]);
    if (!name) return fail("Process Name is required when Attribution Scope is process");
    const match = findByCodeOrName(lookups.processes, name);
    if (!match) return fail(`Process "${name}" was not found`);
    processId = match.id;
    planningLevel = "cost_centre";
    allocationDriver = directDriver();
  } else {
    planningLevel = "branch";
    const method = str(raw["Sharing Method"]).toLowerCase() || "equal_split";
    if (!SHARING_METHODS.includes(method)) {
      return fail(`Sharing Method must be one of: ${SHARING_METHODS.join(", ")}`);
    }
    allocationDriver = method;
    if (method === "manual") {
      const raw_ = str(raw["Manual Allocations"]);
      if (!raw_) return fail('Manual Allocations is required (e.g. "CC1:40, CC2:60") when Sharing Method is manual');
      const parts = raw_.split(",").map((p) => p.trim()).filter(Boolean);
      manualAllocations = [];
      for (const part of parts) {
        const [code, pctRaw] = part.split(":").map((p) => p.trim());
        const match = findByCodeOrName(lookups.costCentres, code ?? "");
        if (!match) return fail(`Manual Allocations references unknown cost centre "${code}"`);
        const pct = num(pctRaw);
        if (!(pct >= 0 && pct <= 100)) return fail(`Manual Allocations has an invalid percentage for "${code}"`);
        manualAllocations.push({ costCentreId: match.id, percentage: pct });
      }
      const total = manualAllocations.reduce((sum, a) => sum + a.percentage, 0);
      if (Math.abs(total - 100) > 0.01) {
        return fail(`Manual Allocations must total 100% (currently ${total.toFixed(2)}%)`);
      }
    }
  }

  let preferredVendorId: string | null = null;
  const vendorCode = str(raw["Preferred Vendor Code"]);
  if (vendorCode) {
    const match = findByCodeOrName(lookups.vendors, vendorCode);
    if (!match) return fail(`Vendor "${vendorCode}" was not found`);
    preferredVendorId = match.id;
  }

  const line: BranchBudgetLineInput = {
    attributionScope: scope,
    planningLevel,
    costCentreId,
    processId,
    head,
    subHead,
    itemName,
    itemDescription,
    quantity,
    unit,
    unitRate,
    taxTreatment,
    gstRate,
    gstType,
    recoverableTaxPct,
    preferredVendorId,
    allocationDriver,
    justification,
    manualAllocations,
  };
  return { rowNumber, line, error: null };
}

// ── Component ────────────────────────────────────────────────────────────────

type Step = "select" | "preview" | "result";
type InputMethod = "file" | "paste";

export function BranchBudgetImportDialog({
  open,
  onOpenChange,
  costCentres,
  processes,
  vendors,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  costCentres: LookupOption[];
  processes: LookupOption[];
  vendors: LookupOption[];
  onImport: (lines: BranchBudgetLineInput[]) => void;
}) {
  const [step, setStep] = useState<Step>("select");
  const [method, setMethod] = useState<InputMethod>("file");
  const [pasteText, setPasteText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [resolvedRows, setResolvedRows] = useState<ResolvedRow[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setStep("select");
    setPasteText("");
    setFileName(null);
    setParseError(null);
    setResolvedRows([]);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleClose(v: boolean) {
    if (!v) reset();
    onOpenChange(v);
  }

  function resolveAndPreview(rawRows: Record<string, unknown>[]) {
    if (rawRows.length === 0) {
      setParseError("No data rows found.");
      return;
    }
    const resolved = rawRows.map((raw, index) => resolveRow(raw, index + 2, { costCentres, processes, vendors }));
    setResolvedRows(resolved);
    setStep("preview");
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParseError(null);
    try {
      const raw = await parseFile(file);
      resolveAndPreview(raw);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "Could not parse file");
    }
  }

  function handlePasteSubmit() {
    setParseError(null);
    try {
      const raw = parsePastedText(pasteText);
      resolveAndPreview(raw);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "Could not parse pasted text");
    }
  }

  const validRows = resolvedRows.filter((r) => r.line);
  const invalidRows = resolvedRows.filter((r) => !r.line);

  function handleImport() {
    onImport(validRows.map((r) => r.line!));
    setStep("result");
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold text-slate-800">
            <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
            Import budget lines from Excel
          </DialogTitle>
        </DialogHeader>

        <div className="mb-2 flex items-center gap-2 text-xs text-slate-500">
          {(["select", "preview", "result"] as Step[]).map((s, i) => (
            <span key={s} className="flex items-center gap-1">
              {i > 0 && <span className="text-slate-300">›</span>}
              <span className={step === s ? "font-semibold text-emerald-700" : ""}>
                {i + 1}. {s === "select" ? "Select source" : s === "preview" ? "Preview & validate" : "Result"}
              </span>
            </span>
          ))}
        </div>

        {step === "select" && (
          <div className="space-y-5">
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 space-y-3">
              <p className="text-xs leading-5 text-slate-500">
                Download the template, fill it in, then upload or paste the rows below. Columns:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {COLUMNS.map((c) => (
                  <Badge key={c} variant="outline" className="text-xs font-normal">
                    {c}{REQUIRED_COLUMNS.has(c) ? " *" : ""}
                  </Badge>
                ))}
              </div>
              <Button size="sm" variant="outline" className="gap-2" onClick={() => void downloadTemplate()}>
                <Download className="h-4 w-4" />Download template (.xlsx)
              </Button>
            </div>

            <div className="flex gap-2">
              <Button type="button" size="sm" variant={method === "file" ? "default" : "outline"} onClick={() => setMethod("file")}>
                <Upload className="mr-1 h-3.5 w-3.5" />Upload file
              </Button>
              <Button type="button" size="sm" variant={method === "paste" ? "default" : "outline"} onClick={() => setMethod("paste")}>
                <ClipboardPaste className="mr-1 h-3.5 w-3.5" />Paste from Excel
              </Button>
            </div>

            {method === "file" ? (
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Upload file</Label>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="block w-full cursor-pointer rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-emerald-700 hover:file:bg-emerald-100"
                  onChange={(event) => void handleFileChange(event)}
                />
                {fileName && !parseError && <p className="text-xs text-slate-500">Parsed {fileName}</p>}
              </div>
            ) : (
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                  Paste rows copied from Excel (including the header row)
                </Label>
                <Textarea
                  rows={6}
                  value={pasteText}
                  onChange={(event) => setPasteText(event.target.value)}
                  placeholder={COLUMNS.join("\t")}
                />
                <Button size="sm" disabled={!pasteText.trim()} onClick={handlePasteSubmit}>Parse pasted rows</Button>
              </div>
            )}

            {parseError && (
              <p className="flex items-center gap-1.5 text-xs text-red-600">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />{parseError}
              </p>
            )}
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-700">
                <span className="font-semibold text-emerald-700">{validRows.length} valid</span>
                {invalidRows.length > 0 && <span className="font-semibold text-rose-600"> · {invalidRows.length} invalid</span>}
                {" "}of {resolvedRows.length} row(s) parsed
              </p>
              <Button size="sm" variant="ghost" className="gap-1.5 text-xs" onClick={reset}>
                <X className="h-3.5 w-3.5" />Start over
              </Button>
            </div>

            <div className="max-h-72 overflow-auto rounded-xl border border-slate-200">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="w-12 px-3 py-2 text-left font-semibold text-slate-500">Row</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-500">Item</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-500">Scope</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-500">Qty x Rate</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-500">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {resolvedRows.map((row) => (
                    <tr key={row.rowNumber} className={row.error ? "bg-rose-50/60" : "hover:bg-slate-50"}>
                      <td className="px-3 py-1.5 text-slate-400">{row.rowNumber}</td>
                      <td className="px-3 py-1.5 text-slate-700">{row.line?.itemName ?? "-"}</td>
                      <td className="px-3 py-1.5 text-slate-600">{row.line?.attributionScope ?? "-"}</td>
                      <td className="px-3 py-1.5 text-right text-slate-600">
                        {row.line ? `${row.line.quantity} x ${row.line.unitRate}` : "-"}
                      </td>
                      <td className="px-3 py-1.5">
                        {row.error ? (
                          <span className="text-rose-700">{row.error}</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5" />Valid
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-3 pt-1">
              <Button variant="outline" size="sm" onClick={reset}>Back</Button>
              <Button size="sm" disabled={validRows.length === 0} onClick={handleImport}>
                <Upload className="mr-2 h-4 w-4" />Add {validRows.length} line(s) to Plan Builder
              </Button>
            </div>
          </div>
        )}

        {step === "result" && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4">
              <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-500" />
              <div>
                <p className="text-sm font-semibold text-slate-800">
                  {validRows.length} line(s) added to Plan Builder
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Review them in Plan Builder and click "Save draft" to persist — nothing is saved yet.
                  {invalidRows.length > 0 && ` ${invalidRows.length} row(s) were skipped due to validation errors above.`}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" size="sm" onClick={reset}>Import more</Button>
              <Button size="sm" onClick={() => handleClose(false)}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
