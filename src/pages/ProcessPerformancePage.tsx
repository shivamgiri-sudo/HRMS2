import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi, type HrmsEnvelope } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import ProcessPerformanceTable, { type PerfQuery } from "@/components/process-performance/ProcessPerformanceTable";
import { Activity } from "lucide-react";

/**
 * Process Performance Health Report Card.
 *
 * The process picker is fed by /api/processes/my-processes, which resolves the
 * caller's own assignments — but that endpoint is only the picker. Every figure
 * on the page is scoped again server-side, so an unlisted processId typed into
 * the URL still returns nothing outside the caller's scope.
 */

interface AssignedProcess { id: string; process_name: string }

const SEL = "h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400";

function firstOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
const todayIso = () => new Date().toISOString().slice(0, 10);

export default function ProcessPerformancePage() {
  const [mode, setMode] = useState<"month" | "range">("month");
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
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
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  }, [mode, month, from, to]);

  const { data: procs } = useQuery({
    queryKey: ["my-processes"],
    queryFn: () => hrmsApi.get<HrmsEnvelope<AssignedProcess[]>>("/api/processes/my-processes"),
  });

  // Manager options come from the manager grain of this same scoped endpoint, so
  // the list can only ever contain managers the caller is allowed to see.
  const { data: mgrs } = useQuery({
    queryKey: ["process-performance", "manager-options", processId, range],
    enabled: !!processId,
    queryFn: () => hrmsApi.get<HrmsEnvelope<Array<{ id: string; name: string }>>>(
      `/api/process-performance/managers?processId=${encodeURIComponent(processId)}&from=${range.from}&to=${range.to}`,
    ),
  });

  const query: PerfQuery = {
    from: range.from,
    to: range.to,
    processId: processId || null,
    managerId: managerId || null,
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
              <option value="">All my processes</option>
              {(procs?.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.process_name}</option>)}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="pp-manager" className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Manager</label>
            <select id="pp-manager" className={SEL} value={managerId} disabled={!processId}
              onChange={(e) => setManagerId(e.target.value)}>
              <option value="">{processId ? "All managers" : "Select a process first"}</option>
              {(mgrs?.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        </div>

        <ProcessPerformanceTable query={query} />

        <p className="text-[11px] text-slate-400 px-1">
          Cells marked <span className="italic text-slate-300">not tracked</span> have no data source in the system yet —
          that is different from a low score. Root-cause breakdowns are shown only where the underlying records carry a
          category; where they do not, the reason is stated instead.
        </p>
      </div>
    </DashboardLayout>
  );
}
