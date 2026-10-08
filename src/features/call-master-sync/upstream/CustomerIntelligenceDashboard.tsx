// @ts-nocheck
// AUTO-SYNCED from tausifansari-mcn/Mydashboards frontend/src/features/call-master/CustomerIntelligenceDashboard.tsx @ 4fbd5df - do not edit; run scripts/sync-mydashboards.mjs
import { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ComposedChart, Bar, Line, BarChart, PieChart, Pie, Cell,
  FunnelChart, Funnel, LabelList,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area, AreaChart,
} from 'recharts';
import {
  PhoneCall, TrendingUp, TrendingDown, Award, Users, ChevronLeft,
  RefreshCw, Download, Maximize2, X, Heart, ThumbsUp, ThumbsDown,
  Minus, AlertTriangle, CheckCircle, Target, Star, Zap, BarChart2,
  MessageCircle, Info, ShieldCheck,
} from 'lucide-react';
import { useAuthStore } from '../shim/authStore';
import api from '../shim/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CIExecSummary {
  totalCalls: number;
  satisfactionPct: number;
  positivePct: number;
  negativePct: number;
  neutralPct: number;
  offerAcceptPct: number;
  offerRejectionPct: number;
  trustScore: number;
  cxScore: number;
  happinessIndex: number;
  purchaseIntentPct: number;
}
interface SentimentRow   { sentiment: string; count: number; pct: number }
interface SentimentTrend { period: string; positive: number; negative: number; neutral: number; unknown: number; positive_pct: number; negative_pct: number }
interface FeedbackCat    { category: string; count: number; positive: number; negative: number; neutral: number; conv_pct: number }
interface SubCatRow      { subCategory: string; count: number; feedback: string }
interface ObjectionData  { objections: { reason: string; count: number }[]; notInterestedReasons: { reason: string; count: number }[] }
interface JourneyStage   { stage: string; icon: string; count: number; pct_of_total: number; dropoff_pct: number }
interface DimRow         { dim: string; calls: number; positive_pct: number; negative_pct: number; neutral_pct: number; satisfaction_score: number; conv_pct: number }
interface ClientComp     { client_id: string; calls: number; satisfaction_pct: number; positive_pct: number; negative_pct: number; offer_accept_pct: number; conv_pct: number; trust_score: number }
interface CampaignComp   { campaign: string; calls: number; satisfaction_pct: number; positive_pct: number; negative_pct: number; offer_accept_pct: number; conv_pct: number }
interface AgentRankData  { top10: AgentRank[]; bottom10: AgentRank[] }
interface AgentRank      { agent: string; calls: number; satisfaction_pct: number; positive_pct: number; negative_pct: number; offer_accept_pct: number; trust_score: number; conv_pct: number }
interface ProductFb      { product: string; calls: number; positive_pct: number; negative_pct: number; conv_pct: number }
interface AgentNPSCSAT   { agent: string; calls: number; positive_count: number; negative_count: number; neutral_count: number; positive_pct: number; negative_pct: number; neutral_pct: number; promoter: number; passive: number; detractor: number; csat: number; nps: number; conv_pct: number }
interface OfferingStage  { stage: string; count: number; pct: number }
interface AIInsight      { type: 'alert' | 'success' | 'opportunity'; priority: string; title: string; what: string; why: string; impact: string; action: string }

// ─── Design tokens ───────────────────────────────────────────────────────────

const C = {
  pos:    '#10B981',
  neg:    '#EF4444',
  neu:    '#F59E0B',
  unk:    '#64748B',
  blue:   '#3B82F6',
  purple: '#8B5CF6',
  teal:   '#06B6D4',
  pink:   '#EC4899',
};
const SENTIMENT_COLORS: Record<string, string> = {
  Positive: C.pos,
  Negative: C.neg,
  Neutral:  C.neu,
  Unknown:  C.unk,
};
const CHART_COLORS = [C.blue, C.pos, C.purple, C.neu, C.neg, C.teal, C.pink, '#6366F1'];
const TT  = { background: '#FFFFFF', border: '1px solid #334155', borderRadius: 8, fontSize: 12 };
const AX  = { fill: '#64748B', fontSize: 11 };
const GR  = { strokeDasharray: '3 3', stroke: '#FFFFFF' };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toLocalDT(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function pctColor(v: number) {
  if (v >= 70) return C.pos;
  if (v >= 40) return C.neu;
  return C.neg;
}

function negColor(v: number) {
  if (v <= 15) return C.pos;
  if (v <= 30) return C.neu;
  return C.neg;
}

function downloadCSV(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const h = Object.keys(rows[0]);
  const e = (v: unknown) => { const s = String(v ?? ''); return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [h.join(','), ...rows.map(r => h.map(k => e(r[k])).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${filename}.csv` });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── AnimatedNumber ───────────────────────────────────────────────────────────

function AnimNum({ value, dec = 0, suffix = '' }: { value: number; dec?: number; suffix?: string }) {
  const [d, setD] = useState(0);
  useEffect(() => {
    const end = value, dur = 1200, t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min((now - t0) / dur, 1);
      setD((1 - Math.pow(1 - p, 3)) * end);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [value]);
  return <span>{dec > 0 ? d.toFixed(dec) : Math.round(d).toLocaleString()}{suffix}</span>;
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KPICard({ label, value, suffix = '', dec = 0, icon, color, sub, trend, index }: {
  label: string; value: number; suffix?: string; dec?: number;
  icon: React.ReactNode; color: string; sub?: string;
  trend?: 'up' | 'down' | 'flat'; index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.4 }}
      className="relative bg-white shadow-sm rounded-xl p-4 flex flex-col gap-2 border border-slate-200 overflow-hidden"
    >
      <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl" style={{ backgroundColor: color }} />
      <div className="pl-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider leading-none">{label}</span>
          <div className="p-1.5 rounded-lg" style={{ backgroundColor: `${color}18` }}>
            <div style={{ color }}>{icon}</div>
          </div>
        </div>
        <div className="text-xl font-bold text-slate-900 tracking-tight whitespace-nowrap">
          <AnimNum value={value} suffix={suffix} dec={dec} />
        </div>
        <div className="flex items-center gap-1.5 mt-1">
          {sub && <span className="text-[10px] text-slate-500">{sub}</span>}
          {trend === 'up'   && <TrendingUp   size={10} className="text-green-400" />}
          {trend === 'down' && <TrendingDown  size={10} className="text-red-400"  />}
        </div>
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-px" style={{ background: `linear-gradient(90deg, ${color}40, transparent)` }} />
    </motion.div>
  );
}

// ─── Section Card ─────────────────────────────────────────────────────────────

function SCard({ title, children, className = '', accent = C.blue, dl }: {
  title: string; children: React.ReactNode; className?: string;
  accent?: string;
  dl?: { filename: string; rows: Record<string, unknown>[] };
}) {
  const [exp, setExp] = useState(false);
  useEffect(() => {
    if (!exp) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setExp(false); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [exp]);

  const hdr = (close?: () => void) => (
    <div className="flex items-center gap-2.5 px-5 py-3 border-b border-slate-200">
      <div className="w-1.5 h-4 rounded-full shrink-0" style={{ backgroundColor: accent }} />
      <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-widest flex-1">{title}</h3>
      {dl && dl.rows.length > 0 && (
        <button onClick={e => { e.stopPropagation(); downloadCSV(dl.filename, dl.rows); }}
          className="text-slate-600 hover:text-slate-600 transition-colors p-0.5 rounded">
          <Download size={13} />
        </button>
      )}
      {!close ? (
        <button onClick={e => { e.stopPropagation(); setExp(true); }} className="text-slate-600 hover:text-slate-600 transition-colors p-0.5 rounded">
          <Maximize2 size={13} />
        </button>
      ) : (
        <button onClick={close} className="text-slate-500 hover:text-slate-900 transition-colors p-0.5 rounded ml-1"><X size={15} /></button>
      )}
    </div>
  );

  return (
    <>
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className={`bg-white rounded-xl border border-slate-200 overflow-hidden ${className}`}>
        {hdr()} <div className="p-5">{children}</div>
      </motion.div>
      {exp && createPortal(
        <div className="fixed inset-0 flex items-center justify-center p-4 sm:p-6 bg-slate-100 backdrop-blur-sm"
          style={{ zIndex: 9999 }} onClick={() => setExp(false)}>
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-6xl flex flex-col overflow-hidden"
            style={{ maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
            {hdr(() => setExp(false))}
            <div className="p-6 overflow-auto flex-1">{children}</div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SK({ h = 200 }: { h?: number }) {
  return <div className="animate-pulse bg-slate-200 rounded-lg" style={{ height: h }} />;
}

// ─── HorizBars ────────────────────────────────────────────────────────────────

function HorizBars({ data, labelKey, valueKey, color, maxItems = 12, suffix = '' }: {
  data: Record<string, unknown>[]; labelKey: string; valueKey: string;
  color?: string; maxItems?: number; suffix?: string;
}) {
  const items = data.slice(0, maxItems);
  const max   = Math.max(...items.map(r => Number(r[valueKey]) || 0), 1);
  return (
    <div className="space-y-2">
      {items.map((r, i) => {
        const val = Number(r[valueKey]) || 0;
        const pct = (val / max) * 100;
        const bc  = color || CHART_COLORS[i % CHART_COLORS.length];
        return (
          <div key={i}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[11px] text-slate-500 truncate max-w-[70%]" title={String(r[labelKey])}>{String(r[labelKey])}</span>
              <span className="text-[11px] font-semibold shrink-0" style={{ color: bc }}>{Number(val).toLocaleString()}{suffix}</span>
            </div>
            <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
              <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.7, delay: i * 0.04 }}
                className="h-full rounded-full" style={{ backgroundColor: bc }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Period Selector ──────────────────────────────────────────────────────────

function PeriodSel({ value, onChange }: {
  value: string;
  onChange: (v: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly') => void;
}) {
  return (
    <div className="flex gap-1">
      {(['daily','weekly','monthly','quarterly','yearly'] as const).map(o => (
        <button key={o} onClick={() => onChange(o)}
          className={`px-2.5 py-1 rounded-md text-[10px] font-semibold capitalize transition-colors ${
            value === o ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:text-slate-900 border border-slate-200'
          }`}>{o}</button>
      ))}
    </div>
  );
}

// ─── Dim Selector ─────────────────────────────────────────────────────────────

function DimSel({ value, onChange }: {
  value: string;
  onChange: (v: 'client' | 'agent' | 'campaign') => void;
}) {
  return (
    <div className="flex gap-1">
      {(['client','agent','campaign'] as const).map(o => (
        <button key={o} onClick={() => onChange(o)}
          className={`px-2.5 py-1 rounded-md text-[10px] font-semibold capitalize transition-colors ${
            value === o ? 'bg-pink-600 text-white' : 'bg-slate-100 text-slate-600 hover:text-slate-900 border border-slate-200'
          }`}>{o}</button>
      ))}
    </div>
  );
}

// ─── AI Insight Card ──────────────────────────────────────────────────────────

function InsightCard({ insight, index }: { insight: AIInsight; index: number }) {
  const [open, setOpen] = useState(index === 0);
  const cfg = {
    alert:       { icon: <AlertTriangle size={14} />, color: C.neg,    label: 'Alert'       },
    success:     { icon: <CheckCircle   size={14} />, color: C.pos,    label: 'Positive'    },
    opportunity: { icon: <Target        size={14} />, color: C.neu,    label: 'Opportunity' },
  }[insight.type];
  const priColor = { high: C.neg, medium: C.neu, low: C.pos }[insight.priority] ?? C.unk;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.08 }}
      className="rounded-xl border overflow-hidden" style={{ borderColor: `${cfg.color}30`, background: `${cfg.color}10` }}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <span style={{ color: cfg.color }}>{cfg.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold text-slate-900 truncate">{insight.title}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px]" style={{ color: cfg.color }}>{cfg.label}</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ backgroundColor: `${priColor}20`, color: priColor }}>
              {insight.priority.toUpperCase()}
            </span>
          </div>
        </div>
        <span className="text-slate-500 shrink-0">{open ? '−' : '+'}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
            className="overflow-hidden border-t" style={{ borderColor: `${cfg.color}20` }}>
            <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                { k: 'What',   v: insight.what   },
                { k: 'Why',    v: insight.why    },
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

// ─── Journey Funnel ───────────────────────────────────────────────────────────

function JourneyFunnel({ stages }: { stages: JourneyStage[] }) {
  if (!stages.length) return <SK h={300} />;
  const max = stages[0]?.count || 1;
  return (
    <div className="space-y-1.5">
      {stages.map((s, i) => {
        const barW = Math.max((s.count / max) * 100, 2);
        const stageColor = i === stages.length - 1 ? C.pos : i === 0 ? C.blue : C.purple;
        return (
          <div key={i}>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[12px] w-5 shrink-0">{s.icon}</span>
              <span className="text-[11px] text-slate-600 flex-1">{s.stage}</span>
              <span className="text-[11px] font-bold" style={{ color: stageColor }}>{Number(s.count).toLocaleString()}</span>
              <span className="text-[10px] text-slate-500 w-10 text-right">{s.pct_of_total}%</span>
              {i > 0 && s.dropoff_pct > 0 && (
                <span className="text-[9px] text-red-400 w-14 text-right shrink-0">↓{s.dropoff_pct}%</span>
              )}
            </div>
            <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
              <motion.div initial={{ width: 0 }} animate={{ width: `${barW}%` }}
                transition={{ duration: 0.6, delay: i * 0.07 }}
                className="h-full rounded-full" style={{ backgroundColor: stageColor }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Sentiment Badge ──────────────────────────────────────────────────────────

function SentBadge({ sentiment }: { sentiment: string }) {
  const color = SENTIMENT_COLORS[sentiment] ?? C.unk;
  return (
    <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold"
      style={{ backgroundColor: `${color}20`, color }}>
      {sentiment}
    </span>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

function useSectionObserver(
  ref: React.RefObject<HTMLElement | null>,
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

export default function CustomerIntelligenceDashboard() {
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const now          = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const [startDT, setStartDT]   = useState(toLocalDT(firstOfMonth));
  const [endDT,   setEndDT]     = useState(toLocalDT(now));
  const [clientId, setClientId] = useState('');
  const [clients,  setClients]  = useState<{ id: number; name: string; dialdesk_client_id: number }[]>([]);

  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'>('daily');
  const [fbDim,  setFbDim]  = useState<'client' | 'agent' | 'campaign'>('agent');

  // Data
  const [summary,        setSummary]        = useState<CIExecSummary | null>(null);
  const [sentiment,      setSentiment]      = useState<SentimentRow[]>([]);
  const [sentTrend,      setSentTrend]      = useState<SentimentTrend[]>([]);
  const [fbCats,         setFbCats]         = useState<FeedbackCat[]>([]);
  const [fbSubCats,      setFbSubCats]      = useState<SubCatRow[]>([]);
  const [objections,     setObjections]     = useState<ObjectionData | null>(null);
  const [journey,        setJourney]        = useState<JourneyStage[]>([]);
  const [fbByDim,        setFbByDim]        = useState<DimRow[]>([]);
  const [clientComp,     setClientComp]     = useState<ClientComp[]>([]);
  const [campaignComp,   setCampaignComp]   = useState<CampaignComp[]>([]);
  const [agentRanking,   setAgentRanking]   = useState<AgentRankData | null>(null);
  const [productFb,      setProductFb]      = useState<ProductFb[]>([]);
  const [offeringFunnel, setOfferingFunnel] = useState<OfferingStage[]>([]);
  const [insights,       setInsights]       = useState<AIInsight[]>([]);
  const [agentNPSCSAT,   setAgentNPSCSAT]   = useState<AgentNPSCSAT[]>([]);
  const [ncsatSearch,    setNcsatSearch]    = useState('');
  const [ncsatSort,      setNcsatSort]      = useState<{ key: keyof AgentNPSCSAT; dir: 'asc' | 'desc' }>({ key: 'csat', dir: 'desc' });

  // Per-section loading states
  const [sumLoading,  setSumLoading]  = useState(true);
  const [sec2Loading, setSec2Loading] = useState(false);
  const [sec3Loading, setSec3Loading] = useState(false);
  const [sec4Loading, setSec4Loading] = useState(false);
  const [sec5Loading, setSec5Loading] = useState(false);
  const [sec6Loading, setSec6Loading] = useState(false);
  const [sec7Loading, setSec7Loading] = useState(false);
  const [sec8Loading, setSec8Loading] = useState(false);
  const [sec9Loading,  setSec9Loading]  = useState(false);
  const [sec10Loading, setSec10Loading] = useState(false);
  const [error,        setError]        = useState('');

  const isSingle = clients.length === 1;

  // Mutable refs so fetch callbacks never need recreation
  const startDTRef  = useRef(startDT);
  const endDTRef    = useRef(endDT);
  const clientIdRef = useRef(clientId);
  const periodRef   = useRef(period);
  const fbDimRef    = useRef(fbDim);
  startDTRef.current  = startDT;
  endDTRef.current    = endDT;
  clientIdRef.current = clientId;
  periodRef.current   = period;
  fbDimRef.current    = fbDim;

  // Section load-once flags
  const sec2Loaded = useRef(false);
  const sec3Loaded = useRef(false);
  const sec4Loaded = useRef(false);
  const sec5Loaded = useRef(false);
  const sec6Loaded = useRef(false);
  const sec7Loaded = useRef(false);
  const sec8Loaded = useRef(false);
  const sec9Loaded  = useRef(false);
  const sec10Loaded = useRef(false);

  // Section refs for IntersectionObserver
  const sec2Ref  = useRef<HTMLElement>(null);
  const sec3Ref  = useRef<HTMLElement>(null);
  const sec4Ref  = useRef<HTMLElement>(null);
  const sec5Ref  = useRef<HTMLElement>(null);
  const sec6Ref  = useRef<HTMLElement>(null);
  const sec7Ref  = useRef<HTMLElement>(null);
  const sec8Ref  = useRef<HTMLElement>(null);
  const sec9Ref  = useRef<HTMLElement>(null);
  const sec10Ref = useRef<HTMLElement>(null);

  const paramsRef = useRef(() => {
    const p: Record<string, string> = {
      startDate: startDTRef.current.replace('T', ' '),
      endDate:   endDTRef.current.replace('T', ' '),
    };
    if (clientIdRef.current) p.clientId = clientIdRef.current;
    return p;
  });

  useEffect(() => {
    api.get('/call-master/clients').then(r => {
      const list = r.data?.data ?? [];
      setClients(list);
      if (list.length === 1) setClientId(String(list[0].dialdesk_client_id));
    }).catch(() => {});
  }, []);

  const fetchSummary = useCallback(async () => {
    setSumLoading(true); setError('');
    try {
      const r = await api.get('/call-master/customer-intelligence/executive-summary', { params: paramsRef.current() });
      setSummary(r.data?.data ?? null);
    } catch { setError('Failed to load data.'); }
    finally   { setSumLoading(false); }
  }, []);

  const fetchSec2 = useCallback(() => {
    setSec2Loading(true);
    const p = paramsRef.current();
    Promise.all([
      api.get('/call-master/customer-intelligence/sentiment',       { params: p }),
      api.get('/call-master/customer-intelligence/sentiment-trend', { params: { ...p, period: periodRef.current } }),
    ]).then(([sR, tR]) => {
      setSentiment(sR.data?.data ?? []);
      setSentTrend(tR.data?.data ?? []);
    }).catch(() => {}).finally(() => setSec2Loading(false));
  }, []);

  const fetchSec3 = useCallback(() => {
    setSec3Loading(true);
    const p = paramsRef.current();
    Promise.all([
      api.get('/call-master/customer-intelligence/feedback-categories', { params: p }),
      api.get('/call-master/customer-intelligence/feedback-subcats',    { params: p }),
    ]).then(([fR, sR]) => {
      setFbCats(fR.data?.data ?? []);
      setFbSubCats(sR.data?.data ?? []);
    }).catch(() => {}).finally(() => setSec3Loading(false));
  }, []);

  const fetchSec4 = useCallback(() => {
    setSec4Loading(true);
    const p = paramsRef.current();
    Promise.all([
      api.get('/call-master/customer-intelligence/journey',         { params: p }),
      api.get('/call-master/customer-intelligence/offering-funnel', { params: p }),
    ]).then(([jR, oR]) => {
      setJourney(jR.data?.data ?? []);
      setOfferingFunnel(oR.data?.data ?? []);
    }).catch(() => {}).finally(() => setSec4Loading(false));
  }, []);

  const fetchSec5 = useCallback(() => {
    setSec5Loading(true);
    const p = paramsRef.current();
    Promise.all([
      api.get('/call-master/customer-intelligence/top-objections',  { params: p }),
      api.get('/call-master/customer-intelligence/feedback-by-dim', { params: { ...p, dim: fbDimRef.current } }),
    ]).then(([oR, dR]) => {
      setObjections(oR.data?.data ?? null);
      setFbByDim(dR.data?.data ?? []);
    }).catch(() => {}).finally(() => setSec5Loading(false));
  }, []);

  const fetchSec6 = useCallback(() => {
    setSec6Loading(true);
    api.get('/call-master/customer-intelligence/client-comparison', { params: paramsRef.current() })
      .then(r => setClientComp(r.data?.data ?? []))
      .catch(() => {}).finally(() => setSec6Loading(false));
  }, []);

  const fetchSec7 = useCallback(() => {
    setSec7Loading(true);
    api.get('/call-master/customer-intelligence/campaign-comparison', { params: paramsRef.current() })
      .then(r => setCampaignComp(r.data?.data ?? []))
      .catch(() => {}).finally(() => setSec7Loading(false));
  }, []);

  const fetchSec8 = useCallback(() => {
    setSec8Loading(true);
    const p = paramsRef.current();
    Promise.all([
      api.get('/call-master/customer-intelligence/agent-ranking',    { params: p }),
      api.get('/call-master/customer-intelligence/product-feedback', { params: p }),
    ]).then(([aR, pR]) => {
      setAgentRanking(aR.data?.data ?? null);
      setProductFb(pR.data?.data ?? []);
    }).catch(() => {}).finally(() => setSec8Loading(false));
  }, []);

  const fetchSec9 = useCallback(() => {
    setSec9Loading(true);
    api.get('/call-master/customer-intelligence/ai-insights', { params: paramsRef.current() })
      .then(r => setInsights(r.data?.data ?? []))
      .catch(() => {}).finally(() => setSec9Loading(false));
  }, []);

  const fetchSec10 = useCallback(() => {
    setSec10Loading(true);
    api.get('/call-master/customer-intelligence/agent-nps-csat', { params: paramsRef.current() })
      .then(r => setAgentNPSCSAT(r.data?.data ?? []))
      .catch(() => {}).finally(() => setSec10Loading(false));
  }, []);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  useSectionObserver(sec2Ref, fetchSec2, sec2Loaded);
  useSectionObserver(sec3Ref, fetchSec3, sec3Loaded);
  useSectionObserver(sec4Ref, fetchSec4, sec4Loaded);
  useSectionObserver(sec5Ref, fetchSec5, sec5Loaded);
  useSectionObserver(sec6Ref, fetchSec6, sec6Loaded);
  useSectionObserver(sec7Ref, fetchSec7, sec7Loaded);
  useSectionObserver(sec8Ref, fetchSec8, sec8Loaded);
  useSectionObserver(sec9Ref,  fetchSec9,  sec9Loaded);
  useSectionObserver(sec10Ref, fetchSec10, sec10Loaded);

  const handlePeriod = (p: typeof period) => {
    setPeriod(p); periodRef.current = p;
    if (sec2Loaded.current) {
      api.get('/call-master/customer-intelligence/sentiment-trend', { params: { ...paramsRef.current(), period: p } })
        .then(r => setSentTrend(r.data?.data ?? [])).catch(() => {});
    }
  };

  const handleDim = (d: typeof fbDim) => {
    setFbDim(d); fbDimRef.current = d;
    if (sec5Loaded.current) {
      api.get('/call-master/customer-intelligence/feedback-by-dim', { params: { ...paramsRef.current(), dim: d } })
        .then(r => setFbByDim(r.data?.data ?? [])).catch(() => {});
    }
  };

  const applyFilters = () => {
    fetchSummary();
    if (sec2Loaded.current) fetchSec2();
    if (sec3Loaded.current) fetchSec3();
    if (sec4Loaded.current) fetchSec4();
    if (sec5Loaded.current) fetchSec5();
    if (sec6Loaded.current) fetchSec6();
    if (sec7Loaded.current) fetchSec7();
    if (sec8Loaded.current) fetchSec8();
    if (sec9Loaded.current)  fetchSec9();
    if (sec10Loaded.current) fetchSec10();
  };

  return (
    <div className="min-h-screen text-slate-900">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3 flex-wrap">
          <button onClick={() => navigate('/call-master')}
            className="flex items-center gap-1.5 text-slate-500 hover:text-slate-900 transition-colors text-xs">
            <ChevronLeft size={16} /> Call Master
          </button>
          <div className="w-px h-4 bg-slate-300" />
          <Heart size={15} className="text-pink-400 shrink-0" />
          <div>
            <h1 className="text-sm font-bold text-slate-900 leading-none">Customer Intelligence</h1>
            <p className="text-[10px] text-slate-500 mt-0.5">Voice of Customer · Sentiment · Feedback · Buying Intent</p>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-pink-600/15 border border-pink-500/30 text-pink-400 text-[10px] font-semibold ml-auto">
            <MessageCircle size={11} /> Prompt B · VOC
          </div>
        </div>
        {/* Filter bar */}
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
          {!isSingle ? (
            <select value={clientId} onChange={e => setClientId(e.target.value)}
              className="border rounded-lg text-[11px] px-2.5 py-1.5 outline-none text-white"
              style={{ background: 'linear-gradient(135deg,#0D47A1,#1565C0)', borderColor: 'rgba(255,255,255,0.25)' }}>
              <option className="text-slate-900 bg-white" value="">All Process</option>
              {clients.map(c => <option className="text-slate-900 bg-white" key={c.id} value={c.dialdesk_client_id}>{c.name}</option>)}
            </select>
          ) : (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-pink-900/20 border border-pink-700/30 text-[11px] text-pink-300">
              {clients[0]?.name}
            </div>
          )}
          <button onClick={applyFilters} disabled={sumLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-pink-600 hover:bg-pink-700 text-slate-900 text-xs font-semibold transition-colors disabled:opacity-50">
            <RefreshCw size={12} className={sumLoading ? 'animate-spin' : ''} />
            {sumLoading ? 'Loading…' : 'Apply'}
          </button>
        </div>
      </div>

      {/* Error Banner */}
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

        {/* ─── Section 1: Executive Summary ─────────────────────────────── */}
        <section>
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2">
            <span className="w-4 h-px bg-slate-300" /> Section 1 — Executive Customer Summary
          </h2>
          {!summary || sumLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-5 xl:grid-cols-10 gap-3">
              {Array(10).fill(0).map((_, i) => <SK key={i} h={88} />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-5 xl:grid-cols-10 gap-3">
              <KPICard index={0} label="Total Calls"      value={summary?.totalCalls ?? 0}         icon={<PhoneCall    size={13}/>} color={C.blue}   />
              <KPICard index={1} label="Satisfaction %"   value={summary?.satisfactionPct ?? 0}    icon={<Star         size={13}/>} color={C.pos}   suffix="%" dec={1} />
              <KPICard index={2} label="Positive %"       value={summary?.positivePct ?? 0}        icon={<ThumbsUp     size={13}/>} color={C.pos}   suffix="%" dec={1} />
              <KPICard index={3} label="Negative %"       value={summary?.negativePct ?? 0}        icon={<ThumbsDown   size={13}/>} color={C.neg}   suffix="%" dec={1} />
              <KPICard index={4} label="Neutral %"        value={summary?.neutralPct ?? 0}         icon={<Minus        size={13}/>} color={C.neu}   suffix="%" dec={1} />
              <KPICard index={5} label="Offer Accept %"   value={summary?.offerAcceptPct ?? 0}     icon={<CheckCircle  size={13}/>} color={C.teal}  suffix="%" dec={1} />
              <KPICard index={6} label="Offer Reject %"   value={summary?.offerRejectionPct ?? 0}  icon={<X            size={13}/>} color={C.neg}   suffix="%" dec={1} />
              <KPICard index={7} label="Trust Score"      value={summary?.trustScore ?? 0}         icon={<ShieldCheck  size={13}/>} color={C.purple} suffix="/100" dec={1} />
              <KPICard index={8} label="CX Score"         value={summary?.cxScore ?? 0}            icon={<Zap          size={13}/>} color={C.pink}   suffix="/100" dec={1} />
              <KPICard index={9} label="Purchase Intent"  value={summary?.purchaseIntentPct ?? 0}  icon={<Target       size={13}/>} color={C.neu}   suffix="%" dec={1} />
            </div>
          )}
        </section>

        {/* ─── Section 2: Customer Sentiment ────────────────────────────── */}
        <section ref={sec2Ref}>
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2">
            <span className="w-4 h-px bg-slate-300" /> Section 2 — Customer Sentiment
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Donut */}
            <SCard title="Sentiment Distribution" accent={C.pos} dl={{ filename: 'sentiment', rows: sentiment as unknown as Record<string, unknown>[] }}>
              {!sentiment.length || sec2Loading ? <SK /> : (
                <div>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={sentiment} dataKey="count" nameKey="sentiment" cx="50%" cy="50%"
                        innerRadius={55} outerRadius={85} paddingAngle={3}>
                        {sentiment.map((r, i) => <Cell key={i} fill={SENTIMENT_COLORS[r.sentiment] ?? CHART_COLORS[i]} />)}
                      </Pie>
                      <Tooltip contentStyle={TT} formatter={(v: unknown) => [Number(v).toLocaleString(), 'Calls']} />
                      <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    {sentiment.map(r => (
                      <div key={r.sentiment} className="flex items-center justify-between p-2 rounded-lg bg-slate-100">
                        <span className="flex items-center gap-1.5 text-[11px] text-slate-600">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: SENTIMENT_COLORS[r.sentiment] ?? C.unk }} />
                          {r.sentiment}
                        </span>
                        <span className="text-[11px] font-bold" style={{ color: SENTIMENT_COLORS[r.sentiment] ?? C.unk }}>{r.pct}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </SCard>

            {/* Sentiment Trend */}
            <SCard title="Sentiment Trend" accent={C.blue} className="lg:col-span-2"
              dl={{ filename: 'sentiment_trend', rows: sentTrend as unknown as Record<string, unknown>[] }}>
              <div className="flex items-center justify-between mb-3">
                <PeriodSel value={period} onChange={handlePeriod} />
              </div>
              {!sentTrend.length || sec2Loading ? <SK h={200} /> : (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={sentTrend} margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
                    <CartesianGrid {...GR} />
                    <XAxis dataKey="period" tick={AX} />
                    <YAxis tick={AX} />
                    <Tooltip contentStyle={TT} />
                    <Area type="monotone" dataKey="positive" name="Positive" stroke={C.pos}  fill={`${C.pos}20`}  strokeWidth={2} stackId="a" />
                    <Area type="monotone" dataKey="neutral"  name="Neutral"  stroke={C.neu}  fill={`${C.neu}20`}  strokeWidth={2} stackId="a" />
                    <Area type="monotone" dataKey="negative" name="Negative" stroke={C.neg}  fill={`${C.neg}20`}  strokeWidth={2} stackId="a" />
                    <Area type="monotone" dataKey="unknown"  name="Unknown"  stroke={C.unk}  fill={`${C.unk}20`}  strokeWidth={1} stackId="a" />
                    <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </SCard>
          </div>
        </section>

        {/* ─── Section 3: Voice of Customer ─────────────────────────────── */}
        <section ref={sec3Ref}>
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2">
            <span className="w-4 h-px bg-slate-300" /> Section 3 — Voice of Customer (VOC)
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Feedback Categories */}
            <SCard title="Feedback Category Breakdown" accent={C.pink} className="lg:col-span-2"
              dl={{ filename: 'feedback_categories', rows: fbCats as unknown as Record<string, unknown>[] }}>
              {!fbCats.length || sec3Loading ? <SK h={240} /> : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={fbCats} margin={{ left: 0, right: 16, top: 4, bottom: 50 }}>
                    <CartesianGrid {...GR} />
                    <XAxis dataKey="category" tick={{ ...AX, fontSize: 9 }} angle={-30} textAnchor="end" interval={0} />
                    <YAxis tick={AX} />
                    <Tooltip contentStyle={TT} />
                    <Bar dataKey="positive" name="Positive" fill={C.pos}  radius={[2, 2, 0, 0]} stackId="s" />
                    <Bar dataKey="neutral"  name="Neutral"  fill={C.neu}  radius={[0, 0, 0, 0]} stackId="s" />
                    <Bar dataKey="negative" name="Negative" fill={C.neg}  radius={[2, 2, 0, 0]} stackId="s" />
                    <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </SCard>

            {/* Top SubCategories */}
            <SCard title="Top Feedback Sub-Categories" accent={C.pink}
              dl={{ filename: 'feedback_subcats', rows: fbSubCats as unknown as Record<string, unknown>[] }}>
              {!fbSubCats.length || sec3Loading ? <SK /> : (
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {fbSubCats.map((r, i) => (
                    <div key={i} className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-slate-500 truncate" title={r.subCategory}>{r.subCategory}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <SentBadge sentiment={r.feedback} />
                        <span className="text-[11px] font-semibold text-slate-600">{Number(r.count).toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SCard>
          </div>

          {/* Conversion by Feedback Category */}
          <div className="mt-4">
            <SCard title="Feedback Category → Conversion Rate" accent={C.pink}
              dl={{ filename: 'feedback_cat_conv', rows: fbCats as unknown as Record<string, unknown>[] }}>
              {!fbCats.length || sec3Loading ? <SK h={180} /> : (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={fbCats} layout="vertical" margin={{ left: 140, right: 40, top: 4, bottom: 4 }}>
                    <CartesianGrid {...GR} horizontal={false} />
                    <XAxis type="number" tick={AX} unit="%" domain={[0, 'auto']} />
                    <YAxis type="category" dataKey="category" tick={{ ...AX, fontSize: 9 }} width={140} />
                    <Tooltip contentStyle={TT} formatter={(v: unknown) => [`${v}%`, 'Conv %']} />
                    <Bar dataKey="conv_pct" name="Conv %" radius={[0, 4, 4, 0]} fill={C.teal} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </SCard>
          </div>
        </section>

        {/* ─── Section 4: Customer Journey ───────────────────────────────── */}
        <section ref={sec4Ref}>
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2">
            <span className="w-4 h-px bg-slate-300" /> Section 4 — Customer Journey & Offering Funnel
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SCard title="9-Stage Customer Journey Funnel" accent={C.blue}
              dl={{ filename: 'customer_journey', rows: journey as unknown as Record<string, unknown>[] }}>
              {!journey.length || sec4Loading ? <SK h={280} /> : <JourneyFunnel stages={journey} />}
            </SCard>

            <SCard title="Offering Funnel (Success vs Rejection)" accent={C.teal}
              dl={{ filename: 'offering_funnel', rows: offeringFunnel as unknown as Record<string, unknown>[] }}>
              {!offeringFunnel.length || sec4Loading ? <SK h={280} /> : (
                <div className="space-y-3 pt-2">
                  {offeringFunnel.map((s, i) => {
                    const max = offeringFunnel[0]?.count || 1;
                    const w   = Math.max((s.count / max) * 100, 2);
                    const bc  = i === 0 ? C.blue : i === 2 ? C.pos : i === 1 ? C.teal : C.neg;
                    return (
                      <div key={i}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] text-slate-600">{s.stage}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-bold" style={{ color: bc }}>{Number(s.count).toLocaleString()}</span>
                            <span className="text-[10px] text-slate-500">{s.pct}%</span>
                          </div>
                        </div>
                        <div className="h-3 bg-slate-200 rounded-full overflow-hidden">
                          <motion.div initial={{ width: 0 }} animate={{ width: `${w}%` }}
                            transition={{ duration: 0.7, delay: i * 0.1 }}
                            className="h-full rounded-full" style={{ backgroundColor: bc }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </SCard>
          </div>
        </section>

        {/* ─── Section 5: Feedback Intelligence ─────────────────────────── */}
        <section ref={sec5Ref}>
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2">
            <span className="w-4 h-px bg-slate-300" /> Section 5 — Feedback Intelligence
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Top Objections */}
            <SCard title="Customer Objections" accent={C.neg}
              dl={{ filename: 'objections', rows: (objections?.objections ?? []) as unknown as Record<string, unknown>[] }}>
              {!objections || sec5Loading ? <SK /> : (
                <HorizBars data={(objections?.objections ?? []) as unknown as Record<string, unknown>[]}
                  labelKey="reason" valueKey="count" color={C.neg} maxItems={10} />
              )}
            </SCard>

            {/* Not Interested Reasons */}
            <SCard title="Not Interested Reasons" accent={C.neu}
              dl={{ filename: 'not_interested', rows: (objections?.notInterestedReasons ?? []) as unknown as Record<string, unknown>[] }}>
              {!objections || sec5Loading ? <SK /> : (
                <HorizBars data={(objections?.notInterestedReasons ?? []) as unknown as Record<string, unknown>[]}
                  labelKey="reason" valueKey="count" color={C.neu} maxItems={10} />
              )}
            </SCard>
          </div>

          <div className="mt-4">
            <SCard title="Feedback Performance by Dimension" accent={C.purple}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] text-slate-500">Group by</span>
                <DimSel value={fbDim} onChange={handleDim} />
              </div>
              {!fbByDim.length || sec5Loading ? <SK h={240} /> : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={fbByDim.slice(0, 15)} margin={{ left: 0, right: 16, top: 4, bottom: 50 }}>
                    <CartesianGrid {...GR} />
                    <XAxis dataKey="dim" tick={{ ...AX, fontSize: 9 }} angle={-30} textAnchor="end" interval={0} />
                    <YAxis tick={AX} unit="%" />
                    <Tooltip contentStyle={TT} />
                    <Bar dataKey="positive_pct" name="Positive %" fill={C.pos}  radius={[2,2,0,0]} />
                    <Bar dataKey="negative_pct" name="Negative %" fill={C.neg}  radius={[2,2,0,0]} />
                    <Bar dataKey="neutral_pct"  name="Neutral %"  fill={C.neu}  radius={[2,2,0,0]} />
                    <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </SCard>
          </div>
        </section>

        {/* ─── Section 6: CX Heatmap (feedback category grid) ───────────── */}
        <section>
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2">
            <span className="w-4 h-px bg-slate-300" /> Section 6 — Customer Experience Heatmap
          </h2>
          <SCard title="Feedback Category — Positive vs Negative Heatmap" accent={C.pink}
            dl={{ filename: 'cx_heatmap', rows: fbCats as unknown as Record<string, unknown>[] }}>
            {!fbCats.length || sec3Loading ? <SK h={240} /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-slate-500 uppercase text-[9px] tracking-wider border-b border-slate-200">
                      <th className="pb-2 text-left">Category</th>
                      <th className="pb-2 text-right">Calls</th>
                      <th className="pb-2 text-right">Positive</th>
                      <th className="pb-2 text-right">Negative</th>
                      <th className="pb-2 text-right">Neutral</th>
                      <th className="pb-2 text-right">Conv %</th>
                      <th className="pb-2 text-left pl-3">Risk Level</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {fbCats.map((r, i) => {
                      const total  = r.positive + r.negative + r.neutral || 1;
                      const negPct = +(r.negative / total * 100).toFixed(0);
                      const risk   = negPct > 50 ? 'High' : negPct > 25 ? 'Medium' : 'Low';
                      const rc     = { High: C.neg, Medium: C.neu, Low: C.pos }[risk];
                      return (
                        <tr key={i} className="hover:bg-slate-50 transition-colors">
                          <td className="py-2 text-slate-600 truncate max-w-[160px]" title={r.category}>{r.category}</td>
                          <td className="py-2 text-right text-slate-500">{Number(r.count).toLocaleString()}</td>
                          <td className="py-2 text-right font-semibold" style={{ color: C.pos }}>{Number(r.positive).toLocaleString()}</td>
                          <td className="py-2 text-right font-semibold" style={{ color: C.neg }}>{Number(r.negative).toLocaleString()}</td>
                          <td className="py-2 text-right font-semibold" style={{ color: C.neu }}>{Number(r.neutral).toLocaleString()}</td>
                          <td className="py-2 text-right">
                            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold" style={{ backgroundColor: `${pctColor(r.conv_pct)}20`, color: pctColor(r.conv_pct) }}>
                              {r.conv_pct}%
                            </span>
                          </td>
                          <td className="py-2 pl-3">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ backgroundColor: `${rc}20`, color: rc }}>
                              {risk}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SCard>
        </section>

        {/* ─── Section 7: Client Comparison ─────────────────────────────── */}
        <section ref={sec6Ref}>
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2">
            <span className="w-4 h-px bg-slate-300" /> Section 7 — Client Comparison
          </h2>
          <SCard title="Client Customer Experience Ranking" accent={C.teal}
            dl={{ filename: 'client_comparison', rows: clientComp as unknown as Record<string, unknown>[] }}>
            {sec6Loading ? <SK h={200} /> : clientComp.length === 0 ? (
              <p className="text-[11px] text-slate-500 text-center py-6">Single client — comparison not available</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-slate-500 uppercase text-[9px] tracking-wider border-b border-slate-200">
                      <th className="pb-2 text-left">#</th>
                      <th className="pb-2 text-left">Client ID</th>
                      <th className="pb-2 text-right">Calls</th>
                      <th className="pb-2 text-right">Satisfaction</th>
                      <th className="pb-2 text-right">Positive %</th>
                      <th className="pb-2 text-right">Negative %</th>
                      <th className="pb-2 text-right">Offer Accept</th>
                      <th className="pb-2 text-right">Conv %</th>
                      <th className="pb-2 text-right">Trust Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {clientComp.map((r, i) => (
                      <tr key={i} className="hover:bg-slate-50 transition-colors">
                        <td className="py-1.5 text-slate-500 font-bold">{i + 1}</td>
                        <td className="py-1.5 text-slate-600 font-medium">{r.client_id}</td>
                        <td className="py-1.5 text-right text-slate-500">{Number(r.calls).toLocaleString()}</td>
                        <td className="py-1.5 text-right"><span className="font-bold" style={{ color: pctColor(r.satisfaction_pct) }}>{r.satisfaction_pct}%</span></td>
                        <td className="py-1.5 text-right font-semibold" style={{ color: C.pos }}>{r.positive_pct}%</td>
                        <td className="py-1.5 text-right font-semibold" style={{ color: negColor(r.negative_pct) }}>{r.negative_pct}%</td>
                        <td className="py-1.5 text-right"><span className="font-bold" style={{ color: pctColor(r.offer_accept_pct) }}>{r.offer_accept_pct}%</span></td>
                        <td className="py-1.5 text-right"><span className="font-bold" style={{ color: pctColor(r.conv_pct) }}>{r.conv_pct}%</span></td>
                        <td className="py-1.5 text-right"><span className="font-bold" style={{ color: pctColor(r.trust_score) }}>{r.trust_score}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SCard>
        </section>

        {/* ─── Section 8: Campaign Comparison ───────────────────────────── */}
        <section ref={sec7Ref}>
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2">
            <span className="w-4 h-px bg-slate-300" /> Section 8 — Campaign Comparison
          </h2>
          <SCard title="Campaign Customer Experience Ranking" accent={C.purple}
            dl={{ filename: 'campaign_comparison', rows: campaignComp as unknown as Record<string, unknown>[] }}>
            {!campaignComp.length || sec7Loading ? <SK h={200} /> : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-slate-500 uppercase text-[9px] tracking-wider border-b border-slate-200">
                        <th className="pb-2 text-left">#</th>
                        <th className="pb-2 text-left">Campaign</th>
                        <th className="pb-2 text-right">Calls</th>
                        <th className="pb-2 text-right">Satisfaction</th>
                        <th className="pb-2 text-right">Offer Accept</th>
                        <th className="pb-2 text-right">Conv %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {campaignComp.map((r, i) => (
                        <tr key={i} className="hover:bg-slate-50 transition-colors">
                          <td className="py-1.5 text-slate-500 font-bold">{i + 1}</td>
                          <td className="py-1.5 text-slate-600 truncate max-w-[120px]" title={r.campaign}>{r.campaign}</td>
                          <td className="py-1.5 text-right text-slate-500">{Number(r.calls).toLocaleString()}</td>
                          <td className="py-1.5 text-right font-bold" style={{ color: pctColor(r.satisfaction_pct) }}>{r.satisfaction_pct}%</td>
                          <td className="py-1.5 text-right font-bold" style={{ color: pctColor(r.offer_accept_pct) }}>{r.offer_accept_pct}%</td>
                          <td className="py-1.5 text-right font-bold" style={{ color: pctColor(r.conv_pct) }}>{r.conv_pct}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={campaignComp.slice(0, 10)} layout="vertical" margin={{ left: 80, right: 16, top: 4, bottom: 4 }}>
                    <CartesianGrid {...GR} horizontal={false} />
                    <XAxis type="number" tick={AX} unit="%" />
                    <YAxis type="category" dataKey="campaign" tick={{ ...AX, fontSize: 9 }} width={80} />
                    <Tooltip contentStyle={TT} />
                    <Bar dataKey="positive_pct" name="Positive %" fill={C.pos}  radius={[0,2,2,0]} stackId="a" />
                    <Bar dataKey="negative_pct" name="Negative %" fill={C.neg}  radius={[0,2,2,0]} stackId="b" />
                    <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </SCard>
        </section>

        {/* ─── Section 9: Agent CX Ranking ──────────────────────────────── */}
        <section ref={sec8Ref}>
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2">
            <span className="w-4 h-px bg-slate-300" /> Section 9 — Agent Customer Experience Ranking
          </h2>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* Top 10 */}
            <SCard title="Top 10 Agents — Customer Experience" accent={C.pos}
              dl={{ filename: 'agent_top10_cx', rows: (agentRanking?.top10 ?? []) as unknown as Record<string, unknown>[] }}>
              {!agentRanking || sec8Loading ? <SK h={260} /> : (
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-slate-500 uppercase text-[9px] tracking-wider border-b border-slate-200">
                      <th className="pb-2 text-left">#</th>
                      <th className="pb-2 text-left">Agent</th>
                      <th className="pb-2 text-right">Calls</th>
                      <th className="pb-2 text-right">Sat %</th>
                      <th className="pb-2 text-right">+ve</th>
                      <th className="pb-2 text-right">−ve</th>
                      <th className="pb-2 text-right">Trust</th>
                      <th className="pb-2 text-right">Conv</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {(agentRanking?.top10 ?? []).map((r, i) => (
                      <tr key={i} className="hover:bg-slate-50 transition-colors">
                        <td className="py-1.5 font-bold" style={{ color: i < 3 ? C.neu : '#64748B' }}>{i + 1}</td>
                        <td className="py-1.5 text-slate-600 truncate max-w-[100px]" title={r.agent}>{r.agent}</td>
                        <td className="py-1.5 text-right text-slate-500">{Number(r.calls).toLocaleString()}</td>
                        <td className="py-1.5 text-right font-bold" style={{ color: pctColor(r.satisfaction_pct) }}>{r.satisfaction_pct}%</td>
                        <td className="py-1.5 text-right font-semibold" style={{ color: C.pos }}>{r.positive_pct}%</td>
                        <td className="py-1.5 text-right font-semibold" style={{ color: negColor(r.negative_pct) }}>{r.negative_pct}%</td>
                        <td className="py-1.5 text-right font-bold" style={{ color: pctColor(r.trust_score) }}>{r.trust_score}</td>
                        <td className="py-1.5 text-right font-bold" style={{ color: pctColor(r.conv_pct) }}>{r.conv_pct}%</td>
                      </tr>
                    ))}
                    {!(agentRanking?.top10.length) && <tr><td colSpan={8} className="py-4 text-center text-slate-600">No data</td></tr>}
                  </tbody>
                </table>
              )}
            </SCard>

            {/* Bottom 10 */}
            <SCard title="Bottom 10 Agents — Needs Improvement" accent={C.neg}
              dl={{ filename: 'agent_bottom10_cx', rows: (agentRanking?.bottom10 ?? []) as unknown as Record<string, unknown>[] }}>
              {!agentRanking || sec8Loading ? <SK h={260} /> : (
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-slate-500 uppercase text-[9px] tracking-wider border-b border-slate-200">
                      <th className="pb-2 text-left">#</th>
                      <th className="pb-2 text-left">Agent</th>
                      <th className="pb-2 text-right">Calls</th>
                      <th className="pb-2 text-right">Sat %</th>
                      <th className="pb-2 text-right">+ve</th>
                      <th className="pb-2 text-right">−ve</th>
                      <th className="pb-2 text-right">Trust</th>
                      <th className="pb-2 text-right">Conv</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {(agentRanking?.bottom10 ?? []).map((r, i) => (
                      <tr key={i} className="hover:bg-red-900/[0.06] transition-colors">
                        <td className="py-1.5 text-red-500 font-bold">{i + 1}</td>
                        <td className="py-1.5 text-slate-600 truncate max-w-[100px]" title={r.agent}>{r.agent}</td>
                        <td className="py-1.5 text-right text-slate-500">{Number(r.calls).toLocaleString()}</td>
                        <td className="py-1.5 text-right font-bold" style={{ color: pctColor(r.satisfaction_pct) }}>{r.satisfaction_pct}%</td>
                        <td className="py-1.5 text-right font-semibold" style={{ color: C.pos }}>{r.positive_pct}%</td>
                        <td className="py-1.5 text-right font-semibold" style={{ color: negColor(r.negative_pct) }}>{r.negative_pct}%</td>
                        <td className="py-1.5 text-right font-bold" style={{ color: pctColor(r.trust_score) }}>{r.trust_score}</td>
                        <td className="py-1.5 text-right font-bold" style={{ color: pctColor(r.conv_pct) }}>{r.conv_pct}%</td>
                      </tr>
                    ))}
                    {!(agentRanking?.bottom10.length) && <tr><td colSpan={8} className="py-4 text-center text-slate-600">No data</td></tr>}
                  </tbody>
                </table>
              )}
            </SCard>
          </div>

          {/* Product Feedback */}
          <div className="mt-4">
            <SCard title="Product Feedback Analysis" accent={C.teal}
              dl={{ filename: 'product_feedback', rows: productFb as unknown as Record<string, unknown>[] }}>
              {!productFb.length || sec8Loading ? <SK h={200} /> : (
                <ResponsiveContainer width="100%" height={200}>
                  <ComposedChart data={productFb} margin={{ left: 0, right: 16, top: 4, bottom: 50 }}>
                    <CartesianGrid {...GR} />
                    <XAxis dataKey="product" tick={{ ...AX, fontSize: 9 }} angle={-30} textAnchor="end" interval={0} />
                    <YAxis yAxisId="calls" orientation="left"  tick={AX} />
                    <YAxis yAxisId="pct"   orientation="right" tick={AX} unit="%" />
                    <Tooltip contentStyle={TT} />
                    <Bar yAxisId="calls" dataKey="calls"        name="Calls"      fill={C.teal} opacity={0.6} radius={[2,2,0,0]} />
                    <Line yAxisId="pct"  dataKey="positive_pct" name="Positive %" stroke={C.pos} strokeWidth={2} dot={false} />
                    <Line yAxisId="pct"  dataKey="negative_pct" name="Negative %" stroke={C.neg} strokeWidth={2} dot={false} />
                    <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </SCard>
          </div>
        </section>

        {/* ─── Section 10: AI Insights ───────────────────────────────────── */}
        <section ref={sec9Ref}>
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2">
            <span className="w-4 h-px bg-slate-300" /> Section 10 — AI Insights & Recommendations
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-3">
              {!insights.length || sec9Loading ? <SK h={120} /> :
                insights.filter((_, i) => i % 2 === 0).map((ins, i) => <InsightCard key={i} insight={ins} index={i * 2} />)}
            </div>
            <div className="space-y-3">
              {!insights.length || sec9Loading ? <SK h={120} /> :
                insights.filter((_, i) => i % 2 === 1).map((ins, i) => <InsightCard key={i} insight={ins} index={i * 2 + 1} />)}
            </div>
          </div>
          {sec9Loaded.current && !sec9Loading && insights.length === 0 && (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
              <Info size={16} className="text-slate-500" />
              <span className="text-[12px] text-slate-500">AI insights will appear once data is loaded.</span>
            </div>
          )}
        </section>

        {/* ─── Section 11: Agent-wise NPS & CSAT ────────────────────────── */}
        <section ref={sec10Ref}>
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2">
            <span className="w-4 h-px bg-slate-300" /> Section 11 — Agent-wise NPS &amp; CSAT Analysis
          </h2>
          <SCard title="Agent NPS & CSAT Summary" accent={C.pink}
            dl={{ filename: 'agent_nps_csat', rows: agentNPSCSAT as unknown as Record<string, unknown>[] }}>
            <div className="flex items-center gap-2 mb-3">
              <input
                type="text" placeholder="Search agent…" value={ncsatSearch}
                onChange={e => setNcsatSearch(e.target.value)}
                className="flex-1 bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-[11px] text-slate-700 outline-none placeholder-slate-400"
              />
              <span className="text-[10px] text-slate-500 shrink-0">
                {agentNPSCSAT.filter(r => r.agent.toLowerCase().includes(ncsatSearch.toLowerCase())).length} agents
              </span>
            </div>
            {sec10Loading ? <SK h={260} /> : agentNPSCSAT.length === 0 ? (
              <p className="text-[11px] text-slate-500 text-center py-6">No data available</p>
            ) : (() => {
              const filtered = agentNPSCSAT
                .filter(r => r.agent.toLowerCase().includes(ncsatSearch.toLowerCase()))
                .slice().sort((a, b) => {
                  const av = a[ncsatSort.key] as number;
                  const bv = b[ncsatSort.key] as number;
                  return ncsatSort.dir === 'desc' ? bv - av : av - bv;
                });
              const thCls = 'pb-2 text-left cursor-pointer select-none hover:text-slate-700 transition-colors';
              const thR   = 'pb-2 text-right cursor-pointer select-none hover:text-slate-700 transition-colors';
              const sortIcon = (k: keyof AgentNPSCSAT) =>
                ncsatSort.key === k ? (ncsatSort.dir === 'desc' ? ' ↓' : ' ↑') : '';
              const handleSort = (k: keyof AgentNPSCSAT) =>
                setNcsatSort(s => ({ key: k, dir: s.key === k && s.dir === 'desc' ? 'asc' : 'desc' }));
              const npsColor = (v: number) => v >= 30 ? C.pos : v >= 0 ? C.neu : C.neg;
              return (
                <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
                  <table className="w-full text-[11px]">
                    <thead className="sticky top-0 bg-slate-100 z-10">
                      <tr className="text-slate-500 uppercase text-[9px] tracking-wider border-b border-slate-200">
                        <th className="pb-2 text-left">#</th>
                        <th className={thCls} onClick={() => handleSort('agent')}>Agent{sortIcon('agent')}</th>
                        <th className={thR} onClick={() => handleSort('calls')}>Calls{sortIcon('calls')}</th>
                        <th className={thR} onClick={() => handleSort('csat')}>CSAT %{sortIcon('csat')}</th>
                        <th className={thR} onClick={() => handleSort('nps')}>NPS{sortIcon('nps')}</th>
                        <th className={thR} onClick={() => handleSort('promoter')}>Promoter{sortIcon('promoter')}</th>
                        <th className={thR} onClick={() => handleSort('passive')}>Passive{sortIcon('passive')}</th>
                        <th className={thR} onClick={() => handleSort('detractor')}>Detractor{sortIcon('detractor')}</th>
                        <th className={thR} onClick={() => handleSort('conv_pct')}>Conv %{sortIcon('conv_pct')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {filtered.map((r, i) => (
                        <tr key={r.agent} className="hover:bg-slate-50 transition-colors">
                          <td className="py-1.5 text-slate-500 font-bold pr-2">{i + 1}</td>
                          <td className="py-1.5 text-slate-700 font-medium max-w-[120px] truncate" title={r.agent}>{r.agent}</td>
                          <td className="py-1.5 text-right text-slate-500">{Number(r.calls).toLocaleString()}</td>
                          <td className="py-1.5 text-right">
                            <span className="font-bold" style={{ color: pctColor(r.csat) }}>{r.csat}%</span>
                          </td>
                          <td className="py-1.5 text-right">
                            <span className="font-bold" style={{ color: npsColor(r.nps) }}>{r.nps > 0 ? '+' : ''}{r.nps}</span>
                          </td>
                          <td className="py-1.5 text-right">
                            <span className="font-semibold" style={{ color: C.pos }}>{Number(r.promoter).toLocaleString()}</span>
                            <span className="text-slate-600 ml-1">({r.positive_pct}%)</span>
                          </td>
                          <td className="py-1.5 text-right">
                            <span className="font-semibold" style={{ color: C.neu }}>{Number(r.passive).toLocaleString()}</span>
                            <span className="text-slate-600 ml-1">({r.neutral_pct}%)</span>
                          </td>
                          <td className="py-1.5 text-right">
                            <span className="font-semibold" style={{ color: negColor(r.negative_pct) }}>{Number(r.detractor).toLocaleString()}</span>
                            <span className="text-slate-600 ml-1">({r.negative_pct}%)</span>
                          </td>
                          <td className="py-1.5 text-right">
                            <span className="font-bold" style={{ color: pctColor(r.conv_pct) }}>{r.conv_pct}%</span>
                          </td>
                        </tr>
                      ))}
                      {filtered.length === 0 && (
                        <tr><td colSpan={9} className="py-4 text-center text-slate-600">No matching agents</td></tr>
                      )}
                    </tbody>
                    {/* Footer totals */}
                    {filtered.length > 0 && (() => {
                      const totCalls    = filtered.reduce((s, r) => s + r.calls, 0);
                      const totPromoter = filtered.reduce((s, r) => s + r.promoter, 0);
                      const totDetractor= filtered.reduce((s, r) => s + r.detractor, 0);
                      const totPassive  = filtered.reduce((s, r) => s + r.passive, 0);
                      const totKnown    = totPromoter + totDetractor + totPassive;
                      const avgCSAT     = totKnown ? +((totPromoter / totKnown) * 100).toFixed(1) : 0;
                      const avgNPS      = totCalls  ? +(((totPromoter - totDetractor) / totCalls) * 100).toFixed(1) : 0;
                      return (
                        <tfoot>
                          <tr className="border-t border-slate-200 text-[10px] font-bold text-slate-500">
                            <td></td>
                            <td className="py-2">Total / Avg</td>
                            <td className="py-2 text-right">{totCalls.toLocaleString()}</td>
                            <td className="py-2 text-right" style={{ color: pctColor(avgCSAT) }}>{avgCSAT}%</td>
                            <td className="py-2 text-right" style={{ color: npsColor(avgNPS) }}>{avgNPS > 0 ? '+' : ''}{avgNPS}</td>
                            <td className="py-2 text-right" style={{ color: C.pos }}>{totPromoter.toLocaleString()}</td>
                            <td className="py-2 text-right" style={{ color: C.neu }}>{totPassive.toLocaleString()}</td>
                            <td className="py-2 text-right" style={{ color: C.neg }}>{totDetractor.toLocaleString()}</td>
                            <td></td>
                          </tr>
                        </tfoot>
                      );
                    })()}
                  </table>
                </div>
              );
            })()}
          </SCard>
        </section>

        <div className="text-center py-4">
          <span className="text-[10px] text-slate-700">Customer Intelligence — Prompt B · Outbound Sales Intelligence · MyDashboards</span>
        </div>
      </div>
    </div>
  );
}
