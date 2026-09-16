import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { hrmsApi } from "@/lib/hrmsApi";

const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

function upcomingMonday() {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 1 ? 0 : (8 - day) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

type Row = {
  employee_id: number;
  employee_name: string;
  employee_code: string;
  fairness_score: number;
  preferred_day: number | null;
  assigned_day: number | null;
  assigned_day_is_preferred: boolean;
  consecutive_no_preferred_weekoff: number;
  consecutive_no_weekend_weekoff: number;
  allocation_exception_reason: string | null;
};

export default function WeekoffFairness() {
  const { roleKeys } = useWorkforceAccess();

  const [processId, setProcessId] = useState("");
  const [weekStartDate, setWeekStartDate] = useState(upcomingMonday());
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [computing, setComputing] = useState(false);
  const [inline, setInline] = useState<Record<number, { day: string; reason: string }>>({});
  // Form Input Rule (CLAUDE.md): Process ID is a closed set (process_master.id), not
  // free text — was a plain <Input> a user had to type a raw UUID into, which the
  // backend (weekoff-fairness.service.ts matches against employees.process_id) never
  // validated, so a typo just silently returned an empty/wrong result.
  const [processes, setProcesses] = useState<{ id: string; process_name: string }[]>([]);

  useEffect(() => {
    hrmsApi.get<{ data: { id: string; process_name: string }[] }>("/api/processes?limit=200")
      .then((res) => setProcesses(res.data ?? []))
      .catch(() => setProcesses([]));
  }, []);

  const allowed = ["wfm", "admin", "super_admin", "branch_head"].some(r => roleKeys.includes(r));
  // Compute (recalculate + write scores) stays wfm/admin/super_admin-only on the backend —
  // branch_head is view-only here, so the button is hidden rather than shown and 403ing.
  const canCompute = ["wfm", "admin", "super_admin"].some(r => roleKeys.includes(r));

  // Was raw fetch() to a relative URL with a manually-read localStorage token — on this
  // dev setup that resolves against the Vite origin (8080), not the real API (5055), so
  // it 401'd before ever reaching the backend. hrmsApi.* (apiBaseUrl() + the real token
  // key) is what every other panel in this console already uses. Also unwraps the
  // backend's real `{ success, data }` envelope — the old code checked
  // Array.isArray(wholeResponse), which is never true for that shape, so the table
  // stayed empty even on a request that did reach the server.
  async function fetchScores() {
    if (!processId) return;
    setLoading(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: Row[] }>(
        `/api/wfm/weekoff/fairness-scores?processId=${processId}&weekStartDate=${weekStartDate}`,
      );
      setRows(Array.isArray(res.data) ? res.data : []);
    } finally {
      setLoading(false);
    }
  }

  async function computeScores() {
    if (!processId) return;
    setComputing(true);
    try {
      await hrmsApi.post("/api/wfm/weekoff/fairness-scores/compute", { processId, weekStartDate });
      await fetchScores();
    } finally {
      setComputing(false);
    }
  }

  async function recordAllocation(row: Row) {
    const inp = inline[row.employee_id];
    if (!inp) return;
    await hrmsApi.post("/api/wfm/weekoff/allocations/record", {
      employeeId: row.employee_id,
      processId,
      weekStartDate,
      assignedDay: parseInt(inp.day),
      exceptionReason: inp.reason || undefined,
    });
    setInline((p) => { const n = { ...p }; delete n[row.employee_id]; return n; });
    fetchScores();
  }

  useEffect(() => { if (processId) fetchScores(); }, [weekStartDate]);

  if (!allowed) return <div className="p-6 text-red-500">Access denied.</div>;

  const avg = rows.length ? (rows.reduce((s, r) => s + r.fairness_score, 0) / rows.length).toFixed(1) : "—";
  const pct = rows.length ? ((rows.filter((r) => r.assigned_day_is_preferred).length / rows.length) * 100).toFixed(0) : "—";

  const scoreColor = (s: number) =>
    s >= 150 ? "text-green-600 font-semibold" : s >= 100 ? "text-yellow-600 font-semibold" : "text-red-600 font-semibold";

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Week-off Fairness Scores</h1>

      <div className="flex flex-wrap gap-3 items-end">
        <Select value={processId} onValueChange={setProcessId}>
          <SelectTrigger className="w-52"><SelectValue placeholder="Select process" /></SelectTrigger>
          <SelectContent>
            {processes.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.process_name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input type="date" value={weekStartDate} onChange={(e) => setWeekStartDate(e.target.value)} className="w-44" />
        <Button onClick={fetchScores} disabled={loading || !processId}>Load</Button>
        {canCompute && (
          <Button variant="secondary" onClick={computeScores} disabled={computing || !processId}>
            {computing ? "Computing…" : "Compute Scores"}
          </Button>
        )}
      </div>

      {rows.length > 0 && (
        <div className="flex gap-6">
          <Card className="px-4 py-2"><div className="text-xs text-muted-foreground">Total</div><div className="text-xl font-bold">{rows.length}</div></Card>
          <Card className="px-4 py-2"><div className="text-xs text-muted-foreground">Avg Score</div><div className="text-xl font-bold">{avg}</div></Card>
          <Card className="px-4 py-2"><div className="text-xs text-muted-foreground">Got Preferred</div><div className="text-xl font-bold">{pct}%</div></Card>
        </div>
      )}

      {loading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b bg-muted/30 text-left">
                {["#","Code","Name","Score","Preferred","Assigned","Got Preferred","No Weekend","No Preferred","Exception","Action"].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const inp = inline[row.employee_id];
                return (
                  <tr key={row.employee_id} className="border-b hover:bg-muted/20">
                    <td className="px-3 py-2">{i + 1}</td>
                    <td className="px-3 py-2 font-mono">{row.employee_code}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{row.employee_name}</td>
                    <td className={`px-3 py-2 ${scoreColor(row.fairness_score)}`}>{row.fairness_score}</td>
                    <td className="px-3 py-2">{row.preferred_day != null ? DAYS[row.preferred_day] : "—"}</td>
                    <td className="px-3 py-2">{row.assigned_day != null ? DAYS[row.assigned_day] : "—"}</td>
                    <td className="px-3 py-2">{row.assigned_day != null ? (row.assigned_day_is_preferred ? "✓" : "✗") : "—"}</td>
                    <td className="px-3 py-2">{row.consecutive_no_weekend_weekoff > 0 && <Badge variant="outline">{row.consecutive_no_weekend_weekoff}</Badge>}</td>
                    <td className="px-3 py-2">{row.consecutive_no_preferred_weekoff > 0 && <Badge variant="secondary">{row.consecutive_no_preferred_weekoff}</Badge>}</td>
                    <td className="px-3 py-2 max-w-[160px] truncate">{row.allocation_exception_reason ?? "—"}</td>
                    <td className="px-3 py-2">
                      {!canCompute ? (
                        "—"
                      ) : (
                        <>
                          {row.assigned_day == null && !inp && (
                            <Button size="sm" variant="outline" onClick={() => setInline((p) => ({ ...p, [row.employee_id]: { day: "", reason: "" } }))}>
                              Record
                            </Button>
                          )}
                          {inp && (
                            <div className="flex gap-1 items-center">
                              <Input className="w-14 h-7 text-xs" type="number" min={0} max={6} placeholder="0-6" value={inp.day} onChange={(e) => setInline((p) => ({ ...p, [row.employee_id]: { ...p[row.employee_id], day: e.target.value } }))} />
                              <Input className="w-24 h-7 text-xs" placeholder="reason" value={inp.reason} onChange={(e) => setInline((p) => ({ ...p, [row.employee_id]: { ...p[row.employee_id], reason: e.target.value } }))} />
                              <Button size="sm" className="h-7 text-xs" onClick={() => recordAllocation(row)}>Save</Button>
                            </div>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
