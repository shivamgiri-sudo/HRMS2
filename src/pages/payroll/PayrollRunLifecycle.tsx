/**
 * Payroll Run Lifecycle — the run pipeline as a visual stage timeline.
 *
 * Payroll run state was only ever surfaced as a single text badge, so "finalized"
 * looked identical whether a run had been validated, compliance-checked, approved by
 * Finance, acknowledged and disbursed — or had simply been imported with a status
 * string and none of that ever happening.
 *
 * salary_prep_run already carries a stamped column pair (…_at / …_by) for each stage,
 * and GET /api/payroll/runs returns the whole row, so this view needs no new endpoint.
 *
 * WHY STAGES CAN READ "no evidence recorded"
 * ------------------------------------------
 * On the live database all 103 runs sit at status 'finalized', but only created_at and
 * attendance_snapshot_locked are populated — validated_at, compliance_checked_at,
 * finance_approved_at, ceo_acknowledged_at and disbursed_at are NULL on every single
 * run, because the history was migrated in rather than driven through the app.
 *
 * This view deliberately does NOT infer those stages from the badge. A run that says
 * finalized while holding no approval evidence is exactly the thing a payroll sign-off
 * reviewer needs to see, so it is shown as an explicit gap rather than back-filled with
 * an assumption. When runs start being processed in-app the same columns light up with
 * no change here.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertTriangle, Ban, Calculator, CalendarCheck, CheckCircle2, CircleDashed,
  FileCheck2, Landmark, Lock, ShieldCheck, Sparkles, Wallet,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Types — salary_prep_run as returned by GET /api/payroll/runs
// ─────────────────────────────────────────────────────────────────────────────
interface PayrollRun {
  id: string;
  run_month: string | null;
  status: string | null;
  total_employees: number | string | null;
  total_gross: number | string | null;
  total_net: number | string | null;
  created_at: string | null;
  created_by: string | null;
  attendance_snapshot_locked: string | null;
  validated_at: string | null;
  validated_by: string | null;
  validation_status: string | null;
  compliance_checked_at: string | null;
  compliance_issues_count: number | string | null;
  incentives_applied_at: string | null;
  finance_approved_at: string | null;
  finance_approved_by: string | null;
  finance_remarks: string | null;
  ceo_acknowledged_at: string | null;
  ceo_acknowledged_by: string | null;
  disbursed_at: string | null;
  disbursed_by: string | null;
  auto_closed_at: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
  rejection_reason: string | null;
}

interface RunsResponse {
  success: boolean;
  data: PayrollRun[];
  total?: number;
}

type StageKey =
  | "created" | "attendance" | "calculated" | "validated"
  | "compliance" | "finance" | "ceo" | "disbursed";

interface StageDef {
  key: StageKey;
  label: string;
  blurb: string;
  icon: typeof CheckCircle2;
  /** Timestamp column proving this stage happened. */
  at: keyof PayrollRun | null;
  /** Actor column, when the schema records one. */
  by: keyof PayrollRun | null;
}

/**
 * The pipeline, in the order salary_prep_run's own columns imply.
 *
 * "Calculated" has no dedicated timestamp on the run row — totals being present is the
 * only evidence the calculation ran — so it is derived rather than stamped, and marked
 * as such in the UI instead of pretending to a precise time.
 */
const STAGES: StageDef[] = [
  { key: "created",    label: "Run Created",         blurb: "Run opened for the month",           icon: CalendarCheck, at: "created_at",                 by: "created_by" },
  { key: "attendance", label: "Attendance Locked",   blurb: "Attendance snapshot frozen",         icon: Lock,          at: "attendance_snapshot_locked", by: null },
  { key: "calculated", label: "Calculated",          blurb: "Salary lines computed",              icon: Calculator,    at: null,                         by: null },
  { key: "validated",  label: "Validated",           blurb: "Pre-approval validation run",        icon: FileCheck2,    at: "validated_at",               by: "validated_by" },
  { key: "compliance", label: "Compliance Checked",  blurb: "Statutory checks cleared",           icon: ShieldCheck,   at: "compliance_checked_at",      by: null },
  { key: "finance",    label: "Finance Approved",    blurb: "Finance sign-off",                   icon: Landmark,      at: "finance_approved_at",        by: "finance_approved_by" },
  { key: "ceo",        label: "CEO Acknowledged",    blurb: "Executive acknowledgement",          icon: Sparkles,      at: "ceo_acknowledged_at",        by: "ceo_acknowledged_by" },
  { key: "disbursed",  label: "Disbursed",           blurb: "Payment released to bank",           icon: Wallet,        at: "disbursed_at",               by: "disbursed_by" },
];

/** Stages whose absence on a settled run is a governance gap worth surfacing. */
const APPROVAL_STAGES: StageKey[] = ["validated", "compliance", "finance"];

const CLOSED_STATUSES = new Set(["locked", "disbursed", "finalized"]);
const isClosed = (s: string | null): boolean =>
  CLOSED_STATUSES.has(String(s ?? "").trim().toLowerCase());

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const inr = (v: unknown): string => num(v).toLocaleString("en-IN", { maximumFractionDigits: 0 });

const fmtDate = (v: string | null): string => {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? String(v)
    : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

type StageState = "done" | "derived" | "missing";

interface ResolvedStage extends StageDef {
  state: StageState;
  at_value: string | null;
  by_value: string | null;
}

function resolveStages(run: PayrollRun): ResolvedStage[] {
  return STAGES.map((s) => {
    // "Calculated" is inferred from totals — there is no stamped column for it.
    if (s.key === "calculated") {
      const ran = num(run.total_employees) > 0 || num(run.total_net) > 0;
      return { ...s, state: ran ? "derived" : "missing", at_value: null, by_value: null };
    }
    const at = s.at ? (run[s.at] as string | null) : null;
    const by = s.by ? (run[s.by] as string | null) : null;
    return { ...s, state: at ? "done" : "missing", at_value: at, by_value: by };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage timeline
// ─────────────────────────────────────────────────────────────────────────────
function StageTimeline({ run }: { run: PayrollRun }) {
  const stages = resolveStages(run);
  const rejected = !!run.rejected_at;

  return (
    <ol className="relative space-y-0">
      {stages.map((s, i) => {
        const Icon = s.icon;
        const last = i === stages.length - 1;
        const done = s.state === "done";
        const derived = s.state === "derived";

        const ring =
          done ? "border-emerald-500 bg-emerald-50 text-emerald-700"
            : derived ? "border-sky-400 bg-sky-50 text-sky-700"
              : "border-slate-200 bg-white text-slate-300";
        const rail = done || derived ? "bg-emerald-200" : "bg-slate-200";

        return (
          <li key={s.key} className="relative flex gap-3 pb-5 last:pb-0">
            {/* connector rail */}
            {!last && <span className={`absolute left-[15px] top-8 h-full w-0.5 ${rail}`} aria-hidden />}

            <span className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 ${ring}`}>
              {done ? <CheckCircle2 className="h-4 w-4" />
                : derived ? <Icon className="h-4 w-4" />
                  : <CircleDashed className="h-4 w-4" />}
            </span>

            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <p className={`text-sm font-bold ${done || derived ? "text-slate-800" : "text-slate-400"}`}>
                  {s.label}
                </p>
                {done && s.at_value && (
                  <span className="text-xs font-medium text-emerald-700">{fmtDate(s.at_value)}</span>
                )}
                {derived && (
                  <Badge variant="outline" className="border-sky-200 bg-sky-50 text-[10px] text-sky-700">
                    inferred from totals — not timestamped
                  </Badge>
                )}
                {s.state === "missing" && (
                  <Badge variant="outline" className="border-slate-200 bg-slate-50 text-[10px] text-slate-500">
                    no evidence recorded
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 text-xs text-slate-500">{s.blurb}</p>

              {s.key === "compliance" && done && num(run.compliance_issues_count) > 0 && (
                <p className="mt-1 text-xs font-semibold text-amber-700">
                  {num(run.compliance_issues_count)} compliance issue(s) recorded
                </p>
              )}
              {s.key === "finance" && run.finance_remarks && (
                <p className="mt-1 text-xs italic text-slate-600">“{run.finance_remarks}”</p>
              )}
            </div>
          </li>
        );
      })}

      {rejected && (
        <li className="relative flex gap-3 pt-1">
          <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-rose-400 bg-rose-50 text-rose-700">
            <Ban className="h-4 w-4" />
          </span>
          <div className="pt-0.5">
            <p className="text-sm font-bold text-rose-800">
              Rejected <span className="ml-1 text-xs font-medium">{fmtDate(run.rejected_at)}</span>
            </p>
            {run.rejection_reason && (
              <p className="mt-0.5 text-xs text-rose-700">{run.rejection_reason}</p>
            )}
          </div>
        </li>
      )}
    </ol>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────
export default function PayrollRunLifecycle() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery<RunsResponse>({
    queryKey: ["payroll-runs-lifecycle"],
    queryFn: () => hrmsApi.get<RunsResponse>("/api/payroll/runs?limit=24"),
    staleTime: 60_000,
  });

  const runs = useMemo(() => data?.data ?? [], [data]);
  const selected = useMemo(
    () => runs.find((r) => r.id === selectedId) ?? runs[0] ?? null,
    [runs, selectedId],
  );

  /** A settled run holding none of the approval evidence its own schema provides for. */
  const unevidenced = useMemo(() => {
    if (!selected || !isClosed(selected.status)) return [];
    return resolveStages(selected)
      .filter((s) => APPROVAL_STAGES.includes(s.key) && s.state === "missing")
      .map((s) => s.label);
  }, [selected]);

  return (
    <DashboardLayout>
      <div className="space-y-5 p-1">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-black text-slate-900">
            <CircleDashed className="h-6 w-6 text-blue-600" />
            Payroll Run Lifecycle
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Where each payroll run actually reached in the pipeline — and which sign-off
            stages have evidence behind them.
          </p>
        </div>

        {isError && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <p className="font-semibold text-amber-900">Could not load payroll runs</p>
              <p className="mt-1 text-sm text-amber-800">
                {String((error as Error)?.message ?? "Request failed.")}
              </p>
            </div>
          </div>
        )}

        {isLoading && (
          <div className="py-20 text-center text-sm text-slate-400 animate-pulse">Loading runs…</div>
        )}

        {!isLoading && !isError && !runs.length && (
          <div className="rounded-xl border border-slate-200 bg-white py-16 text-center text-sm text-slate-400">
            No payroll runs found.
          </div>
        )}

        {!isLoading && !isError && !!runs.length && selected && (
          <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
            {/* Run picker */}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Runs ({runs.length})
              </p>
              <div className="max-h-[65vh] space-y-1.5 overflow-auto pr-1">
                {runs.map((r) => {
                  const active = r.id === selected.id;
                  const gaps = isClosed(r.status)
                    ? resolveStages(r).filter((s) => APPROVAL_STAGES.includes(s.key) && s.state === "missing").length
                    : 0;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setSelectedId(r.id)}
                      className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                        active
                          ? "border-blue-500 bg-blue-50"
                          : "border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-slate-800">{r.run_month ?? "—"}</span>
                        <Badge
                          variant="outline"
                          className={
                            isClosed(r.status)
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-amber-200 bg-amber-50 text-amber-700"
                          }
                        >
                          {r.status ?? "—"}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {num(r.total_employees)} employees · ₹{inr(r.total_net)} net
                      </p>
                      {gaps > 0 && (
                        <p className="mt-0.5 text-xs font-semibold text-amber-700">
                          {gaps} sign-off stage{gaps === 1 ? "" : "s"} unevidenced
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Selected run detail */}
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Card>
                  <CardContent className="pt-4 pb-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Run Month</p>
                    <p className="mt-1 text-2xl font-black text-slate-800">{selected.run_month ?? "—"}</p>
                    <p className="mt-0.5 text-xs text-slate-500">Status: {selected.status ?? "—"}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Employees</p>
                    <p className="mt-1 text-2xl font-black text-slate-800">{num(selected.total_employees)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Net Payable</p>
                    <p className="mt-1 text-2xl font-black text-slate-800">₹{inr(selected.total_net)}</p>
                  </CardContent>
                </Card>
              </div>

              {unevidenced.length > 0 && (
                <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                  <div>
                    <p className="font-semibold text-amber-900">
                      This run is settled but carries no sign-off evidence
                    </p>
                    <p className="mt-1 text-sm text-amber-800">
                      Status reads <strong>{selected.status}</strong>, yet {unevidenced.join(", ")}{" "}
                      {unevidenced.length === 1 ? "was" : "were"} never stamped on the run. Runs
                      migrated from the legacy system carry a status but no approval trail, so this
                      is expected on historical months and is shown rather than assumed.
                    </p>
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Pipeline
                </p>
                <StageTimeline run={selected} />
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
