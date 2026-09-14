import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { hrmsApi } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { useWfmScopeFilter, filterByScope } from "@/hooks/useWfmScopeFilter";
import {
  CheckCircle2,
  ChevronRight,
  Zap,
  Send,
  Lock,
  XCircle,
  Download,
  ArrowRight,
  Users,
  AlertTriangle,
  LayoutGrid,
} from "lucide-react";

// ─── Date helpers (IST-safe, local arithmetic) ────────────────────────────────

function localYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function nextMonday(): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = today.getDay();
  const daysUntilMon = day === 1 ? 7 : (8 - day) % 7 || 7;
  today.setDate(today.getDate() + daysUntilMon);
  return localYMD(today);
}

function sundayAfter(mondayStr: string): string {
  const d = new Date(mondayStr + "T00:00:00");
  d.setDate(d.getDate() + 6);
  return localYMD(d);
}

function isoWeekNum(dateStr: string): number {
  const d = new Date(dateStr + "T00:00:00");
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const diff = d.getTime() - startOfWeek1.getTime();
  return Math.floor(diff / (7 * 24 * 3600 * 1000)) + 1;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Process    { id: string; name: string }
interface Branch     { id: string; name: string }
interface PlanRecord {
  id: string;
  plan_name: string | null;
  process_id: string | null;
  from_date: string;
  to_date: string;
  plan_status: string;
  approval_status: string | null;
  last_coverage_score: number | null;
  publish_lock_status: string | null;
}
interface Assignment {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  roster_date: string;
  shift_code: string | null;
  shift_name: string | null;
  roster_status: string;
  acknowledgement_status: string | null;
}
interface CoverageData {
  plan_id: string;
  coverage_score: number;
  total_required: number;
  total_assigned: number;
  open_gaps: number;
  critical_gaps: number;
}
interface ConflictItem {
  employee_id: string;
  employee_name: string;
  conflict_type: string;
  conflict_date: string;
  severity: string;
}
interface ApprovalLogEntry {
  id: string;
  action: string;
  actor_name: string;
  remarks: string | null;
  created_at: string;
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  draft:     { label: "Draft",     cls: "bg-slate-100 text-slate-700"   },
  generated: { label: "Generated", cls: "bg-sky-100 text-sky-700"       },
  submitted: { label: "Submitted", cls: "bg-amber-100 text-amber-700"   },
  approved:  { label: "Approved",  cls: "bg-emerald-100 text-emerald-700" },
  published: { label: "Published", cls: "bg-blue-100 text-blue-700"     },
  rejected:  { label: "Rejected",  cls: "bg-red-100 text-red-700"       },
};

const STEPS = [
  { n: 1, label: "Setup"            },
  { n: 2, label: "Demand & HC"      },
  { n: 3, label: "Generate & Review"},
  { n: 4, label: "Submit & Approve" },
  { n: 5, label: "Publish"          },
];

// ─── Stepper ─────────────────────────────────────────────────────────────────

function Stepper({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-0 mb-6">
      {STEPS.map((s, i) => (
        <div key={s.n} className="flex items-center">
          <div className={`flex flex-col items-center ${i > 0 ? "ml-2" : ""}`}>
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-colors ${
                step > s.n
                  ? "bg-teal-600 border-teal-600 text-white"
                  : step === s.n
                  ? "bg-white border-teal-600 text-teal-700"
                  : "bg-white border-slate-300 text-slate-400"
              }`}
            >
              {step > s.n ? <CheckCircle2 className="h-4 w-4" /> : s.n}
            </div>
            <span className={`text-[10px] mt-1 font-medium whitespace-nowrap ${
              step === s.n ? "text-teal-700" : step > s.n ? "text-teal-600" : "text-slate-400"
            }`}>{s.label}</span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={`h-0.5 w-8 mx-1 mt-[-18px] ${step > s.n ? "bg-teal-600" : "bg-slate-200"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function RosterPipelinePage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { roleKeys } = useWorkforceAccess();
  const {
    processIds: scopedProcessIds,
    branchIds: scopedBranchIds,
    hasAllAccess,
  } = useWfmScopeFilter();

  const canGenerate = roleKeys.some((r) => ["admin", "wfm", "super_admin"].includes(r));
  const canApprove  = roleKeys.some((r) => ["process_manager", "admin", "super_admin"].includes(r));
  const canPublish  = roleKeys.some((r) => ["process_manager", "admin", "super_admin"].includes(r));

  // ── Wizard state ────────────────────────────────────────────────────────────
  const [step, setStep]             = useState<1 | 2 | 3 | 4 | 5>(1);
  const [processId, setProcessId]   = useState("");
  const [branchId, setBranchId]     = useState("");
  const [fromDate, setFromDate]     = useState(nextMonday);
  const [toDate, setToDate]         = useState(() => sundayAfter(nextMonday()));
  const [shrinkagePct, setShrinkage]= useState(20);
  const [planId, setPlanId]         = useState<string | null>(null);

  const [rejectOpen, setRejectOpen]   = useState(false);
  const [rejectRemarks, setRejectRemarks] = useState("");

  // ── Step 1: masters ─────────────────────────────────────────────────────────
  const { data: procResp } = useQuery<{ data: Process[] }>({
    queryKey: ["processes"],
    queryFn: () => hrmsApi.get<{ data: Process[] }>("/api/processes"),
    staleTime: 10 * 60 * 1000,
  });
  const { data: branchResp } = useQuery<{ data: Branch[] }>({
    queryKey: ["branches-active"],
    queryFn: () => hrmsApi.get<{ data: Branch[] }>("/api/org/branches?active_status=1"),
    staleTime: 10 * 60 * 1000,
  });
  const allProcesses = procResp?.data ?? [];
  const allBranches  = branchResp?.data ?? [];
  // Filter processes/branches based on user's assigned scope (branch_head/process_manager/operations_manager)
  const processes = filterByScope(allProcesses, scopedProcessIds, hasAllAccess);
  const branches  = filterByScope(allBranches, scopedBranchIds, hasAllAccess);

  // ── Step 1: create or load plan ─────────────────────────────────────────────
  const createPlanMutation = useMutation({
    mutationFn: async () => {
      // Check if plan already exists
      const existing = await hrmsApi.get<{ data: PlanRecord[] }>(
        `/api/wfm/auto-roster/plans?from_date=${fromDate}&to_date=${toDate}${processId ? `&process_id=${processId}` : ""}`
      );
      if (existing.data.length > 0) return existing.data[0];
      const weekNum = isoWeekNum(fromDate);
      const procName = processes.find((p) => p.id === processId)?.name ?? processId.substring(0, 8);
      const res = await hrmsApi.post<{ data: PlanRecord }>("/api/wfm/auto-roster/plans", {
        plan_name: `W${weekNum} ${procName}`,
        process_id: processId || null,
        branch_id:  branchId  || null,
        from_date:  fromDate,
        to_date:    toDate,
        shrinkage_pct: shrinkagePct,
      });
      return res.data;
    },
    onSuccess: (plan) => {
      setPlanId(plan.id);
      setStep(2);
    },
  });

  // ── Step 2: slot requirements ────────────────────────────────────────────────
  const { data: reqResp, isLoading: reqLoading } = useQuery<{ data: any[] }>({
    queryKey: ["slot-req", processId, fromDate, toDate],
    queryFn: () =>
      hrmsApi.get<{ data: any[] }>(
        `/api/wfm/slot-requirements?processId=${processId}&fromDate=${fromDate}&toDate=${toDate}`
      ),
    enabled: step >= 2 && !!processId,
  });
  const slotReqs = reqResp?.data ?? [];

  // ── Step 3: generate ────────────────────────────────────────────────────────
  const generateMutation = useMutation({
    mutationFn: () => hrmsApi.post<any>(`/api/wfm/auto-roster/plans/${planId}/generate`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["roster-coverage", planId] });
      qc.invalidateQueries({ queryKey: ["roster-conflicts", planId] });
      qc.invalidateQueries({ queryKey: ["roster-assignments-step3", planId] });
    },
  });

  const { data: coverageData } = useQuery<{ data: CoverageData }>({
    queryKey: ["roster-coverage", planId],
    queryFn: () => hrmsApi.get<{ data: CoverageData }>(`/api/wfm/auto-roster/plans/${planId}/coverage`),
    enabled: step >= 3 && !!planId && generateMutation.isSuccess,
  });
  const coverage = coverageData?.data;

  const { data: conflictsData } = useQuery<{ data: ConflictItem[] }>({
    queryKey: ["roster-conflicts", planId],
    queryFn: () => hrmsApi.get<{ data: ConflictItem[] }>(`/api/wfm/auto-roster/plans/${planId}/conflicts`),
    enabled: step >= 3 && !!planId && generateMutation.isSuccess,
  });
  const conflicts = conflictsData?.data ?? [];

  const { data: assignResp } = useQuery<{ data: Assignment[] }>({
    queryKey: ["roster-assignments-step3", planId],
    queryFn: () => hrmsApi.get<{ data: Assignment[] }>(`/api/wfm/auto-roster/plans/${planId}/assignments`),
    enabled: step >= 3 && !!planId && generateMutation.isSuccess,
  });
  const assignments = assignResp?.data ?? [];

  // ── Step 4: plan status re-fetch ────────────────────────────────────────────
  const { data: planResp, refetch: refetchPlan } = useQuery<{ data: PlanRecord[] }>({
    queryKey: ["pipeline-plan-status", planId],
    queryFn: () =>
      hrmsApi.get<{ data: PlanRecord[] }>(
        `/api/wfm/auto-roster/plans?from_date=${fromDate}&to_date=${toDate}${processId ? `&process_id=${processId}` : ""}`
      ),
    enabled: step >= 4 && !!planId,
    refetchInterval: step === 4 ? 10_000 : false,
  });
  const currentPlan = planResp?.data?.find((p) => p.id === planId) ?? null;
  const currentStatus = currentPlan?.approval_status ?? currentPlan?.plan_status ?? "draft";

  const { data: approvalLogResp } = useQuery<{ data: ApprovalLogEntry[] }>({
    queryKey: ["approval-log", planId],
    queryFn: () => hrmsApi.get<{ data: ApprovalLogEntry[] }>(`/api/wfm/auto-roster/plans/${planId}/approval-log`),
    enabled: step >= 4 && !!planId,
  });
  const approvalLog = approvalLogResp?.data ?? [];

  // ── Step 4: mutations ────────────────────────────────────────────────────────
  const submitMutation = useMutation({
    mutationFn: () => hrmsApi.post<any>(`/api/wfm/auto-roster/plans/${planId}/submit`, {}),
    onSuccess: () => { refetchPlan(); qc.invalidateQueries({ queryKey: ["approval-log", planId] }); },
  });
  const approveMutation = useMutation({
    mutationFn: () => hrmsApi.post<any>(`/api/wfm/auto-roster/plans/${planId}/approve`, {}),
    onSuccess: () => { refetchPlan(); qc.invalidateQueries({ queryKey: ["approval-log", planId] }); },
  });
  const rejectMutation = useMutation({
    mutationFn: () =>
      hrmsApi.post<any>(`/api/wfm/auto-roster/plans/${planId}/reject`, { remarks: rejectRemarks }),
    onSuccess: () => {
      setRejectOpen(false);
      setRejectRemarks("");
      refetchPlan();
      qc.invalidateQueries({ queryKey: ["approval-log", planId] });
    },
  });

  // ── Step 5: publish ──────────────────────────────────────────────────────────
  const publishMutation = useMutation({
    mutationFn: () => hrmsApi.post<any>(`/api/wfm/auto-roster/plans/${planId}/publish`, {}),
    onSuccess: () => { refetchPlan(); qc.invalidateQueries({ queryKey: ["approval-log", planId] }); },
  });

  const queueManagerTasksMutation = useMutation({
    mutationFn: () => hrmsApi.post<any>(`/api/wfm/auto-roster/plans/${planId}/queue-manager-tasks`, {}),
  });

  const ackedCount   = assignments.filter((a) => a.acknowledgement_status === "acknowledged").length;
  const totalCount   = assignments.length;

  // CSV download (client-side, no server call)
  function downloadCSV() {
    if (!assignments.length) return;
    const header = "Employee Code,Employee Name,Date,Shift Code,Status\n";
    const rows = assignments.map((a) =>
      [a.employee_code, a.employee_name, a.roster_date, a.shift_code ?? "", a.roster_status].join(",")
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `roster_${fromDate}_${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Mini assignment grid (Step 3) ────────────────────────────────────────────
  const weekDates = useMemo(() => {
    const from = new Date(fromDate + "T00:00:00");
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(from);
      d.setDate(d.getDate() + i);
      return localYMD(d);
    });
  }, [fromDate]);

  type EmpRow = { employee_code: string; employee_name: string; days: Record<string, Assignment> };
  const miniGrid = useMemo<EmpRow[]>(() => {
    const map = new Map<string, EmpRow>();
    for (const a of assignments) {
      if (!map.has(a.employee_id)) {
        map.set(a.employee_id, { employee_code: a.employee_code, employee_name: a.employee_name, days: {} });
      }
      map.get(a.employee_id)!.days[a.roster_date] = a;
    }
    return Array.from(map.values()).slice(0, 15); // show first 15 rows in wizard
  }, [assignments]);

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">

        {/* Header */}
        <div className="rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-700 text-white px-6 py-5">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <LayoutGrid className="h-6 w-6" />
            Roster Pipeline
          </h1>
          <p className="text-indigo-200 text-sm mt-0.5">
            End-to-end 5-step roster planning — from setup to publish
          </p>
        </div>

        <Stepper step={step} />

        {/* ── Step 1: Setup ───────────────────────────────────────────────────── */}
        {step === 1 && (
          <div className="rounded-xl border bg-white p-6 space-y-4">
            <h2 className="text-lg font-semibold text-slate-800">Step 1 — Setup</h2>
            <p className="text-sm text-slate-500">Choose the process, week, and shrinkage for this roster cycle.</p>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Process</label>
                <Select value={processId || "__none__"} onValueChange={(v) => setProcessId(v === "__none__" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Select process…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Any / All</SelectItem>
                    {processes.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Branch</label>
                <Select value={branchId || "__none__"} onValueChange={(v) => setBranchId(v === "__none__" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Select branch…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Any / All</SelectItem>
                    {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">From Date (Monday)</label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => { setFromDate(e.target.value); setToDate(sundayAfter(e.target.value)); }}
                  className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">To Date (Sunday)</label>
                <input
                  type="date"
                  value={toDate}
                  readOnly
                  className="w-full border rounded-md px-3 py-2 text-sm bg-slate-50 text-slate-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Shrinkage % (default 20)</label>
                <input
                  type="number"
                  min={0}
                  max={80}
                  value={shrinkagePct}
                  onChange={(e) => setShrinkage(Number(e.target.value))}
                  className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                disabled={createPlanMutation.isPending}
                onClick={() => createPlanMutation.mutate()}
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                {createPlanMutation.isPending ? "Creating plan…" : "Next: Demand & HC"}
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
            {createPlanMutation.isError && (
              <p className="text-sm text-red-600">Failed to create plan. Check console.</p>
            )}
          </div>
        )}

        {/* ── Step 2: Demand & HC ───────────────────────────────────────────── */}
        {step === 2 && (
          <div className="rounded-xl border bg-white p-6 space-y-4">
            <h2 className="text-lg font-semibold text-slate-800">Step 2 — Demand & Headcount Requirements</h2>
            <p className="text-sm text-slate-500">
              Review slot requirements for {fromDate} → {toDate}.
              If requirements are missing, the generation engine will use DOW template rows.
            </p>

            {reqLoading ? (
              <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : slotReqs.length === 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                No date-specific requirements found. The engine will use day-of-week templates if configured.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="min-w-full text-xs">
                  <thead className="bg-slate-50">
                    <tr>
                      {["Date", "Time", "Required HC", "Shrinkage %", "Productive HC"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left font-semibold text-slate-600 border-b">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {slotReqs.slice(0, 20).map((r: any, i: number) => {
                      const productive = Math.ceil((r.required_hc ?? 0) / (1 - ((r.shrinkage_pct ?? 20) / 100)));
                      return (
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="px-3 py-1.5 border-b">{r.requirement_date ?? r.day_of_week}</td>
                          <td className="px-3 py-1.5 border-b">{r.slot_start_time ?? r.slot_start} – {r.slot_end_time ?? r.slot_end}</td>
                          <td className="px-3 py-1.5 border-b font-medium">{r.required_hc}</td>
                          <td className="px-3 py-1.5 border-b">{r.shrinkage_pct ?? 20}%</td>
                          <td className="px-3 py-1.5 border-b text-teal-700 font-medium">{productive}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {slotReqs.length > 20 && <p className="text-xs text-slate-400 px-3 py-2">+{slotReqs.length - 20} more rows</p>}
              </div>
            )}

            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep(1)}>← Back</Button>
              <Button
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
                onClick={() => setStep(3)}
              >
                Generate Roster →
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 3: Generate & Review ─────────────────────────────────────── */}
        {step === 3 && (
          <div className="rounded-xl border bg-white p-6 space-y-4">
            <h2 className="text-lg font-semibold text-slate-800">Step 3 — Generate & Review</h2>

            {!generateMutation.isSuccess && !generateMutation.isPending && (
              <div className="text-center py-6 space-y-3">
                <Zap className="h-12 w-12 text-indigo-300 mx-auto" />
                <p className="text-slate-600 text-sm">Click to generate draft assignments for the week.</p>
                {canGenerate ? (
                  <Button
                    className="bg-indigo-600 hover:bg-indigo-700 text-white"
                    onClick={() => generateMutation.mutate()}
                  >
                    <Zap className="h-4 w-4 mr-1.5" /> Generate Draft
                  </Button>
                ) : (
                  <p className="text-sm text-red-500">You do not have permission to generate rosters.</p>
                )}
              </div>
            )}

            {generateMutation.isPending && (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600 mx-auto mb-3" />
                <p className="text-slate-500 text-sm">Generating roster assignments…</p>
              </div>
            )}

            {generateMutation.isError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                Generation failed. Check that the plan exists and slot requirements are configured.
              </div>
            )}

            {generateMutation.isSuccess && (
              <>
                {/* Coverage bar */}
                {coverage && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium text-slate-700">Coverage Score</span>
                      <span className={`font-bold ${coverage.coverage_score >= 80 ? "text-emerald-600" : "text-amber-600"}`}>
                        {coverage.coverage_score}%
                      </span>
                    </div>
                    <div className="bg-slate-200 rounded-full h-3">
                      <div
                        className={`h-3 rounded-full transition-all ${coverage.coverage_score >= 80 ? "bg-emerald-500" : "bg-amber-500"}`}
                        style={{ width: `${Math.min(coverage.coverage_score, 100)}%` }}
                      />
                    </div>
                    <div className="flex gap-4 text-xs text-slate-500 flex-wrap">
                      <span>Required: <b>{coverage.total_required}</b></span>
                      <span>Assigned: <b>{coverage.total_assigned}</b></span>
                      <span>Open gaps: <b className={coverage.open_gaps > 0 ? "text-amber-600" : ""}>{coverage.open_gaps}</b></span>
                      <span>Critical gaps: <b className={coverage.critical_gaps > 0 ? "text-red-600" : ""}>{coverage.critical_gaps}</b></span>
                    </div>
                  </div>
                )}

                {/* Conflicts */}
                {conflicts.length === 0 ? (
                  <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" /> No conflicts detected
                  </div>
                ) : (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 space-y-1">
                    <p className="text-sm font-semibold text-red-700 flex items-center gap-1">
                      <AlertTriangle className="h-4 w-4" /> {conflicts.length} conflict(s) found
                    </p>
                    {conflicts.slice(0, 5).map((c, i) => (
                      <p key={i} className="text-xs text-red-600">
                        {c.conflict_date} — {c.employee_name}: {c.conflict_type} <span className={c.severity === "critical" ? "font-bold" : ""}>[{c.severity}]</span>
                      </p>
                    ))}
                    {conflicts.length > 5 && <p className="text-xs text-red-400">+{conflicts.length - 5} more</p>}
                  </div>
                )}

                {/* Mini assignment grid */}
                {miniGrid.length > 0 && (
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="min-w-full text-[11px]">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-2 py-1.5 text-left font-semibold text-slate-600 border-b">Employee</th>
                          {weekDates.map((d) => (
                            <th key={d} className="px-2 py-1.5 text-center font-semibold text-slate-600 border-b min-w-[56px]">
                              {d.substring(5)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {miniGrid.map((emp) => (
                          <tr key={emp.employee_code} className="hover:bg-slate-50">
                            <td className="px-2 py-1 border-b">
                              <div className="font-medium text-slate-700">{emp.employee_name}</div>
                              <div className="text-slate-400">{emp.employee_code}</div>
                            </td>
                            {weekDates.map((d) => {
                              const a = emp.days[d];
                              if (!a) return <td key={d} className="px-1 py-1 border-b text-center text-slate-300">—</td>;
                              const isWO = a.roster_status === "Week Off";
                              return (
                                <td key={d} className="px-1 py-1 border-b text-center">
                                  <span className={`inline-block rounded px-1 text-[10px] font-medium ${isWO ? "bg-slate-100 text-slate-500" : "bg-indigo-50 text-indigo-800"}`}>
                                    {isWO ? "WO" : (a.shift_code ?? a.shift_name ?? "?")}
                                  </span>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {assignments.length > 15 && (
                      <p className="text-xs text-slate-400 px-3 py-2">
                        Showing 15 of {assignments.length} employees. See <a href="/wfm/roster-workspace" className="text-indigo-600 underline">Roster Workspace</a> for full grid.
                      </p>
                    )}
                  </div>
                )}
              </>
            )}

            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep(2)}>← Back</Button>
              {generateMutation.isSuccess && (
                <Button
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                  onClick={() => setStep(4)}
                >
                  Submit for Approval →
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              )}
            </div>
          </div>
        )}

        {/* ── Step 4: Submit & Approve ─────────────────────────────────────── */}
        {step === 4 && (
          <div className="rounded-xl border bg-white p-6 space-y-4">
            <h2 className="text-lg font-semibold text-slate-800">Step 4 — Submit & Approve</h2>

            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm text-slate-600">Current status:</span>
              {(() => {
                const badge = STATUS_BADGE[currentStatus] ?? { label: currentStatus, cls: "bg-slate-100 text-slate-600" };
                return <Badge className={badge.cls}>{badge.label}</Badge>;
              })()}
            </div>

            <div className="flex flex-wrap gap-2">
              {/* Submit: draft or generated */}
              {["draft", "generated"].includes(currentStatus) && canGenerate && (
                <Button
                  variant="outline"
                  className="border-amber-400 text-amber-700 hover:bg-amber-50"
                  disabled={submitMutation.isPending}
                  onClick={() => submitMutation.mutate()}
                >
                  <Send className="h-4 w-4 mr-1.5" />
                  {submitMutation.isPending ? "Submitting…" : "Submit for Approval"}
                </Button>
              )}

              {/* Approve: submitted */}
              {currentStatus === "submitted" && canApprove && (
                <Button
                  variant="outline"
                  className="border-emerald-400 text-emerald-700 hover:bg-emerald-50"
                  disabled={approveMutation.isPending}
                  onClick={() => approveMutation.mutate()}
                >
                  <CheckCircle2 className="h-4 w-4 mr-1.5" />
                  {approveMutation.isPending ? "Approving…" : "Approve"}
                </Button>
              )}

              {/* Reject: submitted */}
              {currentStatus === "submitted" && canApprove && (
                <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" className="border-red-400 text-red-700 hover:bg-red-50">
                      <XCircle className="h-4 w-4 mr-1.5" /> Reject
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Reject Roster Plan</DialogTitle>
                    </DialogHeader>
                    <Textarea
                      placeholder="Reason for rejection (min 5 characters)…"
                      value={rejectRemarks}
                      onChange={(e) => setRejectRemarks(e.target.value)}
                      rows={4}
                    />
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
                      <Button
                        variant="destructive"
                        disabled={rejectRemarks.trim().length < 5 || rejectMutation.isPending}
                        onClick={() => rejectMutation.mutate()}
                      >
                        {rejectMutation.isPending ? "Rejecting…" : "Confirm Reject"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
            </div>

            {/* Approval log */}
            {approvalLog.length > 0 && (
              <div className="overflow-x-auto rounded-lg border">
                <table className="min-w-full text-xs">
                  <thead className="bg-slate-50">
                    <tr>
                      {["Action", "Actor", "Remarks", "When"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left font-semibold text-slate-600 border-b">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {approvalLog.map((entry) => (
                      <tr key={entry.id} className="hover:bg-slate-50">
                        <td className="px-3 py-1.5 border-b capitalize">{entry.action}</td>
                        <td className="px-3 py-1.5 border-b">{entry.actor_name}</td>
                        <td className="px-3 py-1.5 border-b text-slate-500">{entry.remarks ?? "—"}</td>
                        <td className="px-3 py-1.5 border-b text-slate-400">{new Date(entry.created_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep(3)}>← Back</Button>
              {currentStatus === "approved" && (
                <Button
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                  onClick={() => setStep(5)}
                >
                  Publish →
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              )}
            </div>
          </div>
        )}

        {/* ── Step 5: Publish ──────────────────────────────────────────────── */}
        {step === 5 && (
          <div className="rounded-xl border bg-white p-6 space-y-4">
            <h2 className="text-lg font-semibold text-slate-800">Step 5 — Publish & Lock</h2>

            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm text-slate-600">Status:</span>
              {(() => {
                const badge = STATUS_BADGE[currentStatus] ?? { label: currentStatus, cls: "bg-slate-100 text-slate-600" };
                return <Badge className={badge.cls}>{badge.label}</Badge>;
              })()}
            </div>

            {currentStatus === "approved" && canPublish && (
              <Button
                className="bg-teal-600 hover:bg-teal-700 text-white"
                disabled={publishMutation.isPending}
                onClick={() => publishMutation.mutate()}
              >
                <Lock className="h-4 w-4 mr-1.5" />
                {publishMutation.isPending ? "Publishing…" : "Publish + Lock Roster"}
              </Button>
            )}

            {currentStatus === "published" && (
              <>
                <div className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" />
                  Roster published and locked. Employees will see this in My Roster.
                </div>

                {/* Acknowledgement widget */}
                <div className="rounded-lg border bg-slate-50 px-4 py-3 flex items-center gap-4">
                  <Users className="h-8 w-8 text-slate-400" />
                  <div>
                    <div className="text-sm font-medium text-slate-700">Employee Acknowledgements</div>
                    <div className="text-2xl font-bold text-slate-800">
                      {ackedCount} <span className="text-slate-400 text-base font-normal">/ {totalCount}</span>
                    </div>
                    <div className="text-xs text-slate-500">employees acknowledged</div>
                  </div>
                  <div className="flex-1">
                    <div className="bg-slate-200 rounded-full h-2">
                      <div
                        className="h-2 rounded-full bg-emerald-500"
                        style={{ width: totalCount > 0 ? `${(ackedCount / totalCount) * 100}%` : "0%" }}
                      />
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={queueManagerTasksMutation.isPending}
                    onClick={() => queueManagerTasksMutation.mutate()}
                  >
                    {queueManagerTasksMutation.isSuccess ? <CheckCircle2 className="h-4 w-4 mr-1.5 text-emerald-600" /> : null}
                    Queue Manager Tasks
                  </Button>
                  <Button variant="outline" onClick={downloadCSV}>
                    <Download className="h-4 w-4 mr-1.5" /> Download CSV
                  </Button>
                  <Button
                    variant="outline"
                    className="text-teal-700 border-teal-400 hover:bg-teal-50"
                    onClick={() => navigate("/wfm/roster-workspace")}
                  >
                    <ArrowRight className="h-4 w-4 mr-1.5" /> Open Roster Workspace
                  </Button>
                </div>
              </>
            )}

            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep(4)}>← Back</Button>
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
