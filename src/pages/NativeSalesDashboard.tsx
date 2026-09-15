/**
 * NativeSalesDashboard — Brand Sales Analytics Hub
 *
 * Processes: Bellavita · GNC · Neemans (+ Upload)
 * House style matches ProcessOperationsPage / Mydashboards reference:
 *   navy (#0D1445) chart headers, GAS KPI cards with left accent bar,
 *   color-coded thresholds, expandable charts, slide-over drill-downs.
 *
 * Backend: /api/sales-upload/* (sales-upload.routes.ts)
 * Data:    db_masmis via queryMasmis (sales-upload.service.ts)
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine, ComposedChart, Area, Cell,
} from "recharts";
import {
  TrendingUp, ShoppingCart, AlertTriangle, DollarSign, Package,
  Users, PhoneCall, Clock, Activity, Target, Wallet, CreditCard,
  Percent, Upload, Trash2, RefreshCcw, CheckCircle, Calendar,
  ChevronRight, X, Maximize2, Settings, Download, BarChart2,
  TrendingDown, Award, Filter, Plus, Edit, Loader2,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { useToast } from "@/hooks/use-toast";

// ── House Style ───────────────────────────────────────────────────────────────
const NAVY   = "#0D1445";
const G      = "#10B981";
const C_BLUE = "#3B82F6";
const C_AMB  = "#F59E0B";
const C_RED  = "#EF4444";
const C_PURP = "#8B5CF6";
const C_CYAN = "#06B6D4";
const C_ORG  = "#F97316";

const TOOLTIP_STYLE = { background: "#fff", border: "1px solid #334155", borderRadius: 8, fontSize: 12 };
const AXIS_TICK     = { fill: "#64748B", fontSize: 11 };
const GRID_PROPS    = { strokeDasharray: "3 3", stroke: "#E2E8F0" };

// ── Formatters ────────────────────────────────────────────────────────────────
const fmtN   = (n: number | null | undefined) => (n == null || isNaN(n) ? "—" : Math.round(n).toLocaleString("en-IN"));
const fmtPct = (n: number | null | undefined) => (n == null || isNaN(n) ? "—" : `${Number(n).toFixed(1)}%`);
const fmtRs  = (n: number | null | undefined) => {
  if (n == null || isNaN(n)) return "—";
  if (n >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(2)}Cr`;
  if (n >= 1_00_000)    return `₹${(n / 1_00_000).toFixed(2)}L`;
  if (n >= 1_000)       return `₹${(n / 1_000).toFixed(1)}K`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
};
const fmtRsFull = (n: number | null | undefined) =>
  n == null || isNaN(n) ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthToRange(m: string) {
  const [y, mo] = m.split("-").map(Number);
  const last = new Date(y, mo, 0).getDate();
  return { start: `${m}-01`, end: `${m}-${String(last).padStart(2, "0")}` };
}

// ── Stack Rank ────────────────────────────────────────────────────────────────
function stackRank(achievePct: number | null): "TQ" | "MQ" | "BQ" | "—" {
  if (achievePct == null) return "—";
  if (achievePct > 90) return "TQ";
  if (achievePct > 75) return "MQ";
  return "BQ";
}
const RANK_COLOR: Record<string, { bg: string; text: string }> = {
  TQ: { bg: "#DCFCE7", text: "#166534" },
  MQ: { bg: "#FEF3C7", text: "#92400E" },
  BQ: { bg: "#FEE2E2", text: "#991B1B" },
  "—": { bg: "#F1F5F9", text: "#64748B" },
};
function RankBadge({ rank }: { rank: string }) {
  const c = RANK_COLOR[rank] ?? RANK_COLOR["—"];
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: c.bg, color: c.text }}>
      {rank}
    </span>
  );
}

// ── GAS KPI Card ──────────────────────────────────────────────────────────────
function GasKpi({
  label, value, foot, accent, onClick,
}: { label: string; value: string; foot?: string; accent: string; onClick?: () => void }) {
  const Tag: any = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      style={{
        background: `linear-gradient(145deg,#fff 58%,${accent}14 100%)`,
        border: "1px solid #dfe6ee", borderRadius: 14,
        padding: "9px 11px 8px", minHeight: 82,
        position: "relative", overflow: "hidden",
        boxShadow: "0 6px 16px rgba(16,35,57,.065)",
        cursor: onClick ? "pointer" : "default",
        textAlign: "left", width: "100%",
        transition: "box-shadow .18s, transform .18s",
      }}
      onMouseEnter={onClick ? (e: any) => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 10px 22px rgba(16,35,57,.11)"; } : undefined}
      onMouseLeave={onClick ? (e: any) => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = "0 6px 16px rgba(16,35,57,.065)"; } : undefined}
    >
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: accent, borderRadius: "14px 0 0 14px" }} />
      <div style={{ position: "absolute", width: 52, height: 52, borderRadius: "50%", right: -20, top: -22, background: `${accent}14` }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, paddingLeft: 7 }}>
        <p style={{ fontSize: 8.5, textTransform: "uppercase", letterSpacing: ".45px", color: "#6d7b8c", fontWeight: 900, lineHeight: 1.3 }}>{label}</p>
        <div style={{ width: 7, height: 7, borderRadius: "50%", background: accent, boxShadow: `0 0 0 3px ${accent}1a`, flexShrink: 0 }} />
      </div>
      <p style={{ fontSize: 21, lineHeight: 1.1, fontWeight: 950, color: "#1b2d42", marginTop: 4, paddingLeft: 7 }}>{value}</p>
      {foot && <p style={{ marginTop: 3, fontSize: 8, color: "#8390a0", fontWeight: 700, paddingLeft: 7 }}>{foot}</p>}
    </Tag>
  );
}

// ── Chart Card (navy header) ──────────────────────────────────────────────────
function ChartCard({ title, subtitle, onExpand, children }: {
  title: string; subtitle?: string; onExpand?: () => void; children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3" style={{ background: NAVY }}>
        <div>
          <h3 className="text-sm font-bold text-white">{title}</h3>
          {subtitle && <p className="text-[10px] text-indigo-200 mt-0.5">{subtitle}</p>}
        </div>
        {onExpand && (
          <button onClick={onExpand} className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/20 transition">
            <Maximize2 size={14} />
          </button>
        )}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ── Chart Expand Modal ────────────────────────────────────────────────────────
function ChartModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl flex flex-col" style={{ maxHeight: "90vh" }}>
        <div className="flex items-center justify-between px-6 py-4 rounded-t-3xl" style={{ background: NAVY }}>
          <h3 className="font-bold text-white text-base">{title}</h3>
          <button onClick={onClose} className="p-2 rounded-xl text-white/70 hover:text-white hover:bg-white/20 transition"><X size={18} /></button>
        </div>
        <div className="p-6 flex-1 overflow-auto" style={{ minHeight: 460 }}>{children}</div>
      </div>
    </div>
  );
}

// ── Drill-Down Slide-over Drawer ──────────────────────────────────────────────
function DrillDrawer({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode;
}) {
  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />}
      <div
        className="fixed top-0 right-0 h-full z-50 flex flex-col bg-white shadow-2xl transition-transform duration-300"
        style={{ width: "min(640px, 95vw)", transform: open ? "translateX(0)" : "translateX(100%)" }}
      >
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ background: NAVY }}>
          <h3 className="font-bold text-white text-sm">{title}</h3>
          <button onClick={onClose} className="p-2 rounded-xl text-white/70 hover:text-white hover:bg-white/20 transition"><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </>
  );
}

// ── Mini data table ───────────────────────────────────────────────────────────
function MiniTable({ cols, rows, emptyMsg = "No data" }: {
  cols: { key: string; label: string; right?: boolean; fmt?: (v: any) => string }[];
  rows: Record<string, unknown>[];
  emptyMsg?: string;
}) {
  const [search, setSearch] = useState("");
  const filtered = rows.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(search.toLowerCase())));
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5" style={{ background: NAVY }}>
        <span className="text-xs font-semibold text-white">{rows.length} rows</span>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
          className="text-xs rounded-lg px-2.5 py-1 w-32 bg-white/20 text-white placeholder-indigo-200 border border-white/30 outline-none" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr style={{ background: "#EEF2FF" }}>
            {cols.map(c => <th key={c.key} className={`px-3 py-2 font-semibold text-slate-600 whitespace-nowrap ${c.right ? "text-right" : "text-left"}`}>{c.label}</th>)}
          </tr></thead>
          <tbody>
            {filtered.length === 0
              ? <tr><td colSpan={cols.length} className="text-center py-8 text-slate-400">{emptyMsg}</td></tr>
              : filtered.map((row, i) => (
                <tr key={i} className="border-t border-slate-50 hover:bg-slate-50/60 transition-colors">
                  {cols.map(c => (
                    <td key={c.key} className={`px-3 py-2 text-slate-700 whitespace-nowrap ${c.right ? "text-right tabular-nums" : ""}`}>
                      {c.fmt ? c.fmt(row[c.key]) : String(row[c.key] ?? "—")}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="h-9 w-9 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── BELLAVITA DASHBOARD ───────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

interface BbOverall {
  total_orders: number; rto_pct: number; cod_pct: number; paid_pct: number;
  aov: number; net_revenue_ex_gst: number;
}
interface BbCampaign { campaign: string; orders: number; rto_pct: number; cod_pct: number; paid_pct: number; aov: number; net_revenue: number; }

export function BellavitaDashboard({ month }: { month: string }) {
  const [overall, setOverall] = useState<BbOverall | null>(null);
  const [campaigns, setCampaigns] = useState<BbCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState<BbCampaign | null>(null);
  const [expandChart, setExpandChart] = useState(false);

  useEffect(() => {
    setLoading(true);
    void hrmsApi.get<{ data: { overall: BbOverall; by_campaign: BbCampaign[] } }>(
      `/api/sales-upload/bellavita-dashboard?month=${month}`
    )
      .then(r => { setOverall(r.data?.overall ?? null); setCampaigns(r.data?.by_campaign ?? []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [month]);

  if (loading) return <Spinner />;

  const top = [...campaigns].sort((a, b) => b.orders - a.orders)[0]?.campaign;
  const o = overall;

  return (
    <div className="space-y-5">
      {/* Revenue KPI strip */}
      {o && (
        <>
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Revenue</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <GasKpi label="Total Orders"       value={fmtN(o.total_orders)}       accent={C_BLUE} />
            <GasKpi label="Net Rev (ex-GST)"   value={fmtRs(o.net_revenue_ex_gst)} accent={G} />
            <GasKpi label="AOV"                value={fmtRsFull(o.aov)}           accent={C_PURP} />
            <GasKpi label="Paid %"             value={fmtPct(o.paid_pct)}         accent={G}
              foot={o.paid_pct >= 75 ? "✓ Target ≥75%" : "⚠ Below 75% target"} />
            <GasKpi label="COD %"              value={fmtPct(o.cod_pct)}          accent={C_AMB} />
            <GasKpi label="RTO %"              value={fmtPct(o.rto_pct)}          accent={C_RED}
              foot={o.rto_pct <= 10 ? "✓ Within 10%" : "⚠ Above 10% target"} />
          </div>
        </>
      )}

      {/* Campaign chart + table */}
      {campaigns.length > 0 && (
        <ChartCard title="Campaign-wise Breakdown" onExpand={() => setExpandChart(true)}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={campaigns.slice(0, 12)} margin={{ top: 4, right: 8, left: -16, bottom: 50 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="campaign" tick={{ ...AXIS_TICK, fontSize: 9 }} angle={-35} textAnchor="end" height={55} />
              <YAxis tick={AXIS_TICK} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="orders" name="Orders" fill="#EC4899" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}
      {expandChart && (
        <ChartModal title="Campaign Breakdown — Full" onClose={() => setExpandChart(false)}>
          <ResponsiveContainer width="100%" height={440}>
            <BarChart data={campaigns} margin={{ top: 4, right: 8, left: -16, bottom: 80 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="campaign" tick={{ ...AXIS_TICK, fontSize: 9 }} angle={-40} textAnchor="end" height={80} />
              <YAxis tick={AXIS_TICK} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="orders" name="Orders" fill="#EC4899" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartModal>
      )}

      {/* Campaign detail table */}
      {campaigns.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
          <div className="px-5 py-3" style={{ background: NAVY }}>
            <h3 className="text-xs font-semibold uppercase tracking-widest text-white">{campaigns.length} Campaigns</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="bg-slate-50">
                {["Campaign","Orders","AOV","RTO%","COD%","Paid%","Net Rev"].map(h => (
                  <th key={h} className={`py-2.5 px-3 font-semibold text-slate-500 uppercase tracking-wide ${h === "Campaign" ? "text-left" : "text-right"}`}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {campaigns.map((r, i) => (
                  <tr key={r.campaign}
                    className={`border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors ${i % 2 ? "bg-slate-50/40" : ""}`}
                    onClick={() => setDrill(r)}
                  >
                    <td className="py-2.5 px-3 text-slate-700 font-medium whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        {r.campaign === top && <span className="text-[9px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded px-1 py-0.5">TOP</span>}
                        {r.campaign}
                        <ChevronRight size={11} className="text-slate-300" />
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{fmtN(r.orders)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{fmtRsFull(r.aov)}</td>
                    <td className="py-2.5 px-3 text-right">
                      <span className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${r.rto_pct <= 10 ? "text-green-600 bg-green-100" : "text-red-600 bg-red-100"}`}>{fmtPct(r.rto_pct)}</span>
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{fmtPct(r.cod_pct)}</td>
                    <td className="py-2.5 px-3 text-right">
                      <span className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${r.paid_pct >= 75 ? "text-green-600 bg-green-100" : "text-red-600 bg-red-100"}`}>{fmtPct(r.paid_pct)}</span>
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-medium">{fmtRs(r.net_revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Campaign drill-down drawer */}
      <DrillDrawer open={!!drill} onClose={() => setDrill(null)} title={`Campaign: ${drill?.campaign ?? ""}`}>
        {drill && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Orders",       value: fmtN(drill.orders),         accent: C_BLUE },
                { label: "Net Revenue",  value: fmtRs(drill.net_revenue),   accent: G },
                { label: "AOV",          value: fmtRsFull(drill.aov),       accent: C_PURP },
                { label: "RTO %",        value: fmtPct(drill.rto_pct),      accent: drill.rto_pct <= 10 ? G : C_RED },
                { label: "COD %",        value: fmtPct(drill.cod_pct),      accent: C_AMB },
                { label: "Paid %",       value: fmtPct(drill.paid_pct),     accent: drill.paid_pct >= 75 ? G : C_RED },
              ].map(k => <GasKpi key={k.label} label={k.label} value={k.value} accent={k.accent} />)}
            </div>
            <div className="rounded-xl bg-slate-50 p-4 text-xs text-slate-500">
              <p className="font-semibold text-slate-700 mb-1">Target Comparison</p>
              <p>RTO target: ≤ 10% — Current: <strong className={drill.rto_pct <= 10 ? "text-green-600" : "text-red-600"}>{fmtPct(drill.rto_pct)}</strong></p>
              <p>Paid target: ≥ 75% — Current: <strong className={drill.paid_pct >= 75 ? "text-green-600" : "text-red-600"}>{fmtPct(drill.paid_pct)}</strong></p>
            </div>
          </div>
        )}
      </DrillDrawer>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── GNC DASHBOARD ─────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

interface GncSummary { total_sales: number; total_revenue: number; avg_order: number; conversion_pct: number }
interface GncProduct { product: string; units: number; revenue: number }
interface GncApr     { total: number }

export function GncDashboard({ month }: { month: string }) {
  const [summary, setSummary] = useState<GncSummary | null>(null);
  const [products, setProducts] = useState<GncProduct[]>([]);
  const [apr, setApr] = useState<GncApr | null>(null);
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState<GncProduct | null>(null);

  useEffect(() => {
    setLoading(true);
    void hrmsApi.get<{ data: { summary: GncSummary; by_product: GncProduct[]; apr_summary: GncApr } }>(
      `/api/sales-upload/gnc-dashboard?month=${month}`
    )
      .then(r => { setSummary(r.data?.summary ?? null); setProducts(r.data?.by_product ?? []); setApr(r.data?.apr_summary ?? null); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [month]);

  if (loading) return <Spinner />;

  return (
    <div className="space-y-5">
      {summary && (
        <>
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Summary</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <GasKpi label="Total Sales"    value={fmtN(summary.total_sales)}    accent={C_BLUE} />
            <GasKpi label="Total Revenue"  value={fmtRs(summary.total_revenue)} accent={G} />
            <GasKpi label="Avg Order"      value={fmtRsFull(summary.avg_order)} accent={C_PURP} />
            <GasKpi label="Conversion %"   value={fmtPct(summary.conversion_pct)} accent={C_AMB} />
          </div>
        </>
      )}

      {apr && (
        <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 flex items-center gap-3">
          <Activity size={14} className="text-slate-400" />
          <span className="text-sm text-slate-600">APR Records this month: <strong className="text-slate-800">{fmtN(apr.total)}</strong></span>
        </div>
      )}

      {products.length > 0 && (
        <>
          <ChartCard title="Product Mix — Units Sold">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={products.slice(0, 12)} layout="vertical" margin={{ top: 4, right: 60, bottom: 0, left: 4 }}>
                <CartesianGrid {...GRID_PROPS} horizontal={false} />
                <XAxis type="number" tick={AXIS_TICK} />
                <YAxis dataKey="product" type="category" tick={{ ...AXIS_TICK, fontSize: 9 }} width={120} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="units" name="Units" fill={G} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <div className="px-5 py-3" style={{ background: NAVY }}>
              <h3 className="text-xs font-semibold uppercase tracking-widest text-white">{products.length} Products</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="bg-slate-50">
                  {["Product","Units","Revenue"].map(h => (
                    <th key={h} className={`py-2.5 px-3 font-semibold text-slate-500 uppercase tracking-wide ${h === "Product" ? "text-left" : "text-right"}`}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {products.map((r, i) => (
                    <tr key={r.product}
                      className={`border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors ${i % 2 ? "bg-slate-50/40" : ""}`}
                      onClick={() => setDrill(r)}
                    >
                      <td className="py-2.5 px-3 text-slate-700 font-medium whitespace-nowrap flex items-center gap-1">
                        {r.product}<ChevronRight size={11} className="text-slate-300" />
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums">{fmtN(r.units)}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums font-medium">{fmtRs(r.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <DrillDrawer open={!!drill} onClose={() => setDrill(null)} title={`Product: ${drill?.product ?? ""}`}>
        {drill && (
          <div className="grid grid-cols-2 gap-3">
            <GasKpi label="Units Sold"    value={fmtN(drill.units)}          accent={C_BLUE} />
            <GasKpi label="Revenue"       value={fmtRs(drill.revenue)}       accent={G} />
            <GasKpi label="Revenue/Unit"  value={fmtRsFull(drill.units > 0 ? drill.revenue / drill.units : 0)} accent={C_PURP} />
            <GasKpi label="Revenue Share" value={products.length ? `${((drill.revenue / products.reduce((s, p) => s + p.revenue, 0)) * 100).toFixed(1)}%` : "—"} accent={C_AMB} />
          </div>
        )}
      </DrillDrawer>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── NEEMANS DASHBOARD — 5 TABS ────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

type NmsTab = "overview" | "agents" | "apr" | "snap" | "agent-details" | "upload";

// ── Types ─────────────────────────────────────────────────────────────────────
interface NmsKpis {
  workable_data: number; conversion_pct: number; total_orders: number;
  revenue: number; achievement_pct: number | null; prorated_target: number | null;
  days_elapsed: number; paid_pct: number; cod_pct: number;
}
interface NmsDaily { date: string; orders: number; revenue: number; conversion_pct: number; }
interface NmsAgent { agent_name: string; total_leads: number; sales: number; revenue: number; conversion_pct: number; cod_pct: number; paid_pct: number; }
interface NmsAprKpis { total_calls: number; agent_count: number; avg_occupancy_pct: number; avg_acht: number; total_attendance: number; }
interface NmsAprAgent { agent_id: string; agent_name: string; calls: number; occupancy_pct: number; acht: number; }
interface NmsAgentDetail { id: number; agent_id: string; agent_name: string; team: string; doj: string | null; active: boolean; }

export function NeemansDashboard({ month }: { month: string }) {
  const { hasAnyRole } = useWorkforceAccess();
  const canManage = hasAnyRole("super_admin", "admin", "operations_manager");
  const { toast } = useToast();

  const [tab, setTab] = useState<NmsTab>("overview");

  // ── Overview state ────────────────────────────────────────────────────────
  const [kpis, setKpis] = useState<NmsKpis | null>(null);
  const [daily, setDaily] = useState<NmsDaily[]>([]);
  const [agents, setAgents] = useState<NmsAgent[]>([]);
  const [target, setTarget] = useState<{ total_target: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandChart, setExpandChart] = useState<string | null>(null);
  const [drillDate, setDrillDate] = useState<NmsDaily | null>(null);
  const [drillAgent, setDrillAgent] = useState<NmsAgent | null>(null);

  // ── APR state ─────────────────────────────────────────────────────────────
  const [aprKpis, setAprKpis] = useState<NmsAprKpis | null>(null);
  const [aprAgents, setAprAgents] = useState<NmsAprAgent[]>([]);
  const [aprLoading, setAprLoading] = useState(false);

  // ── Snap state ────────────────────────────────────────────────────────────
  const [snapData, setSnapData] = useState<any>(null);
  const [snapLoading, setSnapLoading] = useState(false);

  // ── Weekly ranking state ──────────────────────────────────────────────────
  const [weeklyData, setWeeklyData] = useState<{ weeks: string[]; rows: any[]; monthlyTarget: number | null } | null>(null);
  const [weeklyLoading, setWeeklyLoading] = useState(false);

  // ── Agent Details state ───────────────────────────────────────────────────
  const [agentDetails, setAgentDetails] = useState<NmsAgentDetail[]>([]);
  const [adLoading, setAdLoading] = useState(false);
  const [adModal, setAdModal] = useState(false);
  const [adEdit, setAdEdit] = useState<NmsAgentDetail | null>(null);
  const [adForm, setAdForm] = useState({ agent_id: "", agent_name: "", team: "", doj: "", active: true });
  const [adSaving, setAdSaving] = useState(false);

  // ── Set Target modal ──────────────────────────────────────────────────────
  const [targetModal, setTargetModal] = useState(false);
  const [targetAmount, setTargetAmount] = useState("");
  const [targetSaving, setTargetSaving] = useState(false);

  // ── Upload state ──────────────────────────────────────────────────────────
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [uploadFiles, setUploadFiles] = useState<Record<string, File | null>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadResults, setUploadResults] = useState<Record<string, { ok: boolean; msg: string }>>({});

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    try {
      const r = await hrmsApi.get<{ data: { kpis: NmsKpis; daily_trend: NmsDaily[]; agents: NmsAgent[]; target: { total_target: number } | null } }>(
        `/api/sales-upload/neemans-dashboard?month=${month}`
      );
      setKpis(r.data?.kpis ?? null);
      setDaily(r.data?.daily_trend ?? []);
      setAgents(r.data?.agents ?? []);
      setTarget(r.data?.target ?? null);
    } catch { /* unavailable */ }
    finally { setLoading(false); }
  }, [month]);

  const fetchApr = useCallback(async () => {
    setAprLoading(true);
    try {
      const r = await hrmsApi.get<{ data: { kpis: NmsAprKpis; agents: NmsAprAgent[] } }>(
        `/api/sales-upload/neemans-apr-dashboard?month=${month}`
      );
      setAprKpis(r.data?.kpis ?? null);
      setAprAgents(r.data?.agents ?? []);
    } catch { }
    finally { setAprLoading(false); }
  }, [month]);

  const fetchAgentDetails = useCallback(async () => {
    setAdLoading(true);
    try {
      const r = await hrmsApi.get<{ data: NmsAgentDetail[] }>("/api/sales-upload/nms-agent-details");
      setAgentDetails(r.data ?? []);
    } catch { }
    finally { setAdLoading(false); }
  }, []);

  const fetchSnap = useCallback(async () => {
    setSnapLoading(true);
    try {
      const r = await hrmsApi.get<{ data: any; _unavailable?: boolean }>(`/api/sales-upload/neemans-abc-cart-snap?month=${month}`);
      setSnapData((r as any)._unavailable ? null : (r.data ?? null));
    } catch { setSnapData(null); }
    finally { setSnapLoading(false); }
  }, [month]);

  const fetchWeekly = useCallback(async () => {
    setWeeklyLoading(true);
    try {
      const r = await hrmsApi.get<{ data: any; _unavailable?: boolean }>(`/api/sales-upload/neemans-weekly-ranking?month=${month}`);
      setWeeklyData((r as any)._unavailable ? null : (r.data ?? null));
    } catch { setWeeklyData(null); }
    finally { setWeeklyLoading(false); }
  }, [month]);

  useEffect(() => { void fetchOverview(); }, [fetchOverview]);
  useEffect(() => { if (tab === "apr") void fetchApr(); }, [tab, fetchApr]);
  useEffect(() => { if (tab === "agent-details") void fetchAgentDetails(); }, [tab, fetchAgentDetails]);
  useEffect(() => { if (tab === "snap") void fetchSnap(); }, [tab, fetchSnap]);
  useEffect(() => { if (tab === "agents") void fetchWeekly(); }, [tab, fetchWeekly]);

  // Cumulative revenue for achievement chart
  const cumData = useMemo(() => {
    const dailyTarget = target ? target.total_target / new Date(Number(month.split("-")[0]), Number(month.split("-")[1]), 0).getDate() : null;
    let cumRev = 0; let cumTgt = 0;
    return daily.map(d => {
      cumRev += Number(d.revenue ?? 0);
      if (dailyTarget) cumTgt += dailyTarget;
      return { ...d, cumRev, cumTgt: dailyTarget ? Math.round(cumTgt) : null };
    });
  }, [daily, target, month]);

  // Ranked agents for top-5 chart
  const top5 = useMemo(() => [...agents].sort((a, b) => b.revenue - a.revenue).slice(0, 5), [agents]);

  // ── Save target ────────────────────────────────────────────────────────────
  async function saveTarget() {
    const v = parseFloat(targetAmount.replace(/,/g, ""));
    if (isNaN(v) || v <= 0) { toast({ variant: "destructive", title: "Enter a valid target amount" }); return; }
    setTargetSaving(true);
    try {
      await hrmsApi.post("/api/sales-upload/neemans-targets", { month, total_target: v, daily_target: 0 });
      toast({ title: "Target saved" });
      setTargetModal(false);
      void fetchOverview();
    } catch { toast({ variant: "destructive", title: "Failed to save target" }); }
    finally { setTargetSaving(false); }
  }

  // ── Upload ─────────────────────────────────────────────────────────────────
  const UPLOAD_TYPES: { key: string; label: string; endpoint: string }[] = [
    { key: "sale-raw",   label: "Sale Raw",    endpoint: "/api/sales-upload/upload-neemans-sale-raw" },
    { key: "allocation", label: "Allocation",  endpoint: "/api/sales-upload/upload-neemans-allocation" },
    { key: "apr",        label: "APR Data",    endpoint: "/api/sales-upload/upload-neemans-apr" },
  ];

  async function doUpload(type: string, endpoint: string) {
    const file = uploadFiles[type];
    if (!file) return;
    setUploading(type);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await hrmsApi.postForm<{ data: { rowsInserted: number } }>(endpoint, fd);
      const n = r.data?.rowsInserted ?? "?";
      setUploadResults(p => ({ ...p, [type]: { ok: true, msg: `${n} rows uploaded` } }));
      setUploadFiles(p => ({ ...p, [type]: null }));
      if (fileRefs.current[type]) (fileRefs.current[type] as HTMLInputElement).value = "";
      void fetchOverview();
    } catch (err: any) {
      setUploadResults(p => ({ ...p, [type]: { ok: false, msg: err?.response?.data?.error ?? err?.message ?? "Upload failed" } }));
    }
    finally { setUploading(null); }
  }

  // ── Agent detail CRUD ──────────────────────────────────────────────────────
  async function saveAgentDetail() {
    if (!adForm.agent_id.trim() || !adForm.agent_name.trim()) { toast({ variant: "destructive", title: "Emp ID and Name required" }); return; }
    setAdSaving(true);
    try {
      if (adEdit) {
        await hrmsApi.put(`/api/sales-upload/nms-agent-details/${adEdit.id}`, { agent_id: adForm.agent_id, agent_name: adForm.agent_name, team: adForm.team, doj: adForm.doj || null, active: adForm.active });
      } else {
        await hrmsApi.post("/api/sales-upload/nms-agent-details", { agent_id: adForm.agent_id, agent_name: adForm.agent_name, team: adForm.team, doj: adForm.doj || null });
      }
      toast({ title: "Agent saved" });
      setAdModal(false);
      void fetchAgentDetails();
    } catch { toast({ variant: "destructive", title: "Save failed" }); }
    finally { setAdSaving(false); }
  }

  const NMS_TABS: { id: NmsTab; label: string }[] = [
    { id: "overview",      label: "Overview" },
    { id: "agents",        label: "Agents" },
    { id: "apr",           label: "APR" },
    { id: "snap",          label: "Cart Snap" },
    { id: "agent-details", label: "Agent Details" },
    { id: "upload",        label: "Upload" },
  ];

  return (
    <div className="space-y-4">
      {/* Tab bar + controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 rounded-2xl" style={{ background: NAVY }}>
        <div className="flex gap-1 p-1 rounded-xl bg-white/10">
          {NMS_TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="px-3 sm:px-5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all"
              style={tab === t.id ? { background: "#fff", color: NAVY } : { color: "rgba(255,255,255,.75)" }}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {canManage && tab === "overview" && (
            <button onClick={() => setTargetModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl border border-white/30 text-white/80 hover:bg-white/20 transition">
              <Target size={13} /> Set Target
            </button>
          )}
          {canManage && tab === "agent-details" && (
            <button onClick={() => { setAdEdit(null); setAdForm({ agent_id: "", agent_name: "", team: "", doj: "", active: true }); setAdModal(true); }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl border border-white/30 text-white/80 hover:bg-white/20 transition">
              <Plus size={13} /> Add Agent
            </button>
          )}
        </div>
      </div>

      {/* ── OVERVIEW ── */}
      {tab === "overview" && (
        loading ? <Spinner /> : (
          <div className="space-y-5">
            {kpis && (
              <>
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Performance</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
                  <GasKpi label="Total Orders"  value={fmtN(kpis.total_orders)}   accent={C_BLUE} foot="Sale records" />
                  <GasKpi label="Revenue"        value={fmtRs(kpis.revenue)}       accent={G} foot={fmtRsFull(kpis.revenue)} />
                  <GasKpi label="Conversion %"   value={fmtPct(kpis.conversion_pct)} accent={C_PURP} foot="Of total leads" />
                  <GasKpi label="Paid %"         value={fmtPct(kpis.paid_pct)}     accent={C_CYAN} foot="Of sales" />
                  <GasKpi label="COD %"          value={fmtPct(kpis.cod_pct)}      accent={C_ORG} foot="Of sales" />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
                  <GasKpi label="Workable Data" value={fmtN(kpis.workable_data)} accent="#64748B" foot="Total leads" />
                  <GasKpi label="Achievement %" value={kpis.achievement_pct != null ? `${kpis.achievement_pct}%` : "No target"}
                    accent={kpis.achievement_pct == null ? "#64748B" : kpis.achievement_pct >= 100 ? G : kpis.achievement_pct >= 70 ? C_AMB : C_RED}
                    foot={kpis.prorated_target != null ? `Prorated: ${fmtRs(kpis.prorated_target)} (day ${kpis.days_elapsed})` : "Set a monthly target"} />
                  <GasKpi label="Monthly Target" value={target ? fmtRs(target.total_target) : "Not set"} accent={C_PURP}
                    foot={target ? `${month}` : "Use Set Target button"} />
                  <GasKpi label="Days Elapsed"   value={`${kpis.days_elapsed} days`} accent="#64748B" foot={`of ${new Date(Number(month.split("-")[0]), Number(month.split("-")[1]), 0).getDate()} in month`} />
                </div>
              </>
            )}

            {daily.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Conversion trend */}
                <ChartCard title="Date-wise Conversion %" subtitle="Last 30 days · click ⤢ for full view" onExpand={() => setExpandChart("conv")}>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={daily.slice(-14)} margin={{ top: 20, right: 10, bottom: 0, left: -20 }}>
                      <CartesianGrid {...GRID_PROPS} />
                      <XAxis dataKey="date" tick={{ ...AXIS_TICK, fontSize: 9 }} angle={-30} textAnchor="end" height={38} />
                      <YAxis tick={AXIS_TICK} unit="%" />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Line type="monotone" dataKey="conversion_pct" name="Conv%" stroke={C_PURP} strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartCard>

                {/* Revenue trend */}
                <ChartCard title="Date-wise Revenue" subtitle="Last 30 days · click ⤢ for full view" onExpand={() => setExpandChart("rev")}>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={daily.slice(-14)} margin={{ top: 20, right: 10, bottom: 0, left: -20 }}>
                      <CartesianGrid {...GRID_PROPS} />
                      <XAxis dataKey="date" tick={{ ...AXIS_TICK, fontSize: 9 }} angle={-30} textAnchor="end" height={38} />
                      <YAxis tick={AXIS_TICK} tickFormatter={fmtRs} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => [fmtRsFull(v), "Revenue"]} />
                      <Bar dataKey="revenue" name="Revenue" fill={G} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>

                {/* Sale count */}
                <ChartCard title="Date-wise Sale Count" subtitle="Last 30 days" onExpand={() => setExpandChart("sales")}>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={daily.slice(-14)} margin={{ top: 20, right: 10, bottom: 0, left: -20 }}>
                      <CartesianGrid {...GRID_PROPS} />
                      <XAxis dataKey="date" tick={{ ...AXIS_TICK, fontSize: 9 }} angle={-30} textAnchor="end" height={38} />
                      <YAxis tick={AXIS_TICK} allowDecimals={false} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Bar dataKey="orders" name="Sales" fill={C_AMB} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>

                {/* Cumulative vs Target */}
                <ChartCard title="Cumulative Revenue vs Target" subtitle="Month to date" onExpand={() => setExpandChart("ach")}>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={cumData} margin={{ top: 10, right: 10, bottom: 0, left: -20 }}>
                      <CartesianGrid {...GRID_PROPS} />
                      <XAxis dataKey="date" tick={{ ...AXIS_TICK, fontSize: 9 }} angle={-30} textAnchor="end" height={38} />
                      <YAxis tick={AXIS_TICK} tickFormatter={fmtRs} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any, n: string) => [fmtRsFull(v), n]} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line type="monotone" dataKey="cumRev" name="Achievement" stroke={G} strokeWidth={2.5} dot={false} />
                      {cumData[0]?.cumTgt != null && <Line type="monotone" dataKey="cumTgt" name="Target" stroke={C_RED} strokeWidth={1.5} strokeDasharray="5 3" dot={false} />}
                    </LineChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>
            )}

            {/* Date-wise table */}
            {daily.length > 0 && (
              <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
                <div className="px-5 py-3" style={{ background: NAVY }}>
                  <h3 className="text-xs font-semibold uppercase tracking-widest text-white">Date-wise Breakdown</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="bg-slate-50">
                      {["Date","Orders","Revenue","Conversion %"].map(h => (
                        <th key={h} className={`py-2.5 px-3 font-semibold text-slate-500 uppercase tracking-wide ${h === "Date" ? "text-left" : "text-right"}`}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {daily.map((d, i) => (
                        <tr key={d.date} className={`border-b border-slate-100 hover:bg-slate-50 cursor-pointer ${i % 2 ? "bg-slate-50/40" : ""}`}
                          onClick={() => setDrillDate(d)}>
                          <td className="py-2.5 px-3 font-medium text-slate-700 whitespace-nowrap flex items-center gap-1">
                            {d.date}<ChevronRight size={11} className="text-slate-300" />
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">{fmtN(d.orders)}</td>
                          <td className="py-2.5 px-3 text-right tabular-nums font-medium">{fmtRs(d.revenue)}</td>
                          <td className="py-2.5 px-3 text-right tabular-nums">{fmtPct(d.conversion_pct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )
      )}

      {/* ── AGENTS ── */}
      {tab === "agents" && (
        <div className="space-y-5">
          {top5.length > 0 && (
            <ChartCard title="Top 5 Agents — Revenue">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={top5} layout="vertical" margin={{ top: 4, right: 70, bottom: 4, left: 110 }}>
                  <CartesianGrid {...GRID_PROPS} horizontal={false} />
                  <XAxis type="number" tick={AXIS_TICK} tickFormatter={fmtRs} />
                  <YAxis type="category" dataKey="agent_name" tick={{ ...AXIS_TICK, fontSize: 10 }} width={110} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => [fmtRsFull(v), "Revenue"]} />
                  <Bar dataKey="revenue" name="Revenue" fill={G} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <div className="px-5 py-3" style={{ background: NAVY }}>
              <h3 className="text-xs font-semibold uppercase tracking-widest text-white">{agents.length} Agents</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="bg-slate-50">
                  {["Agent","Leads","Sales","Revenue","Conv%","Paid%","COD%","Rank"].map(h => (
                    <th key={h} className={`py-2.5 px-3 font-semibold text-slate-500 uppercase tracking-wide ${h === "Agent" ? "text-left" : "text-right"}`}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {agents.map((a, i) => {
                    const tgt = target ? (target.total_target / agents.length) : null;
                    const ach = tgt && tgt > 0 ? Math.round((a.revenue / tgt) * 100) : null;
                    const rank = stackRank(ach);
                    return (
                      <tr key={a.agent_name} className={`border-b border-slate-100 hover:bg-slate-50 cursor-pointer ${i % 2 ? "bg-slate-50/40" : ""}`}
                        onClick={() => setDrillAgent(a)}>
                        <td className="py-2.5 px-3 font-medium text-slate-700 whitespace-nowrap flex items-center gap-1">
                          {a.agent_name}<ChevronRight size={11} className="text-slate-300" />
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums">{fmtN(a.total_leads)}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums">{fmtN(a.sales)}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-medium">{fmtRs(a.revenue)}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums">{fmtPct(a.conversion_pct)}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums">
                          <span className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${Number(a.paid_pct) >= 75 ? "text-green-600 bg-green-100" : "text-red-600 bg-red-100"}`}>
                            {fmtPct(a.paid_pct)}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums">{fmtPct(a.cod_pct)}</td>
                        <td className="py-2.5 px-3 text-right"><RankBadge rank={rank} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── WEEKLY RANKING (shown at bottom of Agents tab) ── */}
      {tab === "agents" && (
        <div className="space-y-2">
          {weeklyLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" />
            </div>
          ) : weeklyData && weeklyData.rows.length > 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
              <div className="px-5 py-3" style={{ background: NAVY }}>
                <h3 className="text-xs font-semibold uppercase tracking-widest text-white">
                  Weekly Achievement % &amp; Stack Ranking
                  {weeklyData.monthlyTarget && (
                    <span className="ml-2 text-indigo-200 font-normal normal-case">
                      Monthly target: {fmtRs(weeklyData.monthlyTarget)} · weekly share = ÷5
                    </span>
                  )}
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ background: "#EEF2FF" }}>
                      <th className="px-3 py-2.5 text-left font-semibold text-slate-600 whitespace-nowrap">Agent</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-slate-600">MAS ID</th>
                      {weeklyData.weeks.map((w: string) => (
                        <th key={w} className="px-3 py-2.5 text-right font-semibold text-slate-600 whitespace-nowrap">{w}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {weeklyData.rows.map((r: any, i: number) => (
                      <tr key={r.emp_id || r.agent_name} className={`border-t border-slate-50 hover:bg-slate-50/70 ${i % 2 ? "bg-slate-50/30" : ""}`}>
                        <td className="px-3 py-2.5 text-slate-700 font-medium whitespace-nowrap">{r.agent_name}</td>
                        <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{r.emp_id || "—"}</td>
                        {weeklyData.weeks.map((w: string) => {
                          const cell = r.weeks[w];
                          return (
                            <td key={w} className="px-3 py-2.5 text-right whitespace-nowrap">
                              {!cell || cell.target == null ? (
                                <span className="text-slate-300">—</span>
                              ) : (
                                <div className="flex items-center justify-end gap-1.5">
                                  <span className="font-semibold text-slate-700 tabular-nums">
                                    {cell.achievementPct != null ? `${cell.achievementPct}%` : "—"}
                                  </span>
                                  <RankBadge rank={cell.rank} />
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* ── CART SNAP ── */}
      {tab === "snap" && (
        snapLoading ? <Spinner /> : !snapData ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <BarChart2 size={36} className="text-slate-300" />
            <p className="text-sm text-slate-500">No Cart Snap data for {month}.</p>
            <p className="text-xs text-slate-400">Upload Sale Raw + Allocation data for this month via the Upload tab.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* MTD + Weekly pivot table */}
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
              <div className="px-5 py-3" style={{ background: NAVY }}>
                <h3 className="text-xs font-semibold uppercase tracking-widest text-white">
                  ABC Cart Snap — {month} · MTD + Weekly + Daily
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse" style={{ minWidth: 700 }}>
                  <thead>
                    <tr>
                      <th className="px-3 py-2.5 text-left font-bold text-white whitespace-nowrap sticky left-0 z-10" style={{ background: "#0A4A5A", minWidth: 200 }}>Metric</th>
                      <th className="px-3 py-2 text-center font-bold text-white whitespace-nowrap sticky z-10" style={{ background: "#0A4A5A", minWidth: 85, left: 200 }}>MTD</th>
                      {(snapData.weekly ?? []).map((w: any) => (
                        <th key={w.week} className="px-3 py-2 text-center font-bold text-white whitespace-nowrap" style={{ background: "#7C3A10", minWidth: 85 }}>{w.week}</th>
                      ))}
                      {(snapData.daily ?? []).map((d: any) => (
                        <th key={d.date_key} className="px-3 py-2 text-center font-semibold text-white whitespace-nowrap" style={{ background: "#0D5E73", minWidth: 80 }}>{d.label || d.date_key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label: "Workable Cases",      key: "workable",        fmt: fmtN },
                      { label: "Connected",           key: "connected",       fmt: fmtN },
                      { label: "Connected %",         key: "connected_pct",   fmt: (v: any) => `${v}%` },
                      { label: "Login Count",         key: "login_count",     fmt: fmtN },
                      { label: "Call Per Agent",      key: "call_per_agent",  fmt: fmtN },
                      { label: "Sale Count",          key: "sale_count",      fmt: fmtN },
                      { label: "Conversion %",        key: "conversion_pct",  fmt: (v: any) => `${v}%` },
                      { label: "Revenue",             key: "revenue",         fmt: fmtRs },
                      { label: "COD Count",           key: "cod_count",       fmt: fmtN },
                      { label: "Prepaid Count",       key: "prepaid_count",   fmt: fmtN },
                      { label: "Prepaid %",           key: "prepaid_pct",     fmt: (v: any) => `${v}%` },
                    ].map((row, ri) => (
                      <tr key={row.key} style={{ background: ri % 2 === 0 ? "#F0FFF4" : "#FAFFFE" }}>
                        <td className="px-3 py-2 font-semibold text-slate-800 whitespace-nowrap sticky left-0 z-10 border-b border-slate-200" style={{ background: "inherit", minWidth: 200 }}>{row.label}</td>
                        <td className="px-3 py-2 text-center tabular-nums border-b border-slate-100 sticky z-10" style={{ background: "#D9EEF7", left: 200, minWidth: 85 }}>
                          {snapData.mtd?.[row.key] != null ? row.fmt(snapData.mtd[row.key]) : "—"}
                        </td>
                        {(snapData.weekly ?? []).map((w: any) => (
                          <td key={w.week} className="px-3 py-2 text-center tabular-nums border-b border-slate-100" style={{ background: "#FCE4D6", minWidth: 85 }}>
                            {w[row.key] != null ? row.fmt(w[row.key]) : "—"}
                          </td>
                        ))}
                        {(snapData.daily ?? []).map((d: any) => (
                          <td key={d.date_key} className="px-3 py-2 text-center tabular-nums border-b border-slate-100" style={{ minWidth: 80 }}>
                            {d[row.key] != null ? row.fmt(d[row.key]) : "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Disposition breakdown */}
            {snapData.disposition?.length > 0 && (
              <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
                <div className="px-5 py-3" style={{ background: "#0277BD" }}>
                  <h3 className="text-xs font-semibold uppercase tracking-widest text-white">Calling Disposition — MTD</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr style={{ background: "#E3F2FD" }}>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Disposition</th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-600">Count</th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-600">%</th>
                    </tr></thead>
                    <tbody>
                      {snapData.disposition.map((d: any, i: number) => (
                        <tr key={d.calling_status} className={`border-t border-slate-100 ${i % 2 ? "bg-slate-50/30" : ""}`}>
                          <td className="px-3 py-2 text-slate-700 font-medium">{d.calling_status}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtN(d.cnt)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            <span className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${d.calling_status === "Connected" ? "text-green-600 bg-green-100" : "text-slate-600 bg-slate-100"}`}>
                              {fmtPct(d.pct)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )
      )}

      {/* ── APR ── */}
      {tab === "apr" && (
        aprLoading ? <Spinner /> : (
          <div className="space-y-5">
            {aprKpis && (
              <>
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">APR KPIs</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
                  <GasKpi label="Total Calls"  value={fmtN(aprKpis.total_calls)}      accent={C_BLUE} />
                  <GasKpi label="Agents"        value={fmtN(aprKpis.agent_count)}      accent={G} />
                  <GasKpi label="Avg Occu %"    value={fmtPct(aprKpis.avg_occupancy_pct)} accent={C_AMB} foot="Average occupancy" />
                  <GasKpi label="Avg ACHT"      value={aprKpis.avg_acht ? `${Math.round(aprKpis.avg_acht)}s` : "—"} accent={C_CYAN} foot="Handle time" />
                  <GasKpi label="Attendance"    value={fmtN(aprKpis.total_attendance)} accent={C_PURP} foot="Agent-days" />
                </div>
              </>
            )}
            {!aprKpis && !aprLoading && (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <BarChart2 size={36} className="text-slate-300" />
                <p className="text-sm text-slate-400">No APR data for {month}. Upload via the Upload tab → APR Data.</p>
              </div>
            )}
            {aprAgents.length > 0 && (
              <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
                <div className="px-5 py-3" style={{ background: NAVY }}>
                  <h3 className="text-xs font-semibold uppercase tracking-widest text-white">{aprAgents.length} Agents — APR</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="bg-slate-50">
                      {["Agent","Emp ID","Calls","Occu %","ACHT (s)"].map(h => (
                        <th key={h} className={`py-2.5 px-3 font-semibold text-slate-500 uppercase tracking-wide ${h === "Agent" ? "text-left" : "text-right"}`}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {aprAgents.map((a, i) => (
                        <tr key={a.agent_id} className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${i % 2 ? "bg-slate-50/40" : ""}`}>
                          <td className="py-2.5 px-3 font-medium text-slate-700 whitespace-nowrap">{a.agent_name}</td>
                          <td className="py-2.5 px-3 text-right text-slate-500">{a.agent_id}</td>
                          <td className="py-2.5 px-3 text-right tabular-nums">{fmtN(a.calls)}</td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            <span className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${a.occupancy_pct >= 75 ? "text-green-600 bg-green-100" : a.occupancy_pct >= 60 ? "text-amber-600 bg-amber-100" : "text-red-600 bg-red-100"}`}>
                              {fmtPct(a.occupancy_pct)}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">{a.acht ? `${Math.round(a.acht)}s` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )
      )}

      {/* ── AGENT DETAILS ── */}
      {tab === "agent-details" && (
        adLoading ? <Spinner /> : (
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <div className="flex items-center justify-between px-5 py-3" style={{ background: NAVY }}>
              <h3 className="text-xs font-semibold uppercase tracking-widest text-white">{agentDetails.length} Agents</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="bg-slate-50">
                  {["#","Emp ID","Name","Team / TL","DOJ","Status",""].map(h => (
                    <th key={h} className="py-2.5 px-3 font-semibold text-slate-500 text-left">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {agentDetails.map((a, i) => (
                    <tr key={a.id} className={`border-b border-slate-100 hover:bg-slate-50 ${i % 2 ? "bg-slate-50/40" : ""}`}>
                      <td className="py-2 px-3 text-slate-400">{i + 1}</td>
                      <td className="py-2 px-3 font-semibold text-slate-700">{a.agent_id}</td>
                      <td className="py-2 px-3 font-medium text-slate-700">{a.agent_name}</td>
                      <td className="py-2 px-3 text-slate-500">{a.team || "—"}</td>
                      <td className="py-2 px-3 text-slate-500">{a.doj ? new Date(a.doj).toLocaleDateString("en-IN") : "—"}</td>
                      <td className="py-2 px-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold text-white ${a.active ? "bg-green-500" : "bg-red-400"}`}>{a.active ? "Active" : "Inactive"}</span>
                      </td>
                      {canManage && (
                        <td className="py-2 px-3">
                          <button onClick={() => { setAdEdit(a); setAdForm({ agent_id: a.agent_id, agent_name: a.agent_name, team: a.team ?? "", doj: a.doj ?? "", active: a.active }); setAdModal(true); }}
                            className="px-2 py-0.5 rounded text-[10px] font-semibold border border-indigo-200 text-indigo-700 hover:bg-indigo-50 transition">Edit</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {/* ── UPLOAD ── */}
      {tab === "upload" && (
        <div className="space-y-4">
          {UPLOAD_TYPES.map(ut => (
            <div key={ut.key} className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
              <p className="mb-3 text-sm font-semibold text-slate-700 flex items-center gap-2">
                <Upload size={14} className="text-blue-500" /> {ut.label}
              </p>
              <div className="flex flex-col sm:flex-row gap-3 items-start">
                <input type="file" accept=".xlsx,.xls"
                  ref={el => { fileRefs.current[ut.key] = el; }}
                  onChange={e => setUploadFiles(p => ({ ...p, [ut.key]: e.target.files?.[0] ?? null }))}
                  className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-blue-700" />
                <button onClick={() => doUpload(ut.key, ut.endpoint)}
                  disabled={!uploadFiles[ut.key] || uploading === ut.key}
                  className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap">
                  {uploading === ut.key ? <><Loader2 size={14} className="animate-spin" /> Uploading…</> : <><Upload size={14} /> Upload</>}
                </button>
              </div>
              {uploadResults[ut.key] && (
                <div className={`mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${uploadResults[ut.key].ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                  {uploadResults[ut.key].ok ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
                  {uploadResults[ut.key].msg}
                </div>
              )}
            </div>
          ))}
          <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-700">
            <strong>Note:</strong> ABC Cart Snap requires additional data aggregation. Upload allocation + sale raw + cart data and the snapshot will be generated from those combined inputs.
          </div>
        </div>
      )}

      {/* ── CHART EXPAND MODALS ── */}
      {expandChart === "conv" && (
        <ChartModal title="Date-wise Conversion % — Full Month" onClose={() => setExpandChart(null)}>
          <ResponsiveContainer width="100%" height={420}>
            <LineChart data={daily} margin={{ top: 20, right: 20, bottom: 50, left: -10 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="date" tick={{ ...AXIS_TICK, fontSize: 9 }} angle={-40} textAnchor="end" height={60} />
              <YAxis tick={AXIS_TICK} unit="%" />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Line type="monotone" dataKey="conversion_pct" name="Conv%" stroke={C_PURP} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartModal>
      )}
      {expandChart === "rev" && (
        <ChartModal title="Date-wise Revenue — Full Month" onClose={() => setExpandChart(null)}>
          <ResponsiveContainer width="100%" height={420}>
            <BarChart data={daily} margin={{ top: 20, right: 20, bottom: 50, left: -10 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="date" tick={{ ...AXIS_TICK, fontSize: 9 }} angle={-40} textAnchor="end" height={60} />
              <YAxis tick={AXIS_TICK} tickFormatter={fmtRs} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => [fmtRsFull(v), "Revenue"]} />
              <Bar dataKey="revenue" fill={G} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartModal>
      )}
      {expandChart === "sales" && (
        <ChartModal title="Date-wise Sale Count — Full Month" onClose={() => setExpandChart(null)}>
          <ResponsiveContainer width="100%" height={420}>
            <BarChart data={daily} margin={{ top: 20, right: 20, bottom: 50, left: -10 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="date" tick={{ ...AXIS_TICK, fontSize: 9 }} angle={-40} textAnchor="end" height={60} />
              <YAxis tick={AXIS_TICK} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="orders" name="Sales" fill={C_AMB} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartModal>
      )}
      {expandChart === "ach" && (
        <ChartModal title="Cumulative Revenue vs Target" onClose={() => setExpandChart(null)}>
          <ResponsiveContainer width="100%" height={420}>
            <LineChart data={cumData} margin={{ top: 10, right: 20, bottom: 50, left: -10 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="date" tick={{ ...AXIS_TICK, fontSize: 9 }} angle={-40} textAnchor="end" height={60} />
              <YAxis tick={AXIS_TICK} tickFormatter={fmtRs} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any, n: string) => [fmtRsFull(v), n]} />
              <Legend />
              <Line type="monotone" dataKey="cumRev" name="Achievement" stroke={G} strokeWidth={2.5} dot={false} />
              {cumData[0]?.cumTgt != null && <Line type="monotone" dataKey="cumTgt" name="Target" stroke={C_RED} strokeWidth={1.5} strokeDasharray="5 3" dot={false} />}
            </LineChart>
          </ResponsiveContainer>
        </ChartModal>
      )}

      {/* ── DRILL-DOWN DRAWERS ── */}
      <DrillDrawer open={!!drillDate} onClose={() => setDrillDate(null)} title={`Date Detail: ${drillDate?.date ?? ""}`}>
        {drillDate && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <GasKpi label="Orders"       value={fmtN(drillDate.orders)}         accent={C_BLUE} />
              <GasKpi label="Revenue"      value={fmtRs(drillDate.revenue)}       accent={G} />
              <GasKpi label="Conversion %" value={fmtPct(drillDate.conversion_pct)} accent={C_PURP} />
              <GasKpi label="Rev / Order"  value={drillDate.orders > 0 ? fmtRsFull(drillDate.revenue / drillDate.orders) : "—"} accent={C_AMB} />
            </div>
            <p className="text-xs text-slate-400">Agent-level breakdown for a specific date requires uploading CDR data for that date range.</p>
          </div>
        )}
      </DrillDrawer>

      <DrillDrawer open={!!drillAgent} onClose={() => setDrillAgent(null)} title={`Agent: ${drillAgent?.agent_name ?? ""}`}>
        {drillAgent && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <GasKpi label="Total Leads"  value={fmtN(drillAgent.total_leads)}       accent="#64748B" />
              <GasKpi label="Sales"        value={fmtN(drillAgent.sales)}             accent={C_BLUE} />
              <GasKpi label="Revenue"      value={fmtRs(drillAgent.revenue)}          accent={G} />
              <GasKpi label="Conversion %" value={fmtPct(drillAgent.conversion_pct)}  accent={C_PURP} />
              <GasKpi label="Paid %"       value={fmtPct(drillAgent.paid_pct)}        accent={drillAgent.paid_pct >= 75 ? G : C_RED} />
              <GasKpi label="COD %"        value={fmtPct(drillAgent.cod_pct)}         accent={C_ORG} />
            </div>
            <div className="rounded-xl bg-slate-50 p-4 text-xs text-slate-500">
              <p className="font-semibold text-slate-700 mb-2">Stack Rank (by revenue vs equal-share target)</p>
              {target
                ? (() => {
                  const share = target.total_target / Math.max(agents.length, 1);
                  const ach = share > 0 ? Math.round((drillAgent.revenue / share) * 100) : null;
                  const rank = stackRank(ach);
                  return (
                    <div className="flex items-center gap-3">
                      <RankBadge rank={rank} />
                      <span>{ach != null ? `${ach}% of equal-share target (${fmtRs(share)})` : "No target set"}</span>
                    </div>
                  );
                })()
                : <p>Set a monthly target to enable stack ranking.</p>
              }
            </div>
          </div>
        )}
      </DrillDrawer>

      {/* ── SET TARGET MODAL ── */}
      {targetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4" style={{ background: NAVY, borderRadius: "1rem 1rem 0 0" }}>
              <div>
                <h3 className="font-bold text-white text-sm">Set Monthly Target</h3>
                <p className="text-indigo-200 text-xs mt-0.5">Neemans — {month}</p>
              </div>
              <button onClick={() => setTargetModal(false)} className="p-1.5 rounded-xl text-white/70 hover:text-white hover:bg-white/20 transition"><X size={16} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Revenue Target (₹)</label>
                <input type="number" value={targetAmount} onChange={e => setTargetAmount(e.target.value)}
                  placeholder="e.g. 6774194"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
              {target && (
                <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  Current: <strong>₹{target.total_target.toLocaleString("en-IN")}</strong> for {month}
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={() => setTargetModal(false)} className="flex-1 py-2.5 text-sm font-semibold rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition">Cancel</button>
                <button onClick={saveTarget} disabled={targetSaving}
                  className="flex-1 py-2.5 text-sm font-semibold rounded-xl text-white transition disabled:opacity-60 flex items-center justify-center gap-1.5"
                  style={{ background: NAVY }}>
                  {targetSaving ? <Loader2 size={14} className="animate-spin" /> : <Target size={14} />}
                  {targetSaving ? "Saving…" : "Save Target"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── AGENT DETAIL MODAL ── */}
      {adModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4" style={{ background: NAVY, borderRadius: "1rem 1rem 0 0" }}>
              <h3 className="font-bold text-white text-sm">{adEdit ? "Edit Agent" : "Add Agent"}</h3>
              <button onClick={() => setAdModal(false)} className="p-1.5 rounded-xl text-white/70 hover:text-white hover:bg-white/20 transition"><X size={16} /></button>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Emp ID *", key: "agent_id", placeholder: "MAS00001" },
                  { label: "Name *",   key: "agent_name", placeholder: "Full Name" },
                  { label: "Team / TL", key: "team", placeholder: "Team Leader" },
                  { label: "Date of Joining", key: "doj", type: "date" },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">{f.label}</label>
                    <input type={f.type ?? "text"} value={(adForm as any)[f.key]} placeholder={f.placeholder ?? ""}
                      onChange={e => setAdForm(p => ({ ...p, [f.key]: e.target.value }))}
                      className="w-full text-xs rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                  </div>
                ))}
                {adEdit && (
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Status</label>
                    <select value={adForm.active ? "Active" : "Inactive"}
                      onChange={e => setAdForm(p => ({ ...p, active: e.target.value === "Active" }))}
                      className="w-full text-xs rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300">
                      <option>Active</option><option>Inactive</option>
                    </select>
                  </div>
                )}
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setAdModal(false)} className="flex-1 py-2.5 text-sm font-semibold rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50">Cancel</button>
                <button onClick={saveAgentDetail} disabled={adSaving}
                  className="flex-1 py-2.5 text-sm font-semibold rounded-xl text-white flex items-center justify-center gap-1.5 disabled:opacity-60"
                  style={{ background: NAVY }}>
                  {adSaving ? <Loader2 size={14} className="animate-spin" /> : null}
                  {adSaving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── UPLOAD PANEL (Shared — Bellavita / GNC / legacy) ─────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// ── AW (AAROHAN WEALTH) DASHBOARD ─────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
//
// Source: db_masmis.aw_out (outbound APR) + aw_billing + aw_mandate.
// month in aw_out is stored as "Sep-26" (MMM-YY varchar) — the backend converts
// YYYY-MM to that format before querying. Verified live 2026-09-14 (34 agents, Sep-26).

interface AwKpis {
  total_calls: number; connected_calls: number; not_connected: number;
  active_agents: number; total_login_hrs: number;
  lrs_amount: number; trade_amount: number; mf_amount: number;
  total_revenue: number; connected_pct: number;
}
interface AwAgent {
  agent_name: string; emp_id: string; lob: string;
  total_calls: number; connected_calls: number; connected_pct: number;
  net_login_hrs: number; acht: number; occupancy_pct: number;
  lrs_amount: number; trade_amount: number; mf_amount: number;
}
interface AwMandate { billing_type: string; mandate: number; per_fe_rate: number; login_hours_per_fte: number; }

export function AwDashboard({ month }: { month: string }) {
  const [kpis, setKpis]     = useState<AwKpis | null>(null);
  const [agents, setAgents] = useState<AwAgent[]>([]);
  const [mandate, setMandate] = useState<AwMandate[]>([]);
  const [availMonths, setAvailMonths] = useState<string[]>([]);
  const [loading, setLoading]   = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [drill, setDrill] = useState<AwAgent | null>(null);
  const [expandRevenue, setExpandRevenue] = useState(false);

  useEffect(() => {
    setLoading(true); setUnavailable(false);
    void hrmsApi.get<{ data: { kpis: AwKpis; agents: AwAgent[]; mandate: AwMandate[]; months: string[] }; _unavailable?: boolean }>(
      `/api/sales-upload/aw-dashboard?month=${month}`
    )
      .then(r => {
        if ((r as any)._unavailable) { setUnavailable(true); return; }
        setKpis(r.data?.kpis ?? null);
        setAgents(r.data?.agents ?? []);
        setMandate(r.data?.mandate ?? []);
        setAvailMonths(r.data?.months ?? []);
      })
      .catch(() => setUnavailable(true))
      .finally(() => setLoading(false));
  }, [month]);

  if (loading) return <Spinner />;

  if (unavailable || (!kpis && agents.length === 0)) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <Activity size={36} className="text-slate-300" />
        <p className="text-sm text-slate-500">No AW data for {month}.</p>
        <p className="text-xs text-slate-400">
          {availMonths.length > 0
            ? `Available months: ${availMonths.slice(0, 6).join(", ")}`
            : "Upload AW Out data via the Upload Data tab to see this dashboard."}
        </p>
      </div>
    );
  }

  const k = kpis!;
  const top5 = [...agents].sort((a, b) => (b.lrs_amount + b.trade_amount + b.mf_amount) - (a.lrs_amount + a.trade_amount + a.mf_amount)).slice(0, 5);

  return (
    <div className="space-y-5">
      {/* KPI strip */}
      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Calling Performance</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <GasKpi label="Total Calls"    value={fmtN(k.total_calls)}      accent={C_BLUE} />
        <GasKpi label="Connected"      value={fmtN(k.connected_calls)}  accent={G}
          foot={`${fmtPct(k.connected_pct)} connect rate`} />
        <GasKpi label="Not Connected"  value={fmtN(k.not_connected)}    accent={C_RED} />
        <GasKpi label="Active Agents"  value={fmtN(k.active_agents)}    accent={C_PURP} />
      </div>

      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Revenue</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <GasKpi label="LRS Amount"     value={fmtRs(k.lrs_amount)}      accent={C_AMB} />
        <GasKpi label="Trade Amount"   value={fmtRs(k.trade_amount)}    accent={C_CYAN} />
        <GasKpi label="MF Amount"      value={fmtRs(k.mf_amount)}       accent={C_PURP} />
        <GasKpi label="Total Revenue"  value={fmtRs(k.total_revenue)}   accent={G}
          foot={`LRS + Trade + MF`} />
      </div>

      {/* Top 5 by revenue chart */}
      {top5.length > 0 && (
        <ChartCard title="Top 5 Agents — Total Revenue" onExpand={() => setExpandRevenue(true)}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={top5.map(a => ({ ...a, totalRevenue: a.lrs_amount + a.trade_amount + a.mf_amount }))}
              layout="vertical" margin={{ top: 4, right: 70, bottom: 4, left: 130 }}>
              <CartesianGrid {...GRID_PROPS} horizontal={false} />
              <XAxis type="number" tick={AXIS_TICK} tickFormatter={fmtRs} />
              <YAxis type="category" dataKey="agent_name" tick={{ ...AXIS_TICK, fontSize: 10 }} width={130} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => [fmtRsFull(v), "Revenue"]} />
              <Bar dataKey="totalRevenue" name="Revenue" fill={G} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {expandRevenue && (
        <ChartModal title="All Agents — Revenue" onClose={() => setExpandRevenue(false)}>
          <ResponsiveContainer width="100%" height={Math.max(300, agents.length * 28)}>
            <BarChart data={agents.map(a => ({ ...a, totalRevenue: a.lrs_amount + a.trade_amount + a.mf_amount }))}
              layout="vertical" margin={{ top: 4, right: 80, bottom: 4, left: 140 }}>
              <CartesianGrid {...GRID_PROPS} horizontal={false} />
              <XAxis type="number" tick={AXIS_TICK} tickFormatter={fmtRs} />
              <YAxis type="category" dataKey="agent_name" tick={{ ...AXIS_TICK, fontSize: 9 }} width={140} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => [fmtRsFull(v), "Revenue"]} />
              <Bar dataKey="totalRevenue" fill={G} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartModal>
      )}

      {/* Agent table */}
      {agents.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
          <div className="px-5 py-3" style={{ background: NAVY }}>
            <h3 className="text-xs font-semibold uppercase tracking-widest text-white">{agents.length} Agents — {month}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="bg-slate-50">
                {["Agent","Emp ID","LOB","Calls","Connected","Connect%","Login Hrs","ACHT","Occu%","LRS","Trade","MF"].map(h => (
                  <th key={h} className={`py-2.5 px-3 font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap ${h === "Agent" ? "text-left" : "text-right"}`}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {agents.map((a, i) => (
                  <tr key={a.emp_id || a.agent_name}
                    className={`border-b border-slate-100 hover:bg-slate-50 cursor-pointer ${i % 2 ? "bg-slate-50/40" : ""}`}
                    onClick={() => setDrill(a)}>
                    <td className="py-2.5 px-3 font-medium text-slate-700 whitespace-nowrap flex items-center gap-1">
                      {a.agent_name}<ChevronRight size={11} className="text-slate-300" />
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-500">{a.emp_id}</td>
                    <td className="py-2.5 px-3 text-right text-slate-500 whitespace-nowrap">{a.lob || "—"}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{fmtN(a.total_calls)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{fmtN(a.connected_calls)}</td>
                    <td className="py-2.5 px-3 text-right">
                      <span className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${Number(a.connected_pct) >= 40 ? "text-green-600 bg-green-100" : "text-red-600 bg-red-100"}`}>
                        {fmtPct(a.connected_pct)}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{fmtN(a.net_login_hrs)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{a.acht ? `${Math.round(a.acht)}s` : "—"}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{fmtPct(a.occupancy_pct)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-medium text-amber-700">{fmtRs(a.lrs_amount)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-medium text-cyan-700">{fmtRs(a.trade_amount)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-medium text-purple-700">{fmtRs(a.mf_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Mandate table */}
      {mandate.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
          <div className="px-5 py-3" style={{ background: "#1565C0" }}>
            <h3 className="text-xs font-semibold uppercase tracking-widest text-white">Mandate — {month}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="bg-blue-50">
                {["Billing Type","Mandate (FTEs)","Per FTE Rate","Login Hrs/FTE"].map(h => (
                  <th key={h} className={`py-2.5 px-3 font-semibold text-blue-700 ${h === "Billing Type" ? "text-left" : "text-right"}`}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {mandate.map((m, i) => (
                  <tr key={m.billing_type} className={`border-t border-slate-100 ${i % 2 ? "bg-slate-50/30" : ""}`}>
                    <td className="py-2.5 px-3 font-medium text-slate-700">{m.billing_type}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-semibold">{fmtN(m.mandate)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{fmtRsFull(m.per_fe_rate)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{m.login_hours_per_fte} hrs</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Agent drill-down */}
      <DrillDrawer open={!!drill} onClose={() => setDrill(null)} title={`Agent: ${drill?.agent_name ?? ""}`}>
        {drill && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <GasKpi label="Total Calls"    value={fmtN(drill.total_calls)}    accent={C_BLUE} />
              <GasKpi label="Connected"      value={fmtN(drill.connected_calls)} accent={G} foot={`${fmtPct(drill.connected_pct)} rate`} />
              <GasKpi label="Login Hrs"      value={fmtN(drill.net_login_hrs)}  accent="#64748B" />
              <GasKpi label="ACHT"           value={drill.acht ? `${Math.round(drill.acht)}s` : "—"} accent={C_CYAN} />
              <GasKpi label="Occupancy %"    value={fmtPct(drill.occupancy_pct)} accent={C_AMB} />
              <GasKpi label="LOB"            value={drill.lob || "—"}            accent={C_PURP} />
            </div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Revenue Breakdown</p>
            <div className="grid grid-cols-3 gap-3">
              <GasKpi label="LRS"   value={fmtRs(drill.lrs_amount)}   accent={C_AMB} />
              <GasKpi label="Trade" value={fmtRs(drill.trade_amount)} accent={C_CYAN} />
              <GasKpi label="MF"    value={fmtRs(drill.mf_amount)}    accent={C_PURP} />
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-xs font-semibold text-slate-700 mb-1">Total Revenue</p>
              <p className="text-2xl font-black" style={{ color: G }}>{fmtRsFull(drill.lrs_amount + drill.trade_amount + drill.mf_amount)}</p>
            </div>
          </div>
        )}
      </DrillDrawer>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── BVO / BELLAVITA REPEAT DASHBOARD ─────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
//
// Source: db_masmis.bvo_order_export (3M rows, Shopify export).
// Date format: DD-MM-YYYY. financial_status: paid/COD/PrePaid/voided/refunded.
// Coverage: 2024-05 through 2025-06 (historical). Verified live 2026-09-15.

interface BvoKpis {
  total_orders: number; total_revenue: number; aov: number;
  paid_count: number; cod_count: number; prepaid_count: number; returned_count: number;
  paid_pct: number; cod_pct: number; prepaid_pct: number; return_pct: number;
  paid_revenue: number; cod_revenue: number;
}
interface BvoDaily { date: string; orders: number; revenue: number; paid_count: number; cod_count: number; }
interface BvoProduct { product: string; orders: number; revenue: number; }
interface BvoPayment { status: string; cnt: number; revenue: number; }

export function BvoDashboard({ month }: { month: string }) {
  const [kpis, setKpis]       = useState<BvoKpis | null>(null);
  const [daily, setDaily]     = useState<BvoDaily[]>([]);
  const [products, setProducts] = useState<BvoProduct[]>([]);
  const [payments, setPayments] = useState<BvoPayment[]>([]);
  const [availMonths, setAvailMonths] = useState<string[]>([]);
  const [selMonth, setSelMonth] = useState(month);
  const [loading, setLoading] = useState(true);
  const [expandChart, setExpandChart] = useState<string | null>(null);
  const [drillProduct, setDrillProduct] = useState<BvoProduct | null>(null);

  const fetchBvo = useCallback((m: string) => {
    setLoading(true);
    void hrmsApi.get<{ data: { kpis: BvoKpis; daily: BvoDaily[]; products: BvoProduct[]; paymentMix: BvoPayment[]; months: string[] }; _unavailable?: boolean }>(
      `/api/sales-upload/bvo-dashboard?month=${m}`
    )
      .then(r => {
        if ((r as any)._unavailable) return;
        setKpis(r.data?.kpis ?? null);
        setDaily(r.data?.daily ?? []);
        setProducts(r.data?.products ?? []);
        setPayments(r.data?.paymentMix ?? []);
        setAvailMonths(r.data?.months ?? []);
        if (!selMonth && r.data?.months?.[0]) setSelMonth(r.data.months[0]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchBvo(selMonth); }, [selMonth]);

  const PAY_COLORS: Record<string, string> = {
    paid: G, COD: C_ORG, PrePaid: C_CYAN, voided: "#94A3B8", refunded: C_RED, partially_paid: C_AMB,
  };

  if (loading) return <Spinner />;

  if (!kpis && !daily.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
        <BarChart2 size={36} className="text-slate-300" />
        <p className="text-sm text-slate-500">No BVO data for {selMonth}.</p>
        {availMonths.length > 0 && (
          <p className="text-xs text-slate-400">Available: {availMonths.slice(0, 6).join(", ")}</p>
        )}
      </div>
    );
  }

  const k = kpis!;
  return (
    <div className="space-y-5">
      {/* Month picker (BVO has different date range from Bellavita/Neemans) */}
      {availMonths.length > 0 && (
        <div className="flex items-center gap-2">
          <Calendar size={13} className="text-slate-400" />
          <select value={selMonth} onChange={e => setSelMonth(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700">
            {availMonths.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      )}

      {/* KPI strip */}
      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Revenue Overview</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <GasKpi label="Total Orders"  value={fmtN(k.total_orders)}    accent={C_BLUE} />
        <GasKpi label="Total Revenue" value={fmtRs(k.total_revenue)}  accent={G}     foot={fmtRsFull(k.total_revenue)} />
        <GasKpi label="AOV"           value={fmtRsFull(k.aov)}        accent={C_PURP} />
        <GasKpi label="Paid %"        value={fmtPct(k.paid_pct)}      accent={G}     foot={`${fmtN(k.paid_count)} orders`} />
        <GasKpi label="COD %"         value={fmtPct(k.cod_pct)}       accent={C_ORG} foot={`${fmtN(k.cod_count)} orders`} />
        <GasKpi label="Return %"      value={fmtPct(k.return_pct)}    accent={C_RED} foot={`${fmtN(k.returned_count)} voided/refunded`} />
      </div>

      {/* Revenue trend chart */}
      {daily.length > 0 && (
        <ChartCard title="Daily Revenue Trend" subtitle={selMonth} onExpand={() => setExpandChart("rev")}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={daily} margin={{ top: 20, right: 10, bottom: 0, left: -20 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="date" tick={{ ...AXIS_TICK, fontSize: 9 }} angle={-30} textAnchor="end" height={38} />
              <YAxis tick={AXIS_TICK} tickFormatter={fmtRs} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => [fmtRsFull(v), "Revenue"]} />
              <Bar dataKey="revenue" name="Revenue" fill={G} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* Payment mode breakdown */}
      {payments.length > 0 && (
        <ChartCard title="Payment Mode Breakdown" subtitle="Count + Revenue by status">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={payments} margin={{ top: 20, right: 10, bottom: 0, left: -20 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="status" tick={AXIS_TICK} />
              <YAxis tick={AXIS_TICK} tickFormatter={fmtN} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="cnt" name="Orders">
                {payments.map((p, i) => (
                  <Cell key={i} fill={PAY_COLORS[p.status] ?? "#94A3B8"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* Products table */}
      {products.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
          <div className="px-5 py-3" style={{ background: NAVY }}>
            <h3 className="text-xs font-semibold uppercase tracking-widest text-white">Top Products by Orders</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="bg-slate-50">
                {["Product","Orders","Revenue","Avg Order"].map(h => (
                  <th key={h} className={`py-2.5 px-3 font-semibold text-slate-500 uppercase tracking-wide ${h === "Product" ? "text-left" : "text-right"}`}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {products.map((p, i) => (
                  <tr key={p.product} className={`border-b border-slate-100 hover:bg-slate-50 cursor-pointer ${i % 2 ? "bg-slate-50/40" : ""}`}
                    onClick={() => setDrillProduct(p)}>
                    <td className="py-2.5 px-3 font-medium text-slate-700 flex items-center gap-1">
                      {String(p.product).slice(0, 60)}{p.product?.length > 60 ? "…" : ""}
                      <ChevronRight size={11} className="text-slate-300 shrink-0" />
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{fmtN(p.orders)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-medium">{fmtRs(p.revenue)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{p.orders > 0 ? fmtRsFull(p.revenue / p.orders) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Expand modal */}
      {expandChart === "rev" && (
        <ChartModal title="Daily Revenue — Full Month" onClose={() => setExpandChart(null)}>
          <ResponsiveContainer width="100%" height={420}>
            <BarChart data={daily} margin={{ top: 20, right: 20, bottom: 50, left: -10 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="date" tick={{ ...AXIS_TICK, fontSize: 9 }} angle={-40} textAnchor="end" height={60} />
              <YAxis tick={AXIS_TICK} tickFormatter={fmtRs} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => [fmtRsFull(v), "Revenue"]} />
              <Bar dataKey="revenue" fill={G} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartModal>
      )}

      {/* Product drill-down */}
      <DrillDrawer open={!!drillProduct} onClose={() => setDrillProduct(null)} title={`Product: ${drillProduct?.product ? String(drillProduct.product).slice(0, 40) : ""}`}>
        {drillProduct && (
          <div className="grid grid-cols-2 gap-3">
            <GasKpi label="Orders"      value={fmtN(drillProduct.orders)}   accent={C_BLUE} />
            <GasKpi label="Revenue"     value={fmtRs(drillProduct.revenue)} accent={G} />
            <GasKpi label="Avg Order"   value={drillProduct.orders > 0 ? fmtRsFull(drillProduct.revenue / drillProduct.orders) : "—"} accent={C_PURP} />
            <GasKpi label="Share"       value={k.total_orders > 0 ? `${((drillProduct.orders / k.total_orders) * 100).toFixed(1)}%` : "—"} accent={C_AMB} />
          </div>
        )}
      </DrillDrawer>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── LP (LUCKPAY / LENDING PARTNER) DASHBOARD ─────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
//
// Source: db_masmis.CR_lp_regional (896 rows), CR_lp_non_regional (955), CR_lp_feedback (2,210).
// Coverage: Aug 2026. Data is lead allocations with agent and disposition.

interface LpSummaryRow { campaign: string; leads: number; agents: number; dispositions: number; earliest: string | null; latest: string | null; }
interface LpAgentRow   { agent_name: string; campaign: string; leads: number; dispositions: number; }
interface LpDispRow    { disposition: string; campaign: string; cnt: number; }

export function LpDashboard() {
  const [summary, setSummary]       = useState<LpSummaryRow[]>([]);
  const [agents, setAgents]         = useState<LpAgentRow[]>([]);
  const [dispositions, setDispos]   = useState<LpDispRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [drillAgent, setDrillAgent] = useState<LpAgentRow | null>(null);

  useEffect(() => {
    setLoading(true);
    void hrmsApi.get<{ data: { summary: LpSummaryRow[]; agents: LpAgentRow[]; dispositions: LpDispRow[] }; _unavailable?: boolean }>(
      "/api/sales-upload/lp-dashboard"
    )
      .then(r => {
        if ((r as any)._unavailable) return;
        setSummary(r.data?.summary ?? []);
        setAgents(r.data?.agents ?? []);
        setDispos(r.data?.dispositions ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;
  if (!summary.length && !agents.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <BarChart2 size={36} className="text-slate-300" />
        <p className="text-sm text-slate-500">No LP data yet. Upload LP leads via the Upload Data tab.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Summary by campaign type */}
      {summary.length > 0 && (
        <>
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Campaign Summary</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {summary.map(s => (
              <div key={s.campaign} className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{s.campaign}</span>
                  <span className="text-[10px] font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{s.leads} leads</span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div><p className="text-lg font-bold text-slate-800">{fmtN(s.leads)}</p><p className="text-xs text-slate-500">Leads</p></div>
                  <div><p className="text-lg font-bold text-slate-800">{fmtN(s.agents)}</p><p className="text-xs text-slate-500">Agents</p></div>
                  <div><p className="text-lg font-bold text-slate-800">{fmtN(s.dispositions)}</p><p className="text-xs text-slate-500">Dispositions</p></div>
                </div>
                {s.earliest && <p className="mt-3 text-[10px] text-slate-400">Coverage: {String(s.earliest).slice(0, 10)} → {String(s.latest ?? "").slice(0, 10)}</p>}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Agent table */}
      {agents.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
          <div className="px-5 py-3" style={{ background: NAVY }}>
            <h3 className="text-xs font-semibold uppercase tracking-widest text-white">{agents.length} Agents</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="bg-slate-50">
                {["Agent","Campaign","Leads Allocated","Dispositions"].map(h => (
                  <th key={h} className={`py-2.5 px-3 font-semibold text-slate-500 uppercase tracking-wide ${h === "Agent" ? "text-left" : "text-right"}`}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {agents.map((a, i) => (
                  <tr key={`${a.agent_name}-${a.campaign}`}
                    className={`border-b border-slate-100 hover:bg-slate-50 cursor-pointer ${i % 2 ? "bg-slate-50/40" : ""}`}
                    onClick={() => setDrillAgent(a)}>
                    <td className="py-2.5 px-3 font-medium text-slate-700 whitespace-nowrap flex items-center gap-1">
                      {a.agent_name}<ChevronRight size={11} className="text-slate-300" />
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-purple-100 text-purple-700">{a.campaign}</span>
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-semibold">{fmtN(a.leads)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{fmtN(a.dispositions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Disposition breakdown */}
      {dispositions.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
          <div className="px-5 py-3" style={{ background: "#4E342E" }}>
            <h3 className="text-xs font-semibold uppercase tracking-widest text-white">Disposition Breakdown</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="bg-slate-50">
                {["Disposition","Campaign","Count"].map(h => (
                  <th key={h} className={`py-2.5 px-3 font-semibold text-slate-500 uppercase tracking-wide ${h === "Count" ? "text-right" : "text-left"}`}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {dispositions.map((d, i) => (
                  <tr key={`${d.disposition}-${d.campaign}`} className={`border-b border-slate-100 ${i % 2 ? "bg-slate-50/40" : ""}`}>
                    <td className="py-2.5 px-3 font-mono text-slate-700">{d.disposition}</td>
                    <td className="py-2.5 px-3 text-slate-500">{d.campaign}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{fmtN(d.cnt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <DrillDrawer open={!!drillAgent} onClose={() => setDrillAgent(null)} title={`Agent: ${drillAgent?.agent_name ?? ""}`}>
        {drillAgent && (
          <div className="grid grid-cols-2 gap-3">
            <GasKpi label="Campaign"       value={drillAgent.campaign}       accent={C_PURP} />
            <GasKpi label="Leads"          value={fmtN(drillAgent.leads)}    accent={C_BLUE} />
            <GasKpi label="Dispositions"   value={fmtN(drillAgent.dispositions)} accent={C_AMB} />
            <GasKpi label="Leads/Disp."    value={drillAgent.dispositions > 0 ? (drillAgent.leads / drillAgent.dispositions).toFixed(1) : "—"} accent={G} />
          </div>
        )}
      </DrillDrawer>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── PROCESS DATA PANEL (Clovia / DU Digital / Dalmia) ────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
//
// These processes upload data via BulkUploadHub into mas_hrms — their raw data
// isn't in db_masmis so no transaction-level sales dashboard is available.
// Shows upload status, recent batches, and links to ProcessOperations for KPIs.

export function ProcessDataPanel({ process: processName, uploadTypes, color }: {
  process: string; uploadTypes: string[]; color: string;
}) {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void hrmsApi.get<{ data: any[] }>(`/api/sales-upload/logs?limit=50`)
      .then(r => {
        const all = r.data ?? [];
        const filtered = all.filter((l: any) => {
          const t = String(l.upload_type ?? "").toUpperCase();
          return uploadTypes.some(u => t.includes(u.replace(/_MASMIS|_BATCH/g, "").slice(0, 10)));
        });
        setLogs(filtered);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [processName]);

  return (
    <div className="space-y-5">
      {/* Info banner */}
      <div className="rounded-2xl p-5 text-white" style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)` }}>
        <h2 className="text-lg font-bold">{processName}</h2>
        <p className="text-sm opacity-80 mt-1">
          Data for this process is uploaded via BulkUploadHub and consumed by Process Operations.
          Transaction-level sales dashboard is not applicable for this process type.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {uploadTypes.map(t => (
            <span key={t} className="text-[10px] font-semibold bg-white/20 px-2 py-1 rounded">{t}</span>
          ))}
        </div>
      </div>

      {/* Link to Process Operations */}
      <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-blue-800">View KPIs in Process Operations</p>
          <p className="text-xs text-blue-600 mt-0.5">All KPI metrics, quality scores, and workforce data are visible there.</p>
        </div>
        <a href="/process-operations" className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition whitespace-nowrap">
          Open <ChevronRight size={14} />
        </a>
      </div>

      {/* Upload history */}
      <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden shadow-sm">
        <div className="px-5 py-3" style={{ background: NAVY }}>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-white">
            Recent Uploads — {processName}
            <span className="ml-2 text-indigo-200 font-normal normal-case">via BulkUploadHub</span>
          </h3>
        </div>
        {loading ? <Spinner /> : logs.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No upload batches found for {processName}. Upload data via <a href="/admin/bulk-upload" className="text-blue-600 underline">BulkUploadHub</a>.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="bg-slate-50">
                {["Type","Month","Rows","By","Date"].map(h => (
                  <th key={h} className={`py-2.5 px-3 font-semibold text-slate-500 uppercase tracking-wide ${h === "Rows" ? "text-right" : "text-left"}`}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {logs.map((l, i) => (
                  <tr key={i} className={`border-b border-slate-100 ${i % 2 ? "bg-slate-50/40" : ""}`}>
                    <td className="py-2 px-3 font-medium text-slate-700">{l.upload_type}</td>
                    <td className="py-2 px-3 text-slate-600">{l.month_label || "—"}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{fmtN(l.row_count)}</td>
                    <td className="py-2 px-3 text-slate-500">{l.uploaded_by}</td>
                    <td className="py-2 px-3 text-slate-400">{new Date(l.created_at).toLocaleDateString("en-IN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

type UploadType =
  | "bellavita-sales" | "bellavita-apr" | "bellavita-chat" | "bellavita-cart"
  | "gnc-sales" | "gnc-apr" | "gnc-allocation"
  | "aw-out" | "aw-billing" | "aw-mandate" | "aw-inbound" | "aw-new-cdr";

// logTable: the upload_log.table_name the backend files this upload under
// (logUpload in sales-upload.service.ts) — what Recent Uploads rows carry.
const UPLOAD_OPTIONS: { type: UploadType; label: string; brand: string; desc: string; endpoint: string; logTable: string }[] = [
  { type: "bellavita-sales", label: "Bellavita Sales",     brand: "Bellavita", desc: "Monthly sales (.xlsx)",           endpoint: "/api/sales-upload/upload/bellavita-sales", logTable: "bb_sale" },
  { type: "bellavita-apr",   label: "Bellavita APR",       brand: "Bellavita", desc: "Activity performance (.xlsx)",    endpoint: "/api/sales-upload/upload/bellavita-apr", logTable: "bb_apr" },
  { type: "bellavita-chat",  label: "Bellavita Chat",      brand: "Bellavita", desc: "Chat interactions (.xlsx)",       endpoint: "/api/sales-upload/upload/bellavita-chat", logTable: "bb_chat" },
  { type: "bellavita-cart",  label: "Bellavita Cart",      brand: "Bellavita", desc: "Cart abandonment (.xlsx)",        endpoint: "/api/sales-upload/upload/bellavita-cart", logTable: "bb_cart" },
  { type: "gnc-sales",       label: "GNC Sales",           brand: "GNC",       desc: "Monthly sales (.xlsx)",           endpoint: "/api/sales-upload/upload/gnc-sales", logTable: "gnc_sale" },
  { type: "gnc-apr",         label: "GNC APR",             brand: "GNC",       desc: "Activity performance (.xlsx)",    endpoint: "/api/sales-upload/upload/gnc-apr", logTable: "gnc_apr" },
  { type: "gnc-allocation",  label: "GNC Allocation",      brand: "GNC",       desc: "Agent allocation (.xlsx)",        endpoint: "/api/sales-upload/upload/gnc-allocation", logTable: "gnc_allocation" },
  { type: "aw-out",          label: "AW Out (APR)",        brand: "AW",        desc: "Outbound daily APR report (.xlsx)", endpoint: "/api/sales-upload/upload-aw/aw-out", logTable: "aw_out" },
  { type: "aw-billing",      label: "AW Billing",          brand: "AW",        desc: "Billing/activity report (.xlsx)",  endpoint: "/api/sales-upload/upload-aw/aw-billing", logTable: "aw_billing" },
  { type: "aw-mandate",      label: "AW Mandate",          brand: "AW",        desc: "Headcount mandate (.xlsx)",        endpoint: "/api/sales-upload/upload-aw/aw-mandate", logTable: "aw_mandate" },
  { type: "aw-inbound",      label: "AW Inbound CDR",      brand: "AW",        desc: "Inbound call records (.xlsx)",     endpoint: "/api/sales-upload/upload-aw/aw-inbound", logTable: "aw_inbound" },
  { type: "aw-new-cdr",      label: "AW New CDR",          brand: "AW",        desc: "Outbound call records (.xlsx)",    endpoint: "/api/sales-upload/upload-aw/aw-new-cdr", logTable: "aw_new_cdr" },
];

interface UploadLog { id: number; batch_id: string; upload_type: string; month_label: string; row_count: number; uploaded_by: string; created_at: string; }

/**
 * `brand` narrows the panel to one brand's uploads and upload history — how
 * Process Operations' Sales view shows it for the selected process. Without it,
 * every brand (the Brand Sales Analytics "Upload Data" tab).
 */
export function UploadPanel({ brand }: { brand?: string } = {}) {
  const options = useMemo(() => (brand ? UPLOAD_OPTIONS.filter(o => o.brand === brand) : UPLOAD_OPTIONS), [brand]);
  const [selectedType, setSelectedType] = useState<UploadType>(options[0]?.type ?? "bellavita-sales");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [logs, setLogs] = useState<UploadLog[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [openBatch, setOpenBatch] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // DELETE /batch/:id's roles. Offered only for this panel's own upload types:
  // upload_log also lists other modules' uploads (Housing, Clovia, LP…), whose
  // tables deleteUploadBatch does not clear — deleting one would drop the log
  // entry and leave its data behind.
  const { hasAnyRole } = useWorkforceAccess();
  const canDelete = hasAnyRole("super_admin", "admin", "operations_manager");
  const ownTables = useMemo(() => new Set(UPLOAD_OPTIONS.map(o => o.logTable)), []);

  const loadLogs = useCallback(async () => {
    try {
      const r = await hrmsApi.get<{ data: UploadLog[] }>("/api/sales-upload/logs?limit=30");
      // upload_type is the logged table name (bb_sale, aw_out…), not the option's type.
      const tables = new Set<string>(options.map(o => o.logTable));
      setLogs((r.data ?? []).filter(l => !brand || tables.has(l.upload_type)));
    } catch { }
  }, [brand, options]);

  useEffect(() => { void loadLogs(); }, [loadLogs]);

  async function handleUpload() {
    if (!file) return;
    setUploading(true); setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const endpoint = UPLOAD_OPTIONS.find(o => o.type === selectedType)?.endpoint ?? `/api/sales-upload/upload/${selectedType}`;
      const r = await hrmsApi.postForm<{ rowsInserted?: number; message?: string }>(endpoint, fd);
      setResult({ ok: true, message: `Uploaded ${(r as any).rowsInserted ?? "?"} rows successfully.` });
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      void loadLogs();
    } catch (err: any) {
      setResult({ ok: false, message: err?.response?.data?.error ?? err?.message ?? "Upload failed" });
    } finally { setUploading(false); }
  }

  async function handleDelete(batchId: string) {
    if (!confirm("Delete this upload batch? This cannot be undone.")) return;
    setDeleting(batchId);
    try {
      await hrmsApi.delete(`/api/sales-upload/batch/${batchId}`);
      void loadLogs();
    } catch (err: any) {
      setResult({ ok: false, message: err?.response?.data?.error ?? err?.message ?? "Delete failed" });
    } finally { setDeleting(null); }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <p className="mb-4 text-sm font-semibold text-slate-700 flex items-center gap-2">
          <Upload size={14} className="text-blue-500" /> Upload {brand ?? "Bellavita / GNC / AW"} Data
        </p>
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Data Type</label>
            <select value={selectedType} onChange={e => setSelectedType(e.target.value as UploadType)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
              {options.map(o => <option key={o.type} value={o.type}>{o.label} ({o.brand}) — {o.desc}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Excel File (.xlsx)</label>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={e => setFile(e.target.files?.[0] ?? null)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-blue-700" />
          </div>
          {result && (
            <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${result.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
              {result.ok ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
              {result.message}
            </div>
          )}
          <button onClick={handleUpload} disabled={!file || uploading}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            {uploading ? <><Loader2 size={14} className="animate-spin" /> Uploading…</> : <><Upload size={14} /> Upload</>}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-700">Recent Uploads</p>
          <button onClick={loadLogs} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600">
            <RefreshCcw size={12} /> Refresh
          </button>
        </div>
        {logs.length === 0
          ? <p className="py-4 text-center text-sm text-slate-400">No uploads yet.</p>
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-slate-400 border-b border-slate-100">
                  {/* "Note" is upload_log.file_name (aliased month_label) — the writer's note, not a month. */}
                  {["Type","Note","Rows","By","Date",""].map(h => <th key={h} className={`py-2 ${h === "Rows" ? "text-right" : "text-left"}`}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {logs.map(log => (
                    <tr key={log.id} onClick={() => setOpenBatch(log.batch_id)}
                      className="cursor-pointer border-b border-slate-50 hover:bg-slate-50" title="Open this upload">
                      <td className="py-1.5 font-medium text-slate-700">{uploadLabel(log.upload_type)}</td>
                      <td className="py-1.5 text-slate-600">{log.month_label}</td>
                      <td className="py-1.5 text-right text-slate-600 tabular-nums">{log.row_count.toLocaleString()}</td>
                      <td className="py-1.5 text-slate-500">{log.uploaded_by ?? uploaderFromLabel(log.month_label)}</td>
                      <td className="py-1.5 text-slate-400">{fmtDateTimeIN(log.created_at)}</td>
                      <td className="py-1.5 text-right">
                        {canDelete && ownTables.has(log.upload_type) && (
                          <button onClick={e => { e.stopPropagation(); void handleDelete(log.batch_id); }} disabled={deleting === log.batch_id}
                            className="rounded p-1 text-red-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                            aria-label="Delete this upload batch">
                            <Trash2 size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>

      <DrillDrawer open={openBatch !== null} onClose={() => setOpenBatch(null)}
        title={openBatch ? `Upload batch ${openBatch.slice(0, 8)}` : "Upload batch"}>
        {openBatch && <UploadBatchDetail batchId={openBatch} />}
      </DrillDrawer>
    </div>
  );
}

const uploadLabel = (table: string) => UPLOAD_OPTIONS.find(o => o.logTable === table)?.label ?? table;
/**
 * Upload writers file the uploader inside file_name ("sales-upload by x@y",
 * "HRMS2 upload by <user id>") and leave uploaded_by NULL.
 */
const uploaderFromLabel = (label: string | null | undefined) =>
  (label ?? "").replace(/^(sales-upload|hrms2 upload) by\s+/i, "") || "—";
/** DD/MM/YYYY HH:mm in IST. */
function fmtDateTimeIN(v: unknown): string {
  if (v == null || v === "") return "—";
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

interface UploadBatch {
  log: Record<string, unknown>;
  table: string;
  rowsInTable: number | null;
  sample: Record<string, unknown>[];
}

/** Drill-down for one Recent Uploads row: the log entry, rows still held, and a sample. */
function UploadBatchDetail({ batchId }: { batchId: string }) {
  const [data, setData] = useState<UploadBatch | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setData(null); setError(null);
    hrmsApi.get<{ data: UploadBatch }>(`/api/sales-upload/batch/${encodeURIComponent(batchId)}`)
      .then(r => { if (live) setData(r.data); })
      .catch((err: any) => { if (live) setError(err?.response?.data?.error ?? err?.message ?? "Could not load this upload"); });
    return () => { live = false; };
  }, [batchId]);

  const Section = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <section className="space-y-2">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p>
      {children}
    </section>
  );
  const None = () => <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">None</p>;

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading upload…</p>;

  const logged = Number(data.log.row_count ?? 0);
  const fields: [string, string][] = [
    ["Batch ID", String(data.log.batch_id ?? batchId)],
    ["Upload type", uploadLabel(data.table)],
    ["Table", `db_masmis.${data.table}`],
    ["Rows uploaded", logged.toLocaleString("en-IN")],
    ["Uploaded by", String(data.log.uploaded_by ?? uploaderFromLabel(String(data.log.file_name ?? "")))],
    ["Uploaded at", fmtDateTimeIN(data.log.uploaded_at)],
  ];
  const cols = data.sample[0]
    ? Object.keys(data.sample[0]).filter(k => k !== "upload_batch_id").map(k => ({ key: k, label: k }))
    : [];

  return (
    <div className="space-y-6">
      <Section label="Upload">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {fields.map(([k, v]) => (
            <div key={k}><dt className="text-xs text-slate-400">{k}</dt><dd className="font-semibold text-slate-800 break-all">{v}</dd></div>
          ))}
        </dl>
      </Section>

      <Section label="Rows held now">
        {data.rowsInTable === null ? <None /> : (
          <p className={`rounded-lg px-3 py-2 text-sm ${data.rowsInTable === logged ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
            {data.rowsInTable.toLocaleString("en-IN")} row{data.rowsInTable === 1 ? "" : "s"} in db_masmis.{data.table}
            {data.rowsInTable === logged ? " — matches the upload." : ` — the upload logged ${logged.toLocaleString("en-IN")}.`}
          </p>
        )}
      </Section>

      <Section label={`Sample rows${data.sample.length ? ` (first ${data.sample.length})` : ""}`}>
        {data.sample.length === 0 ? <None /> : <MiniTable cols={cols} rows={data.sample} />}
      </Section>

      <Section label="Audit trail">
        {/* upload_log is the only record of an upload; there is no separate audit table. */}
        <None />
      </Section>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── MAIN PAGE ─────────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

type SalesProcess = "bellavita" | "gnc" | "neemans" | "aw" | "bvo" | "lp" | "clovia" | "du" | "dalmia" | "upload";

export default function NativeSalesDashboard() {
  const { hasAnyRole } = useWorkforceAccess();
  const canAccess = hasAnyRole("super_admin", "admin", "ceo", "manager", "process_manager", "operations_manager", "quality_analyst", "qa");
  const canUpload = hasAnyRole("super_admin", "admin", "process_manager", "operations_manager");

  const [process, setProcess] = useState<SalesProcess>("bellavita");
  const [month, setMonth] = useState(currentMonth());

  if (!canAccess) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-24">
          <div className="rounded-2xl border border-red-100 bg-red-50 px-8 py-6 text-center">
            <p className="font-semibold text-red-700">Access Restricted</p>
            <p className="mt-1 text-sm text-red-500">You don't have permission to view Sales analytics.</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const PROCESSES: { id: SalesProcess; label: string; color: string; emoji: string }[] = [
    { id: "bellavita", label: "Bellavita",  color: "#D4AF37", emoji: "🌸" },
    { id: "gnc",       label: "GNC",        color: "#CE112D", emoji: "🛒" },
    { id: "neemans",   label: "Neemans",    color: "#6B8E4E", emoji: "👟" },
    { id: "aw",      label: "AW",          color: "#0EA5E9", emoji: "₹" },
    { id: "bvo",     label: "BVO / Repeat", color: "#DB2777", emoji: "🔁" },
    { id: "lp",      label: "LP",          color: "#7C3AED", emoji: "📋" },
    { id: "clovia",  label: "Clovia",      color: "#E40B92", emoji: "👗" },
    { id: "du",      label: "DU Digital",  color: "#003D6B", emoji: "📱" },
    { id: "dalmia",  label: "Dalmia",      color: "#B45309", emoji: "🏗" },
    ...(canUpload ? [{ id: "upload" as const, label: "Upload Data", color: "#6366F1", emoji: "⬆" }] : []),
  ];

  return (
    <DashboardLayout>
      <div className="space-y-5 p-4 md:p-6">

        {/* Page header */}
        <div
          className="relative overflow-hidden rounded-2xl px-6 py-5"
          style={{ background: `radial-gradient(circle at 88% 12%,rgba(79,209,255,.18),transparent 24%),linear-gradient(118deg,${NAVY} 0%,#124d82 48%,#0f7890 100%)` }}
        >
          <div className="pointer-events-none absolute -right-10 -top-16 h-56 w-56 rounded-full opacity-20 blur-3xl" style={{ background: "#A78BFA" }} />
          <div className="relative flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-lg font-bold text-white flex items-center gap-2">
                <TrendingUp size={18} className="opacity-80" /> Brand Sales Analytics
              </h1>
              <p className="text-xs text-white/50 mt-0.5">Bellavita · GNC · Neemans — upload, analyse, drill down</p>
            </div>
            <div className="flex items-center gap-2">
              <Calendar size={14} className="text-white/50" />
              <input type="month" value={month} onChange={e => setMonth(e.target.value)}
                className="rounded-lg border border-white/20 bg-white/15 px-3 py-1.5 text-sm text-white backdrop-blur-sm outline-none [color-scheme:dark]" />
            </div>
          </div>
        </div>

        {/* Process picker */}
        <div className="flex flex-wrap gap-2">
          {PROCESSES.map(p => (
            <button key={p.id} onClick={() => setProcess(p.id)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all border"
              style={process === p.id
                ? { background: p.color, color: "#fff", borderColor: p.color, boxShadow: `0 4px 12px ${p.color}40` }
                : { background: "#fff", color: "#334155", borderColor: "#E2E8F0" }}>
              <span>{p.emoji}</span> {p.label}
            </button>
          ))}
        </div>

        {/* Dashboard content */}
        {process === "bellavita" && <BellavitaDashboard month={month} />}
        {process === "gnc"       && <GncDashboard month={month} />}
        {process === "neemans"   && <NeemansDashboard month={month} />}
        {process === "aw"        && <AwDashboard month={month} />}
        {process === "bvo"       && <BvoDashboard month={month} />}
        {process === "lp"        && <LpDashboard />}
        {process === "clovia"    && <ProcessDataPanel process="Clovia" uploadTypes={["CLOVIA_EMAIL_DAILY","CLOVIA_CHAT_DAILY","CLOVIA_CRM_DISPOSITION","CLOVIA_QUALITY_AUDIT","CLOVIA_RECHURN_CALLS","CLOVIA_TEAM_ALIGNMENT"]} color="#E40B92" />}
        {process === "du"        && <ProcessDataPanel process="DU Digital" uploadTypes={["DU_APR_KOREA","DU_APR_THAILAND","DU_TEAM_MAPPING_KOREA","DU_TEAM_MAPPING_THAILAND"]} color="#003D6B" />}
        {process === "dalmia"    && <DalmiaDashboard />}
        {process === "upload"    && <UploadPanel />}
      </div>
    </DashboardLayout>
  );
}

// ── Dalmia Cement Dashboard ───────────────────────────────────────────────────

interface DalmiaFiltersI { from: string; to: string }

async function fetchDalmia<T>(path: string, f: DalmiaFiltersI): Promise<T> {
  const token = localStorage.getItem("authToken") || sessionStorage.getItem("authToken") || "";
  const qs = new URLSearchParams({ from: f.from, to: f.to }).toString();
  const r = await fetch(`/api/process-live/dalmia/${path}?${qs}`, {
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" }
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json() as { ok: boolean; data: T };
  if (!d.ok) throw new Error("API error");
  return d.data;
}

function DalmiaKpiCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #dce4ed", borderRadius: 14, padding: "14px 16px", borderTop: `3px solid ${color}` }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#697586", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 900, color: "#172235", marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#697586", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function DalmiaBarChart({ data, color }: { data: { name: string; value: number }[]; color: string }) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {data.map(d => (
        <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 120, fontSize: 11, fontWeight: 600, color: "#475569", textAlign: "right", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.name}>{d.name}</div>
          <div style={{ flex: 1, background: "#f1f5f9", borderRadius: 4, height: 18, position: "relative" }}>
            <div style={{ width: `${Math.round((d.value / max) * 100)}%`, background: color, borderRadius: 4, height: "100%", transition: "width 0.4s ease" }} />
          </div>
          <div style={{ width: 40, fontSize: 11, fontWeight: 800, color: "#172235", textAlign: "right" }}>{d.value}</div>
        </div>
      ))}
    </div>
  );
}

export function DalmiaDashboard() {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = new Date(); monthStart.setDate(1);
  const [filters, setFilters] = useState<DalmiaFiltersI>({ from: monthStart.toISOString().slice(0, 10), to: today });
  const [overview, setOverview] = useState<Record<string, unknown> | null>(null);
  const [scenarios, setScenarios] = useState<{ name: string; value: number }[]>([]);
  const [leadSources, setLeadSources] = useState<{ name: string; value: number }[]>([]);
  const [regions, setRegions] = useState<Array<{ region: string; total: number; converted: number }>>([]);
  const [afterHour, setAfterHour] = useState<{ date: string; calls: number }[]>([]);
  const [outboundStatus, setOutboundStatus] = useState<{ name: string; value: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setError(null);
    Promise.all([
      fetchDalmia<Record<string, unknown>>('overview', filters),
      fetchDalmia<{ name: string; value: number }[]>('scenarios', filters),
      fetchDalmia<{ name: string; value: number }[]>('lead-sources', filters),
      fetchDalmia<Array<{ region: string; total: number; converted: number }>>('regions', filters),
      fetchDalmia<{ date: string; calls: number }[]>('after-hour-daily', filters),
      fetchDalmia<{ name: string; value: number }[]>('outbound-status', filters),
    ]).then(([ov, sc, ls, rg, ah, os]) => {
      setOverview(ov); setScenarios(sc); setLeadSources(ls);
      setRegions(rg); setAfterHour(ah); setOutboundStatus(os);
    }).catch(e => setError(e instanceof Error ? e.message : 'Failed to load')).finally(() => setLoading(false));
  }, [filters]);

  const panelStyle = { background: "#fff", border: "1px solid #dce4ed", borderRadius: 14, padding: "16px 18px" };

  const dd = overview?.dd as { total: number; ftr: number; closed: number; converted: number; days: number; ftrPct: number; conversionPct: number } | undefined;
  const outboundOv = overview?.outbound as { total: number; contacted: number; contactPct: number } | undefined;
  const afterHourOv = overview?.afterHour as { total: number } | undefined;

  return (
    <div style={{ fontFamily: "Inter, sans-serif" }}>
      {/* Date range filter */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, background: "#f8fafd", border: "1px solid #dce4ed", borderRadius: 10, padding: "8px 12px" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#697586", textTransform: "uppercase" }}>Period</span>
        <input type="date" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))}
          style={{ border: "1px solid #dce4ed", borderRadius: 8, padding: "4px 8px", fontSize: 12, fontWeight: 700 }} />
        <span style={{ color: "#697586" }}>–</span>
        <input type="date" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))}
          style={{ border: "1px solid #dce4ed", borderRadius: 8, padding: "4px 8px", fontSize: 12, fontWeight: 700 }} />
      </div>

      {loading && <div style={{ padding: 40, textAlign: "center", color: "#697586" }}>Loading Dalmia dashboard…</div>}
      {error && <div style={{ padding: 20, color: "#dc2626", background: "#fff0f0", borderRadius: 10 }}>Error: {error}</div>}

      {!loading && !error && overview && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* KPI strip */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
            <DalmiaKpiCard label="DD Calls" value={dd?.total ?? 0} sub={`${dd?.days ?? 0} active days`} color="#B45309" />
            <DalmiaKpiCard label="FTR%" value={`${dd?.ftrPct ?? 0}%`} sub={`${dd?.ftr ?? 0} first-time resolutions`} color="#16a34a" />
            <DalmiaKpiCard label="Converted" value={dd?.converted ?? 0} sub={`${dd?.conversionPct ?? 0}% of calls`} color="#2563eb" />
            <DalmiaKpiCard label="Closed" value={dd?.closed ?? 0} sub="Status = Closed" color="#7c3aed" />
            <DalmiaKpiCard label="After-Hour" value={afterHourOv?.total ?? 0} sub="Calls after working hours" color="#dc2626" />
            <DalmiaKpiCard label="Outbound" value={outboundOv?.total ?? 0} sub={`${outboundOv?.contactPct ?? 0}% contacted`} color="#0891b2" />
          </div>

          {/* Charts row 1 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div style={panelStyle}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#172235", marginBottom: 12 }}>Call Scenarios</div>
              {scenarios.length === 0 ? <p style={{ color: "#697586", fontSize: 12 }}>No data</p> : <DalmiaBarChart data={scenarios} color="#B45309" />}
            </div>
            <div style={panelStyle}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#172235", marginBottom: 12 }}>Lead Sources</div>
              {leadSources.length === 0 ? <p style={{ color: "#697586", fontSize: 12 }}>No data</p> : <DalmiaBarChart data={leadSources} color="#2563eb" />}
            </div>
          </div>

          {/* After-hour daily trend */}
          {afterHour.length > 0 && (
            <div style={panelStyle}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#172235", marginBottom: 12 }}>After-Hour Calls — Daily</div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 80 }}>
                {afterHour.map(d => {
                  const maxV = Math.max(...afterHour.map(x => x.calls), 1);
                  const h = Math.round((d.calls / maxV) * 72);
                  return (
                    <div key={d.date} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }} title={`${d.date}: ${d.calls} calls`}>
                      <div style={{ width: "100%", height: h, background: "#dc2626", borderRadius: "3px 3px 0 0", minHeight: d.calls > 0 ? 4 : 0 }} />
                      <div style={{ fontSize: 8, color: "#697586", transform: "rotate(-45deg)", whiteSpace: "nowrap" }}>{d.date.slice(5)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Region breakdown table */}
          {regions.length > 0 && (
            <div style={panelStyle}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#172235", marginBottom: 12 }}>Region Breakdown</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#f8fafd" }}>
                    {["Region", "Total Calls", "Converted", "Conversion%"].map(h => (
                      <th key={h} style={{ padding: "6px 10px", textAlign: "left", fontWeight: 700, color: "#697586", fontSize: 10, textTransform: "uppercase" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {regions.map(r => (
                    <tr key={r.region} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "6px 10px", fontWeight: 600, color: "#172235" }}>{r.region}</td>
                      <td style={{ padding: "6px 10px", color: "#475569" }}>{r.total}</td>
                      <td style={{ padding: "6px 10px", color: "#475569" }}>{r.converted}</td>
                      <td style={{ padding: "6px 10px", fontWeight: 700, color: r.total > 0 && r.converted / r.total > 0.1 ? "#16a34a" : "#697586" }}>
                        {r.total > 0 ? `${Math.round(r.converted / r.total * 100)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Outbound status */}
          {outboundStatus.length > 0 && (
            <div style={panelStyle}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#172235", marginBottom: 12 }}>Outbound Enquiry Status</div>
              <DalmiaBarChart data={outboundStatus} color="#0891b2" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
