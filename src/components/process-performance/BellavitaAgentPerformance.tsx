import { useCallback, useEffect, useMemo, useState } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Search } from "lucide-react";
import { DashboardExportMenu, type ExportSlide } from "./DashboardKit";

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
  const [nameSearch, setNameSearch] = useState("");

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

  const filteredRows = useMemo(() => {
    const q = nameSearch.trim().toLowerCase();
    if (!q || !rows) return rows ?? [];
    return rows.filter((r) => r.empName.toLowerCase().includes(q) || r.empId.toLowerCase().includes(q));
  }, [rows, nameSearch]);

  const exportSlides = useMemo<ExportSlide[]>(() => {
    if (!rows) return [];
    return [{
      title: "Agent Performance",
      tables: [{
        title: "Agent Performance",
        columns: ["Agent", "Emp ID", "TL", "LOB", "Tenure", "Attendance", "Login Hrs", "Break Hrs", "Talk Hrs", "ACHT", "Sale", "Zecpe", "Website", "Draft Order", "COD%", "Paid%", "RTO%", "Revenue", "Avg Sale"],
        rows: rows.map((r) => [
          r.empName, r.empId, r.teamLeader, r.lob, r.tenureDays ?? "—", r.attendanceDays, r.loginHours, r.breakHours,
          r.talkHours, `${r.achtSeconds}s`, r.saleCount, r.zecpeCount, r.websiteCount, r.draftOrderCount,
          `${r.codPct}%`, `${r.paidPct}%`, `${r.rtoPct}%`, formatINR(r.revenue), formatINR(r.avgSale),
        ]),
      }],
    }];
  }, [rows]);

  if (loading && !rows) return <Spinner />;
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!rows) return null;

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-700">Agent Performance ({filteredRows.length} of {rows.length} agents)</p>
        <div className="flex flex-wrap items-center gap-2">
          <DashboardExportMenu
            reportTitle="Bellavita — Agent Performance"
            fileBaseName="Bellavita_Agent_Performance"
            raw={{ dashboard: "bellavita_agent_performance", from, to }}
            subtitle={`${from} to ${to}`}
            slides={exportSlides}
            activeSlideTitle="Agent Performance"
          />
          <div className="relative w-full max-w-[220px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={nameSearch}
              onChange={(e) => setNameSearch(e.target.value)}
              placeholder="Search agent name..."
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-700 shadow-sm transition-colors focus:border-rose-400 focus:outline-none"
            />
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-center text-xs">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-slate-500">
              <th className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold">Agent</th>
              <th className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold">TL</th>
              <th className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold">LOB</th>
              <th className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold">Tenure</th>
              <th className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold">Attendance</th>
              <th className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold">Login Hrs</th>
              <th className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold">Break Hrs</th>
              <th className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold">Talk Hrs</th>
              <th className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold">ACHT</th>
              <th className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold">Sale</th>
              <th className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold">Zecpe</th>
              <th className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold">Website</th>
              <th className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold">Draft Order</th>
              <th className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold">COD%</th>
              <th className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold">Paid%</th>
              <th className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold">RTO%</th>
              <th className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold">Revenue</th>
              <th className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold">Avg Sale</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((r) => (
              <tr key={r.empId}>
                <td className="border border-slate-200 px-3 py-2">
                  <div className="font-medium text-slate-700">{r.empName}</div>
                  <div className="text-[11px] text-slate-400">{r.empId}</div>
                </td>
                <td className="border border-slate-200 px-3 py-2 text-slate-500">{r.teamLeader}</td>
                <td className="border border-slate-200 px-3 py-2 text-slate-500">{r.lob}</td>
                <td className="border border-slate-200 px-3 py-2 text-slate-600">{r.tenureDays ?? "—"}</td>
                <td className="border border-slate-200 px-3 py-2 text-slate-600">{r.attendanceDays}</td>
                <td className="border border-slate-200 px-3 py-2 text-slate-600">{r.loginHours}</td>
                <td className="border border-slate-200 px-3 py-2 text-slate-600">{r.breakHours}</td>
                <td className="border border-slate-200 px-3 py-2 text-slate-600">{r.talkHours}</td>
                <td className="border border-slate-200 px-3 py-2 text-slate-600">{r.achtSeconds}s</td>
                <td className="border border-slate-200 px-3 py-2 font-semibold text-slate-800">{r.saleCount}</td>
                <td className="border border-slate-200 px-3 py-2 text-slate-600">{r.zecpeCount}</td>
                <td className="border border-slate-200 px-3 py-2 text-slate-600">{r.websiteCount}</td>
                <td className="border border-slate-200 px-3 py-2 text-slate-600">{r.draftOrderCount}</td>
                <td className="border border-slate-200 px-3 py-2 text-slate-600">{r.codPct}%</td>
                <td className="border border-slate-200 px-3 py-2 text-slate-600">{r.paidPct}%</td>
                <td className={`border border-slate-200 px-3 py-2 font-semibold ${r.rtoPct > 10 ? "text-red-600" : "text-slate-600"}`}>{r.rtoPct}%</td>
                <td className="border border-slate-200 px-3 py-2 font-semibold text-slate-800">{formatINR(r.revenue)}</td>
                <td className="border border-slate-200 px-3 py-2 text-slate-600">{formatINR(r.avgSale)}</td>
              </tr>
            ))}
            {filteredRows.length === 0 && (
              <tr><td colSpan={18} className="border border-slate-200 py-6 text-center text-slate-400">{rows.length === 0 ? "No agent data for this period." : "No agents match this search."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
