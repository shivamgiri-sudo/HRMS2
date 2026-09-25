import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Search } from "lucide-react";
import { DashboardExportMenu, type ExportSlide } from "./DashboardKit";
import { BellavitaAgentDetailDrawer } from "./BellavitaAgentDetailDrawer";
import { useSortableRows } from "./useSortableRows";
import { FilterSortTh, useColumnFilters, type FilterColumn } from "./ColumnFilterHeader";

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

interface Col {
  key: string; label: string;
  /** Raw value -- what the column sorts by and what its filter list offers. */
  get: (r: AgentRow) => string | number | null;
  cell: (r: AgentRow) => ReactNode;
  className?: string;
}
const TD = "border border-slate-200 px-3 py-2";
const COLS: Col[] = [
  { key: "agent", label: "Agent", get: (r) => r.empName, cell: (r) => null },
  { key: "tl", label: "TL", get: (r) => r.teamLeader, cell: (r) => r.teamLeader, className: "text-slate-500" },
  { key: "lob", label: "LOB", get: (r) => r.lob, cell: (r) => r.lob, className: "text-slate-500" },
  { key: "tenure", label: "Tenure", get: (r) => r.tenureDays, cell: (r) => r.tenureDays ?? "—", className: "text-slate-600" },
  { key: "attendance", label: "Attendance", get: (r) => r.attendanceDays, cell: (r) => r.attendanceDays, className: "text-slate-600" },
  { key: "login", label: "Login Hrs", get: (r) => r.loginHours, cell: (r) => r.loginHours, className: "text-slate-600" },
  { key: "break", label: "Break Hrs", get: (r) => r.breakHours, cell: (r) => r.breakHours, className: "text-slate-600" },
  { key: "talk", label: "Talk Hrs", get: (r) => r.talkHours, cell: (r) => r.talkHours, className: "text-slate-600" },
  { key: "acht", label: "ACHT", get: (r) => r.achtSeconds, cell: (r) => `${r.achtSeconds}s`, className: "text-slate-600" },
  { key: "sale", label: "Sale", get: (r) => r.saleCount, cell: (r) => r.saleCount, className: "font-semibold text-slate-800" },
  { key: "zecpe", label: "Zecpe", get: (r) => r.zecpeCount, cell: (r) => r.zecpeCount, className: "text-slate-600" },
  { key: "website", label: "Website", get: (r) => r.websiteCount, cell: (r) => r.websiteCount, className: "text-slate-600" },
  { key: "draft", label: "Draft Order", get: (r) => r.draftOrderCount, cell: (r) => r.draftOrderCount, className: "text-slate-600" },
  { key: "cod", label: "COD%", get: (r) => r.codPct, cell: (r) => `${r.codPct}%`, className: "text-slate-600" },
  { key: "paid", label: "Paid%", get: (r) => r.paidPct, cell: (r) => `${r.paidPct}%`, className: "text-slate-600" },
  { key: "rto", label: "RTO%", get: (r) => r.rtoPct, cell: (r) => `${r.rtoPct}%`, className: "font-semibold" },
  { key: "revenue", label: "Revenue", get: (r) => r.revenue, cell: (r) => formatINR(r.revenue), className: "font-semibold text-slate-800" },
  { key: "avgSale", label: "Avg Sale", get: (r) => r.avgSale, cell: (r) => formatINR(r.avgSale), className: "text-slate-600" },
];
const FILTER_COLS: Array<FilterColumn<AgentRow>> = COLS.map((c) => ({ key: c.key, get: c.get }));
const colGetter = (r: AgentRow, key: string) => COLS.find((c) => c.key === key)?.get(r);

/**
 * Slide 2: per-agent performance, joining db_masmis.bb_apr (attendance/
 * login/talk-time) with db_masmis.bb_sale (sale outcomes) via GET
 * /api/process-performance/bellavita-agent-performance. See the backend
 * service's doc comment for exactly which columns from the reference
 * "Agent Metric" sheet are real (sourced from these two tables) vs.
 * deliberately left out (no real source exists in this app: DOJ, Bucket,
 * per-agent Target/Achiv%, TQ/MQ/BQ, Compliance%, Man Day, Start Date).
 */
export function BellavitaAgentPerformance({ from, to, lob }: { from: string; to: string; lob?: string }) {
  const [rows, setRows] = useState<AgentRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nameSearch, setNameSearch] = useState("");
  const [drawerEmpId, setDrawerEmpId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const lobParam = lob && lob !== "All" ? `&lob=${encodeURIComponent(lob)}` : "";
      const res = await hrmsApi.get<{ success: boolean; data: AgentRow[] }>(
        `/api/process-performance/bellavita-agent-performance?from=${from}&to=${to}${lobParam}`,
      );
      setRows(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load agent performance.");
    } finally {
      setLoading(false);
    }
  }, [from, to, lob]);

  useEffect(() => { void load(); }, [load]);

  const searchedRows = useMemo(() => {
    const q = nameSearch.trim().toLowerCase();
    if (!q || !rows) return rows ?? [];
    return rows.filter((r) => r.empName.toLowerCase().includes(q) || r.empId.toLowerCase().includes(q));
  }, [rows, nameSearch]);
  // Excel-style: every header sorts (click) and filters (funnel icon); filters AND together, then the sort applies.
  const filters = useColumnFilters(searchedRows, FILTER_COLS);
  const { sorted: filteredRows, sortKey, sortDir, toggleSort } = useSortableRows(filters.filtered, colGetter);

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
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-slate-700">Agent Performance ({filteredRows.length} of {rows.length} agents)</p>
          {lob && lob !== "All" && (
            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-700">LOB: {lob}</span>
          )}
          {filters.activeCount > 0 && (
            <button type="button" onClick={filters.clearAll} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-200">
              Clear {filters.activeCount} filter{filters.activeCount > 1 ? "s" : ""}
            </button>
          )}
        </div>
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
              {COLS.map((c) => (
                <FilterSortTh
                  key={c.key} label={c.label} columnKey={c.key} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} filters={filters}
                  sticky={c.key === "agent"}
                  className={c.key === "agent"
                    ? "min-w-[140px] border border-slate-200 bg-slate-50 px-3 py-2 font-semibold shadow-[2px_0_6px_-2px_rgba(0,0,0,0.15)]"
                    : "border border-slate-200 bg-slate-50 px-3 py-2 font-semibold"}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((r) => (
              <tr key={r.empId} onClick={() => setDrawerEmpId(r.empId)} role="button" tabIndex={0} className="cursor-pointer transition-colors hover:bg-rose-50/50">
                <td className="sticky left-0 z-10 border border-slate-200 bg-white px-3 py-2 shadow-[2px_0_6px_-2px_rgba(0,0,0,0.1)]">
                  <div className="font-medium text-rose-700 underline-offset-2 hover:underline">{r.empName}</div>
                  <div className="text-[11px] text-slate-400">{r.empId}</div>
                </td>
                {COLS.filter((c) => c.key !== "agent").map((c) => (
                  <td key={c.key} className={`${TD} ${c.key === "rto" ? (r.rtoPct > 10 ? "text-red-600" : "text-slate-600") : ""} ${c.className ?? ""}`.replace(/s+/g, " ")}>{c.cell(r)}</td>
                ))}
              </tr>
            ))}
            {filteredRows.length === 0 && (
              <tr><td colSpan={18} className="border border-slate-200 py-6 text-center text-slate-400">{rows.length === 0 ? "No agent data for this period." : "No agents match the search / filters."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {drawerEmpId && (
        <BellavitaAgentDetailDrawer empId={drawerEmpId} from={from} to={to} onClose={() => setDrawerEmpId(null)} />
      )}
    </div>
  );
}
