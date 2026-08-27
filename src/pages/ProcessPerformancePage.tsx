import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi, type HrmsEnvelope } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import ProcessPerformanceTable, { type PerfQuery } from "@/components/process-performance/ProcessPerformanceTable";
import { Activity, RotateCcw } from "lucide-react";

/**
 * Process Performance Health Report Card.
 *
 * Both pickers are fed by /api/process-performance/filters, which resolves them
 * through the SAME scope predicate the table uses. They were previously fed by
 * /api/processes/my-processes, which reads user_assignment_scope — live that
 * grants a process to ten users in the whole system, so every admin, CEO and COO
 * opened this page to an empty Process picker and, because the Manager picker
 * was gated behind it, no working filters at all.
 *
 * The pickers are only pickers. Every figure is scoped again server-side, so an
 * id typed into the URL still returns nothing outside the caller's scope.
 */

interface FilterOptions {
  processes: Array<{ id: string; name: string }>;
  managers: Array<{ id: string; name: string }>;
}

const SEL = "h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400";

/**
 * Dates are formatted from the LOCAL calendar fields, never via toISOString().
 *
 * In IST (UTC+5:30) a locally-built midnight Date is 18:30 UTC the previous day,
 * so `new Date(2026, 7, 1).toISOString().slice(0, 10)` is "2026-07-31". Picking
 * August therefore queried 31 Jul – 30 Aug: every figure on the page was
 * computed over a window shifted one day at both ends.
 */
const isoLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function firstOfMonth(d = new Date()) {
  return isoLocal(new Date(d.getFullYear(), d.getMonth(), 1));
}
const todayIso = () => isoLocal(new Date());
const currentMonth = () => todayIso().slice(0, 7);

export default function ProcessPerformancePage() {
  const [mode, setMode] = useState<"month" | "range">("month");
  const [month, setMonth] = useState(currentMonth);
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(todayIso);
  const [processId, setProcessId] = useState<string>("");
  const [managerId, setManagerId] = useState<string>("");

  // Month mode derives its own range so the backend only ever sees from/to —
  // one date contract rather than two.
  const range = useMemo(() => {
    if (mode === "range") return { from, to };
    const [y, m] = month.split("-").map(Number);
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 0);
    return { from: isoLocal(start), to: isoLocal(end) };
  }, [mode, month, from, to]);

  // One call for both pickers, through the page's own scope. The manager list
  // narrows to the chosen process when there is one, and stays fully usable when
  // there is not — filtering by manager first is a legitimate way to read this
  // page, and gating it behind a process choice made it unreachable.
  const { data: options } = useQuery({
    queryKey: ["process-performance", "filters", processId],
    queryFn: () => hrmsApi.get<HrmsEnvelope<FilterOptions>>(
      `/api/process-performance/filters${processId ? `?processId=${encodeURIComponent(processId)}` : ""}`,
    ),
  });
  const processes = options?.data?.processes ?? [];
  const managers = options?.data?.managers ?? [];
  const isFiltered = mode !== "month" || month !== currentMonth() || !!processId || !!managerId;

  const query: PerfQuery = {
    from: range.from,
    to: range.to,
    processId: processId || null,
    managerId: managerId || null,
    employeeId: null,
  };

  const resetFilters = () => {
    setMode("month");
    setMonth(currentMonth());
    setFrom(firstOfMonth());
    setTo(todayIso());
    setProcessId("");
    setManagerId("");
  };

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            <Activity className="h-4.5 w-4.5" />
          </span>
          <div>
            <h1 className="text-lg font-bold text-slate-900">Process Performance</h1>
            <p className="text-xs text-slate-500">
              Health report card by process, manager and agent. Every figure is computed from live records.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm p-4 shadow-sm">
          <div className="flex flex-col gap-1">
            <label htmlFor="pp-period" className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Period</label>
            <select id="pp-period" className={SEL} value={mode} onChange={(e) => setMode(e.target.value as "month" | "range")}>
              <option value="month">Month</option>
              <option value="range">Custom range</option>
            </select>
          </div>

          {mode === "month" ? (
            <div className="flex flex-col gap-1">
              <label htmlFor="pp-month" className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Month</label>
              <input id="pp-month" type="month" className={SEL} value={month} onChange={(e) => setMonth(e.target.value)} />
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <label htmlFor="pp-from" className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">From</label>
                <input id="pp-from" type="date" className={SEL} value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="pp-to" className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">To</label>
                <input id="pp-to" type="date" className={SEL} value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </>
          )}

          <div className="flex flex-col gap-1">
            <label htmlFor="pp-process" className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Process</label>
            <select
              id="pp-process"
              className={SEL}
              value={processId}
              onChange={(e) => { setProcessId(e.target.value); setManagerId(""); }}
            >
              <option value="">All processes in my scope</option>
              {processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="pp-manager" className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Manager</label>
            <select id="pp-manager" className={SEL} value={managerId}
              onChange={(e) => setManagerId(e.target.value)}>
              <option value="">All managers</option>
              {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>

          {isFiltered && (
            <button
              type="button"
              onClick={resetFilters}
              className="h-9 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              <RotateCcw className="h-3.5 w-3.5" />Reset
            </button>
          )}
        </div>

        <ProcessPerformanceTable query={query} />

        <p className="text-[11px] text-slate-400 px-1">
          A cell reads <span className="text-slate-400">—</span> when its source holds no rows for that group and period,
          and <span className="italic text-slate-300">not tracked</span> when the figure is not defined at that level —
          neither is a low score. Mandate and Buffer are contracted per cost centre, so they are reported on process rows
          only. Root-cause breakdowns are shown only where the underlying records carry a category; where they do not, the
          reason is stated instead.
        </p>
      </div>
    </DashboardLayout>
  );
}
