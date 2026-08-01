import { useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hrmsApi } from "@/lib/hrmsApi";
import { useToast } from "@/hooks/use-toast";

interface DriftRow {
  employee_id: string;
  employee_code: string;
  full_name: string;
  branch_name: string | null;
  process_name: string | null;
  stored_paid_days: number;
  live_paid_days: number;
  diff: number;
  direction: "underpaid" | "overpaid";
}

interface DriftResult {
  total_drifted: number;
  underpaid_count: number;
  overpaid_count: number;
  snapshot_locked: boolean;
  rows: DriftRow[];
}

type State = "idle" | "scanning" | "results" | "recalculating" | "done";

interface Props {
  runId: string;
  runMonth: string;
  snapshotLocked: boolean;
}

export function SalaryDriftPanel({ runId, runMonth, snapshotLocked }: Props) {
  const { toast } = useToast();
  const [state, setState] = useState<State>("idle");
  const [result, setResult] = useState<DriftResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [doneStats, setDoneStats] = useState<{ processed: number; failed: number } | null>(null);

  const scan = async () => {
    setState("scanning");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: DriftResult }>(
        `/api/payroll/runs/${runId}/drift-check`,
      );
      setResult(res.data);
      setSelected(new Set());
      setState("results");
    } catch (e: any) {
      toast({ title: "Drift scan failed", description: e.message, variant: "destructive" });
      setState("idle");
    }
  };

  const recalculate = async (employeeIds?: string[]) => {
    setState("recalculating");
    try {
      const res = await hrmsApi.post<{ success: boolean; data: { processed: number; failed: number; skipped_locked: number } }>(
        `/api/payroll/runs/${runId}/recalculate-drift`,
        employeeIds?.length ? { employee_ids: employeeIds } : {},
      );
      setDoneStats({ processed: res.data.processed, failed: res.data.failed });
      setState("done");
      toast({
        title: "Recalculation complete",
        description: `${res.data.processed} employees updated · ${res.data.failed} failed · ${res.data.skipped_locked} skipped (locked)`,
      });
    } catch (e: any) {
      toast({ title: "Recalculation failed", description: e.message, variant: "destructive" });
      setState("results");
    }
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (!result) return;
    setSelected(prev =>
      prev.size === result.rows.length
        ? new Set()
        : new Set(result.rows.map(r => r.employee_id)),
    );
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.1em] text-slate-500">Salary Drift Audit</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Employees whose stored paid days differ from live attendance data for {runMonth}.
          </p>
        </div>
        <div className="flex gap-2">
          {(state === "idle" || state === "done") && (
            <Button size="sm" variant="outline" onClick={scan} disabled={snapshotLocked} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />
              {state === "done" ? "Re-scan" : "Scan for Drift"}
            </Button>
          )}
          {state === "results" && result && result.total_drifted > 0 && !snapshotLocked && (
            <>
              {selected.size > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void recalculate(Array.from(selected))}
                  className="gap-1.5 border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Recalculate Selected ({selected.size})
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => void recalculate()}
                className="gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Recalculate All ({result.total_drifted})
              </Button>
            </>
          )}
          {state === "results" && result && result.total_drifted > 0 && (
            <Button size="sm" variant="ghost" onClick={scan} className="text-slate-500">Re-scan</Button>
          )}
        </div>
      </div>

      {snapshotLocked && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center gap-2 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          Attendance snapshot is frozen — recalculation is disabled. Fix gaps before freezing next time.
        </div>
      )}

      {/* States */}
      {state === "scanning" && (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-4">
          <RefreshCw className="h-4 w-4 animate-spin" /> Scanning attendance vs stored salary…
        </div>
      )}

      {state === "recalculating" && (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-4">
          <RefreshCw className="h-4 w-4 animate-spin" /> Recalculating — this may take a moment…
        </div>
      )}

      {state === "done" && doneStats && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-2 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          Done — {doneStats.processed} employees recalculated
          {doneStats.failed > 0 && `, ${doneStats.failed} failed`}.
        </div>
      )}

      {state === "results" && result && (
        <>
          {/* Summary badges */}
          <div className="flex gap-3 flex-wrap">
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">
              {result.total_drifted} drifted
            </span>
            {result.underpaid_count > 0 && (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-red-50 text-red-700 flex items-center gap-1">
                <TrendingDown className="h-3 w-3" /> {result.underpaid_count} underpaid
              </span>
            )}
            {result.overpaid_count > 0 && (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 flex items-center gap-1">
                <TrendingUp className="h-3 w-3" /> {result.overpaid_count} overpaid
              </span>
            )}
          </div>

          {result.total_drifted === 0 ? (
            <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
              <CheckCircle2 className="h-4 w-4" /> No salary drift detected — stored salary matches live attendance.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                  <tr>
                    <th className="px-3 py-2.5 text-left w-8">
                      <input type="checkbox"
                        checked={selected.size === result.rows.length && result.rows.length > 0}
                        onChange={toggleAll}
                        className="h-3.5 w-3.5 rounded"
                      />
                    </th>
                    <th className="px-3 py-2.5 text-left">Employee</th>
                    <th className="px-3 py-2.5 text-left">Branch · Process</th>
                    <th className="px-3 py-2.5 text-right">Stored Days</th>
                    <th className="px-3 py-2.5 text-right">Live Days</th>
                    <th className="px-3 py-2.5 text-right">Diff</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map(row => (
                    <tr key={row.employee_id} className="border-t border-slate-100 hover:bg-slate-50/60">
                      <td className="px-3 py-2">
                        <input type="checkbox"
                          checked={selected.has(row.employee_id)}
                          onChange={() => toggleSelect(row.employee_id)}
                          className="h-3.5 w-3.5 rounded"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-semibold text-slate-900">{row.full_name}</p>
                        <p className="text-xs text-slate-500">{row.employee_code}</p>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {row.branch_name ?? "—"} · {row.process_name ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{row.stored_paid_days}</td>
                      <td className="px-3 py-2 text-right font-mono">{row.live_paid_days}</td>
                      <td className={`px-3 py-2 text-right font-semibold ${row.direction === "underpaid" ? "text-red-600" : "text-amber-600"}`}>
                        {row.diff > 0 ? "+" : ""}{row.diff}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
