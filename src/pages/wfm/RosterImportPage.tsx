/**
 * Roster Import Page
 * Supports all wide-format roster spreadsheets:
 *  - Format A (Housing Owner): 24h times "10:00 - 19:00", double header rows, WO markers
 *  - Format B (Onfido/Analyst): 12h times "07:00pm-04:00am", single header, night shifts
 * Features: night-shift amber highlight, manual cell override, missing-employee WFM reminders.
 */

import { useState, useRef, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Send,
  Moon,
  Sun,
  Users,
  Bell,
  ChevronDown,
  ChevronUp,
  Pencil,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Process {
  id: string;
  process_name: string;
}

interface ImportBatch {
  id: number;
  status: string;
  file_name: string;
  import_mode: "NEW" | "UPDATE";
  total_rows: number;
  valid_rows: number;
  warning_rows: number;
  error_rows: number;
  needs_mapping_rows: number;
  date_range_start: string | null;
  date_range_end: string | null;
  created_at: string;
  committed_at: string | null;
}

interface ImportRow {
  id: number;
  row_number: number;
  employee_id_raw: string;
  employee_name_raw: string;
  roster_date: string;
  raw_value: string;
  normalized_type: string;
  validation_state: "VALID" | "WARNING" | "ERROR";
  validation_messages: string[] | null;
  extra_metadata_json: Record<string, string> | null;
}

interface MissingEmployee {
  id: string;
  employee_code: string;
  full_name: string;
  designation: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isNightShift(raw: string): boolean {
  if (!raw) return false;
  // 12h pattern: "7pm-4am", "07:00pm-04:00am"
  if (/\d+(?::\d+)?\s*pm\s*[-–]\s*\d+(?::\d+)?\s*am/i.test(raw)) return true;
  // 24h pattern: "22:00 - 06:00" (end <= start)
  const m = raw.match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/);
  if (m) {
    const start = parseInt(m[1]) * 60 + parseInt(m[2]);
    const end = parseInt(m[3]) * 60 + parseInt(m[4]);
    return end <= start;
  }
  return false;
}

function cellBg(row: ImportRow): string {
  if (row.validation_state === "ERROR") return "bg-red-50 ring-1 ring-red-300";
  if (row.validation_state === "WARNING") return "bg-yellow-50";
  if (row.normalized_type === "WEEK_OFF") return "bg-slate-100 text-slate-400";
  if (row.normalized_type === "LEAVE") return "bg-blue-50 text-blue-700";
  if (row.normalized_type === "HOLIDAY") return "bg-purple-50 text-purple-700";
  if (row.normalized_type === "TRAINING") return "bg-teal-50 text-teal-700";
  if (row.normalized_type === "UNASSIGNED") return "bg-white text-slate-300";
  if (isNightShift(row.raw_value)) return "bg-amber-50 ring-1 ring-amber-300 text-amber-800";
  return "bg-green-50 text-green-800";
}

function cellLabel(row: ImportRow): string {
  if (row.normalized_type === "WEEK_OFF") return "WO";
  if (row.normalized_type === "LEAVE") return "L";
  if (row.normalized_type === "HOLIDAY") return "HOL";
  if (row.normalized_type === "TRAINING") return "TRG";
  if (row.normalized_type === "UNASSIGNED") return "—";
  if (row.normalized_type === "NEEDS_MAPPING") return "?";
  if (row.normalized_type === "HARD_ERROR") return "ERR";
  const v = row.raw_value ?? "";
  return v.length > 13 ? v.slice(0, 12) + "…" : v;
}

const STATUS_PILL: Record<string, string> = {
  PARSING: "bg-blue-100 text-blue-700",
  PREVIEW: "bg-yellow-100 text-yellow-700",
  COMMITTED: "bg-green-100 text-green-700",
  FAILED: "bg-red-100 text-red-700",
  CANCELLED: "bg-slate-100 text-slate-500",
};

// ─── Cell Edit Modal ──────────────────────────────────────────────────────────

interface CellEditModalProps {
  row: ImportRow | null;
  batchId: number;
  onClose: () => void;
}

function CellEditModal({ row, batchId, onClose }: CellEditModalProps) {
  const [value, setValue] = useState(row?.raw_value ?? "");
  const qc = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: () =>
      hrmsApi.patch(`/wfm/roster-imports/${batchId}/rows/${row!.id}`, { rawValue: value }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["roster-import-rows", batchId] });
      qc.invalidateQueries({ queryKey: ["roster-import-batch", batchId] });
      onClose();
    },
  });

  const QUICK = ["WO", "L", "HOL", "TRG", "09:30 - 18:30", "10:00 - 19:00", "07:00pm-04:00am"];

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Override Roster Cell</DialogTitle>
        </DialogHeader>
        {row && (
          <div className="space-y-4">
            <div className="text-sm text-slate-600">
              <p className="font-semibold">{row.employee_name_raw || row.employee_id_raw}</p>
              <p className="text-slate-400">{row.roster_date}</p>
              {row.validation_messages?.length ? (
                <p className="text-red-600 text-xs mt-1">
                  {row.validation_messages.join(" · ")}
                </p>
              ) : null}
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">NEW VALUE</label>
              <Input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="e.g. 10:00 - 19:00 or WO"
                autoFocus
              />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {QUICK.map((q) => (
                  <button
                    key={q}
                    onClick={() => setValue(q)}
                    className="text-xs px-2 py-0.5 rounded-full border border-slate-300 hover:bg-slate-100"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || value === row?.raw_value}
          >
            {saveMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
        </DialogFooter>
        {saveMutation.isError && (
          <p className="text-xs text-red-600 mt-1">
            {(saveMutation.error as Error).message}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function RosterImportPage() {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [processId, setProcessId] = useState("");
  const [importMode, setImportMode] = useState<"NEW" | "UPDATE">("NEW");
  const [batchId, setBatchId] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [editingRow, setEditingRow] = useState<ImportRow | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const [reminderSent, setReminderSent] = useState<Set<string>>(new Set());

  // Processes list
  const { data: procData } = useQuery({
    queryKey: ["processes-list"],
    queryFn: () => hrmsApi.get<{ data: Process[] }>("/processes?limit=200"),
  });
  const processes: Process[] = procData?.data ?? [];

  // Current batch
  const { data: batchData, isLoading: batchLoading } = useQuery({
    queryKey: ["roster-import-batch", batchId],
    queryFn: () =>
      hrmsApi.get<{ batch: ImportBatch }>(`/wfm/roster-imports/${batchId}`),
    enabled: !!batchId,
    refetchInterval: (data) =>
      data?.state?.data?.batch?.status === "PARSING" ? 2000 : false,
  });
  const batch = batchData?.batch;

  // All rows for grid (fetch up to 5000 per-cell entries)
  const { data: rowsData } = useQuery({
    queryKey: ["roster-import-rows", batchId],
    queryFn: () =>
      hrmsApi.get<{ rows: ImportRow[]; total: number }>(
        `/wfm/roster-imports/${batchId}/rows?limit=5000`
      ),
    enabled: !!batchId && batch?.status === "PREVIEW",
  });
  const allRows: ImportRow[] = rowsData?.rows ?? [];

  // Missing employees
  const { data: missingData } = useQuery({
    queryKey: ["roster-import-missing", batchId],
    queryFn: () =>
      hrmsApi.get<{ employees: MissingEmployee[]; total: number }>(
        `/wfm/roster-imports/${batchId}/missing-employees`
      ),
    enabled: !!batchId && batch?.status === "PREVIEW",
  });
  const missingEmployees: MissingEmployee[] = missingData?.employees ?? [];

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!processId) throw new Error("Select a process first");
      const fd = new FormData();
      fd.append("file", file);
      fd.append("processId", processId);
      fd.append("importMode", importMode);
      return hrmsApi.postForm<{ batchId: number; status: string }>("/wfm/roster-imports", fd);
    },
    onSuccess: (res) => {
      setBatchId(res.batchId);
    },
  });

  // Commit mutation
  const commitMutation = useMutation({
    mutationFn: (overrideWarnings = false) =>
      hrmsApi.post<{ assignmentsCreated: number }>(
        `/wfm/roster-imports/${batchId}/commit`,
        { overrideWarnings }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["roster-import-batch", batchId] });
    },
  });

  // Pivot rows into employee × date grid
  const { employees, sortedDates } = useMemo(() => {
    const empMap = new Map<
      string,
      { name: string; dates: Map<string, ImportRow> }
    >();
    const dateSet = new Set<string>();

    for (const row of allRows) {
      const key = row.employee_id_raw || `__row_${row.row_number}`;
      if (!empMap.has(key)) {
        empMap.set(key, { name: row.employee_name_raw || key, dates: new Map() });
      }
      empMap.get(key)!.dates.set(row.roster_date, row);
      dateSet.add(row.roster_date);
    }

    const sortedDates = Array.from(dateSet).sort();
    const employees = Array.from(empMap.entries()).map(([id, v]) => ({
      id,
      name: v.name,
      dates: v.dates,
    }));

    employees.sort((a, b) => {
      const aErr = Array.from(a.dates.values()).some((r) => r.validation_state === "ERROR");
      const bErr = Array.from(b.dates.values()).some((r) => r.validation_state === "ERROR");
      if (aErr !== bErr) return aErr ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return { employees, sortedDates };
  }, [allRows]);

  const nightShiftCount = useMemo(
    () =>
      allRows.filter((r) => r.normalized_type === "SHIFT" && isNightShift(r.raw_value)).length,
    [allRows]
  );

  const handleFile = useCallback(
    (file: File) => {
      if (!processId) { alert("Please select a process first"); return; }
      uploadMutation.mutate(file);
    },
    [processId, uploadMutation]
  );

  const canCommit =
    batch?.status === "PREVIEW" &&
    (batch.error_rows ?? 0) === 0 &&
    !commitMutation.isPending;

  const reset = () => {
    setBatchId(null);
    uploadMutation.reset();
    commitMutation.reset();
    setReminderSent(new Set());
  };

  const pushReminder = (emp: MissingEmployee) => {
    hrmsApi.post(`/wfm/roster-imports/${batchId}/remind`, { employeeId: emp.id }).catch(() => {});
    setReminderSent((prev) => new Set([...prev, emp.id]));
  };

  function fmtDateHeader(d: string) {
    const dt = new Date(d + "T00:00:00");
    const day = dt.getDate();
    const mon = dt.toLocaleString("en", { month: "short" });
    const dow = dt.toLocaleString("en", { weekday: "short" });
    const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
    return { label: `${day} ${mon}`, sub: dow, isWeekend };
  }

  return (
    <DashboardLayout>
      <div className="p-6 max-w-full space-y-5">

        {/* Header */}
        <div className="rounded-xl bg-gradient-to-r from-slate-800 to-slate-700 text-white p-6">
          <p className="text-xs font-semibold tracking-widest uppercase text-slate-400 mb-1">
            WFM · ROSTER IMPORT
          </p>
          <h1 className="text-2xl font-bold">Roster Upload</h1>
          <p className="text-slate-300 text-sm mt-1 max-w-2xl">
            Supports wide-format Excel rosters: 24h "10:00–19:00" or 12h "07:00pm–04:00am",
            single or double header rows, WO/HD/blank normalization.
            Night shifts highlighted amber. Click any cell to manually override.
          </p>
        </div>

        {/* Config row */}
        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs font-semibold text-slate-500 mb-1">PROCESS</label>
            <Select value={processId} onValueChange={setProcessId} disabled={!!batchId}>
              <SelectTrigger>
                <SelectValue placeholder="Select process…" />
              </SelectTrigger>
              <SelectContent>
                {processes.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.process_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">IMPORT MODE</label>
            <Select
              value={importMode}
              onValueChange={(v) => setImportMode(v as "NEW" | "UPDATE")}
              disabled={!!batchId}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NEW">NEW — insert only</SelectItem>
                <SelectItem value="UPDATE">UPDATE — overwrite</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {batchId && (
            <Button variant="outline" size="sm" onClick={reset}>
              New Upload
            </Button>
          )}
        </div>

        {/* Drop zone */}
        {!batchId && (
          <div
            className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
              dragOver ? "border-blue-500 bg-blue-50" : "border-slate-300 hover:border-blue-400 hover:bg-slate-50"
            } ${!processId ? "opacity-50 pointer-events-none" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files[0];
              if (f) handleFile(f);
            }}
            onClick={() => processId && fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
            {uploadMutation.isPending ? (
              <div className="flex flex-col items-center gap-3">
                <RefreshCw className="h-10 w-10 text-blue-500 animate-spin" />
                <p className="text-slate-600 font-medium">Uploading & parsing…</p>
                <p className="text-slate-400 text-sm">Detecting headers, normalizing shifts…</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <FileSpreadsheet className="h-12 w-12 text-slate-400" />
                <p className="text-slate-700 font-semibold text-lg">Drop roster Excel here</p>
                <p className="text-slate-400 text-sm">or click to browse · .xlsx / .xls / .csv</p>
                <div className="flex gap-6 text-xs text-slate-400 mt-1">
                  <span className="flex items-center gap-1">
                    <Sun className="h-3.5 w-3.5" /> 24h: 10:00–19:00
                  </span>
                  <span className="flex items-center gap-1">
                    <Moon className="h-3.5 w-3.5" /> Night: 07:00pm–04:00am
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Upload error */}
        {uploadMutation.isError && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700 text-sm">
            <strong>Upload failed:</strong> {(uploadMutation.error as Error).message}
          </div>
        )}

        {/* Batch summary */}
        {batch && (
          <div className="rounded-xl border bg-white shadow-sm">
            <div className="p-4 border-b flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <Upload className="h-5 w-5 text-slate-500" />
                <div>
                  <p className="font-semibold text-slate-800">{batch.file_name}</p>
                  <p className="text-xs text-slate-400">
                    {batch.import_mode} · {new Date(batch.created_at).toLocaleString()}
                    {batch.date_range_start &&
                      ` · ${batch.date_range_start} → ${batch.date_range_end}`}
                  </p>
                </div>
              </div>
              <Badge className={STATUS_PILL[batch.status] ?? "bg-slate-100 text-slate-600"}>
                {batch.status}
              </Badge>
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-6 divide-x border-b text-center">
              {[
                { label: "Total", value: batch.total_rows, color: "text-slate-700" },
                { label: "Valid", value: batch.valid_rows, color: "text-green-600" },
                { label: "Warnings", value: batch.warning_rows, color: "text-yellow-600" },
                { label: "Errors", value: batch.error_rows, color: "text-red-600" },
                { label: "Needs Mapping", value: batch.needs_mapping_rows, color: "text-orange-500" },
                { label: "Night Shifts", value: nightShiftCount, color: "text-amber-600" },
              ].map((s) => (
                <div key={s.label} className="p-3">
                  <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>

            {batch.status === "PREVIEW" && (
              <div className="p-4 flex items-center justify-between flex-wrap gap-3">
                <div className="text-sm">
                  {batch.error_rows > 0 ? (
                    <span className="text-red-600 font-medium">
                      {batch.error_rows} error{batch.error_rows !== 1 ? "s" : ""} — fix cells below or use Override & Commit.
                    </span>
                  ) : batch.warning_rows > 0 ? (
                    <span className="text-yellow-700">
                      {batch.warning_rows} warning{batch.warning_rows !== 1 ? "s" : ""} · ready to commit.
                    </span>
                  ) : (
                    <span className="text-green-600 font-medium">All rows valid — ready.</span>
                  )}
                </div>
                <div className="flex gap-2">
                  {batch.error_rows > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => commitMutation.mutate(true)}
                      disabled={commitMutation.isPending}
                    >
                      Override & Commit
                    </Button>
                  )}
                  <Button
                    onClick={() => commitMutation.mutate(false)}
                    disabled={!canCommit}
                    className="gap-2"
                  >
                    {commitMutation.isPending ? (
                      <><RefreshCw className="h-4 w-4 animate-spin" /> Committing…</>
                    ) : (
                      <><Send className="h-4 w-4" /> Commit {(batch.valid_rows ?? 0) + (batch.warning_rows ?? 0)} rows</>
                    )}
                  </Button>
                </div>
              </div>
            )}

            {batch.status === "COMMITTED" && (
              <div className="p-4 flex items-center gap-2 text-green-700">
                <CheckCircle2 className="h-5 w-5" />
                <span className="font-medium">
                  Committed {batch.committed_at ? new Date(batch.committed_at).toLocaleString() : ""}
                </span>
              </div>
            )}

            {commitMutation.isError && (
              <p className="px-4 pb-3 text-sm text-red-600">
                {(commitMutation.error as Error).message}
              </p>
            )}
          </div>
        )}

        {/* Legend */}
        {allRows.length > 0 && (
          <div className="flex flex-wrap gap-2 text-xs items-center">
            {[
              { cls: "bg-green-50 ring-1 ring-green-200 text-green-800", label: "Day shift" },
              { cls: "bg-amber-50 ring-1 ring-amber-300 text-amber-800", label: "Night shift" },
              { cls: "bg-slate-100 text-slate-500", label: "Week Off" },
              { cls: "bg-blue-50 text-blue-700", label: "Leave" },
              { cls: "bg-yellow-50 ring-1 ring-yellow-200 text-slate-700", label: "Warning" },
              { cls: "bg-red-50 ring-1 ring-red-300 text-red-700", label: "Error" },
            ].map((l) => (
              <span key={l.label} className={`px-2 py-1 rounded ${l.cls}`}>{l.label}</span>
            ))}
            <span className="text-slate-400 flex items-center gap-1 ml-1">
              <Pencil className="h-3 w-3" /> Click any cell to override
            </span>
            <AlertTriangle className="h-3.5 w-3.5 text-orange-400 ml-2" />
            <span className="text-slate-400">Errors sorted to top</span>
          </div>
        )}

        {/* Employee × Date Grid */}
        {batchLoading && (
          <div className="text-center py-10 text-slate-400">
            <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2" />
            Loading roster grid…
          </div>
        )}

        {employees.length > 0 && (
          <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
            <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
              <table className="text-xs border-collapse min-w-full">
                <thead className="sticky top-0 z-20">
                  <tr className="bg-slate-50 border-b">
                    <th className="sticky left-0 z-30 bg-slate-50 px-3 py-2 text-left font-semibold text-slate-600 min-w-[170px] border-r">
                      Employee ({employees.length})
                    </th>
                    {sortedDates.map((d) => {
                      const { label, sub, isWeekend } = fmtDateHeader(d);
                      return (
                        <th
                          key={d}
                          className={`px-1 py-2 text-center font-medium min-w-[70px] border-r ${
                            isWeekend ? "text-blue-600 bg-blue-50" : "text-slate-600"
                          }`}
                        >
                          <div>{label}</div>
                          <div className="text-slate-400 font-normal">{sub}</div>
                        </th>
                      );
                    })}
                    <th className="sticky right-0 bg-slate-50 px-2 py-2 text-center text-slate-500 font-medium min-w-[54px] border-l">
                      Issues
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((emp) => {
                    const errCnt = Array.from(emp.dates.values()).filter(
                      (r) => r.validation_state === "ERROR"
                    ).length;
                    const warnCnt = Array.from(emp.dates.values()).filter(
                      (r) => r.validation_state === "WARNING"
                    ).length;
                    const nightCnt = Array.from(emp.dates.values()).filter(
                      (r) => r.normalized_type === "SHIFT" && isNightShift(r.raw_value)
                    ).length;

                    return (
                      <tr
                        key={emp.id}
                        className={`border-b transition-colors ${errCnt > 0 ? "bg-red-50/20" : "hover:bg-slate-50/50"}`}
                      >
                        <td className="sticky left-0 z-10 bg-white border-r px-3 py-1.5 min-w-[170px]">
                          <p className="font-medium text-slate-800 truncate max-w-[155px]" title={emp.name}>
                            {emp.name}
                          </p>
                          <p className="text-slate-400 font-mono text-[10px]">{emp.id}</p>
                          {nightCnt > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-amber-700 text-[10px]">
                              <Moon className="h-2.5 w-2.5" /> {nightCnt}d night
                            </span>
                          )}
                        </td>

                        {sortedDates.map((d) => {
                          const row = emp.dates.get(d);
                          if (!row) {
                            return (
                              <td key={d} className="border-r px-1 py-1 text-center text-slate-200 min-w-[70px]">
                                –
                              </td>
                            );
                          }
                          return (
                            <td
                              key={d}
                              className={`border-r px-0.5 py-1 text-center cursor-pointer hover:brightness-95 min-w-[70px] ${cellBg(row)}`}
                              title={`${row.raw_value || "blank"} · ${row.validation_state}${
                                row.validation_messages?.length
                                  ? " · " + row.validation_messages.join("; ")
                                  : ""
                              }`}
                              onClick={() => batch?.status === "PREVIEW" && setEditingRow(row)}
                            >
                              <div className="flex items-center justify-center gap-0.5 leading-tight">
                                {isNightShift(row.raw_value) && row.normalized_type === "SHIFT" && (
                                  <Moon className="h-2.5 w-2.5 shrink-0" />
                                )}
                                <span className="truncate text-[10px]">{cellLabel(row)}</span>
                              </div>
                              {row.validation_state === "ERROR" && (
                                <XCircle className="h-2.5 w-2.5 text-red-500 mx-auto mt-0.5" />
                              )}
                            </td>
                          );
                        })}

                        <td className="sticky right-0 bg-white border-l px-2 py-1 text-center min-w-[54px]">
                          {errCnt > 0 && (
                            <span className="text-red-600 font-bold text-[11px]">{errCnt}E</span>
                          )}
                          {warnCnt > 0 && (
                            <span className="text-yellow-600 text-[11px] ml-0.5">{warnCnt}W</span>
                          )}
                          {errCnt === 0 && warnCnt === 0 && (
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-400 mx-auto" />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Missing employees */}
        {missingEmployees.length > 0 && (
          <div className="rounded-xl border bg-white shadow-sm">
            <button
              className="w-full p-4 flex items-center justify-between text-left"
              onClick={() => setShowMissing((v) => !v)}
            >
              <div className="flex items-center gap-3">
                <Users className="h-5 w-5 text-orange-500" />
                <div>
                  <p className="font-semibold text-slate-800">
                    {missingEmployees.length} Employee{missingEmployees.length !== 1 ? "s" : ""} Not in Roster
                  </p>
                  <p className="text-xs text-slate-400">
                    Active process employees whose code wasn't found in this file
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-orange-600 border-orange-300 hover:bg-orange-50"
                  onClick={(e) => {
                    e.stopPropagation();
                    missingEmployees.forEach((emp) => pushReminder(emp));
                  }}
                >
                  <Bell className="h-3.5 w-3.5" />
                  Push All Reminders
                </Button>
                {showMissing ? (
                  <ChevronUp className="h-4 w-4 text-slate-400" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-slate-400" />
                )}
              </div>
            </button>

            {showMissing && (
              <div className="border-t">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                    <tr>
                      <th className="px-4 py-2 text-left">Code</th>
                      <th className="px-4 py-2 text-left">Name</th>
                      <th className="px-4 py-2 text-left">Designation</th>
                      <th className="px-4 py-2 text-center w-28">WFM Reminder</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {missingEmployees.map((emp) => (
                      <tr key={emp.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2 font-mono text-xs">{emp.employee_code}</td>
                        <td className="px-4 py-2 font-medium">{emp.full_name}</td>
                        <td className="px-4 py-2 text-slate-500">{emp.designation || "—"}</td>
                        <td className="px-4 py-2 text-center">
                          {reminderSent.has(emp.id) ? (
                            <span className="text-xs text-green-600 flex items-center justify-center gap-1">
                              <CheckCircle2 className="h-3.5 w-3.5" /> Sent
                            </span>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1"
                              onClick={() => pushReminder(emp)}
                            >
                              <Bell className="h-3 w-3" /> Remind
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Cell edit modal */}
        {editingRow && batchId && (
          <CellEditModal
            row={editingRow}
            batchId={batchId}
            onClose={() => setEditingRow(null)}
          />
        )}
      </div>
    </DashboardLayout>
  );
}
