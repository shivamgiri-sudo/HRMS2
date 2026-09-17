import { useCallback, useEffect, useState } from "react";
import { hrmsApi } from "@/lib/hrmsApi";

interface AgentRow {
  empId: string;
  empName: string;
  teamLeader: string;
  lob: string;
  tenureDays: number | null;
  attendanceDays: number;
  loginHours: number;
  breakHours: number;
  talkHours: number;
  achtSeconds: number;
  saleCount: number;
  zecpeCount: number;
  websiteCount: number;
  draftOrderCount: number;
  codCount: number;
  paidCount: number;
  codPct: number;
  paidPct: number;
  rtoCount: number;
  rtoPct: number;
  revenue: number;
  avgSale: number;
}

const formatINR = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-rose-500" />
    </div>
  );
}

/**
 * Slide 2: per-agent performance, joining db_masmis.bb_apr (attendance/
 * login/talk-time) with db_masmis.bb_sale (sale outcomes) via GET
 * /api/process-performance/bellavita-agent-performance. See the backend
 * service's doc comment for exactly which columns from the reference
 * "Agent Metric" sheet are real (sourced from these two tables) vs.
 * deliberately left out (no real source exists in this app: DOJ, Bucket,
 * per-agent Target/Achiv%, TQ/MQ/BQ, Compliance%, Man Day, Start Date).
 */
export function BellavitaAgentPerformance({ from, to }: { from: string; to: string }) {
  const [rows, setRows] = useState<AgentRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: AgentRow[] }>(
        `/api/process-performance/bellavita-agent-performance?from=${from}&to=${to}`,
      );
      setRows(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load agent performance.");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  if (loading && !rows) return <Spinner />;
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!rows) return null;

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-700">Agent Performance ({rows.length} agents)</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
              <th className="py-2 pr-3 font-semibold">Agent</th>
              <th className="py-2 pr-3 font-semibold">TL</th>
              <th className="py-2 pr-3 font-semibold">LOB</th>
              <th className="py-2 pr-3 text-right font-semibold">Tenure</th>
              <th className="py-2 pr-3 text-right font-semibold">Attendance</th>
              <th className="py-2 pr-3 text-right font-semibold">Login Hrs</th>
              <th className="py-2 pr-3 text-right font-semibold">Break Hrs</th>
              <th className="py-2 pr-3 text-right font-semibold">Talk Hrs</th>
              <th className="py-2 pr-3 text-right font-semibold">ACHT</th>
              <th className="py-2 pr-3 text-right font-semibold">Sale</th>
              <th className="py-2 pr-3 text-right font-semibold">Zecpe</th>
              <th className="py-2 pr-3 text-right font-semibold">Website</th>
              <th className="py-2 pr-3 text-right font-semibold">Draft Order</th>
              <th className="py-2 pr-3 text-right font-semibold">COD%</th>
              <th className="py-2 pr-3 text-right font-semibold">Paid%</th>
              <th className="py-2 pr-3 text-right font-semibold">RTO%</th>
              <th className="py-2 pr-3 text-right font-semibold">Revenue</th>
              <th className="py-2 pr-0 text-right font-semibold">Avg Sale</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.empId} className="border-b border-slate-50 last:border-0">
                <td className="py-2.5 pr-3">
                  <div className="font-medium text-slate-700">{r.empName}</div>
                  <div className="text-[11px] text-slate-400">{r.empId}</div>
                </td>
                <td className="py-2.5 pr-3 text-slate-500">{r.teamLeader}</td>
                <td className="py-2.5 pr-3 text-slate-500">{r.lob}</td>
                <td className="py-2.5 pr-3 text-right text-slate-600">{r.tenureDays ?? "—"}</td>
                <td className="py-2.5 pr-3 text-right text-slate-600">{r.attendanceDays}</td>
                <td className="py-2.5 pr-3 text-right text-slate-600">{r.loginHours}</td>
                <td className="py-2.5 pr-3 text-right text-slate-600">{r.breakHours}</td>
                <td className="py-2.5 pr-3 text-right text-slate-600">{r.talkHours}</td>
                <td className="py-2.5 pr-3 text-right text-slate-600">{r.achtSeconds}s</td>
                <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{r.saleCount}</td>
                <td className="py-2.5 pr-3 text-right text-slate-600">{r.zecpeCount}</td>
                <td className="py-2.5 pr-3 text-right text-slate-600">{r.websiteCount}</td>
                <td className="py-2.5 pr-3 text-right text-slate-600">{r.draftOrderCount}</td>
                <td className="py-2.5 pr-3 text-right text-slate-600">{r.codPct}%</td>
                <td className="py-2.5 pr-3 text-right text-slate-600">{r.paidPct}%</td>
                <td className={`py-2.5 pr-3 text-right font-semibold ${r.rtoPct > 10 ? "text-red-600" : "text-slate-600"}`}>{r.rtoPct}%</td>
                <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{formatINR(r.revenue)}</td>
                <td className="py-2.5 pr-0 text-right text-slate-600">{formatINR(r.avgSale)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={18} className="py-6 text-center text-slate-400">No agent data for this period.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
