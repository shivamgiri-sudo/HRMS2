/**
 * Roster Import Page
 * Supports all wide-format roster spreadsheets:
 *  - Format A (Housing Owner): 24h times "10:00 - 19:00", double header rows, WO markers
 *  - Format B (Onfido/Analyst): 12h times "07:00pm-04:00am", single header, night shifts
 * Features: night-shift amber highlight, manual cell override, missing-employee list.
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
  ChevronDown,
  ChevronUp,
  Pencil,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Process {
  id: string;
  process_name: string;
}

interface Branch {
  id: string;
  branch_name: string;
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
  process_id?: string | null;
  branch_id?: string | null;
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

/**
 * Parses one clock-time token — 24h ("22:00", "6") or 12h with meridiem ("7pm", "07:00pm",
 * "12:00am") — into minutes since midnight. Returns null if it isn't a time at all.
 */
function parseTimeToken(token: string): number | null {
  const m = token.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const meridiem = m[3]?.toLowerCase();
  if (meridiem === "am") { if (h === 12) h = 0; }
  else if (meridiem === "pm") { if (h !== 12) h += 12; }
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Splits a shift cell into its two clock times, in minutes since midnight.
 *
 * Previously this only recognized the literal textual shape "<pm-time> - <am-time>" for 12h
 * cells, so any night shift NOT written that exact way was silently missed: "12:00am - 08:00am"
 * (both sides "am") and "11:30pm - 11:45pm" (both sides "pm") never matched at all, and the old
 * 24h regex required a colon on both sides, missing bare-hour cells like "22 - 6". Parsing each
 * side as its own token — 12h or 24h, independently — closes all of those at once.
 */
function parseShiftRange(raw: string): { start: number; end: number } | null {
  if (!raw) return null;
  const m = raw.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*[-–—]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
  if (!m) return null;
  const start = parseTimeToken(m[1]);
  const end = parseTimeToken(m[2]);
  if (start === null || end === null) return null;
  return { start, end };
}

/**
 * A shift counts as "night" if it crosses midnight (end clock-time <= start clock-time — e.g.
 * "22:00 - 06:00", "07:00pm-04:00am"), OR if it starts inside the late-evening/pre-dawn window
 * even when it doesn't wrap (e.g. "12:00am - 08:00am" starts at midnight and ends the same
 * calendar day, so end > start, but it's still unambiguously a night/graveyard shift; likewise
 * "22:00 - 23:30"). The wrap check alone systematically misses every shift that starts at or
 * after midnight and stays within the same AM block — exactly the gap reported 2026-08-21.
 * Window bounds (22:00 / 05:00) are deliberately narrow to avoid relabeling an early "morning"
 * shift (e.g. a 05:30 or 06:00 start) as night.
 */
export function isNightShift(raw: string): boolean {
  const r = parseShiftRange(raw);
  if (!r) return false;
  if (r.end <= r.start) return true;
  return r.start >= 22 * 60 || r.start < 5 * 60;
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
      hrmsApi.patch(`/api/wfm/roster-imports/${batchId}/rows/${row!.id}`, { rawValue: value }),
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

  /**
   * Roster Builder links here as /wfm/roster-import?cycleId=…&processId=… so a bulk upload can
   * land inside the week the planner is already building. Until this read existed the params
   * were dropped in the browser: commitImportBatch accepts a cycleId (roster-import.routes.ts)
   * and writes it onto every assignment, but the page never sent one, so imported rows landed
   * with cycle_id NULL. Publish selects `WHERE cycle_id = ? AND final_roster_status =
   * 'generated'`, so those rows could never be published or acknowledged — 412,032 of the
   * 413,386 live rows are in exactly that state. Reading the params here is what connects the
   * bulk path to the publish gate.
   *
   * Opening the page directly (no query string) is still supported: cycleId stays null and the
   * commit behaves exactly as before, creating cycle-less draft assignments.
   */
  const linkedParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const cycleId = linkedParams.get("cycleId");
  const [processId, setProcessId] = useState(() => linkedParams.get("processId") ?? "");
  const [importMode, setImportMode] = useState<"NEW" | "UPDATE">("NEW");
  const [batchId, setBatchId] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [editingRow, setEditingRow] = useState<ImportRow | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const [gridSearch, setGridSearch] = useState("");
  const [issuesOnly, setIssuesOnly] = useState(false);
  // Set when a commit request aborts client-side (30s+ default) while the server keeps working —
  // commit is one lock+validate+write cycle PER EMPLOYEE, not one statement, so a few thousand
  // rows over the remote DB link routinely outlasts a short timeout even though the commit itself
  // is still succeeding. Drives the batch-status query back into polling so the page reflects the
  // real outcome (COMMITTED, or still PREVIEW with the actual error) once the server finishes,
  // instead of leaving the uploader stuck on "please refresh" forever.
  const [pollingAfterTimeout, setPollingAfterTimeout] = useState(false);

  /**
   * Upload scope. "process" is the original single-process flow. "branch" covers a whole
   * branch in one upload — every process's employees in one sheet — for a WFM lead who
   * builds the roster branch-wide rather than process-by-process. Employee matching was
   * already global (by employee_code, not process), so this only changes what the batch
   * is filed under and what the missing-employees check compares against (migration 1536).
   * A cycle-linked upload (Roster Builder deep link) is always process-scoped, since a
   * cycle itself belongs to one process — the toggle is hidden in that case.
   */
  const [uploadScope, setUploadScope] = useState<"process" | "branch">("process");
  const [branchId, setBranchId] = useState("");

  // Processes list
  const { data: procData } = useQuery({
    queryKey: ["processes-list"],
    queryFn: () => hrmsApi.get<{ data: Process[] }>("/api/processes?limit=200"),
  });
  const processes: Process[] = procData?.data ?? [];

  // Branches list — only fetched once the user actually picks branch scope
  const { data: branchData } = useQuery({
    queryKey: ["wfm-roster-import-branches"],
    queryFn: () => hrmsApi.get<{ branches: Branch[] }>("/api/wfm/roster-imports/branches"),
    enabled: uploadScope === "branch",
  });
  const branches: Branch[] = branchData?.branches ?? [];

  // Current batch
  const { data: batchData, isLoading: batchLoading } = useQuery({
    queryKey: ["roster-import-batch", batchId],
    queryFn: () =>
      hrmsApi.get<{ batch: ImportBatch }>(`/api/wfm/roster-imports/${batchId}`),
    enabled: !!batchId,
    refetchInterval: (data) => {
      const status = data?.state?.data?.batch?.status;
      if (status === "PARSING") return 2000;
      // Keep polling after a commit-request timeout until the batch leaves PREVIEW (either
      // COMMITTED once the server-side commit actually finishes, or still PREVIEW with the
      // real error surfaced) — see pollingAfterTimeout above for why this can outlast the
      // original request by a couple of minutes on a large file.
      if (pollingAfterTimeout && status === "PREVIEW") return 5000;
      return false;
    },
  });
  const batch = batchData?.batch;

  // Stop polling once the batch has moved past PREVIEW (COMMITTED/FAILED/CANCELLED) — the
  // outcome is now known and reflected in `batch`, so there is nothing left to wait for.
  useEffect(() => {
    if (pollingAfterTimeout && batch && batch.status !== "PREVIEW") {
      setPollingAfterTimeout(false);
    }
  }, [pollingAfterTimeout, batch?.status]);

  // All rows for grid (fetch up to 5000 per-cell entries)
  const { data: rowsData } = useQuery({
    queryKey: ["roster-import-rows", batchId],
    queryFn: () =>
      hrmsApi.get<{ rows: ImportRow[]; total: number }>(
        `/api/wfm/roster-imports/${batchId}/rows?limit=5000`
      ),
    enabled: !!batchId && batch?.status === "PREVIEW",
  });
  const allRows: ImportRow[] = rowsData?.rows ?? [];

  // Missing employees
  const { data: missingData } = useQuery({
    queryKey: ["roster-import-missing", batchId],
    queryFn: () =>
      hrmsApi.get<{ employees: MissingEmployee[]; total: number }>(
        `/api/wfm/roster-imports/${batchId}/missing-employees`
      ),
    enabled: !!batchId && batch?.status === "PREVIEW",
  });
  const missingEmployees: MissingEmployee[] = missingData?.employees ?? [];

  /**
   * Sheet choice.
   *
   * A real weekly workbook can hold more than one sheet that genuinely looks like a roster — the
   * 12-tab file that prompted this has three ('Roster - Analyst' with 204 agents, 'Leadership
   * Roster' with 74 managers, and a 31-row 'Sheet1'). The server refuses to guess between them
   * and replies 409 ROSTER_IMPORT_AMBIGUOUS_SHEET with the candidate list; we keep the file so
   * the same upload can be retried once the user picks, rather than making them drag it again.
   */
  const [sheetChoices, setSheetChoices] = useState<string[]>([]);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: async ({ file, sheet }: { file: File; sheet?: string }) => {
      const branchMode = uploadScope === "branch" && !cycleId;
      if (branchMode && !branchId) throw new Error("Select a branch first");
      if (!branchMode && !processId) throw new Error("Select a process first");
      const fd = new FormData();
      fd.append("file", file);
      if (branchMode) {
        fd.append("branchId", branchId);
      } else {
        fd.append("processId", processId);
      }
      fd.append("importMode", importMode);
      // Only sent when the page was opened from Roster Builder's bulk-upload link. createImportBatch
      // takes cycleId as optional, so omitting it keeps the standalone upload behaving as before.
      if (cycleId) fd.append("cycleId", cycleId);
      if (sheet) fd.append("sheetName", sheet);
      return hrmsApi.postForm<{ batchId: number; status: string }>("/api/wfm/roster-imports", fd);
    },
    onSuccess: (res) => {
      setSheetChoices([]);
      setPendingFile(null);
      setBatchId(res.batchId);
    },
    onError: (err: unknown) => {
      const payload = (err as { payload?: { candidates?: unknown } })?.payload;
      const candidates = Array.isArray(payload?.candidates) ? (payload!.candidates as string[]) : [];
      setSheetChoices(candidates);
    },
  });

  // Commit mutation
  //
  // 120s, not the 30s JSON default: commitImportBatch acquires a per-employee advisory lock and
  // runs the leave/rest/payroll-lock checks and write ONE EMPLOYEE AT A TIME (roster-import.
  // service.ts), so a multi-thousand-row file over the production DB's WAN link (122.184.128.90,
  // per backend/.env — not localhost) routinely takes well past 30s even though the commit is
  // genuinely succeeding server-side. Raising the client timeout is the real fix for that case;
  // pollingAfterTimeout below covers the case where even 120s isn't enough on a very large batch.
  const commitMutation = useMutation({
    mutationFn: (overrideWarnings = false) =>
      hrmsApi.post<{ assignmentsCreated: number; employeesNotified: number }>(
        `/api/wfm/roster-imports/${batchId}/commit`,
        { overrideWarnings, cycleId },
        120000
      ),
    onSuccess: () => {
      setPollingAfterTimeout(false);
      qc.invalidateQueries({ queryKey: ["roster-import-batch", batchId] });
    },
    onError: (err: unknown) => {
      // The request aborted client-side, but commitImportBatch has no server-side rollback for
      // work already done (each employee's lock scope commits independently — see the "partial
      // success is still success" note in roster-import.service.ts) — so the commit is very
      // likely still running or already finished on the server. Poll the batch instead of
      // leaving the page stuck on a dead "please refresh" message.
      if ((err as Error)?.message?.includes("Request timed out")) {
        setPollingAfterTimeout(true);
      }
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

  // Search + issues-only filter on the pivoted grid. Matters most for a whole-branch upload —
  // a branch can carry hundreds of employees across every process, and scrolling all of them to
  // find the handful with an ERROR is exactly the friction a correction workflow should remove.
  const visibleEmployees = useMemo(() => {
    const q = gridSearch.trim().toLowerCase();
    return employees.filter((emp) => {
      if (q && !emp.name.toLowerCase().includes(q) && !emp.id.toLowerCase().includes(q)) {
        return false;
      }
      if (issuesOnly) {
        const hasIssue = Array.from(emp.dates.values()).some(
          (r) => r.validation_state === "ERROR" || r.validation_state === "WARNING"
        );
        if (!hasIssue) return false;
      }
      return true;
    });
  }, [employees, gridSearch, issuesOnly]);

  const branchMode = uploadScope === "branch" && !cycleId;
  const scopeReady = branchMode ? !!branchId : !!processId;

  const handleFile = useCallback(
    (file: File) => {
      if (!scopeReady) {
        alert(branchMode ? "Please select a branch first" : "Please select a process first");
        return;
      }
      setSheetChoices([]);
      setPendingFile(file);
      uploadMutation.mutate({ file });
    },
    [scopeReady, branchMode, uploadMutation]
  );

  const canCommit =
    batch?.status === "PREVIEW" &&
    (batch.error_rows ?? 0) === 0 &&
    !commitMutation.isPending &&
    !pollingAfterTimeout;

  const reset = () => {
    setBatchId(null);
    uploadMutation.reset();
    commitMutation.reset();
    setPollingAfterTimeout(false);
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
            single or double header rows, WO and blank normalization.
            Night shifts highlighted amber. Click any cell to manually override.
          </p>
        </div>

        {/* Config row */}
        <div className="flex flex-wrap gap-4 items-end">
          {!cycleId && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">UPLOAD FOR</label>
              <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5">
                {(["process", "branch"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={!!batchId}
                    onClick={() => setUploadScope(s)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                      uploadScope === s ? "bg-slate-800 text-white" : "text-slate-500 hover:bg-slate-100"
                    } ${batchId ? "opacity-60 cursor-not-allowed" : ""}`}
                  >
                    {s === "process" ? "One Process" : "Whole Branch"}
                  </button>
                ))}
              </div>
            </div>
          )}
          {branchMode ? (
            <div className="flex-1 min-w-[220px]">
              <label className="block text-xs font-semibold text-slate-500 mb-1">BRANCH</label>
              <Select value={branchId} onValueChange={setBranchId} disabled={!!batchId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select branch…" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.branch_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-slate-400 mt-1">
                One sheet, every process mixed together — each row is filed by the employee's own code.
              </p>
            </div>
          ) : (
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
          )}
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
            } ${!scopeReady ? "opacity-50 pointer-events-none" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files[0];
              if (f) handleFile(f);
            }}
            onClick={() => scopeReady && fileInputRef.current?.click()}
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

        {/* Sheet picker — shown instead of a bare error when the workbook has more than one
            sheet that could be the roster. The file is still held in memory, so choosing a sheet
            retries the same upload rather than making the user find the file again. */}
        {sheetChoices.length > 0 && pendingFile && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
            <p className="font-semibold text-amber-900">Which sheet is the roster?</p>
            <p className="mt-1 text-sm text-amber-800">
              <span className="font-medium">{pendingFile.name}</span> has {sheetChoices.length} sheets
              that could be a roster. Pick the one to import.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {sheetChoices.map((name) => (
                <Button
                  key={name}
                  size="sm"
                  variant="outline"
                  disabled={uploadMutation.isPending}
                  className="border-amber-400 bg-white text-amber-900 hover:bg-amber-100"
                  onClick={() => uploadMutation.mutate({ file: pendingFile, sheet: name })}
                >
                  <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />
                  {name}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Upload error — suppressed while the sheet picker is offering a way forward. */}
        {uploadMutation.isError && sheetChoices.length === 0 && (
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
                      disabled={commitMutation.isPending || pollingAfterTimeout}
                    >
                      Override & Commit
                    </Button>
                  )}
                  <Button
                    onClick={() => commitMutation.mutate((batch.warning_rows ?? 0) > 0)}
                    disabled={!canCommit}
                    className="gap-2"
                  >
                    {commitMutation.isPending || pollingAfterTimeout ? (
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
                {typeof commitMutation.data?.employeesNotified === "number" && (
                  <span className="text-sm text-slate-500 font-normal">
                    · {commitMutation.data.employeesNotified > 0
                      ? `${commitMutation.data.employeesNotified} employee${commitMutation.data.employeesNotified !== 1 ? "s" : ""} notified to acknowledge`
                      : "no new employees to notify (already acknowledged, or this batch is linked to a cycle that publishes separately)"}
                  </span>
                )}
              </div>
            )}

            {pollingAfterTimeout ? (
              <p className="px-4 pb-3 text-sm text-amber-600 flex items-center gap-2">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                The commit is taking longer than expected — the server is still processing this
                batch in the background. Checking automatically every 5s; no need to resubmit.
              </p>
            ) : commitMutation.isError && (
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
          <div className="flex flex-wrap items-center gap-3">
            <Input
              value={gridSearch}
              onChange={(e) => setGridSearch(e.target.value)}
              placeholder="Search employee name or code…"
              className="max-w-xs h-8 text-sm"
            />
            <button
              onClick={() => setIssuesOnly((v) => !v)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                issuesOnly
                  ? "bg-red-600 text-white border-red-600"
                  : "bg-white text-slate-500 border-slate-300 hover:bg-slate-50"
              }`}
            >
              Errors & warnings only
            </button>
            <span className="text-xs text-slate-400">
              Showing {visibleEmployees.length} of {employees.length} employees
            </span>
          </div>
        )}

        {employees.length > 0 && visibleEmployees.length === 0 && (
          <div className="text-center py-10 text-slate-400 border rounded-xl bg-white">
            No employees match {issuesOnly ? "the current filter" : "your search"}.
          </div>
        )}

        {visibleEmployees.length > 0 && (
          <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
            <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
              <table className="text-xs border-collapse min-w-full">
                <thead className="sticky top-0 z-20">
                  <tr className="bg-slate-50 border-b">
                    <th className="sticky left-0 z-30 bg-slate-50 px-3 py-2 text-left font-semibold text-slate-600 min-w-[170px] border-r">
                      Employee ({visibleEmployees.length})
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
                  {visibleEmployees.map((emp) => {
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
                    Active {batch?.branch_id && !batch?.process_id ? "branch" : "process"} employees whose code wasn't found in this file
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
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
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {missingEmployees.map((emp) => (
                      <tr key={emp.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2 font-mono text-xs">{emp.employee_code}</td>
                        <td className="px-4 py-2 font-medium">{emp.full_name}</td>
                        <td className="px-4 py-2 text-slate-500">{emp.designation || "—"}</td>
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
