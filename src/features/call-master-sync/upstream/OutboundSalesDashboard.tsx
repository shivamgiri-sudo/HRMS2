// @ts-nocheck
// AUTO-SYNCED from tausifansari-mcn/Mydashboards frontend/src/features/call-master/OutboundSalesDashboard.tsx @ 4fbd5df - do not edit; run scripts/sync-mydashboards.mjs
import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ComposedChart, Bar, Line,
  BarChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  PhoneCall, TrendingUp, Award, Clock, Users,
  ChevronLeft, Calendar, RefreshCw, Download, Maximize2, X, Lock,
  ChevronDown, ArrowUpDown, FileDown,
} from 'lucide-react';
import { useAuthStore } from '../shim/authStore';
import api from '../shim/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClientItem { id: number; name: string; dialdesk_client_id: number }

interface OBSummary {
  totalCalls: number; totalSales: number; convPct: number;
  avgTalkSec: number; activeAgents: number;
}
interface TrendRow  { date: string; calls: number; sales: number; conv_pct: number; ob_quality: number }
interface HourRow   { hour: string; calls: number; sales: number }
interface AgentRow  { agent: string; calls: number; sales: number; conv_pct: number; ob_quality: number; avg_talk_sec: number }
interface DispRow   { disposition: string; cnt: number; sales: number }
interface ProdRow   { product: string; calls: number; sales: number }
interface NiRow     { reason: string; cnt: number }
interface QParamRow { parameter: string; key: string; score: number }

// ─── Helpers ─────────────────────────────────────────────────────────────────

const COLOR_GREEN  = '#10B981';
const COLOR_BLUE   = '#3B82F6';
const COLOR_PURPLE = '#8B5CF6';
const COLOR_AMBER  = '#F59E0B';
const COLOR_RED    = '#EF4444';
const COLORS       = [COLOR_BLUE, COLOR_GREEN, COLOR_PURPLE, COLOR_AMBER, COLOR_RED, '#06B6D4', '#EC4899', '#6366F1'];

const TOOLTIP_STYLE = { background: '#FFFFFF', border: '1px solid #334155', borderRadius: 8, fontSize: 12 };
const AXIS_TICK     = { fill: '#64748B', fontSize: 11 };
const GRID          = { strokeDasharray: '3 3', stroke: '#FFFFFF' };

function toLocalDT(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtDate(d: unknown) {
  const s = String(d);
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
}

function fmtSec(sec: number) {
  if (!sec) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function fmt(n: number | string, dec = 1) {
  const v = Number(n);
  if (v >= 1_000_000) return `${(v/1_000_000).toFixed(dec)}M`;
  if (v >= 1_000)     return `${(v/1_000).toFixed(dec)}K`;
  return v.toLocaleString();
}

function pctColor(v: number | string) {
  const n = Number(v);
  if (n >= 80) return COLOR_GREEN;
  if (n >= 60) return COLOR_AMBER;
  return COLOR_RED;
}

function downloadCSV(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${filename}.csv` });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── AnimatedNumber ───────────────────────────────────────────────────────────

function AnimatedNumber({ value, dec = 0, suffix = '' }: { value: number; dec?: number; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const end = value, duration = 1200, startTime = performance.now();
    const step = (now: number) => {
      const p = Math.min((now - startTime) / duration, 1);
      const e = 1 - Math.pow(1 - p, 3);
      setDisplay(e * end);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [value]);
  return <span>{dec > 0 ? display.toFixed(dec) : Math.round(display).toLocaleString()}{suffix}</span>;
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KPICard({ label, value, suffix = '', dec = 0, icon, color, sub, index, onClick }: {
  label: string; value: number; suffix?: string; dec?: number;
  icon: React.ReactNode; color: string; sub?: string; index: number;
  onClick?: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.4 }}
      onClick={onClick}
      className={`relative bg-white shadow-sm rounded-xl p-4 flex flex-col gap-2 border border-slate-200 overflow-hidden transition-all duration-200 ${onClick ? 'cursor-pointer hover:border-slate-300 hover:shadow-lg' : ''}`}
    >
      <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl" style={{ backgroundColor: color }} />
      <div className="pl-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider leading-none">{label}</span>
          <div className="p-1.5 rounded-lg" style={{ backgroundColor: `${color}18` }}>
            <div style={{ color }}>{icon}</div>
          </div>
        </div>
        <div className="text-xl font-bold text-slate-900 tracking-tight whitespace-nowrap">
          <AnimatedNumber value={value} suffix={suffix} dec={dec} />
        </div>
        {sub && <div className="text-[11px] text-slate-500 mt-1">{sub}</div>}
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-px" style={{ background: `linear-gradient(90deg, ${color}40, transparent)` }} />
    </motion.div>
  );
}

// ─── Section Card ─────────────────────────────────────────────────────────────

function SectionCard({ title, children, className = '', accent = COLOR_BLUE, downloadData }: {
  title: string; children: React.ReactNode; className?: string;
  accent?: string;
  downloadData?: { filename: string; rows: Record<string, unknown>[] };
}) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [expanded]);

  const header = (onClose?: () => void) => (
    <div className="flex items-center gap-2.5 px-5 py-3 border-b border-slate-200">
      <div className="w-1.5 h-4 rounded-full shrink-0" style={{ backgroundColor: accent }} />
      <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-widest flex-1">{title}</h3>
      {downloadData && downloadData.rows.length > 0 && (
        <button onClick={(e) => { e.stopPropagation(); downloadCSV(downloadData.filename, downloadData.rows); }}
          title="Download CSV" className="text-slate-600 hover:text-slate-600 transition-colors p-0.5 rounded">
          <Download size={13} />
        </button>
      )}
      {!onClose ? (
        <button onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
          title="Expand" className="text-slate-600 hover:text-slate-600 transition-colors p-0.5 rounded">
          <Maximize2 size={13} />
        </button>
      ) : (
        <button onClick={onClose} className="text-slate-500 hover:text-slate-900 transition-colors p-0.5 rounded ml-1">
          <X size={15} />
        </button>
      )}
    </div>
  );

  return (
    <>
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className={`bg-white rounded-xl border border-slate-200 overflow-hidden ${className}`}>
        {header()}
        <div className="p-5">{children}</div>
      </motion.div>

      {expanded && createPortal(
        <div className="fixed inset-0 flex items-center justify-center p-4 sm:p-6 bg-slate-100 backdrop-blur-sm"
          style={{ zIndex: 9999 }} onClick={() => setExpanded(false)}>
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-6xl flex flex-col overflow-hidden"
            style={{ maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
            {header(() => setExpanded(false))}
            <div className="p-6 overflow-auto flex-1">{children}</div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// ─── Horizontal Bar chart for lists ──────────────────────────────────────────

function HorizBars({ data, labelKey, valueKey, colorFn }: {
  data: Record<string, unknown>[];
  labelKey: string; valueKey: string;
  colorFn?: (v: number) => string;
}) {
  const max = Math.max(...data.map(r => Number(r[valueKey]) || 0), 1);
  return (
    <div className="space-y-2">
      {data.map((r, i) => {
        const v = Number(r[valueKey]) || 0;
        const pct = (v / max) * 100;
        const color = colorFn ? colorFn(v) : COLORS[i % COLORS.length];
        return (
          <div key={String(r[labelKey])} className="flex items-center gap-2">
            <span className="text-xs text-slate-500 w-36 shrink-0 truncate" title={String(r[labelKey])}>
              {String(r[labelKey])}
            </span>
            <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
              <div className="h-5 rounded-full flex items-center justify-end pr-2 transition-all"
                style={{ width: `${pct}%`, minWidth: 4, backgroundColor: color }}>
                {pct > 15 && <span className="text-[10px] text-slate-900 font-bold">{fmt(v, 0)}</span>}
              </div>
            </div>
            {pct <= 15 && <span className="text-[10px] text-slate-500 w-10 text-right shrink-0">{fmt(v, 0)}</span>}
          </div>
        );
      })}
    </div>
  );
}

// ─── Quality Param Bars ───────────────────────────────────────────────────────

function QualityBars({ rows }: { rows: QParamRow[] }) {
  const sorted = [...rows].sort((a, b) => b.score - a.score);
  return (
    <div className="space-y-2">
      {sorted.map(p => (
        <div key={p.key} className="flex items-center gap-2">
          <span className="text-xs text-slate-500 w-40 shrink-0 truncate" title={p.parameter}>{p.parameter}</span>
          <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
            <motion.div className="h-5 rounded-full flex items-center justify-end pr-2"
              style={{ backgroundColor: pctColor(p.score), minWidth: 4 }}
              initial={{ width: 0 }} animate={{ width: `${p.score}%` }} transition={{ duration: 0.7 }}>
              {p.score > 12 && <span className="text-[10px] text-slate-900 font-bold">{Number(p.score).toFixed(0)}%</span>}
            </motion.div>
          </div>
          {p.score <= 12 && (
            <span className="text-[10px] w-8 text-right shrink-0" style={{ color: pctColor(p.score) }}>
              {Number(p.score).toFixed(0)}%
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Agent Table ─────────────────────────────────────────────────────────────

type AgentSortKey = 'calls' | 'sales' | 'conv_pct' | 'ob_quality' | 'avg_talk_sec';

function AgentTable({ rows, onRowClick }: { rows: AgentRow[]; onRowClick?: (a: AgentRow) => void }) {
  const [sortKey, setSortKey] = useState<AgentSortKey>('conv_pct');
  const [asc, setAsc] = useState(false);

  const sorted = [...rows].sort((a, b) =>
    asc ? a[sortKey] - b[sortKey] : b[sortKey] - a[sortKey]
  );

  const col = (key: AgentSortKey, label: string, align = 'right') => (
    <th className={`text-${align} text-slate-500 py-2 pr-3 font-semibold cursor-pointer hover:text-slate-600 transition-colors`}
      onClick={() => { if (sortKey === key) setAsc(v => !v); else { setSortKey(key); setAsc(false); } }}>
      <span className="inline-flex items-center gap-1 justify-end">
        {label}
        {sortKey === key
          ? <span className="text-blue-400 text-[10px]">{asc ? '▲' : '▼'}</span>
          : <ArrowUpDown size={10} className="text-slate-600" />}
      </span>
    </th>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-200">
            <th className="text-left text-slate-500 py-2 pr-3 font-semibold">#</th>
            <th className="text-left text-slate-500 py-2 pr-3 font-semibold">Agent</th>
            {col('calls',       'Calls')}
            {col('sales',       'Sales')}
            {col('conv_pct',    'Conv %')}
            {col('ob_quality',  'OB Quality')}
            {col('avg_talk_sec','Avg Talk')}
          </tr>
        </thead>
        <tbody>
          {sorted.map((a, i) => (
            <tr key={a.agent} onClick={() => onRowClick?.(a)}
              className={`border-b border-slate-200 hover:bg-slate-100 transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}>
              <td className="py-2.5 pr-3 text-slate-600">{i + 1}</td>
              <td className="py-2.5 pr-3 font-medium text-slate-700 max-w-[140px] truncate" title={a.agent}>{a.agent}</td>
              <td className="py-2.5 pr-3 text-right text-slate-500">{fmt(a.calls, 0)}</td>
              <td className="py-2.5 pr-3 text-right font-semibold" style={{ color: a.sales > 0 ? COLOR_GREEN : '#64748B' }}>
                {Number(a.sales) > 0 ? fmt(Number(a.sales), 0) : '—'}
              </td>
              <td className="py-2.5 pr-3 text-right font-semibold" style={{ color: pctColor(a.conv_pct) }}>
                {Number(a.conv_pct).toFixed(1)}%
              </td>
              <td className="py-2.5 pr-3 text-right font-semibold" style={{ color: pctColor(a.ob_quality) }}>
                {Number(a.ob_quality).toFixed(1)}%
              </td>
              <td className="py-2.5 text-right text-slate-500">{fmtSec(a.avg_talk_sec)}</td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr><td colSpan={7} className="py-8 text-center text-slate-600">No agent data for this period</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── OB Drill Modal ──────────────────────────────────────────────────────────

interface AgentDailyRow { date: string; calls: number; sales: number; conv_pct: number; avg_talk_sec: number; }

function OBDrillModal({ title, accent, onClose, loading, onExport, children }: {
  title: string; accent?: string; onClose: () => void;
  loading?: boolean; onExport?: () => void; children: React.ReactNode;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center p-4 sm:p-6 bg-slate-900/60 backdrop-blur-sm" style={{ zIndex: 9998 }}
      onClick={onClose}>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200 shrink-0">
          <div className="w-1.5 h-5 rounded-full shrink-0" style={{ backgroundColor: accent ?? COLOR_PURPLE }} />
          <h3 className="text-sm font-semibold text-slate-700 flex-1 truncate">{title}</h3>
          {onExport && (
            <button onClick={onExport} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors">
              <FileDown size={13} /> Export CSV
            </button>
          )}
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors ml-1">
            <X size={15} />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-40 gap-2 text-slate-500 text-sm">
              <RefreshCw size={16} className="animate-spin" /> Loading analysis…
            </div>
          ) : children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── OB Root Cause Panel ─────────────────────────────────────────────────────

function OBRootCausePanel({ summary, notInt, agents, qParams }: {
  summary: OBSummary | null; notInt: NiRow[]; agents: AgentRow[]; qParams: QParamRow[];
}) {
  if (!summary || summary.totalCalls === 0) return null;

  const insights: { color: string; icon: string; title: string; detail: string; fix: string }[] = [];

  if (summary.convPct < 30) {
    const topNI = notInt[0];
    const worstAgents = [...agents].sort((a, b) => a.conv_pct - b.conv_pct).slice(0, 3).filter(a => a.conv_pct < summary.convPct);
    insights.push({
      color: COLOR_RED, icon: '📉',
      title: `Low Conversion — ${summary.convPct.toFixed(1)}% (Target: 30%+)`,
      detail: `${topNI ? `Top rejection: "${topNI.reason}" (${topNI.cnt.toLocaleString()} calls). ` : ''}${worstAgents.length > 0 ? `Underperforming: ${worstAgents.map(a => `${a.agent} (${a.conv_pct.toFixed(1)}%)`).join(', ')}.` : ''}`,
      fix: 'Focus on objection handling and opening quality. Review top NI reasons in team meetings.',
    });
  }

  if (summary.avgTalkSec > 600) {
    insights.push({
      color: COLOR_AMBER, icon: '📞',
      title: `High Avg Talk Time — ${fmtSec(summary.avgTalkSec)} (Target: < 10 min)`,
      detail: 'Long calls with low conversion rate signals pitch inefficiency.',
      fix: 'Shorten pitch structure. Front-load value proposition to qualify leads faster.',
    });
  }

  const lowestParam = [...qParams].sort((a, b) => a.score - b.score)[0];
  if (lowestParam && lowestParam.score < 60) {
    insights.push({
      color: COLOR_AMBER, icon: '⭐',
      title: `Weak Quality Parameter — "${lowestParam.parameter}"`,
      detail: `Scored ${lowestParam.score.toFixed(0)}% — lowest across all quality parameters.`,
      fix: `Conduct targeted coaching on ${lowestParam.parameter}. High-quality pitches convert 2× better.`,
    });
  }

  if (insights.length === 0) return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl border text-xs mb-5"
      style={{ background: `${COLOR_GREEN}10`, borderColor: `${COLOR_GREEN}30`, color: COLOR_GREEN }}>
      ✅ All outbound metrics look healthy. No critical issues detected.
    </div>
  );

  return (
    <div className="mb-5">
      <h3 className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest mb-3">⚠️ Root Cause Insights</h3>
      <div className="grid grid-cols-1 gap-2.5">
        {insights.map((ins, i) => (
          <div key={i} className="flex gap-3 p-3.5 rounded-xl border"
            style={{ background: `${ins.color}0C`, borderColor: `${ins.color}25` }}>
            <span className="text-sm shrink-0 mt-0.5">{ins.icon}</span>
            <div className="min-w-0">
              <p className="text-xs font-bold mb-0.5" style={{ color: ins.color }}>{ins.title}</p>
              <p className="text-xs text-slate-500 mb-0.5">{ins.detail}</p>
              <p className="text-[11px] text-slate-500"><span className="text-blue-400">→ </span>{ins.fix}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function OutboundSalesDashboard() {
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const now = new Date();
  const [startDate, setStartDate] = useState(
    toLocalDT(new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0))
  );
  const [endDate, setEndDate]   = useState(toLocalDT(now));
  const [clientId, setClientId] = useState('');
  const [clients, setClients]   = useState<ClientItem[]>([]);

  const [summary,    setSummary]    = useState<OBSummary | null>(null);
  const [trend,      setTrend]      = useState<TrendRow[]>([]);
  const [hourly,     setHourly]     = useState<HourRow[]>([]);
  const [agents,     setAgents]     = useState<AgentRow[]>([]);
  const [disp,       setDisp]       = useState<DispRow[]>([]);
  const [products,   setProducts]   = useState<ProdRow[]>([]);
  const [notInt,     setNotInt]     = useState<NiRow[]>([]);
  const [qParams,    setQParams]    = useState<QParamRow[]>([]);

  const [loading,  setLoading]  = useState(false);
  const [loading2, setLoading2] = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  // ── Agent drill-down state ──
  const [agentDrill,        setAgentDrill]        = useState<AgentRow | null>(null);
  const [agentDrillRows,    setAgentDrillRows]    = useState<AgentDailyRow[]>([]);
  const [agentDrillLoading, setAgentDrillLoading] = useState(false);

  const isTenantLocked = clients.length === 1;

  const buildQS = useCallback(() => {
    const p: Record<string, string> = {
      startDate: startDate.replace('T', ' '),
      endDate:   endDate.replace('T', ' '),
    };
    if (clientId) p.clientId = clientId;
    return new URLSearchParams(p).toString();
  }, [startDate, endDate, clientId]);

  const fetchAgentDrill = useCallback(async (a: AgentRow) => {
    setAgentDrill(a);
    setAgentDrillLoading(true);
    setAgentDrillRows([]);
    try {
      const qs = buildQS();
      const res = await api.get(`/call-master/outbound/agent-daily?${qs}&agentName=${encodeURIComponent(a.agent)}`);
      setAgentDrillRows((res.data?.data ?? []).map((r: AgentDailyRow) => ({
        ...r, calls: Number(r.calls), sales: Number(r.sales),
        conv_pct: Number(r.conv_pct), avg_talk_sec: Number(r.avg_talk_sec),
      })));
    } catch { setAgentDrillRows([]); }
    finally { setAgentDrillLoading(false); }
  }, [buildQS]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setLoading2(true);
    setError(null);
    const qs = buildQS();
    try {
      // Phase 1: fast summary data
      const [sumRes, dispRes, prodRes, niRes, qpRes] = await Promise.all([
        api.get(`/call-master/outbound/summary?${qs}`),
        api.get(`/call-master/outbound/disposition?${qs}`),
        api.get(`/call-master/outbound/products?${qs}`),
        api.get(`/call-master/outbound/not-interested?${qs}`),
        api.get(`/call-master/outbound/quality-params?${qs}`),
      ]);
      const raw = sumRes.data.data;
      setSummary({
        totalCalls:   Number(raw?.totalCalls)   || 0,
        totalSales:   Number(raw?.totalSales)   || 0,
        convPct:      Number(raw?.convPct)      || 0,
        avgTalkSec:   Number(raw?.avgTalkSec)   || 0,
        activeAgents: Number(raw?.activeAgents) || 0,
      });
      setDisp((dispRes.data.data || []).map((r: DispRow) => ({
        ...r, cnt: Number(r.cnt) || 0, sales: Number(r.sales) || 0,
      })));
      setProducts((prodRes.data.data || []).map((r: ProdRow) => ({
        ...r, calls: Number(r.calls) || 0, sales: Number(r.sales) || 0,
      })));
      setNotInt((niRes.data.data || []).map((r: NiRow) => ({ ...r, cnt: Number(r.cnt) || 0 })));
      setQParams((qpRes.data.data || []).map((r: QParamRow) => ({ ...r, score: Number(r.score) || 0 })));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }

    // Phase 2: trend + hourly + agents (slightly heavier)
    try {
      const [tRes, hRes, aRes] = await Promise.all([
        api.get(`/call-master/outbound/daily-trend?${qs}`),
        api.get(`/call-master/outbound/hourly?${qs}`),
        api.get(`/call-master/outbound/agents?${qs}`),
      ]);
      setTrend((tRes.data.data || []).map((r: TrendRow) => ({
        ...r,
        calls:      Number(r.calls)      || 0,
        sales:      Number(r.sales)      || 0,
        conv_pct:   Number(r.conv_pct)   || 0,
        ob_quality: Number(r.ob_quality) || 0,
        date:       fmtDate(r.date),
      })));
      setHourly(hRes.data.data || []);
      setAgents((aRes.data.data || []).map((r: AgentRow) => ({
        ...r,
        calls:        Number(r.calls)        || 0,
        sales:        Number(r.sales)        || 0,
        conv_pct:     Number(r.conv_pct)     || 0,
        ob_quality:   Number(r.ob_quality)   || 0,
        avg_talk_sec: Number(r.avg_talk_sec) || 0,
      })));
    } catch { /* trend errors are non-fatal */ }
    finally { setLoading2(false); }
  }, [buildQS]);

  useEffect(() => {
    api.get('/call-master/clients')
      .then(r => {
        const list: ClientItem[] = r.data.data || [];
        setClients(list);
        if (list.length === 1) setClientId(String(list[0].dialdesk_client_id));
      })
      .catch(() => {});
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Derived download rows
  const trendDownload = trend.map(r => ({
    Date: r.date, Calls: r.calls, Sales: r.sales,
    'Conv %': r.conv_pct, 'OB Quality %': r.ob_quality,
  }));
  const agentDownload = agents.map(a => ({
    Agent: a.agent, Calls: a.calls, Sales: a.sales,
    'Conv %': a.conv_pct, 'OB Quality %': a.ob_quality,
    'Avg Talk': fmtSec(a.avg_talk_sec),
  }));

  return (
    <div className="min-h-screen text-slate-900">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="px-6 pt-6 pb-4 bg-white border-b border-slate-200">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/call-master')}
              className="flex items-center gap-1.5 text-slate-500 hover:text-slate-900 transition-colors text-xs"
            >
              <ChevronLeft size={14} /> Call Master
            </button>
            <span className="text-slate-700">/</span>
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">Outbound Sales Intelligence</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                db_external.CallDetails · {user?.role === 'super_admin' ? 'All Process' : 'Your Scope'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/call-master/opening-intelligence')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/15 border border-blue-500/30 text-blue-400 hover:bg-blue-600/25 hover:text-blue-300 text-xs font-medium transition-colors">
              <TrendingUp size={13} />
              Opening Intelligence
            </button>
            <button onClick={() => navigate('/call-master/customer-intelligence')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-pink-600/15 border border-pink-500/30 text-pink-400 hover:bg-pink-600/25 hover:text-pink-300 text-xs font-medium transition-colors">
              <Award size={13} />
              Customer Intelligence
            </button>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-purple-500/10 border border-purple-500/20">
              <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
              <span className="text-xs text-purple-400 font-medium">Outbound</span>
            </div>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="date-pill">
            <Calendar size={13} className="shrink-0" style={{ color: 'rgba(255,255,255,0.75)' }} />
            <div className="flex flex-col gap-0.5">
              <span className="text-[9px] uppercase tracking-wider leading-none" style={{ color: 'rgba(255,255,255,0.65)' }}>From</span>
              <input type="datetime-local" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="bg-transparent text-xs outline-none text-white [color-scheme:dark]" />
            </div>
            <span className="mx-1 self-center" style={{ color: 'rgba(255,255,255,0.40)' }}>—</span>
            <div className="flex flex-col gap-0.5">
              <span className="text-[9px] uppercase tracking-wider leading-none" style={{ color: 'rgba(255,255,255,0.65)' }}>To</span>
              <input type="datetime-local" value={endDate} onChange={e => setEndDate(e.target.value)}
                className="bg-transparent text-xs outline-none text-white [color-scheme:dark]" />
            </div>
          </div>

          {isTenantLocked ? (
            <div className="flex items-center gap-2 bg-white border border-blue-500/40 rounded-lg px-3 py-2">
              <Lock size={12} className="text-blue-400 shrink-0" />
              <span className="text-sm text-blue-300 font-medium">{clients[0].name}</span>
            </div>
          ) : (
            <div className="relative">
              <select value={clientId} onChange={e => setClientId(e.target.value)}
                className="appearance-none bg-white border border-slate-200 text-sm text-slate-700 rounded-lg px-3 py-2 pr-8 outline-none">
                <option className="text-slate-900 bg-white" value="">All Processes</option>
                {clients.map(c => (
                  <option className="text-slate-900 bg-white" key={c.id} value={c.dialdesk_client_id}>{c.name}</option>
                ))}
              </select>
              <ChevronDown size={12} className="absolute right-2 top-3 text-slate-500 pointer-events-none" />
            </div>
          )}

          <motion.button whileTap={{ scale: 0.95 }} onClick={fetchAll} disabled={loading}
            className="flex items-center gap-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-slate-900 text-sm font-medium px-4 py-2 rounded-lg transition-colors">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Loading…' : 'Refresh'}
          </motion.button>
        </div>
      </div>

      <div className="p-6 space-y-5">
        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              className="flex items-center gap-3 bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl px-4 py-3 text-sm">
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── KPI Row ────────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <KPICard index={0} label="Total Calls"   value={summary?.totalCalls ?? 0}
            icon={<PhoneCall size={15}/>} color={COLOR_BLUE}   sub="Click for daily trend" />
          <KPICard index={1} label="Sales Done"    value={summary?.totalSales ?? 0}
            icon={<TrendingUp size={15}/>} color={COLOR_GREEN} sub="Click for product mix" />
          <KPICard index={2} label="Conversion"    value={summary?.convPct ?? 0} suffix="%" dec={1}
            icon={<Award size={15}/>} color={summary && summary.convPct >= 30 ? COLOR_GREEN : COLOR_RED}
            sub="Click for disposition breakdown" />
          <KPICard index={3} label="Avg Talk Time" value={summary ? Math.round(summary.avgTalkSec / 60) : 0} suffix="m"
            icon={<Clock size={15}/>} color={COLOR_AMBER} sub={summary ? fmtSec(summary.avgTalkSec) : '—'} />
          <KPICard index={4} label="Active Agents" value={summary?.activeAgents ?? 0}
            icon={<Users size={15}/>} color={COLOR_RED}    />
        </div>

        {/* ── Root Cause Panel ── */}
        {!loading && summary && (
          <OBRootCausePanel summary={summary} notInt={notInt} agents={agents} qParams={qParams} />
        )}

        {/* ── Daily Trend (3/5) + Hourly (2/5) ─────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          <div className="lg:col-span-3">
            <SectionCard title="Daily Sales Trend" accent={COLOR_GREEN}
              downloadData={{ filename: 'ob_daily_trend', rows: trendDownload }}>
              {loading2 ? (
                <div className="flex items-center justify-center h-56 text-slate-600 text-sm gap-2">
                  <RefreshCw size={14} className="animate-spin" /> Loading…
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={trend} margin={{ top: 4, right: 36, bottom: 0, left: -8 }}>
                    <CartesianGrid {...GRID} />
                    <XAxis dataKey="date" tick={{ ...AXIS_TICK, fontSize: 10 }} tickLine={false} axisLine={false}
                      interval={Math.max(0, Math.floor(trend.length / 10) - 1)} />
                    <YAxis yAxisId="left" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                    <YAxis yAxisId="right" orientation="right" domain={[0, 100]} unit="%"
                      tick={AXIS_TICK} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: '#CBD5E1' }} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                    <Bar yAxisId="left" dataKey="calls" fill={COLOR_BLUE}   name="Calls"   radius={[2,2,0,0]} />
                    <Bar yAxisId="left" dataKey="sales" fill={COLOR_GREEN}  name="Sales"   radius={[2,2,0,0]} />
                    <Line yAxisId="right" type="monotone" dataKey="conv_pct"   stroke={COLOR_AMBER}  strokeWidth={2} dot={false} name="Conv %" />
                    <Line yAxisId="right" type="monotone" dataKey="ob_quality" stroke={COLOR_PURPLE} strokeWidth={1.5} dot={false} strokeDasharray="4 2" name="OB Quality %" />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </SectionCard>
          </div>

          <div className="lg:col-span-2">
            <SectionCard title="Hourly Distribution" accent={COLOR_BLUE}
              downloadData={{ filename: 'ob_hourly', rows: hourly.map(r => ({ Hour: r.hour, Calls: r.calls, Sales: r.sales })) }}>
              {loading2 ? (
                <div className="flex items-center justify-center h-56 text-slate-600 text-sm gap-2">
                  <RefreshCw size={14} className="animate-spin" /> Loading…
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={hourly} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
                    <CartesianGrid {...GRID} />
                    <XAxis dataKey="hour" tick={{ ...AXIS_TICK, fontSize: 9 }} tickLine={false} axisLine={false} interval={3} />
                    <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="calls" fill={COLOR_BLUE}  name="Calls" radius={[2,2,0,0]} />
                    <Bar dataKey="sales" fill={COLOR_GREEN} name="Sales" radius={[2,2,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </SectionCard>
          </div>
        </div>

        {/* ── OB Quality Params (2/5) + Call Disposition (3/5) ─────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          <div className="lg:col-span-2">
            <SectionCard title="OB Quality Parameters" accent={COLOR_PURPLE}
              downloadData={{ filename: 'ob_quality_params', rows: qParams.map(p => ({ Parameter: p.parameter, 'Score (%)': p.score })) }}>
              <QualityBars rows={qParams} />
            </SectionCard>
          </div>
          <div className="lg:col-span-3">
            <SectionCard title="Call Disposition Breakdown" accent={COLOR_BLUE}
              downloadData={{ filename: 'ob_disposition', rows: disp.map(r => ({ Disposition: r.disposition, Calls: r.cnt, Sales: r.sales })) }}>
              <HorizBars data={disp.map(r => ({ label: r.disposition, value: r.cnt, sales: r.sales }))}
                labelKey="label" valueKey="value" />
            </SectionCard>
          </div>
        </div>

        {/* ── Agent Performance Table ───────────────────────────────────────── */}
        <SectionCard title="Agent Performance" accent={COLOR_AMBER}
          downloadData={{ filename: 'ob_agent_performance', rows: agentDownload }}>
          {loading2 ? (
            <div className="flex items-center justify-center py-8 text-slate-600 text-sm gap-2">
              <RefreshCw size={14} className="animate-spin" /> Loading agents…
            </div>
          ) : (
            <>
              <p className="text-xs text-slate-500 mb-3">Click column headers to sort · Click a row for deep analysis</p>
              <AgentTable rows={agents} onRowClick={fetchAgentDrill} />
            </>
          )}
        </SectionCard>

        {/* ── Product Mix + Not Interested Reasons ─────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <SectionCard title="Product Mix" accent={COLOR_GREEN}
            downloadData={{ filename: 'ob_product_mix', rows: products.map(r => ({ Product: r.product, Calls: r.calls, Sales: r.sales })) }}>
            <HorizBars data={products.map(r => ({ label: r.product, value: r.calls }))}
              labelKey="label" valueKey="value" />
          </SectionCard>

          <SectionCard title="Not Interested Reasons" accent={COLOR_RED}
            downloadData={{ filename: 'ob_not_interested', rows: notInt.map(r => ({ Reason: r.reason, Count: r.cnt })) }}>
            {notInt.length === 0 ? (
              <p className="text-slate-600 text-sm text-center py-8">No rejection reason data available</p>
            ) : (
              <HorizBars data={notInt.map(r => ({ label: r.reason, value: r.cnt }))}
                labelKey="label" valueKey="value" colorFn={() => COLOR_RED} />
            )}
          </SectionCard>
        </div>

        {/* ── Date-wise Performance Table ───────────────────────────────────── */}
        <SectionCard title="Date-wise Performance" accent={COLOR_BLUE}
          downloadData={{ filename: 'ob_datewise_performance', rows: trendDownload }}>
          {loading2 ? (
            <div className="flex items-center justify-center py-8 text-slate-600 text-sm gap-2">
              <RefreshCw size={14} className="animate-spin" /> Loading…
            </div>
          ) : (
            <div className="overflow-x-auto max-h-72 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-slate-200">
                    <th className="text-left text-slate-500 py-2 pr-3 font-semibold">Date</th>
                    <th className="text-right text-slate-500 py-2 pr-3 font-semibold">Calls</th>
                    <th className="text-right text-slate-500 py-2 pr-3 font-semibold">Sales</th>
                    <th className="text-right text-slate-500 py-2 pr-3 font-semibold">Conv %</th>
                    <th className="text-right text-slate-500 py-2 font-semibold">OB Quality %</th>
                  </tr>
                </thead>
                <tbody>
                  {trend.map(r => (
                    <tr key={r.date} className="border-b border-slate-200 hover:bg-slate-100 transition-colors">
                      <td className="py-2.5 pr-3 font-medium text-slate-600">{r.date}</td>
                      <td className="py-2.5 pr-3 text-right text-slate-500">{Number(r.calls).toLocaleString()}</td>
                      <td className="py-2.5 pr-3 text-right font-semibold" style={{ color: r.sales > 0 ? COLOR_GREEN : '#64748B' }}>
                        {Number(r.sales) > 0 ? Number(r.sales).toLocaleString() : '—'}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-semibold" style={{ color: pctColor(r.conv_pct) }}>
                        {Number(r.conv_pct).toFixed(1)}%
                      </td>
                      <td className="py-2.5 text-right font-semibold" style={{ color: pctColor(r.ob_quality) }}>
                        {Number(r.ob_quality).toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                  {trend.length === 0 && (
                    <tr><td colSpan={5} className="py-8 text-center text-slate-600">No data for this period</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>

      {/* ── Agent Drill Modal ── */}
      {agentDrill && (
        <OBDrillModal
          title={`${agentDrill.agent} — Agent Deep Analysis`}
          accent={COLOR_AMBER}
          onClose={() => { setAgentDrill(null); setAgentDrillRows([]); }}
          loading={agentDrillLoading}
          onExport={agentDrillRows.length > 0 ? () => downloadCSV(
            `${agentDrill.agent.replace(/\s+/g,'_')}_daily`,
            agentDrillRows.map(r => ({ Date: r.date, Calls: r.calls, Sales: r.sales, 'Conv%': r.conv_pct, 'Avg Talk (s)': r.avg_talk_sec }))
          ) : undefined}
        >
          {/* Summary strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            {[
              { label: 'Total Calls', val: agentDrill.calls.toLocaleString(),                            color: COLOR_BLUE },
              { label: 'Total Sales', val: agentDrill.sales > 0 ? agentDrill.sales.toLocaleString() : '—', color: agentDrill.sales > 0 ? COLOR_GREEN : '#64748B' },
              { label: 'Conversion',  val: `${agentDrill.conv_pct.toFixed(1)}%`,                         color: pctColor(agentDrill.conv_pct) },
              { label: 'Avg Talk',    val: fmtSec(agentDrill.avg_talk_sec),                              color: COLOR_AMBER },
            ].map(({ label, val, color }) => (
              <div key={label} className="bg-white rounded-xl p-3 border border-slate-200">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{label}</p>
                <p className="text-lg font-bold" style={{ color }}>{val}</p>
              </div>
            ))}
          </div>

          {/* Root cause for this agent */}
          {agentDrill.conv_pct < (summary?.convPct ?? 30) && (
            <div className="flex gap-3 p-3.5 rounded-xl border mb-5"
              style={{ background: `${COLOR_RED}0C`, borderColor: `${COLOR_RED}25` }}>
              <span className="text-sm shrink-0">📉</span>
              <div>
                <p className="text-xs font-bold text-red-400 mb-0.5">Below Team Average</p>
                <p className="text-xs text-slate-500">
                  Converts {agentDrill.conv_pct.toFixed(1)}% vs team avg {summary?.convPct.toFixed(1)}%.
                  OB Quality score: {agentDrill.ob_quality.toFixed(1)}%.
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  <span className="text-blue-400">→ </span>
                  Review call recordings. Focus on opening, objection handling, and offer urgency.
                </p>
              </div>
            </div>
          )}

          {/* Daily chart */}
          {agentDrillRows.length > 0 ? (
            <>
              <h4 className="text-[11px] text-slate-500 uppercase tracking-widest mb-3">Daily Performance</h4>
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={agentDrillRows.map(r => ({ ...r, date: fmtDate(r.date) }))} margin={{ top: 4, right: 48, left: 0, bottom: 4 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="date" tick={{ ...AXIS_TICK, fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="left"  tick={AXIS_TICK} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="right" orientation="right" domain={[0,100]} unit="%" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  <Bar yAxisId="left" dataKey="calls" fill={COLOR_BLUE}  name="Calls" radius={[2,2,0,0]} />
                  <Bar yAxisId="left" dataKey="sales" fill={COLOR_GREEN} name="Sales" radius={[2,2,0,0]} />
                  <Line yAxisId="right" type="monotone" dataKey="conv_pct" stroke={COLOR_AMBER} strokeWidth={2} dot={false} name="Conv %" />
                </ComposedChart>
              </ResponsiveContainer>

              <h4 className="text-[11px] text-slate-500 uppercase tracking-widest mt-5 mb-3">Daily Breakdown</h4>
              <div className="overflow-auto max-h-56">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-white z-10">
                    <tr className="border-b border-slate-200">
                      {['Date','Calls','Sales','Conv%','Avg Talk'].map(h => (
                        <th key={h} className="py-2 px-3 text-right first:text-left text-slate-500 font-semibold uppercase tracking-wider whitespace-nowrap text-[9px]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {agentDrillRows.map((r, i) => (
                      <tr key={r.date} className={`border-b border-slate-100 ${i%2===0?'':'bg-transparent'}`}>
                        <td className="py-2 px-3 text-slate-600 font-medium">{fmtDate(r.date)}</td>
                        <td className="py-2 px-3 text-right text-slate-500 tabular-nums">{Number(r.calls).toLocaleString()}</td>
                        <td className="py-2 px-3 text-right font-semibold tabular-nums" style={{ color: r.sales > 0 ? COLOR_GREEN : '#64748B' }}>
                          {Number(r.sales) > 0 ? Number(r.sales).toLocaleString() : '—'}
                        </td>
                        <td className="py-2 px-3 text-right font-semibold tabular-nums" style={{ color: pctColor(r.conv_pct) }}>
                          {Number(r.conv_pct).toFixed(1)}%
                        </td>
                        <td className="py-2 px-3 text-right text-slate-500 tabular-nums">{fmtSec(r.avg_talk_sec)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="text-center text-slate-500 py-8 text-sm">No daily data found for this agent in the selected period.</div>
          )}
        </OBDrillModal>
      )}
    </div>
  );
}
