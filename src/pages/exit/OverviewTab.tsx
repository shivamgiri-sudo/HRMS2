/**
 * Extracted from NativeExitCommandCenter.tsx (owner ruling 2026-09-26: split the 2600+
 * line page into smaller files). Shared types/consts/primitives live in ./shared.ts.
 */
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, FileText, ShieldCheck, UserMinus } from "lucide-react";
import { Search } from "lucide-react";
import { AIInsightPanel } from "@/components/ai";
import { ChartSkeleton, StatTile } from "@/components/analytics/analytics-kit";
import { NoticePeriodDrawer } from "@/components/exit/NoticePeriodDrawer";
import {
  ExitStagePipeline,
  exitStageOf,
  exitStageOfRow,
  isPendingAtExit,
  type ExitStageKey,
} from "@/components/exit/ExitStagePipeline";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { useApprovalFocus } from "@/hooks/useApprovalFocus";
import { exitTypeBadgeClass, NOC_ELIGIBLE_STATUSES, Pill, reasonLabel, statusFlow, type CenterData } from "./shared";

// ─────────────────────────────────────────────────────────────────────────────
// Overview Tab
// ─────────────────────────────────────────────────────────────────────────────
export function OverviewTab({
  data,
  loading,
  onStatusChange,
  onGenerateClearance,
  onStartNocClearance,
}: {
  data: CenterData | null;
  loading: boolean;
  onStatusChange: (id: string, status: string) => Promise<number>;
  onGenerateClearance: (id: string) => Promise<void>;
  onStartNocClearance: (
    exitRequestId: string,
    employeeId: string,
  ) => Promise<void>;
}) {
  const [stage, setStage] = useState<ExitStageKey | "all">("all");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "voluntary" | "involuntary">("all");
  const [drawerExitId, setDrawerExitId] = useState<string | null>(null);
  const { hasAnyRole } = useWorkforceAccess();

  // Manager-stage transitions (submitted→manager_review, manager_review→accepted) are
  // reserved for the employee's reporting manager. HR's role is clearance tasks + exit
  // interview, not advancing the manager-gate statuses.
  const isManagerRole = hasAnyRole(
    "manager",
    "process_manager",
    "operations_manager",
    "branch_head",
  );
  const isHrOrAdmin = hasAnyRole(
    "admin",
    "super_admin",
    "hr",
    "ceo",
    "branch_admin",
  );
  const isSuperAdmin = hasAnyRole("super_admin", "admin", "ceo");

  function canMoveToStatus(nextStatus: string): boolean {
    // super_admin / admin / ceo can override any stage transition (backend also allows this)
    if (isSuperAdmin) return true;
    // Manager-stage transitions: show ONLY to users who hold an actual manager role.
    // HR/branch_admin do NOT see these buttons — their involvement is via clearance tasks.
    // The backend enforces that the caller must be the actual reporting manager.
    if (["manager_review", "accepted"].includes(nextStatus))
      return isManagerRole;
    if (["notice_serving", "exited"].includes(nextStatus)) return isHrOrAdmin;
    return isHrOrAdmin || isManagerRole; // revoked/withdrawn
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.requests ?? []).filter((r) => {
      if (stage !== "all" && exitStageOfRow(r) !== stage) return false;
      if (typeFilter !== "all" && (r.exit_type ?? "").toLowerCase() !== typeFilter) return false;
      if (!q) return true;
      return [r.employee_name, r.employee_code, r.branch_name, r.process_name]
        .some((v) => v?.toLowerCase().includes(q));
    });
  }, [data, stage, search, typeFilter]);

  // Approval Center deep link: ring the row once the list has rendered.
  useApprovalFocus(!loading && filtered.length > 0);

  const moveStatus = async (id: string, nextStatus: string) => {
    try {
      const pending = await onStatusChange(id, nextStatus);
      const moved = `Moved to ${nextStatus.replace(/_/g, " ")}`;
      setMessage(
        pending > 0
          ? `${moved}. ${pending} clearance task(s) still open; they will block F&F approval.`
          : moved,
      );
    } catch (err: any) {
      const blockers: string[] = err?.payload?.blockers ?? [];
      const detail = blockers.length ? ` — ${blockers.join("; ")}` : "";
      setMessage((err?.message || "Status update failed") + detail);
    }
  };

  const generateClearance = async (id: string) => {
    try {
      await onGenerateClearance(id);
      setMessage("Clearance tasks generated");
    } catch (err: any) {
      setMessage(err?.message || "Unable to generate clearance");
    }
  };

  const startNocClearance = async (
    exitRequestId: string,
    employeeId: string,
  ) => {
    try {
      await onStartNocClearance(exitRequestId, employeeId);
      setMessage(
        "NOC clearance started — see NOC Clearance Chain under Payroll",
      );
    } catch (err: any) {
      setMessage(err?.message || "Unable to start NOC clearance");
    }
  };

  return (
    <div className="space-y-6">
      {/* KPI strip: the pipeline below is the filter, tiles are the headline */}
      {loading && !data ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => <ChartSkeleton key={i} height={36} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatTile label="Total exits" value={Number(data?.summary?.total ?? 0)} denominator="All exit records" icon={<UserMinus className="h-4 w-4" />} onClick={() => setStage("all")} />
          <StatTile label="Pending review" value={Number(data?.summary?.pending_review ?? 0)} denominator="Manager / HR / Admin" intent="warning" icon={<Clock className="h-4 w-4" />} />
          <StatTile label="Active notice" value={Number(data?.summary?.active_notice ?? 0)} denominator="Accepted or serving" icon={<FileText className="h-4 w-4" />} />
          <StatTile label="Completed" value={Number(data?.summary?.completed ?? 0)} denominator="Exit confirmed" intent="good" icon={<CheckCircle2 className="h-4 w-4" />} />
          <StatTile label="Regrettable" value={Number(data?.summary?.regrettable ?? 0)} denominator="Retention attention" intent="critical" icon={<AlertTriangle className="h-4 w-4" />} />
        </div>
      )}

      {/* AI Insight */}
      <AIInsightPanel
        contextType="exit_risk"
        role="hr"
        title="Exit Risk AI Brief"
        enabled={data !== null && !loading}
        data={{
          total_exits: Number(data?.summary?.total ?? 0),
          pending_offboarding: Number(data?.summary?.pending_review ?? 0),
          regrettable_exits: Number(data?.summary?.regrettable ?? 0),
          active_notice: Number(data?.summary?.active_notice ?? 0),
          completed: Number(data?.summary?.completed ?? 0),
          kt_incomplete:
            data?.requests?.filter(
              (r) => r.status !== "exited" && r.status !== "exit_confirmed",
            ).length ?? 0,
          clearance_pending:
            data?.clearance
              ?.filter((c) => c.status === "pending")
              .reduce((s, c) => s + c.count, 0) ?? 0,
        }}
      />

      {message && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
          {message}
        </div>
      )}

      <ExitStagePipeline
        rows={data?.requests ?? []}
        active={stage}
        onSelect={setStage}
      />

      {/* Journey Board */}
      <div className="overflow-hidden rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <div>
            <h2 className="font-bold text-slate-800">Exit Journey Board</h2>
            <p className="text-sm text-slate-500" aria-live="polite">
              {filtered.length} of {data?.requests?.length ?? 0} records
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, code, branch…"
                aria-label="Search exit records"
                className="h-9 w-56 rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-sm outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
              />
            </div>
            <div className="flex gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label="Exit type">
              {(["all", "voluntary", "involuntary"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTypeFilter(t)}
                  aria-pressed={typeFilter === t}
                  className={`cursor-pointer rounded-md px-2.5 py-1 text-xs font-semibold capitalize transition-colors ${typeFilter === t ? "bg-white text-rose-700 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1150px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                {[
                  "Employee",
                  "Branch / Process",
                  "LWD",
                  "Status",
                  "Reason",
                  "Health",
                  "Clearance",
                  "Risk",
                  "Actions",
                ].map((h) => (
                  <th key={h} className="p-4 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const currentIndex = statusFlow.indexOf(
                  r.status === "exit_confirmed" ? "exited" : r.status,
                );
                const nextStatus =
                  currentIndex >= 0 && currentIndex < statusFlow.length - 1
                    ? statusFlow[currentIndex + 1]
                    : null;
                const total = Number(r.clearance_total ?? 0);
                const cleared = Number(r.clearance_cleared ?? 0);
                return (
                  <tr
                    key={r.id}
                    data-approval-id={r.id}
                    className="border-t hover:bg-slate-50/80 transition-colors cursor-pointer"
                    onClick={() => setDrawerExitId(r.id)}
                  >
                    <td className="p-4">
                      <div className="font-semibold text-slate-800">
                        {r.employee_name ?? r.employee_id}
                      </div>
                      <div className="font-mono text-xs text-slate-500">
                        {r.employee_code ?? r.employee_id?.slice(0, 8)}
                      </div>
                    </td>
                    <td className="p-4 text-slate-600">
                      <div>{r.branch_name ?? "—"}</div>
                      <div className="text-xs">{r.process_name ?? "—"}</div>
                    </td>
                    <td className="p-4 font-mono text-xs text-slate-600">
                      {r.last_working_day_proposed ?? "—"}
                    </td>
                    <td className="p-4">
                      <Pill tone="blue">{r.status?.replace(/_/g, " ")}</Pill>
                      <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        Stage: {exitStageOfRow(r)}
                      </div>
                    </td>
                    <td className="p-4">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${exitTypeBadgeClass(r.exit_type)}`}
                      >
                        {r.exit_type ?? "—"}
                      </span>
                      <div className="mt-1 text-xs text-slate-600">
                        {reasonLabel(r.exit_reason_category)}
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="font-bold">
                        {Math.round(Number(r.engagement_score ?? 0))}%
                      </div>
                      <div className="text-xs text-slate-500">Engagement</div>
                    </td>
                    <td className="p-4">
                      <div className="font-bold">
                        {cleared}/{total}
                      </div>
                      <div className="text-xs text-slate-500">Cleared</div>
                      {isPendingAtExit(r) && (
                        <div className="mt-1">
                          <Pill tone="amber">Pending at exit</Pill>
                        </div>
                      )}
                    </td>
                    <td className="p-4">
                      {r.regrettable_exit ? (
                        <Pill tone="red">Regrettable</Pill>
                      ) : (
                        <Pill
                          tone={
                            r.risk_label === "high" ||
                            r.risk_label === "critical"
                              ? "amber"
                              : "green"
                          }
                        >
                          {r.risk_label ?? "low"}
                        </Pill>
                      )}
                    </td>
                    <td className="p-4" onClick={(e) => e.stopPropagation()}>
                      <div className="flex flex-wrap gap-2">
                        {nextStatus && canMoveToStatus(nextStatus) && (
                          <button
                            onClick={() => moveStatus(r.id, nextStatus)}
                            className="rounded-xl bg-slate-950 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 transition-colors"
                          >
                            Move to {nextStatus.replace(/_/g, " ")}
                          </button>
                        )}
                        {total === 0 && (
                          <button
                            onClick={() => generateClearance(r.id)}
                            className="inline-flex items-center gap-1 rounded-xl border px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                          >
                            <ShieldCheck className="h-3 w-3" /> Generate
                            clearance
                          </button>
                        )}
                        {NOC_ELIGIBLE_STATUSES.includes(r.status) && (
                          <button
                            onClick={() =>
                              startNocClearance(r.id, r.employee_id)
                            }
                            className="inline-flex items-center gap-1 rounded-xl border px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                          >
                            <ShieldCheck className="h-3 w-3" /> Start NOC
                            clearance
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!filtered.length && (
          <div className="p-10 text-center text-sm text-slate-500">
            {loading && !data
              ? "Loading exit records…"
              : search || typeFilter !== "all" || stage !== "all"
                ? "No records match these filters."
                : "No exit records found."}
          </div>
        )}
      </div>
      {drawerExitId && (
        <NoticePeriodDrawer
          exitId={drawerExitId}
          onClose={() => setDrawerExitId(null)}
        />
      )}
    </div>
  );
}
