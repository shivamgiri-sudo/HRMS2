// @ts-nocheck
// AUTO-SYNCED from tausifansari-mcn/Mydashboards frontend/src/features/call-master/OpeningIntelligenceDashboard.tsx @ 4fbd5df - do not edit; run scripts/sync-mydashboards.mjs
import { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ComposedChart, Bar, Line, BarChart, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import {
  PhoneCall, TrendingUp, Award, Users, ChevronLeft,
  RefreshCw, Download, Maximize2, X, Lightbulb,
  MessageSquare, Target, BarChart2, AlertTriangle, CheckCircle, Info,
} from 'lucide-react';
import { useAuthStore } from '../shim/authStore';
import api from '../shim/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface OIExecSummary {
  totalCalls: number;
  openingSuccessPct: number;
  openingFailPct: number;
  openingScore: number;
  contextSuccessPct: number;
  contextFailPct: number;
  contextScore: number;
  salesConvPct: number;
}
interface CategoryRow   { category: string; calls: number; sales: number; conv_pct: number }
interface RawCatRow     { category: string; calls: number; conv_pct: number }
interface TrendRow      { period: string; calls: number; opening_good_pct?: number; context_set_pct?: number; opening_score?: number; conv_pct: number }
interface DimRow        { dim: string; calls: number; opening_good_pct?: number; context_set_pct?: number; opening_score?: number; conv_pct: number }
interface VsSalesRow    { opening_category: string; calls: number; sales: number; conv_pct: number; opening_score: number }
interface LeaderboardData {
  top10Agents: AgentLB[];
  bottom5Agents: AgentLB[];
  topClients: SimpleLB[];
  topCampaigns: SimpleLB[];
}
interface AgentLB   { name: string; calls: number; opening_pct: number; opening_score: number; conv_pct: number }
interface SimpleLB  { name: string; calls: number; opening_pct: number; conv_pct: number }
interface AIInsight { type: 'alert' | 'success' | 'opportunity'; title: string; what: string; why: string; impact: string; action: string }

// ─── Design Tokens ────────────────────────────────────────────────────────────

const C_GREEN  = '#10B981';
const C_BLUE   = '#3B82F6';
const C_PURPLE = '#8B5CF6';
const C_AMBER  = '#F59E0B';
const C_RED    = '#EF4444';
const C_TEAL   = '#06B6D4';
const C_PINK   = '#EC4899';
const COLORS   = [C_BLUE, C_GREEN, C_PURPLE, C_AMBER, C_RED, C_TEAL, C_PINK, '#6366F1'];

const TOOLTIP_STYLE = { background: '#FFFFFF', border: '1px solid #334155', borderRadius: 8, fontSize: 12 };
const AXIS_TICK     = { fill: '#64748B', fontSize: 11 };
const GRID_PROPS    = { strokeDasharray: '3 3', stroke: '#FFFFFF' };

const OPENING_COLORS: Record<string, string> = {
  'Full Opening':      C_GREEN,
  'Standard Opening':  C_BLUE,
  'Basic Greeting':    C_AMBER,
  'No Opening':        C_RED,
  'Other':             '#64748B',
};

const CONTEXT_COLORS: Record<string, string> = {
  'Feedback-First Approach then Offer Pitched': C_BLUE,
  'Dual Approach: Feedback & Offer at Once':    C_GREEN,
  'Follow Up':                                  C_AMBER,
  'Order Confirmation':                         C_PURPLE,
  'Not Set':                                    '#64748B',
  'Other':                                      '#475569',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toLocalDT(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function pctColor(v: number | string) {
  const n = Number(v);
  if (n >= 80) return C_GREEN;
  if (n >= 60) return C_AMBER;
  return C_RED;
}

function downloadCSV(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
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

function KPICard({ label, value, suffix = '', dec = 0, icon, color, sub, index }: {
  label: string; value: number; suffix?: string; dec?: number;
  icon: React.ReactNode; color: string; sub?: string; index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.4 }}
      className="relative bg-white shadow-sm rounded-xl p-4 flex flex-col gap-2 border border-slate-200 overflow-hidden"
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

function SectionCard({ title, children, className = '', accent = C_BLUE, downloadData }: {
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

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ h = 200 }: { h?: number }) {
  return (
    <div className="animate-pulse bg-slate-200 rounded-lg" style={{ height: h }} />
  );
}

// ─── HorizBars ────────────────────────────────────────────────────────────────

function HorizBars({ data, labelKey, valueKey, color, maxItems = 10 }: {
  data: Record<string, unknown>[]; labelKey: string; valueKey: string; color?: string; maxItems?: number;
}) {
  const items = data.slice(0, maxItems);
  const max = Math.max(...items.map(r => Number(r[valueKey]) || 0), 1);
  return (
    <div className="space-y-2">
      {items.map((r, i) => {
        const val = Number(r[valueKey]) || 0;
        const pct = (val / max) * 100;
        const barColor = color || COLORS[i % COLORS.length];
        return (
          <div key={i} className="group">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[11px] text-slate-500 truncate max-w-[70%]" title={String(r[labelKey])}>{String(r[labelKey])}</span>
              <span className="text-[11px] font-semibold" style={{ color: barColor }}>{typeof val === 'number' && valueKey.includes('pct') ? `${val}%` : val.toLocaleString()}</span>
            </div>
            <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
              <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.7, delay: i * 0.04 }}
                className="h-full rounded-full" style={{ backgroundColor: barColor }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Score Badge ──────────────────────────────────────────────────────────────

function ScoreBadge({ value }: { value: number | string | null | undefined }) {
  const n = Number(value);
  const color = pctColor(n);
  return (
    <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ backgroundColor: `${color}22`, color }}>
      {isNaN(n) ? '—' : `${n.toFixed(1)}%`}
    </span>
  );
}

// ─── Period Selector ──────────────────────────────────────────────────────────

function PeriodSelector({ value, onChange }: {
  value: string;
  onChange: (v: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly') => void;
}) {
  const opts = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as const;
  return (
    <div className="flex gap-1">
      {opts.map(o => (
        <button key={o} onClick={() => onChange(o)}
          className={`px-2.5 py-1 rounded-md text-[10px] font-semibold capitalize transition-colors ${
            value === o ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:text-slate-900 border border-slate-200'
          }`}>{o}</button>
      ))}
    </div>
  );
}

// ─── Dim Selector ─────────────────────────────────────────────────────────────

function DimSelector({ value, onChange }: {
  value: string;
  onChange: (v: 'client' | 'agent' | 'campaign') => void;
}) {
  const opts = ['client', 'agent', 'campaign'] as const;
  return (
    <div className="flex gap-1">
      {opts.map(o => (
        <button key={o} onClick={() => onChange(o)}
          className={`px-2.5 py-1 rounded-md text-[10px] font-semibold capitalize transition-colors ${
            value === o ? 'bg-purple-600 text-white' : 'bg-slate-100 text-slate-600 hover:text-slate-900 border border-slate-200'
          }`}>{o}</button>
      ))}
    </div>
  );
}

// ─── AI Insight Card ──────────────────────────────────────────────────────────

function InsightCard({ insight, index }: { insight: AIInsight; index: number }) {
  const [open, setOpen] = useState(index === 0);
  const cfg = {
    alert:       { icon: <AlertTriangle size={14} />, color: C_RED,    bg: '#EF444415', label: 'Alert' },
    success:     { icon: <CheckCircle size={14} />,   color: C_GREEN,  bg: '#10B98115', label: 'Positive' },
    opportunity: { icon: <Target size={14} />,        color: C_AMBER,  bg: '#F59E0B15', label: 'Opportunity' },
  }[insight.type];

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.08 }}
      className="rounded-xl border overflow-hidden" style={{ borderColor: `${cfg.color}30`, background: cfg.bg }}>
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <span style={{ color: cfg.color }}>{cfg.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold text-slate-900 truncate">{insight.title}</div>
          <div className="text-[10px] mt-0.5" style={{ color: cfg.color }}>{cfg.label}</div>
        </div>
        <span className="text-slate-500 shrink-0">{open ? '−' : '+'}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
            className="overflow-hidden border-t" style={{ borderColor: `${cfg.color}20` }}>
            <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                { k: 'What', v: insight.what },
                { k: 'Why',  v: insight.why },
                { k: 'Impact', v: insight.impact },
                { k: 'Action', v: insight.action },
              ].map(({ k, v }) => (
                <div key={k} className="rounded-lg bg-slate-100 px-3 py-2">
                  <div className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: cfg.color }}>{k}</div>
                  <div className="text-[11px] text-slate-600 leading-relaxed">{v}</div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Lazy section observer (fires fetch when div enters viewport) ─────────────

function useSectionObserver(
  ref: React.RefObject<HTMLDivElement | null>,
  fetchFn: () => void,
  loadedFlag: React.MutableRefObject<boolean>,
) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !loadedFlag.current) {
        loadedFlag.current = true;
        fetchFn();
        obs.disconnect();
      }
    }, { rootMargin: '250px' });
    obs.observe(el);
    return () => obs.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function OpeningIntelligenceDashboard() {
  const navigate = useNavigate();
  const { user }  = useAuthStore();

  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const [startDT, setStartDT] = useState(toLocalDT(firstOfMonth));
  const [endDT,   setEndDT]   = useState(toLocalDT(now));
  const [clientId, setClientId] = useState<string>('');
  const [clients,  setClients]  = useState<{ id: number; name: string; dialdesk_client_id: number }[]>([]);

  // Opening trend controls
  const [openingPeriod, setOpeningPeriod] = useState<'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'>('daily');
  const [openingDim, setOpeningDim] = useState<'client' | 'agent' | 'campaign'>('agent');

  // Context trend controls
  const [contextPeriod, setContextPeriod] = useState<'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'>('daily');
  const [contextDim, setContextDim] = useState<'client' | 'agent' | 'campaign'>('agent');

  // Data state
  const [summary,      setSummary]     = useState<OIExecSummary | null>(null);
  const [openingCats,  setOpeningCats] = useState<CategoryRow[]>([]);
  const [rawCats,      setRawCats]     = useState<RawCatRow[]>([]);
  const [openingByDim, setOpeningByDim] = useState<DimRow[]>([]);
  const [contextCats,  setContextCats]  = useState<CategoryRow[]>([]);
  const [contextByDim, setContextByDim] = useState<DimRow[]>([]);
  const [vsSales,      setVsSales]      = useState<VsSalesRow[]>([]);
  const [openingTrend, setOpeningTrend] = useState<TrendRow[]>([]);
  const [contextTrend, setContextTrend] = useState<TrendRow[]>([]);
  const [leaderboard,  setLeaderboard]  = useState<LeaderboardData | null>(null);
  const [insights,     setInsights]     = useState<AIInsight[]>([]);

  const [loading,    setLoading]    = useState(true);
  const [sec2Loading, setSec2Loading] = useState(false);
  const [sec3Loading, setSec3Loading] = useState(false);
  const [sec4Loading, setSec4Loading] = useState(false);
  const [sec5Loading, setSec5Loading] = useState(false);
  const [sec6Loading, setSec6Loading] = useState(false);
  const [sec7Loading, setSec7Loading] = useState(false);
  const [sec8Loading, setSec8Loading] = useState(false);
  const [error,      setError]      = useState('');

  // Section refs — each attached to a section <div> for IntersectionObserver
  const sec2Ref = useRef<HTMLDivElement>(null);
  const sec3Ref = useRef<HTMLDivElement>(null);
  const sec4Ref = useRef<HTMLDivElement>(null);
  const sec5Ref = useRef<HTMLDivElement>(null);
  const sec6Ref = useRef<HTMLDivElement>(null);
  const sec7Ref = useRef<HTMLDivElement>(null);
  const sec8Ref = useRef<HTMLDivElement>(null);

  // Section load-once flags
  const sec2Loaded = useRef(false);
  const sec3Loaded = useRef(false);
  const sec4Loaded = useRef(false);
  const sec5Loaded = useRef(false);
  const sec6Loaded = useRef(false);
  const sec7Loaded = useRef(false);
  const sec8Loaded = useRef(false);

  const isSingleClient = clients.length === 1;

  const params = useCallback(() => {
    const p: Record<string, string> = { startDate: startDT.replace('T', ' '), endDate: endDT.replace('T', ' ') };
    if (clientId) p.clientId = clientId;
    return p;
  }, [startDT, endDT, clientId]);

  // Mutable refs so fetch callbacks stay stable
  const paramsRef        = useRef(params);
  const openingDimRef    = useRef(openingDim);
  const contextDimRef    = useRef(contextDim);
  const openingPeriodRef = useRef(openingPeriod);
  const contextPeriodRef = useRef(contextPeriod);

  // Keep refs in sync every render
  paramsRef.current        = params;
  openingDimRef.current    = openingDim;
  contextDimRef.current    = contextDim;
  openingPeriodRef.current = openingPeriod;
  contextPeriodRef.current = contextPeriod;

  // Load clients
  useEffect(() => {
    api.get('/call-master/clients').then(r => {
      const list = r.data?.data ?? [];
      setClients(list);
      if (list.length === 1) setClientId(String(list[0].dialdesk_client_id));
    }).catch(() => {});
  }, []);

  // ── Stable fetch functions (read from refs, never recreated) ────────────

  const fetchSummary = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await api.get('/call-master/opening-intelligence/executive-summary', { params: paramsRef.current() });
      setSummary(r.data?.data ?? null);
    } catch { setError('Failed to load data. Please try again.'); }
    finally  { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchSec2 = useCallback(() => {
    setSec2Loading(true);
    const p = paramsRef.current();
    Promise.all([
      api.get('/call-master/opening-intelligence/opening-categories', { params: p }),
      api.get('/call-master/opening-intelligence/opening-raw', { params: p }),
      api.get('/call-master/opening-intelligence/opening-by-dim', { params: { ...p, dim: openingDimRef.current } }),
    ]).then(([a, b, c]) => {
      setOpeningCats(a.data?.data ?? []);
      setRawCats(b.data?.data ?? []);
      setOpeningByDim(c.data?.data ?? []);
    }).catch(() => {}).finally(() => setSec2Loading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchSec3 = useCallback(() => {
    setSec3Loading(true);
    const p = paramsRef.current();
    Promise.all([
      api.get('/call-master/opening-intelligence/context-categories', { params: p }),
      api.get('/call-master/opening-intelligence/context-by-dim', { params: { ...p, dim: contextDimRef.current } }),
    ]).then(([a, b]) => {
      setContextCats(a.data?.data ?? []);
      setContextByDim(b.data?.data ?? []);
    }).catch(() => {}).finally(() => setSec3Loading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchSec4 = useCallback(() => {
    setSec4Loading(true);
    api.get('/call-master/opening-intelligence/opening-vs-sales', { params: paramsRef.current() })
      .then(r => setVsSales(r.data?.data ?? []))
      .catch(() => {}).finally(() => setSec4Loading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchSec5 = useCallback(() => {
    setSec5Loading(true);
    api.get('/call-master/opening-intelligence/opening-trend', { params: { ...paramsRef.current(), period: openingPeriodRef.current } })
      .then(r => setOpeningTrend(r.data?.data ?? []))
      .catch(() => {}).finally(() => setSec5Loading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchSec6 = useCallback(() => {
    setSec6Loading(true);
    api.get('/call-master/opening-intelligence/context-trend', { params: { ...paramsRef.current(), period: contextPeriodRef.current } })
      .then(r => setContextTrend(r.data?.data ?? []))
      .catch(() => {}).finally(() => setSec6Loading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchSec7 = useCallback(() => {
    setSec7Loading(true);
    api.get('/call-master/opening-intelligence/leaderboard', { params: paramsRef.current() })
      .then(r => setLeaderboard(r.data?.data ?? null))
      .catch(() => {}).finally(() => setSec7Loading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchSec8 = useCallback(() => {
    setSec8Loading(true);
    api.get('/call-master/opening-intelligence/ai-insights', { params: paramsRef.current() })
      .then(r => setInsights(r.data?.data ?? []))
      .catch(() => {}).finally(() => setSec8Loading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Executive summary loads immediately
  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  // One IntersectionObserver per section — fires when section enters viewport
  useSectionObserver(sec2Ref, fetchSec2, sec2Loaded);
  useSectionObserver(sec3Ref, fetchSec3, sec3Loaded);
  useSectionObserver(sec4Ref, fetchSec4, sec4Loaded);
  useSectionObserver(sec5Ref, fetchSec5, sec5Loaded);
  useSectionObserver(sec6Ref, fetchSec6, sec6Loaded);
  useSectionObserver(sec7Ref, fetchSec7, sec7Loaded);
  useSectionObserver(sec8Ref, fetchSec8, sec8Loaded);

  // Apply button: reload summary + any section already loaded
  const applyFilters = useCallback(() => {
    fetchSummary();
    if (sec2Loaded.current) fetchSec2();
    if (sec3Loaded.current) fetchSec3();
    if (sec4Loaded.current) fetchSec4();
    if (sec5Loaded.current) fetchSec5();
    if (sec6Loaded.current) fetchSec6();
    if (sec7Loaded.current) fetchSec7();
    if (sec8Loaded.current) fetchSec8();
  }, [fetchSummary, fetchSec2, fetchSec3, fetchSec4, fetchSec5, fetchSec6, fetchSec7, fetchSec8]);

  // Dim / period change handlers — update ref immediately then refetch if visible
  const handleOpeningPeriod = (p: typeof openingPeriod) => {
    setOpeningPeriod(p); openingPeriodRef.current = p;
    if (sec5Loaded.current) fetchSec5();
  };
  const handleContextPeriod = (p: typeof contextPeriod) => {
    setContextPeriod(p); contextPeriodRef.current = p;
    if (sec6Loaded.current) fetchSec6();
  };
  const handleOpeningDim = (d: typeof openingDim) => {
    setOpeningDim(d); openingDimRef.current = d;
    if (sec2Loaded.current) {
      api.get('/call-master/opening-intelligence/opening-by-dim', { params: { ...paramsRef.current(), dim: d } })
        .then(r => setOpeningByDim(r.data?.data ?? [])).catch(() => {});
    }
  };
  const handleContextDim = (d: typeof contextDim) => {
    setContextDim(d); contextDimRef.current = d;
    if (sec3Loaded.current) {
      api.get('/call-master/opening-intelligence/context-by-dim', { params: { ...paramsRef.current(), dim: d } })
        .then(r => setContextByDim(r.data?.data ?? [])).catch(() => {});
    }
  };

  return (
    <div className="min-h-screen text-slate-900">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3 flex-wrap">
          <button onClick={() => navigate('/call-master')}
            className="flex items-center gap-1.5 text-slate-500 hover:text-slate-900 transition-colors text-xs">
            <ChevronLeft size={16} /> Call Master
          </button>
          <div className="w-px h-4 bg-slate-300" />
          <MessageSquare size={16} className="text-blue-400 shrink-0" />
          <div>
            <h1 className="text-sm font-bold text-slate-900 leading-none">Opening Intelligence</h1>
            <p className="text-[10px] text-slate-500 mt-0.5">Opening Pitch & Context Setting Analytics</p>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-600/15 border border-blue-500/30 text-blue-400 text-[10px] font-semibold ml-auto">
            <BarChart2 size={11} /> Module A
          </div>
        </div>

        {/* Filter Bar */}
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 pb-3 flex flex-wrap items-center gap-2">
          <div className="date-pill">
            <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.65)' }}>From</span>
            <input type="datetime-local" value={startDT} onChange={e => setStartDT(e.target.value)}
              className="bg-transparent text-[11px] outline-none w-36 text-white [color-scheme:dark]" />
          </div>
          <div className="date-pill">
            <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.65)' }}>To</span>
            <input type="datetime-local" value={endDT} onChange={e => setEndDT(e.target.value)}
              className="bg-transparent text-[11px] outline-none w-36 text-white [color-scheme:dark]" />
          </div>
          {!isSingleClient ? (
            <select value={clientId} onChange={e => setClientId(e.target.value)}
              className="border rounded-lg text-[11px] px-2.5 py-1.5 outline-none text-white"
              style={{ background: 'linear-gradient(135deg,#0D47A1,#1565C0)', borderColor: 'rgba(255,255,255,0.25)' }}>
              <option className="text-slate-900 bg-white" value="">All Process</option>
              {clients.map(c => <option className="text-slate-900 bg-white" key={c.id} value={c.dialdesk_client_id}>{c.name}</option>)}
            </select>
          ) : (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-900/30 border border-blue-700/30 text-[11px] text-blue-300">
              {clients[0]?.name}
            </div>
          )}
          <button onClick={applyFilters} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-slate-900 text-xs font-semibold transition-colors disabled:opacity-50">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Loading…' : 'Apply'}
          </button>
        </div>
      </div>

      {/* ── Error Banner ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="max-w-screen-2xl mx-auto px-4 sm:px-6 mt-4">
            <div className="bg-red-900/30 border border-red-700/40 rounded-xl px-4 py-3 flex items-center gap-2 text-sm text-red-300">
              <AlertTriangle size={14} /> {error}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* ── Section 1: Executive Summary ─────────────────────────────── */}
        <div>
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2">
            <span className="w-4 h-px bg-slate-300" /> Executive Summary
          </h2>
          {loading && !summary ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
              {Array(8).fill(0).map((_, i) => <Skeleton key={i} h={90} />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
              <KPICard index={0} label="Total Calls"         value={summary?.totalCalls ?? 0}         icon={<PhoneCall size={14} />}   color={C_BLUE}   />
              <KPICard index={1} label="Opening Success %"   value={summary?.openingSuccessPct ?? 0}  icon={<CheckCircle size={14} />} color={C_GREEN}  suffix="%" dec={1} />
              <KPICard index={2} label="Opening Failure %"   value={summary?.openingFailPct ?? 0}     icon={<X size={14} />}           color={C_RED}    suffix="%" dec={1} />
              <KPICard index={3} label="Opening Score"       value={summary?.openingScore ?? 0}       icon={<Award size={14} />}       color={C_PURPLE} suffix="/100" dec={1} />
              <KPICard index={4} label="Context Success %"   value={summary?.contextSuccessPct ?? 0}  icon={<MessageSquare size={14} />} color={C_TEAL}  suffix="%" dec={1} />
              <KPICard index={5} label="Context Failure %"   value={summary?.contextFailPct ?? 0}     icon={<AlertTriangle size={14} />} color={C_AMBER}  suffix="%" dec={1} />
              <KPICard index={6} label="Context Score"       value={summary?.contextScore ?? 0}       icon={<Target size={14} />}      color={C_PINK}   suffix="%" dec={1} />
              <KPICard index={7} label="Conversion %"        value={summary?.salesConvPct ?? 0}       icon={<TrendingUp size={14} />}  color={C_GREEN}  suffix="%" dec={2} />
            </div>
          )}
        </div>

        {/* ── Section 2: Opening Intelligence ──────────────────────────── */}
        <div ref={sec2Ref}>
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2">
            <span className="w-4 h-px bg-slate-300" /> Section 2 — Opening Intelligence
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Opening Category Breakdown (Pie) */}
            <SectionCard title="Opening Pitch Category" accent={C_BLUE}
              downloadData={{ filename: 'opening_categories', rows: openingCats as unknown as Record<string, unknown>[] }}>
              {!openingCats.length || sec2Loading ? <Skeleton /> : (
                <div>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={openingCats} dataKey="calls" nameKey="category" cx="50%" cy="50%"
                        outerRadius={80} paddingAngle={2}>
                        {openingCats.map((r, i) => (
                          <Cell key={i} fill={OPENING_COLORS[r.category] || COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="mt-3 space-y-1.5">
                    {openingCats.map((r, i) => (
                      <div key={i} className="flex items-center justify-between text-[11px]">
                        <span className="flex items-center gap-1.5 text-slate-500">
                          <span className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: OPENING_COLORS[r.category] || COLORS[i % COLORS.length] }} />
                          {r.category}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-600 font-semibold">{Number(r.calls).toLocaleString()}</span>
                          <ScoreBadge value={r.conv_pct} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </SectionCard>

            {/* Raw Opening Category Top 10 */}
            <SectionCard title="Top Opening Styles" accent={C_BLUE}
              downloadData={{ filename: 'opening_styles', rows: rawCats as unknown as Record<string, unknown>[] }}>
              {!rawCats.length || sec2Loading ? <Skeleton /> : (
                <HorizBars data={rawCats as unknown as Record<string, unknown>[]} labelKey="category" valueKey="calls" maxItems={10} />
              )}
            </SectionCard>

            {/* Opening by Dimension */}
            <SectionCard title="Opening Performance by Dimension" accent={C_BLUE}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] text-slate-500">Group by</span>
                <DimSelector value={openingDim} onChange={handleOpeningDim} />
              </div>
              {!openingByDim.length || sec2Loading ? <Skeleton /> : (
                <HorizBars data={openingByDim as unknown as Record<string, unknown>[]} labelKey="dim" valueKey="opening_good_pct" color={C_BLUE} maxItems={10} />
              )}
            </SectionCard>
          </div>
        </div>

        {/* ── Section 3: Context Intelligence ──────────────────────────── */}
        <div ref={sec3Ref}>
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2">
            <span className="w-4 h-px bg-slate-300" /> Section 3 — Context Setting Intelligence
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Context 4-bucket Pie */}
            <SectionCard title="Context Setting Category (Looker Buckets)" accent={C_TEAL}
              downloadData={{ filename: 'context_categories', rows: contextCats as unknown as Record<string, unknown>[] }}>
              {!contextCats.length || sec3Loading ? <Skeleton /> : (
                <div>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={contextCats} dataKey="calls" nameKey="category" cx="50%" cy="50%"
                        outerRadius={80} paddingAngle={2}>
                        {contextCats.map((r, i) => (
                          <Cell key={i} fill={CONTEXT_COLORS[r.category] || COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="mt-3 space-y-1.5">
                    {contextCats.map((r, i) => (
                      <div key={i} className="flex items-center justify-between text-[11px]">
                        <span className="flex items-center gap-1.5 text-slate-500 truncate max-w-[65%]" title={r.category}>
                          <span className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: CONTEXT_COLORS[r.category] || COLORS[i % COLORS.length] }} />
                          {r.category}
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-slate-600 font-semibold">{Number(r.calls).toLocaleString()}</span>
                          <ScoreBadge value={r.conv_pct} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </SectionCard>

            {/* Context Category Conversion Comparison */}
            <SectionCard title="Context → Conversion Rate" accent={C_TEAL}
              downloadData={{ filename: 'context_conversion', rows: contextCats as unknown as Record<string, unknown>[] }}>
              {!contextCats.length || sec3Loading ? <Skeleton /> : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={contextCats} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                    <CartesianGrid {...GRID_PROPS} horizontal={false} />
                    <XAxis type="number" tick={AXIS_TICK} domain={[0, 'auto']} unit="%" />
                    <YAxis type="category" dataKey="category" tick={{ ...AXIS_TICK, fontSize: 9 }} width={140} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: unknown) => [`${v}%`, 'Conv %']} />
                    <Bar dataKey="conv_pct" name="Conversion %" radius={[0, 4, 4, 0]}>
                      {contextCats.map((r, i) => (
                        <Cell key={i} fill={CONTEXT_COLORS[r.category] || COLORS[i % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </SectionCard>

            {/* Context by Dimension */}
            <SectionCard title="Context Setting by Dimension" accent={C_TEAL}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] text-slate-500">Group by</span>
                <DimSelector value={contextDim} onChange={handleContextDim} />
              </div>
              {!contextByDim.length || sec3Loading ? <Skeleton /> : (
                <HorizBars data={contextByDim as unknown as Record<string, unknown>[]} labelKey="dim" valueKey="context_set_pct" color={C_TEAL} maxItems={10} />
              )}
            </SectionCard>
          </div>
        </div>

        {/* ── Section 4: Opening vs Sales ───────────────────────────────── */}
        <div ref={sec4Ref}>
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2">
            <span className="w-4 h-px bg-slate-300" /> Section 4 — Opening Quality vs Sales Conversion
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Conversion by Opening Type */}
            <SectionCard title="Conversion Rate by Opening Style" accent={C_GREEN}
              downloadData={{ filename: 'opening_vs_sales', rows: vsSales as unknown as Record<string, unknown>[] }}>
              {!vsSales.length || sec4Loading ? <Skeleton h={220} /> : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={vsSales} margin={{ left: 0, right: 16, top: 4, bottom: 40 }}>
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis dataKey="opening_category" tick={AXIS_TICK} angle={-25} textAnchor="end" interval={0} />
                    <YAxis tick={AXIS_TICK} unit="%" />
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: unknown) => [`${v}%`, 'Conv %']} />
                    <Bar dataKey="conv_pct" name="Conversion %" radius={[4, 4, 0, 0]}>
                      {vsSales.map((r, i) => (
                        <Cell key={i} fill={OPENING_COLORS[r.opening_category] || COLORS[i % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </SectionCard>

            {/* Volume vs Conversion Scatter-style Bar */}
            <SectionCard title="Call Volume vs Conversion by Opening" accent={C_GREEN}>
              {!vsSales.length || sec4Loading ? <Skeleton h={220} /> : (
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={vsSales} margin={{ left: 0, right: 16, top: 4, bottom: 40 }}>
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis dataKey="opening_category" tick={AXIS_TICK} angle={-25} textAnchor="end" interval={0} />
                    <YAxis yAxisId="calls" orientation="left" tick={AXIS_TICK} />
                    <YAxis yAxisId="pct" orientation="right" tick={AXIS_TICK} unit="%" />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Bar yAxisId="calls" dataKey="calls" name="Calls" fill={C_BLUE} opacity={0.7} radius={[4, 4, 0, 0]} />
                    <Line yAxisId="pct" type="monotone" dataKey="conv_pct" name="Conv %" stroke={C_GREEN} strokeWidth={2} dot={{ r: 4 }} />
                    <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </SectionCard>
          </div>
        </div>

        {/* ── Section 5: Opening Trend ──────────────────────────────────── */}
        <div ref={sec5Ref}>
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2">
            <span className="w-4 h-px bg-slate-300" /> Section 5 — Opening Trend Analysis
          </h2>
          <SectionCard title="Opening Quality Trend" accent={C_PURPLE}
            downloadData={{ filename: 'opening_trend', rows: openingTrend as unknown as Record<string, unknown>[] }}>
            <div className="flex items-center justify-between mb-4">
              <PeriodSelector value={openingPeriod} onChange={handleOpeningPeriod} />
              <div className="flex gap-3 text-[10px] text-slate-500">
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-400 inline-block" /> Good Opening %</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-green-400 inline-block" /> Conv %</span>
              </div>
            </div>
            {!openingTrend.length || sec5Loading ? <Skeleton h={240} /> : (
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={openingTrend} margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="period" tick={AXIS_TICK} />
                  <YAxis yAxisId="calls" orientation="left" tick={AXIS_TICK} />
                  <YAxis yAxisId="pct" orientation="right" tick={AXIS_TICK} unit="%" domain={[0, 100]} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Bar yAxisId="calls" dataKey="calls" name="Calls" fill={C_PURPLE} opacity={0.5} radius={[2, 2, 0, 0]} />
                  <Line yAxisId="pct" type="monotone" dataKey="opening_good_pct" name="Good Opening %" stroke={C_BLUE} strokeWidth={2} dot={false} />
                  <Line yAxisId="pct" type="monotone" dataKey="conv_pct" name="Conv %" stroke={C_GREEN} strokeWidth={2} dot={false} />
                  <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </SectionCard>
        </div>

        {/* ── Section 6: Context Trend ──────────────────────────────────── */}
        <div ref={sec6Ref}>
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2">
            <span className="w-4 h-px bg-slate-300" /> Section 6 — Context Setting Trend
          </h2>
          <SectionCard title="Context Setting Trend" accent={C_TEAL}
            downloadData={{ filename: 'context_trend', rows: contextTrend as unknown as Record<string, unknown>[] }}>
            <div className="flex items-center justify-between mb-4">
              <PeriodSelector value={contextPeriod} onChange={handleContextPeriod} />
              <div className="flex gap-3 text-[10px] text-slate-500">
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-teal-400 inline-block" /> Context Set %</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-green-400 inline-block" /> Conv %</span>
              </div>
            </div>
            {!contextTrend.length || sec6Loading ? <Skeleton h={240} /> : (
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={contextTrend} margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="period" tick={AXIS_TICK} />
                  <YAxis yAxisId="calls" orientation="left" tick={AXIS_TICK} />
                  <YAxis yAxisId="pct" orientation="right" tick={AXIS_TICK} unit="%" domain={[0, 100]} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Bar yAxisId="calls" dataKey="calls" name="Calls" fill={C_TEAL} opacity={0.5} radius={[2, 2, 0, 0]} />
                  <Line yAxisId="pct" type="monotone" dataKey="context_set_pct" name="Context Set %" stroke={C_TEAL} strokeWidth={2} dot={false} />
                  <Line yAxisId="pct" type="monotone" dataKey="conv_pct" name="Conv %" stroke={C_GREEN} strokeWidth={2} dot={false} />
                  <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </SectionCard>
        </div>

        {/* ── Section 7: Opening Leaderboard ────────────────────────────── */}
        <div ref={sec7Ref}>
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2">
            <span className="w-4 h-px bg-slate-300" /> Section 7 — Opening Leaderboard
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4">
            {/* Top 10 Agents */}
            <SectionCard title="Top 10 Agents — Opening" accent={C_GREEN} className="xl:col-span-2"
              downloadData={{ filename: 'top_agents_opening', rows: (leaderboard?.top10Agents ?? []) as unknown as Record<string, unknown>[] }}>
              {!leaderboard || sec7Loading ? <Skeleton h={240} /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-200">
                        <th className="pb-2 text-left">#</th>
                        <th className="pb-2 text-left">Agent</th>
                        <th className="pb-2 text-right">Calls</th>
                        <th className="pb-2 text-right">Opening %</th>
                        <th className="pb-2 text-right">Score</th>
                        <th className="pb-2 text-right">Conv %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {(leaderboard?.top10Agents ?? []).map((r, i) => (
                        <tr key={i} className="hover:bg-slate-50 transition-colors">
                          <td className="py-1.5 text-slate-500 font-bold">{i + 1}</td>
                          <td className="py-1.5 text-slate-600 truncate max-w-[120px]" title={r.name}>{r.name}</td>
                          <td className="py-1.5 text-right text-slate-500">{Number(r.calls).toLocaleString()}</td>
                          <td className="py-1.5 text-right"><ScoreBadge value={r.opening_pct} /></td>
                          <td className="py-1.5 text-right">
                            <span className="font-semibold" style={{ color: pctColor(r.opening_score) }}>{Number(r.opening_score).toFixed(1)}</span>
                          </td>
                          <td className="py-1.5 text-right"><ScoreBadge value={r.conv_pct} /></td>
                        </tr>
                      ))}
                      {!leaderboard?.top10Agents.length && (
                        <tr><td colSpan={6} className="py-4 text-center text-slate-600">No data</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>

            {/* Bottom 5 Agents */}
            <SectionCard title="Bottom 5 — Needs Coaching" accent={C_RED}>
              {!leaderboard || sec7Loading ? <Skeleton h={200} /> : (
                <div className="space-y-2">
                  {(leaderboard?.bottom5Agents ?? []).map((r, i) => (
                    <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-red-900/10 border border-red-700/20">
                      <span className="text-red-400 font-bold text-[10px] w-4">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] text-slate-600 truncate">{r.name}</div>
                        <div className="text-[10px] text-slate-500">{Number(r.calls).toLocaleString()} calls</div>
                      </div>
                      <ScoreBadge value={r.opening_score} />
                    </div>
                  ))}
                  {!leaderboard?.bottom5Agents.length && <p className="text-[11px] text-slate-600 text-center py-4">No data</p>}
                </div>
              )}
            </SectionCard>

            {/* Top Clients / Campaigns */}
            <SectionCard title="Top Clients & Campaigns" accent={C_AMBER}>
              {!leaderboard || sec7Loading ? <Skeleton h={200} /> : (
                <div className="space-y-4">
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Clients</p>
                    <HorizBars data={(leaderboard?.topClients ?? []) as unknown as Record<string, unknown>[]} labelKey="name" valueKey="opening_pct" color={C_AMBER} maxItems={5} />
                  </div>
                  <div className="border-t border-slate-200 pt-3">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Campaigns</p>
                    <HorizBars data={(leaderboard?.topCampaigns ?? []) as unknown as Record<string, unknown>[]} labelKey="name" valueKey="opening_pct" color={C_PURPLE} maxItems={5} />
                  </div>
                </div>
              )}
            </SectionCard>
          </div>
        </div>

        {/* ── Section 8: AI Insights ────────────────────────────────────── */}
        <div ref={sec8Ref}>
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2">
            <span className="w-4 h-px bg-slate-300" /> Section 8 — AI Insights & Recommendations
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-3">
              {!insights.length || sec8Loading ? (
                <Skeleton h={120} />
              ) : insights.filter((_, i) => i % 2 === 0).map((ins, i) => (
                <InsightCard key={i} insight={ins} index={i * 2} />
              ))}
            </div>
            <div className="space-y-3">
              {!insights.length || sec8Loading ? (
                <Skeleton h={120} />
              ) : insights.filter((_, i) => i % 2 === 1).map((ins, i) => (
                <InsightCard key={i} insight={ins} index={i * 2 + 1} />
              ))}
            </div>
          </div>
          {!sec8Loading && insights.length === 0 && sec8Loaded.current && (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
              <Info size={16} className="text-slate-500" />
              <span className="text-[12px] text-slate-500">AI insights will appear once data is loaded.</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="text-center py-4">
          <span className="text-[10px] text-slate-700">Opening Intelligence — Module A · Call Master · MyDashboards</span>
        </div>
      </div>
    </div>
  );
}
