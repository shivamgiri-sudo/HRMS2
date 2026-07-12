import { useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Bell, CheckCircle2, ClipboardList, IndianRupee,
  CalendarDays, AlertTriangle, CheckCheck,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface WorkItem {
  id: string;
  item_type?: string;
  title?: string;
  description?: string;
  priority?: string;
  status?: string;
  due_at?: string;
}

interface Alert {
  id: string;
  alert_type: string;
  message?: string;
  severity?: "low" | "medium" | "high" | "critical";
  created_at?: string;
  employee_name?: string;
  employee_code?: string;
}

interface ExpenseClaim {
  id: string | number;
  claim_number?: string;
  employee_id?: number;
  total_amount?: number;
  currency?: string;
  status?: string;
  submitted_date?: string;
}

interface RosterItem {
  id: string;
  employee_name?: string;
  employee_code?: string;
  reason?: string;
  roster_date?: string;
}

const SEVERITY_STYLE: Record<string, string> = {
  critical: "bg-rose-50 border-rose-200 text-rose-800",
  high:     "bg-rose-50 border-rose-200 text-rose-800",
  medium:   "bg-amber-50 border-amber-200 text-amber-800",
  low:      "bg-blue-50 border-blue-200 text-blue-800",
  info:     "bg-blue-50 border-blue-200 text-blue-800",
};

const PRIORITY_PILL: Record<string, string> = {
  high:   "bg-rose-100 text-rose-700",
  medium: "bg-amber-100 text-amber-700",
  low:    "bg-slate-100 text-slate-600",
};

// ── Section header ────────────────────────────────────────────
function SectionHeader({ icon, label, count, accent }: {
  icon: React.ReactNode; label: string; count: number; accent: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className={`rounded-lg p-1.5 ${accent}`}>{icon}</span>
      <h3 className="text-sm font-semibold text-slate-700">{label}</h3>
      <span className={`ml-1 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-xs font-bold ${accent}`}>
        {count}
      </span>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────
export default function TeamActionsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: workData, isLoading: w1 } = useQuery({
    queryKey: ["work-inbox", "team"],
    queryFn: () => hrmsApi.get<any>("/api/work-inbox/team"),
    staleTime: 30_000,
  });

  const { data: alertsData, isLoading: w2 } = useQuery({
    queryKey: ["management", "alerts", "unack"],
    queryFn: () => hrmsApi.get<any>("/api/management/alerts?acknowledged=false"),
    staleTime: 30_000,
  });

  const { data: expenseData, isLoading: w3 } = useQuery({
    queryKey: ["expenses", "pending-approval"],
    queryFn: () => hrmsApi.get<any>("/api/expenses/claims/pending-approval"),
    staleTime: 30_000,
  });

  const { data: rosterData, isLoading: w4 } = useQuery({
    queryKey: ["wfm", "manager-weekoff-review"],
    queryFn: () => hrmsApi.get<any>("/api/wfm/manager/weekoff-review"),
    staleTime: 30_000,
  });

  const isLoading = w1 || w2 || w3 || w4;

  const workItems: WorkItem[] = ((workData as any)?.data ?? (workData as any)?.items ?? [])
    .filter((w: WorkItem) => !w.status || w.status === "pending");
  const alerts: Alert[] = (alertsData as any)?.data ?? [];
  // Expenses: response key is `claims` not `data`
  const expenses: ExpenseClaim[] = (expenseData as any)?.claims ?? (expenseData as any)?.data ?? [];
  const rosterItems: RosterItem[] = (rosterData as any)?.data ?? (rosterData as any)?.assignments ?? [];

  const totalPending = workItems.length + alerts.length + expenses.length + rosterItems.length;

  async function ackAlert(id: string) {
    try {
      await hrmsApi.post(`/api/management/alerts/${id}/acknowledge`, {});
      toast({ title: "Alert dismissed" });
      queryClient.invalidateQueries({ queryKey: ["management", "alerts"] });
    } catch {
      toast({ title: "Failed to dismiss", variant: "destructive" });
    }
  }

  if (isLoading) return (
    <div className="space-y-3">
      {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}
    </div>
  );

  if (totalPending === 0) return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white py-20">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 mb-3">
        <CheckCheck className="h-7 w-7 text-emerald-500" />
      </div>
      <p className="text-sm font-semibold text-slate-700">All clear!</p>
      <p className="text-xs text-slate-400 mt-1">No pending actions in your queue</p>
    </div>
  );

  return (
    <div className="space-y-8">
      {/* ── Alerts ── */}
      {alerts.length > 0 && (
        <section>
          <SectionHeader
            icon={<Bell className="h-3.5 w-3.5 text-amber-600" />}
            label="Team Alerts"
            count={alerts.length}
            accent="bg-amber-100 text-amber-700"
          />
          <div className="space-y-2">
            {alerts.map((a) => {
              const style = SEVERITY_STYLE[a.severity ?? "medium"] ?? SEVERITY_STYLE.medium;
              return (
                <div key={a.id} className={`flex items-start gap-3 rounded-2xl border p-4 ${style}`}>
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 opacity-80" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-xs font-semibold uppercase tracking-wide opacity-70">{a.alert_type}</span>
                      {a.employee_name && (
                        <span className="text-xs opacity-60">· {a.employee_name}</span>
                      )}
                    </div>
                    <p className="text-sm">{a.message ?? "—"}</p>
                    {a.created_at && <p className="text-xs opacity-50 mt-0.5">{a.created_at.slice(0, 10)}</p>}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 shrink-0 rounded-xl text-xs opacity-80 hover:opacity-100 cursor-pointer"
                    onClick={() => ackAlert(a.id)}
                  >
                    Dismiss
                  </Button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Expense Approvals ── */}
      {expenses.length > 0 && (
        <section>
          <SectionHeader
            icon={<IndianRupee className="h-3.5 w-3.5 text-emerald-600" />}
            label="Expense Approvals"
            count={expenses.length}
            accent="bg-emerald-100 text-emerald-700"
          />
          <div className="space-y-2">
            {expenses.map((e) => (
              <div key={e.id} className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50">
                  <IndianRupee className="h-5 w-5 text-emerald-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-900">
                    {e.claim_number ?? `Claim #${e.id}`}
                  </p>
                  <p className="text-xs text-slate-500">
                    {e.currency ?? "INR"} {e.total_amount?.toLocaleString("en-IN") ?? "—"}
                    {e.submitted_date ? ` · ${String(e.submitted_date).slice(0, 10)}` : ""}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                  Pending
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Roster realignments ── */}
      {rosterItems.length > 0 && (
        <section>
          <SectionHeader
            icon={<CalendarDays className="h-3.5 w-3.5 text-indigo-600" />}
            label="Roster Realignment Requests"
            count={rosterItems.length}
            accent="bg-indigo-100 text-indigo-700"
          />
          <div className="space-y-2">
            {rosterItems.map((r) => (
              <div key={r.id} className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50">
                  <CalendarDays className="h-5 w-5 text-indigo-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-900">
                    {r.employee_name ?? r.employee_code ?? "—"}
                  </p>
                  <p className="text-xs text-slate-500">
                    {r.roster_date ? `Date: ${r.roster_date}` : ""}
                    {r.reason ? ` · ${r.reason}` : ""}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                  Pending
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Work inbox ── */}
      {workItems.length > 0 && (
        <section>
          <SectionHeader
            icon={<ClipboardList className="h-3.5 w-3.5 text-blue-600" />}
            label="Work Inbox"
            count={workItems.length}
            accent="bg-blue-100 text-blue-700"
          />
          <div className="space-y-2">
            {workItems.slice(0, 10).map((w) => (
              <div key={w.id} className="flex items-start gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50">
                  <ClipboardList className="h-5 w-5 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{w.title ?? w.item_type ?? "Work item"}</p>
                  {w.description && <p className="text-xs text-slate-500 truncate">{w.description}</p>}
                  {w.due_at && (
                    <p className="text-xs text-slate-400 mt-0.5">Due: {String(w.due_at).slice(0, 10)}</p>
                  )}
                </div>
                {w.priority && (
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${PRIORITY_PILL[w.priority] ?? PRIORITY_PILL.medium}`}>
                    {w.priority}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
