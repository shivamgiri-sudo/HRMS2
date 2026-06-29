import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";

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
  const { user } = useAuth();
  const token = localStorage.getItem("token");

  const [processId, setProcessId] = useState("");
  const [weekStartDate, setWeekStartDate] = useState(upcomingMonday());
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [computing, setComputing] = useState(false);
  const [inline, setInline] = useState<Record<number, { day: string; reason: string }>>({});

  const allowed = ["wfm", "admin", "super_admin"].includes(user?.role ?? "");

  async function fetchScores() {
    if (!processId) return;
    setLoading(true);
    const res = await fetch(
      `/api/wfm/weekoff/fairness-scores?processId=${processId}&weekStartDate=${weekStartDate}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  async function computeScores() {
    if (!processId) return;
    setComputing(true);
    await fetch("/api/wfm/weekoff/fairness-scores/compute", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ processId, weekStartDate }),
    });
    setComputing(false);
    fetchScores();
  }

  async function recordAllocation(row: Row) {
    const inp = inline[row.employee_id];
    if (!inp) return;
    await fetch("/api/wfm/weekoff/allocations/record", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId: row.employee_id,
        processId,
        weekStartDate,
        assignedDay: parseInt(inp.day),
        exceptionReason: inp.reason || undefined,
      }),
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
        <Input placeholder="Process ID" value={processId} onChange={(e) => setProcessId(e.target.value)} className="w-40" />
        <Input type="date" value={weekStartDate} onChange={(e) => setWeekStartDate(e.target.value)} className="w-44" />
        <Button onClick={fetchScores} disabled={loading || !processId}>Load</Button>
        <Button variant="secondary" onClick={computeScores} disabled={computing || !processId}>
          {computing ? "Computing…" : "Compute Scores"}
        </Button>
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
