// @ts-nocheck
// AUTO-SYNCED from tausifansari-mcn/Mydashboards frontend/src/features/call-master/CallMasterDashboard.tsx @ 4fbd5df - do not edit; run scripts/sync-mydashboards.mjs
import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import {
  PhoneCall, CheckCircle, Shield, Heart, TrendingUp,
  Users, UserCheck, AlertCircle, Calendar,
  RefreshCw, ChevronDown, Award, ThumbsDown, Lock, X, Info, Download, Maximize2,
} from 'lucide-react';
import { useAuthStore } from '../shim/authStore';
import api from '../shim/api';

// ─── Types ───────────────────────────────────────────────────────────────────

interface KPIs {
  totalCalls: number;
  totalAudited: number;
  qualityScore: number;
  fatalScore: number;
  customerExperience: number;
  compliance: number;
  salesConversion: number;
  outboundQuality: number;
  activeClients: number;
  activeAgents: number;
}

interface ClientItem { id: number; name: string; dialdesk_client_id: number }
interface TrendRow   { period: string; quality: number; calls: number; fatal: number }
interface FunnelRow  { stage: string; value: number; pct: number }
interface CXParamRow { parameter: string; key: string; score: number }
interface ScenarioRow { name: string; value: number }
interface CXData { inbound: CXParamRow[]; outbound: CXParamRow[]; scenario: ScenarioRow[] }
interface AgentRow    { agent: string; calls: number; quality: number; compliance: number; fatal_rate: number }
interface AgentParamRow { parameter: string; key: string; score: number }
interface HourRow    { hour: string; inbound: number; outbound: number; total: number }
interface DayRow     { day: string; inbound: number; outbound: number }
interface ClientRow        { client_name: string; audited?: number; quality?: number; calls?: number; sales?: number }
interface ActiveAgentItem  { agent: string; calls: number; quality: number; clients: string; lob: string }
interface ProcessListItem  { process_name: string; lob: string; client_name: string; total_calls: number; quality_score: number | null; fatal_calls: number; fatal_rate: number | null }
interface FatalDayRow      { day: string; fatal_calls: number }
interface AgentAuditRow    { agent: string; audit_count: number; cq_score: number; fatal_count: number; fatal_pct: number; tq_count: number; mq_count: number; bq_count: number }

// ─── Export Column Metadata ───────────────────────────────────────────────────

interface ExportColMeta { key: string; label: string; group: string }

const IB_EXPORT_COLS: ExportColMeta[] = [
  { key: 'CallDate',    label: 'Date',              group: 'Call Info' },
  { key: 'User',        label: 'Agent',             group: 'Call Info' },
  { key: 'Client',      label: 'Client',            group: 'Call Info' },
  { key: 'QualityScore', label: 'Quality Score (%)', group: 'Call Info' },
  { key: 'scenario',    label: 'Scenario',          group: 'Call Info' },
  { key: 'scenario1',   label: 'Sub-Scenario',      group: 'Call Info' },
  { key: 'call_answered_within_5_seconds',    label: 'Answered ≤5s',          group: 'Quality Parameters' },
  { key: 'customer_concern_acknowledged',     label: 'Concern Acknowledged',   group: 'Quality Parameters' },
  { key: 'professionalism_maintained',        label: 'Professionalism',        group: 'Quality Parameters' },
  { key: 'assurance_or_appreciation_provided', label: 'Assurance',            group: 'Quality Parameters' },
  { key: 'pronunciation_and_clarity',         label: 'Pronunciation & Clarity', group: 'Quality Parameters' },
  { key: 'enthusiasm_and_no_fumbling',        label: 'Enthusiasm',             group: 'Quality Parameters' },
  { key: 'active_listening',                  label: 'Active Listening',       group: 'Quality Parameters' },
  { key: 'politeness_and_no_sarcasm',         label: 'Politeness',             group: 'Quality Parameters' },
  { key: 'proper_grammar',                    label: 'Proper Grammar',         group: 'Quality Parameters' },
  { key: 'accurate_issue_probing',            label: 'Issue Probing',          group: 'Quality Parameters' },
  { key: 'proper_hold_procedure',             label: 'Hold Procedure',         group: 'Quality Parameters' },
  { key: 'proper_transfer_and_language',      label: 'Transfer & Language',    group: 'Quality Parameters' },
  { key: 'dead_air_under_10_seconds',         label: 'Dead Air <10s',          group: 'Quality Parameters' },
  { key: 'case_escalated_correctly',          label: 'Escalation',             group: 'Quality Parameters' },
  { key: 'address_recorded_completely',       label: 'Address Recorded',       group: 'Quality Parameters' },
  { key: 'correct_and_complete_information',  label: 'Correct Info',           group: 'Quality Parameters' },
  { key: 'upselling_or_offers_suggested',     label: 'Upselling',              group: 'Quality Parameters' },
  { key: 'further_assistance_offered',        label: 'Further Assistance',     group: 'Quality Parameters' },
  { key: 'proper_call_closure',               label: 'Call Closure',           group: 'Quality Parameters' },
];

const OB_EXPORT_COLS: ExportColMeta[] = [
  { key: 'CallDate',       label: 'Date',              group: 'Call Info' },
  { key: 'AgentName',      label: 'Agent',             group: 'Call Info' },
  { key: 'Client',         label: 'Client',            group: 'Call Info' },
  { key: 'LengthSec',      label: 'Duration (sec)',    group: 'Call Info' },
  { key: 'CallDisposition', label: 'Disposition',      group: 'Call Info' },
  { key: 'StartTime',      label: 'Start Time',        group: 'Call Info' },
  { key: 'EndTime',        label: 'End Time',          group: 'Call Info' },
  { key: 'Opening',             label: 'Opening',           group: 'Quality' },
  { key: 'Offered',             label: 'Offer Presented',   group: 'Quality' },
  { key: 'ObjectionHandling',   label: 'Objection Handling', group: 'Quality' },
  { key: 'PrepaidPitch',        label: 'Prepaid Pitch',     group: 'Quality' },
  { key: 'UpsellingEfforts',    label: 'Upselling Efforts', group: 'Quality' },
  { key: 'OfferUrgency',        label: 'Offer Urgency',     group: 'Quality' },
  { key: 'SensitiveWordUsed',   label: 'Sensitive Words',   group: 'Quality' },
  { key: 'OBQuality',           label: 'OB Quality (%)',    group: 'Quality' },
  { key: 'SaleDone',       label: 'Sale Done',         group: 'Sales' },
  { key: 'ProductOffering', label: 'Product',          group: 'Sales' },
  { key: 'DiscountType',   label: 'Discount Type',     group: 'Sales' },
  { key: 'Category',       label: 'Category',          group: 'Sales' },
  { key: 'SubCategory',    label: 'Sub Category',      group: 'Sales' },
  { key: 'Feedback',            label: 'Feedback',          group: 'Feedback' },
  { key: 'Feedback_Category',   label: 'Feedback Category', group: 'Feedback' },
  { key: 'AreaForImprovement',  label: 'Area for Improvement', group: 'Feedback' },
  { key: 'SensitiveWordContext', label: 'Sensitive Word Context', group: 'Feedback' },
  { key: 'NotInterestedBucketReason', label: 'Not Interested Reason', group: 'Feedback' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const COLORS = ['#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#06B6D4', '#EC4899', '#6366F1'];
const COLOR_GREEN = '#10B981';
const COLOR_BLUE = '#3B82F6';
const COLOR_PURPLE = '#8B5CF6';
const COLOR_AMBER = '#F59E0B';
const COLOR_RED = '#EF4444';

// Returns YYYY-MM-DDTHH:MM using LOCAL time (needed for datetime-local inputs)
function toLocalDT(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function downloadCSV(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function fmt(n: number, dec = 1) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(dec)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(dec)}K`;
  return n.toLocaleString();
}

function pctColor(v: number) {
  if (v >= 80) return COLOR_GREEN;
  if (v >= 60) return COLOR_AMBER;
  return COLOR_RED;
}

// ─── Animated Counter ─────────────────────────────────────────────────────────

function AnimatedNumber({ value, suffix = '', dec = 0 }: { value: number; suffix?: string; dec?: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const start = 0;
    const end = value;
    const duration = 1200;
    const startTime = performance.now();
    const step = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(start + (end - start) * eased);
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [value]);
  return <span>{dec > 0 ? display.toFixed(dec) : Math.round(display).toLocaleString()}{suffix}</span>;
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

interface KPICardProps {
  label: string;
  value: number;
  suffix?: string;
  dec?: number;
  icon: React.ReactNode;
  color: string;
  sub?: string;
  index: number;
  onClick?: () => void;
}

function KPICard({ label, value, suffix, dec, icon, color, sub, index, onClick }: KPICardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.4 }}
      whileHover={{ y: -4, boxShadow: `0 16px 40px ${color}28` }}
      onClick={onClick}
      className={`relative bg-white rounded-2xl overflow-hidden group transition-colors duration-200 ${onClick ? 'cursor-pointer' : ''}`}
      style={{ border: `2px solid ${color}30`, borderTopWidth: 4, borderTopColor: color }}
    >
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none"
           style={{ background: `linear-gradient(145deg, ${color}0a, transparent)` }} />
      <div className="relative p-4">
        <div className="flex items-start justify-between mb-3">
          <span className="text-[10px] font-black text-slate-700 uppercase tracking-[0.12em] leading-none pr-2">{label}</span>
          <div className="flex items-center gap-1.5">
            {onClick && <Info size={11} className="text-slate-500 group-hover:text-slate-600 transition-colors" />}
            <div className="p-2 rounded-xl shrink-0 group-hover:scale-110 transition-transform duration-200 shadow-sm"
                 style={{ backgroundColor: `${color}18`, color }}>
              {icon}
            </div>
          </div>
        </div>
        <div className="text-[28px] font-black text-slate-900 tracking-tight leading-none mb-2">
          <AnimatedNumber value={value} suffix={suffix} dec={dec} />
        </div>
        {sub && (
          <div className="flex items-center gap-1.5">
            <div className="w-1 h-1 rounded-full shrink-0" style={{ backgroundColor: color }} />
            <span className="text-[11px] text-slate-600 font-semibold">{sub}</span>
          </div>
        )}
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-[3px] opacity-60 group-hover:opacity-100 transition-opacity duration-200"
           style={{ background: `linear-gradient(90deg, ${color}, ${color}40)` }} />
    </motion.div>
  );
}

// ─── Section Card ─────────────────────────────────────────────────────────────

function SectionCard({ title, children, className = '', accent = COLOR_BLUE, description, onInfoClick, downloadData }: {
  title: string;
  children: React.ReactNode;
  className?: string;
  accent?: string;
  description?: string;
  onInfoClick?: () => void;
  downloadData?: { filename: string; rows: Record<string, unknown>[] };
}) {
  const [tipOpen, setTipOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  const handleInfo = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onInfoClick) { onInfoClick(); return; }
    if (description) setTipOpen(v => !v);
  };

  const cardHeader = (onClose?: () => void) => (
    <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-100"
         style={{ background: `linear-gradient(90deg, ${accent}08, transparent)` }}>
      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: accent }} />
      <h3 className="text-[11px] font-black text-slate-800 uppercase tracking-[0.1em] flex-1">{title}</h3>
      {downloadData && downloadData.rows.length > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); downloadCSV(downloadData.filename, downloadData.rows); }}
          title="Download CSV"
          className="text-slate-600 hover:text-slate-600 transition-colors p-0.5 rounded"
        >
          <Download size={13} />
        </button>
      )}
      {(description || onInfoClick) && !onClose && (
        <button onClick={handleInfo} className="text-slate-600 hover:text-slate-600 transition-colors p-0.5 rounded">
          <Info size={13} />
        </button>
      )}
      {!onClose && (
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
          title="Expand chart"
          className="text-slate-600 hover:text-slate-600 transition-colors p-0.5 rounded"
        >
          <Maximize2 size={13} />
        </button>
      )}
      {onClose && (
        <button onClick={onClose} className="text-slate-500 hover:text-slate-900 transition-colors p-0.5 rounded ml-1">
          <X size={15} />
        </button>
      )}
    </div>
  );

  const modal = createPortal(
    <AnimatePresence>
      {expanded && (
        <motion.div
          key="chart-expand-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-100 backdrop-blur-sm"
          onClick={() => setExpanded(false)}
        >
          <motion.div
            key="chart-expand-card"
            initial={{ opacity: 0, scale: 0.95, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-6xl flex flex-col overflow-hidden"
            style={{ maxHeight: '90vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            {cardHeader(() => setExpanded(false))}
            {description && (
              <div className="px-5 py-2.5 bg-blue-500/5 border-b border-blue-500/10 text-xs text-slate-500 leading-relaxed">
                {description}
              </div>
            )}
            <div className="p-6 overflow-auto flex-1 chart-expand-modal">
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className={`bg-white rounded-2xl overflow-hidden transition-shadow duration-200 ${className}`}
        style={{ border: `2px solid ${accent}22`, borderTopWidth: 4, borderTopColor: accent }}
        whileHover={{ boxShadow: `0 8px 30px ${accent}18` }}
      >
        {cardHeader()}
        <AnimatePresence>
          {tipOpen && description && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="px-5 py-3 bg-blue-500/5 border-b border-blue-500/10 text-xs text-slate-500 leading-relaxed">
                {description}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="p-5">
          {children}
        </div>
      </motion.div>
      {modal}
    </>
  );
}

// ─── Filter Bar ───────────────────────────────────────────────────────────────

interface Filters {
  startDate: string;
  endDate: string;
  clientId: string;
  lob: string;
  period: string;
}

function FilterBar({
  filters, clients, onChange, onRefresh, loading,
}: {
  filters: Filters;
  clients: ClientItem[];
  onChange: (k: keyof Filters, v: string) => void;
  onRefresh: () => void;
  loading: boolean;
}) {
  // If the API returned exactly 1 client, this user is tenant-scoped — lock the client filter
  const isTenantLocked = clients.length === 1;
  const lockedClient = isTenantLocked ? clients[0] : null;

  return (
    <div className="flex flex-wrap gap-3 items-center">
      {/* Date + time range — two separate labeled inputs */}
      <div className="date-pill">
        <Calendar size={13} className="shrink-0" style={{ color: 'rgba(255,255,255,0.75)' }} />
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] uppercase tracking-wider leading-none" style={{ color: 'rgba(255,255,255,0.65)' }}>From</span>
          <input
            type="datetime-local"
            value={filters.startDate}
            onChange={(e) => onChange('startDate', e.target.value)}
            className="bg-transparent text-xs outline-none text-white [color-scheme:dark]"
          />
        </div>
        <span className="mx-1 self-center" style={{ color: 'rgba(255,255,255,0.40)' }}>—</span>
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] uppercase tracking-wider leading-none" style={{ color: 'rgba(255,255,255,0.65)' }}>To</span>
          <input
            type="datetime-local"
            value={filters.endDate}
            onChange={(e) => onChange('endDate', e.target.value)}
            className="bg-transparent text-xs outline-none text-white [color-scheme:dark]"
          />
        </div>
      </div>

      {/* Client filter — locked badge for tenant users, dropdown for super admin */}
      {isTenantLocked ? (
        <div className="flex items-center gap-2 bg-white border border-blue-500/40 rounded-lg px-3 py-2">
          <Lock size={12} className="text-blue-400 shrink-0" />
          <span className="text-sm text-blue-300 font-medium">{lockedClient!.name}</span>
        </div>
      ) : (
        <div className="relative">
          <select
            value={filters.clientId}
            onChange={(e) => onChange('clientId', e.target.value)}
            className="appearance-none bg-white border border-slate-200 text-sm text-slate-700 rounded-lg px-3 py-2 pr-8 outline-none"
          >
            <option className="text-slate-900 bg-white" value="">All Process</option>
            {clients.map((c) => (
              <option className="text-slate-900 bg-white" key={c.id} value={c.dialdesk_client_id}>{c.name}</option>
            ))}
          </select>
          <ChevronDown size={12} className="absolute right-2 top-3 text-slate-500 pointer-events-none" />
        </div>
      )}

      {/* LOB */}
      <div className="relative">
        <select
          value={filters.lob}
          onChange={(e) => onChange('lob', e.target.value)}
          className="appearance-none bg-white border border-slate-200 text-sm text-slate-700 rounded-lg px-3 py-2 pr-8 outline-none"
        >
          <option className="text-slate-900 bg-white" value="All">All LOBs</option>
          <option className="text-slate-900 bg-white" value="Inbound">Inbound</option>
          <option className="text-slate-900 bg-white" value="Outbound">Outbound</option>
        </select>
        <ChevronDown size={12} className="absolute right-2 top-3 text-slate-500 pointer-events-none" />
      </div>

      {/* Period */}
      <div className="relative">
        <select
          value={filters.period}
          onChange={(e) => onChange('period', e.target.value)}
          className="appearance-none bg-white border border-slate-200 text-sm text-slate-700 rounded-lg px-3 py-2 pr-8 outline-none"
        >
          <option className="text-slate-900 bg-white" value="daily">Daily</option>
          <option className="text-slate-900 bg-white" value="weekly">Weekly</option>
          <option className="text-slate-900 bg-white" value="monthly">Monthly</option>
        </select>
        <ChevronDown size={12} className="absolute right-2 top-3 text-slate-500 pointer-events-none" />
      </div>

      <motion.button
        whileTap={{ scale: 0.95 }}
        onClick={onRefresh}
        disabled={loading}
        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-slate-900 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
      >
        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        {loading ? 'Loading...' : 'Refresh'}
      </motion.button>
    </div>
  );
}

// ─── Funnel Bar ──────────────────────────────────────────────────────────────

function FunnelBar({ row, max }: { row: FunnelRow; max: number }) {
  const width = max > 0 ? (row.value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-36 text-xs text-slate-500 text-right shrink-0">{row.stage}</div>
      <div className="flex-1 bg-slate-100 rounded-full h-6 overflow-hidden">
        <motion.div
          className="h-6 rounded-full flex items-center justify-end pr-2"
          style={{ backgroundColor: COLOR_BLUE }}
          initial={{ width: 0 }}
          animate={{ width: `${width}%` }}
          transition={{ duration: 0.8 }}
        >
          <span className="text-xs text-slate-900 font-bold">{fmt(row.value)}</span>
        </motion.div>
      </div>
      <div className="w-12 text-xs text-slate-500 shrink-0">{row.pct}%</div>
    </div>
  );
}

// ─── Detail Drawer ────────────────────────────────────────────────────────────

function DetailDrawer({ open, onClose, title, description, children }: {
  open: boolean; onClose: () => void; title: string; description: string; children?: React.ReactNode;
}) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-100 z-40 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 w-full max-w-lg bg-white border-l border-slate-200 z-50 flex flex-col shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200">
              <div>
                <h2 className="text-base font-semibold text-slate-900">{title}</h2>
              </div>
              <button onClick={onClose} className="mt-0.5 text-slate-500 hover:text-slate-900 transition-colors p-1 rounded-lg hover:bg-slate-100">
                <X size={16} />
              </button>
            </div>
            {/* Description */}
            <div className="px-6 py-3 bg-blue-500/5 border-b border-slate-200">
              <p className="text-xs text-slate-500 leading-relaxed">{description}</p>
            </div>
            {/* Content */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── Pareto Chart ─────────────────────────────────────────────────────────────

function ParetoChart({ data }: { data: CXParamRow[] }) {
  if (data.length === 0) return <p className="text-slate-600 text-sm text-center py-4">No data</p>;
  const sorted = [...data].sort((a, b) => b.score - a.score);
  const totalScore = sorted.reduce((s, p) => s + p.score, 0) || 1;
  let cum = 0;
  const chartData = sorted.map(p => {
    cum += p.score;
    return { name: p.parameter, score: p.score, cumulative: parseFloat((cum / totalScore * 100).toFixed(1)) };
  });

  return (
    <ResponsiveContainer width="100%" height={200}>
      <ComposedChart data={chartData} margin={{ top: 4, right: 36, bottom: 64, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
        <XAxis dataKey="name" tick={{ fill: '#94A3B8', fontSize: 8 }} angle={-45} textAnchor="end" interval={0} />
        <YAxis yAxisId="left" domain={[0, 100]} tick={{ fill: '#94A3B8', fontSize: 10 }} unit="%" />
        <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fill: '#94A3B8', fontSize: 10 }} unit="%" />
        <Tooltip contentStyle={{ background: '#FFFFFF', border: '1px solid #334155', borderRadius: 8 }} />
        <Bar yAxisId="left" dataKey="score" name="Adherence %" radius={[2, 2, 0, 0]}>
          {chartData.map((entry, i) => <Cell key={i} fill={pctColor(entry.score)} />)}
        </Bar>
        <Line yAxisId="right" type="monotone" dataKey="cumulative" stroke={COLOR_AMBER} strokeWidth={2} dot={false} name="Cumulative %" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ─── CX Quality Parameters (tabbed, LOB-aware) ───────────────────────────────

const SCENARIO_COLORS = ['#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#06B6D4'];

function ParamBars({ rows, barH = 'h-5' }: { rows: CXParamRow[]; barH?: string }) {
  const sorted = [...rows].sort((a, b) => b.score - a.score);
  if (sorted.length === 0) return <p className="text-slate-600 text-sm text-center py-8">No data</p>;
  return (
    <div className="space-y-1.5">
      {sorted.map(p => (
        <div key={p.key} className="flex items-center gap-2">
          <span className="text-xs text-slate-500 w-40 shrink-0 truncate" title={p.parameter}>{p.parameter}</span>
          <div className={`flex-1 bg-slate-100 rounded-full ${barH} overflow-hidden`}>
            <motion.div
              className={`${barH} rounded-full flex items-center justify-end pr-2`}
              style={{ backgroundColor: pctColor(p.score), minWidth: 4 }}
              initial={{ width: 0 }}
              animate={{ width: `${p.score}%` }}
              transition={{ duration: 0.7 }}
            >
              {p.score > 12 && <span className="text-[10px] text-slate-900 font-bold">{p.score.toFixed(0)}%</span>}
            </motion.div>
          </div>
          {p.score <= 12 && (
            <span className="text-[10px] w-8 text-right shrink-0" style={{ color: pctColor(p.score) }}>
              {p.score.toFixed(0)}%
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function CXParametersCard({ cxData, lob }: { cxData: CXData; lob: string }) {
  const showInbound  = lob !== 'Outbound';
  const showOutbound = lob !== 'Inbound';
  const [tab, setTab] = useState<'inbound' | 'outbound'>(showInbound ? 'inbound' : 'outbound');

  useEffect(() => {
    if (lob === 'Outbound') setTab('outbound');
    else setTab('inbound');
  }, [lob]);

  const cxDownload = {
    filename: `cx_parameters_${tab}`,
    rows: (tab === 'inbound' ? cxData.inbound : cxData.outbound)
      .map(r => ({ Parameter: r.parameter, 'Score (%)': r.score })),
  };

  return (
    <SectionCard title="CX Quality Parameters" accent="#EC4899" downloadData={cxDownload}>
      {(showInbound && showOutbound) && (
        <div className="flex gap-1 mb-4 bg-slate-100 rounded-lg p-1 w-fit">
          <button onClick={() => setTab('inbound')}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${tab === 'inbound' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-slate-900'}`}>
            Inbound (19)
          </button>
          <button onClick={() => setTab('outbound')}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${tab === 'outbound' ? 'bg-purple-600 text-white' : 'text-slate-500 hover:text-slate-900'}`}>
            Outbound (6)
          </button>
        </div>
      )}

      {tab === 'inbound' && showInbound && (
        <div className="max-h-[220px] overflow-y-auto pr-1">
          <ParamBars rows={cxData.inbound} />
        </div>
      )}

      {tab === 'outbound' && showOutbound && (
        <ParamBars rows={cxData.outbound} barH="h-6" />
      )}
    </SectionCard>
  );
}

// ─── Scenario Section ─────────────────────────────────────────────────────────

function ScenarioSection({ scenario, buildQS }: { scenario: ScenarioRow[]; buildQS: () => string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [subData, setSubData] = useState<ScenarioRow[]>([]);
  const [loading, setLoading] = useState(false);

  const handleClick = async (entry: { name?: string }) => {
    const name = entry?.name;
    if (!name) return;
    if (selected === name) { setSelected(null); setSubData([]); return; }
    setSelected(name);
    setLoading(true);
    try {
      const qs = buildQS();
      const r = await api.get(`/call-master/scenario-detail?scenario=${encodeURIComponent(name)}&${qs}`);
      setSubData((r.data.data || []).map((s: ScenarioRow) => ({ name: String(s.name), value: Number(s.value) })));
    } catch { setSubData([]); }
    finally { setLoading(false); }
  };

  if (scenario.length === 0) return null;
  const total = scenario.reduce((s, r) => s + r.value, 0) || 1;

  // Top 10 + "Other" grouping
  const sorted = [...scenario].sort((a, b) => b.value - a.value);
  const top10 = sorted.slice(0, 10);
  const rest  = sorted.slice(10);
  const otherValue = rest.reduce((s, r) => s + r.value, 0);
  const chartData: ScenarioRow[] = otherValue > 0
    ? [...top10, { name: 'Other', value: otherValue }]
    : top10;

  const scenarioDownload = {
    filename: 'scenario_distribution_inbound',
    rows: scenario.map(r => ({
      Scenario: r.name,
      Calls: r.value,
      'Share (%)': ((r.value / total) * 100).toFixed(1),
    })),
  };

  return (
    <SectionCard title="Scenario Distribution · Inbound" accent={COLOR_BLUE} downloadData={scenarioDownload}>
      <p className="text-xs text-slate-500 mb-4">Top 10 scenarios shown · click a slice to drill into sub-scenarios</p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Main pie */}
        <div>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={chartData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={85}
                strokeWidth={2}
                stroke="#E2E8F0"
                onClick={(entry) => { if (entry?.name !== 'Other') handleClick(entry); }}
                style={{ cursor: 'pointer' }}
              >
                {chartData.map((r, i) => (
                  <Cell
                    key={i}
                    fill={r.name === 'Other' ? '#475569' : SCENARIO_COLORS[i % SCENARIO_COLORS.length]}
                    opacity={selected && selected !== r.name ? 0.35 : 1}
                    style={{ cursor: r.name === 'Other' ? 'default' : 'pointer' }}
                  />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: '#FFFFFF', border: '1px solid #334155', borderRadius: 8 }}
                formatter={(v) => [Number(v).toLocaleString(), 'Calls']}
              />
            </PieChart>
          </ResponsiveContainer>
          {/* Legend */}
          <div className="mt-2 space-y-1.5">
            {chartData.map((r, i) => (
              <div key={r.name} className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: r.name === 'Other' ? '#475569' : SCENARIO_COLORS[i % SCENARIO_COLORS.length] }} />
                <span className={`text-xs flex-1 ${r.name === 'Other' ? 'text-slate-500 italic' : 'text-slate-600'}`}>{r.name}</span>
                <span className="text-xs text-slate-500">{r.value.toLocaleString()}</span>
                <span className="text-xs font-semibold text-slate-600 w-12 text-right">
                  {((r.value / total) * 100).toFixed(1)}%
                </span>
              </div>
            ))}
            {rest.length > 0 && (
              <p className="text-[10px] text-slate-600 pt-1">{rest.length} scenario{rest.length > 1 ? 's' : ''} grouped into "Other"</p>
            )}
          </div>
        </div>

        {/* Sub-scenario */}
        <div className="flex flex-col justify-center">
          {!selected && (
            <p className="text-slate-600 text-xs text-center py-8">← Select a scenario to see sub-scenarios</p>
          )}
          {selected && loading && (
            <p className="text-slate-500 text-xs text-center py-8">Loading sub-scenarios…</p>
          )}
          {selected && !loading && subData.length === 0 && (
            <p className="text-slate-600 text-xs text-center py-8">No sub-scenario data for "{selected}"</p>
          )}
          {selected && !loading && subData.length > 0 && (() => {
            const subTotal = subData.reduce((s, r) => s + r.value, 0) || 1;
            return (
              <>
                <p className="text-xs text-slate-500 mb-3">
                  Sub-scenarios — <span className="text-slate-900 font-medium">{selected}</span>
                </p>
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie data={subData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                      outerRadius={65} strokeWidth={2} stroke="#E2E8F0">
                      {subData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: '#FFFFFF', border: '1px solid #334155', borderRadius: 8 }}
                      formatter={(v) => [Number(v).toLocaleString(), 'Calls']}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-2 space-y-1.5">
                  {subData.map((r, i) => (
                    <div key={r.name} className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                      <span className="text-xs text-slate-600 flex-1">{r.name}</span>
                      <span className="text-xs text-slate-500">{r.value.toLocaleString()}</span>
                      <span className="text-xs font-semibold text-slate-600 w-12 text-right">
                        {((r.value / subTotal) * 100).toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
        </div>
      </div>
    </SectionCard>
  );
}

// ─── Agent Drill-down Panel ──────────────────────────────────────────────────

function AgentParamsPanel({
  agent, type, params, onClose,
}: {
  agent: AgentRow; type: 'top' | 'bottom'; params: AgentParamRow[]; onClose: () => void;
}) {
  const sorted = [...params].sort((a, b) => b.score - a.score);
  const weak = sorted.filter(p => p.score < 60);
  const strong = sorted.filter(p => p.score >= 80);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      className="mt-4 bg-white border border-slate-200 rounded-xl p-4"
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className="text-sm font-semibold text-slate-900">{agent.agent}</span>
          <span className="ml-2 text-xs text-slate-500">
            {type === 'top' ? '— Why Top Performer' : '— Coaching Areas'}
          </span>
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-900 transition-colors">
          <X size={14} />
        </button>
      </div>

      {type === 'bottom' && weak.length > 0 && (
        <div className="mb-3">
          <p className="text-xs text-red-400 font-medium mb-2 uppercase tracking-wider">Needs Improvement</p>
          <div className="space-y-1.5">
            {weak.map(p => (
              <div key={p.key} className="flex items-center gap-2">
                <span className="text-xs text-slate-500 w-44 shrink-0">{p.parameter}</span>
                <div className="flex-1 bg-slate-100 rounded-full h-4 overflow-hidden">
                  <motion.div
                    className="h-4 rounded-full flex items-center justify-end pr-1.5"
                    style={{ backgroundColor: COLOR_RED }}
                    initial={{ width: 0 }}
                    animate={{ width: `${p.score}%` }}
                    transition={{ duration: 0.6 }}
                  >
                    <span className="text-[10px] text-slate-900 font-bold">{p.score.toFixed(0)}%</span>
                  </motion.div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {type === 'top' && strong.length > 0 && (
        <div className="mb-3">
          <p className="text-xs text-green-400 font-medium mb-2 uppercase tracking-wider">Strengths</p>
          <div className="space-y-1.5">
            {strong.map(p => (
              <div key={p.key} className="flex items-center gap-2">
                <span className="text-xs text-slate-500 w-44 shrink-0">{p.parameter}</span>
                <div className="flex-1 bg-slate-100 rounded-full h-4 overflow-hidden">
                  <motion.div
                    className="h-4 rounded-full flex items-center justify-end pr-1.5"
                    style={{ backgroundColor: COLOR_GREEN }}
                    initial={{ width: 0 }}
                    animate={{ width: `${p.score}%` }}
                    transition={{ duration: 0.6 }}
                  >
                    <span className="text-[10px] text-slate-900 font-bold">{p.score.toFixed(0)}%</span>
                  </motion.div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All params compact */}
      <details className="group">
        <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-600 transition-colors">
          All parameters ({params.length})
        </summary>
        <div className="mt-2 space-y-1">
          {sorted.map(p => (
            <div key={p.key} className="flex items-center gap-2">
              <span className="text-xs text-slate-500 w-44 shrink-0">{p.parameter}</span>
              <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
                <div
                  className="h-3 rounded-full"
                  style={{ width: `${p.score}%`, backgroundColor: pctColor(p.score) }}
                />
              </div>
              <span className="text-xs w-10 text-right" style={{ color: pctColor(p.score) }}>
                {p.score.toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      </details>
    </motion.div>
  );
}

// ─── Agent Table ─────────────────────────────────────────────────────────────

function AgentTable({
  agents, type, buildQS,
}: {
  agents: AgentRow[];
  type: 'top' | 'bottom';
  buildQS: () => string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [params, setParams] = useState<AgentParamRow[]>([]);
  const [loadingAgent, setLoadingAgent] = useState(false);

  const handleClick = async (agentName: string) => {
    if (selected === agentName) { setSelected(null); return; }
    setSelected(agentName);
    setLoadingAgent(true);
    try {
      const qs = buildQS();
      const r = await api.get(`/call-master/agent-params?agent=${encodeURIComponent(agentName)}&${qs}`);
      setParams((r.data.data || []).map((p: AgentParamRow) => ({
        ...p, score: parseFloat(String(p.score)) || 0,
      })));
    } catch { setParams([]); }
    finally { setLoadingAgent(false); }
  };

  const icon = type === 'top'
    ? <Award size={12} className="text-amber-400" />
    : <ThumbsDown size={12} className="text-red-400" />;

  const selectedAgent = agents.find(a => a.agent === selected);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          {type === 'top' ? 'Top Performers' : 'Needs Coaching'}
        </span>
        <span className="text-xs text-slate-600 ml-1">(click agent to drill down)</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left text-slate-500 py-2 pr-3">#</th>
              <th className="text-left text-slate-500 py-2 pr-3">Agent</th>
              <th className="text-right text-slate-500 py-2 pr-3">Calls</th>
              <th className="text-right text-slate-500 py-2 pr-3">Quality</th>
              <th className="text-right text-slate-500 py-2 pr-3">Fatal</th>
              <th className="text-right text-slate-500 py-2">Compliance</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a, i) => (
              <motion.tr
                key={a.agent}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
                onClick={() => handleClick(a.agent)}
                className={`border-b border-slate-200 cursor-pointer transition-colors ${
                  selected === a.agent ? 'bg-blue-500/10' : 'hover:bg-slate-100'
                }`}
              >
                <td className="py-2 pr-3 text-slate-600">{i + 1}</td>
                <td className="py-2 pr-3 font-medium text-blue-300 underline decoration-dotted">{a.agent}</td>
                <td className="py-2 pr-3 text-right text-slate-500">{fmt(a.calls)}</td>
                <td className="py-2 pr-3 text-right font-semibold" style={{ color: pctColor(a.quality) }}>
                  {a.quality.toFixed(1)}%
                </td>
                <td className="py-2 pr-3 text-right font-semibold" style={{ color: a.fatal_rate > 0 ? COLOR_RED : '#64748B' }}>
                  {a.fatal_rate > 0 ? `${a.fatal_rate.toFixed(1)}%` : '—'}
                </td>
                <td className="py-2 text-right font-semibold" style={{ color: pctColor(a.compliance) }}>
                  {a.compliance.toFixed(1)}%
                </td>
              </motion.tr>
            ))}
            {agents.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-slate-600 text-xs">No data for this period</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <AnimatePresence>
        {selected && selectedAgent && !loadingAgent && (
          <AgentParamsPanel
            agent={selectedAgent}
            type={type}
            params={params}
            onClose={() => setSelected(null)}
          />
        )}
        {loadingAgent && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mt-3 text-xs text-slate-500 text-center py-3"
          >
            Loading parameters…
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Export Modal ─────────────────────────────────────────────────────────────

function ExportModal({ open, onClose, clients, currentFilters }: {
  open: boolean;
  onClose: () => void;
  clients: ClientItem[];
  currentFilters: Filters;
}) {
  const cfRef = useRef(currentFilters);
  useEffect(() => { cfRef.current = currentFilters; }, [currentFilters]);

  const [source, setSource]                 = useState<'inbound' | 'outbound'>('inbound');
  const [exportStart, setExportStart]       = useState('');
  const [exportEnd, setExportEnd]           = useState('');
  const [exportClientId, setExportClientId] = useState('');
  const [rowLimit, setRowLimit]             = useState(5000);
  const [selectedCols, setSelectedCols]     = useState<Set<string>>(new Set());
  const [isDownloading, setIsDownloading]   = useState(false);
  const [isFatalDownloading, setIsFatalDownloading] = useState(false);

  // Sync from dashboard filters when modal opens
  useEffect(() => {
    if (!open) return;
    const cf = cfRef.current;
    const s: 'inbound' | 'outbound' = cf.lob === 'Outbound' ? 'outbound' : 'inbound';
    setSource(s);
    setExportStart(cf.startDate);
    setExportEnd(cf.endDate);
    setExportClientId(cf.clientId);
    const cols = s === 'outbound' ? OB_EXPORT_COLS : IB_EXPORT_COLS;
    setSelectedCols(new Set(cols.filter(c => c.group === 'Call Info').map(c => c.key)));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const cols   = source === 'inbound' ? IB_EXPORT_COLS : OB_EXPORT_COLS;
  const groups = [...new Set(cols.map(c => c.group))];

  const switchSource = (s: 'inbound' | 'outbound') => {
    setSource(s);
    const newCols = s === 'inbound' ? IB_EXPORT_COLS : OB_EXPORT_COLS;
    setSelectedCols(new Set(newCols.filter(c => c.group === 'Call Info').map(c => c.key)));
  };

  const toggleCol = (key: string) =>
    setSelectedCols(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const toggleGroup = (group: string) => {
    const keys = cols.filter(c => c.group === group).map(c => c.key);
    const allOn = keys.every(k => selectedCols.has(k));
    setSelectedCols(prev => {
      const next = new Set(prev);
      keys.forEach(k => allOn ? next.delete(k) : next.add(k));
      return next;
    });
  };

  const applyPreset = (preset: 'all' | 'info' | 'quality') => {
    if (preset === 'all')
      setSelectedCols(new Set(cols.map(c => c.key)));
    else if (preset === 'info')
      setSelectedCols(new Set(cols.filter(c => c.group === 'Call Info').map(c => c.key)));
    else
      setSelectedCols(new Set(cols.filter(c => c.group === 'Quality Parameters' || c.group === 'Quality').map(c => c.key)));
  };

  const handleDownload = async () => {
    if (selectedCols.size === 0) return;
    setIsDownloading(true);
    try {
      const p = new URLSearchParams({
        source,
        startDate: exportStart.replace('T', ' '),
        endDate:   exportEnd.replace('T', ' '),
        columns:   [...selectedCols].join(','),
        limit:     String(rowLimit),
      });
      if (exportClientId) p.set('clientId', exportClientId);

      const r = await api.get(`/call-master/export?${p}`);
      const rows: Record<string, unknown>[] = r.data?.data?.rows || [];

      if (rows.length === 0) {
        alert('No data found for the selected filters.');
        return;
      }

      // Rename column keys to human-readable labels for CSV headers
      const keyToLabel = Object.fromEntries(cols.map(c => [c.key, c.label]));
      const renamed = rows.map(row => {
        const out: Record<string, unknown> = {};
        for (const key of [...selectedCols]) {
          if (key in row) out[keyToLabel[key] ?? key] = row[key];
        }
        return out;
      });

      downloadCSV(`call_master_${source}_${new Date().toISOString().slice(0, 10)}`, renamed);
    } catch (err) {
      console.error('Export failed:', err);
      alert('Export failed. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleFatalDownload = async () => {
    setIsFatalDownloading(true);
    try {
      const p = new URLSearchParams({
        startDate: exportStart.replace('T', ' '),
        endDate:   exportEnd.replace('T', ' '),
      });
      if (exportClientId) p.set('clientId', exportClientId);

      const r = await api.get(`/call-master/fatal-agent-summary?${p}`);
      const rows: { date: string; agent: string; client: string; total_calls: number; fatal_calls: number; fatal_rate: number; avg_quality: number }[] = r.data?.data?.rows || [];

      if (rows.length === 0) {
        alert('No fatal data found for the selected filters.');
        return;
      }

      const renamed = rows.map(row => ({
        'Date':              row.date,
        'Agent':             row.agent,
        'Client':            row.client,
        'Total Calls':       row.total_calls,
        'Fatal Calls':       row.fatal_calls,
        'Fatal Rate (%)':    row.fatal_rate,
        'Avg Quality (%)':   row.avg_quality,
      }));

      downloadCSV(`fatal_agent_report_${new Date().toISOString().slice(0, 10)}`, renamed);
    } catch (err) {
      console.error('Fatal export failed:', err);
      alert('Fatal report export failed. Please try again.');
    } finally {
      setIsFatalDownloading(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-900/60 z-50 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed inset-x-4 top-8 bottom-8 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-full md:max-w-3xl bg-white border border-slate-200 rounded-2xl z-50 flex flex-col shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200 shrink-0">
              <Download size={16} className="text-blue-400" />
              <h2 className="text-base font-semibold text-slate-900 flex-1">Export Report</h2>
              <button onClick={onClose} className="text-slate-500 hover:text-slate-900 transition-colors p-1 rounded-lg hover:bg-slate-100">
                <X size={16} />
              </button>
            </div>

            {/* Body: left filters panel + right column selector */}
            <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-[220px_1fr]">

              {/* ── Left panel ── */}
              <div className="border-b md:border-b-0 md:border-r border-slate-200 p-5 flex flex-col gap-5 overflow-y-auto">

                {/* Source */}
                <div>
                  <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-2">Data Source</p>
                  <div className="flex gap-2">
                    {(['inbound', 'outbound'] as const).map(s => (
                      <button key={s} onClick={() => switchSource(s)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          source === s
                            ? s === 'inbound' ? 'bg-blue-600 text-white' : 'bg-purple-600 text-white'
                            : 'bg-slate-100 text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                        }`}
                      >
                        {s === 'inbound' ? 'Inbound' : 'Outbound'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Date range */}
                <div>
                  <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-2">Date Range</p>
                  <div className="space-y-2">
                    <div>
                      <span className="text-[10px] text-slate-600 block mb-1">From</span>
                      <input type="datetime-local" value={exportStart}
                        onChange={e => setExportStart(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-700 outline-none [color-scheme:dark]"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-600 block mb-1">To</span>
                      <input type="datetime-local" value={exportEnd}
                        onChange={e => setExportEnd(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-700 outline-none [color-scheme:dark]"
                      />
                    </div>
                  </div>
                </div>

                {/* Client */}
                <div>
                  <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-2">Client</p>
                  <select value={exportClientId} onChange={e => setExportClientId(e.target.value)}
                    className="w-full appearance-none bg-white border border-slate-200 text-xs text-slate-700 rounded-lg px-2 py-1.5 outline-none"
                  >
                    <option className="text-slate-900 bg-white" value="">All Process</option>
                    {clients.map(c => (
                      <option className="text-slate-900 bg-white" key={c.id} value={c.dialdesk_client_id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                {/* Row limit */}
                <div>
                  <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-2">Row Limit</p>
                  <select value={rowLimit} onChange={e => setRowLimit(Number(e.target.value))}
                    className="w-full appearance-none bg-white border border-slate-200 text-xs text-slate-700 rounded-lg px-2 py-1.5 outline-none"
                  >
                    <option className="text-slate-900 bg-white" value={1000}>1,000 rows</option>
                    <option className="text-slate-900 bg-white" value={5000}>5,000 rows</option>
                    <option className="text-slate-900 bg-white" value={10000}>10,000 rows</option>
                  </select>
                </div>

                {/* Column presets */}
                <div>
                  <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-2">Column Presets</p>
                  <div className="space-y-1.5">
                    {([
                      { id: 'all'     as const, label: 'All Columns' },
                      { id: 'info'    as const, label: 'Call Info Only' },
                      { id: 'quality' as const, label: 'Quality Only' },
                    ] as const).map(p => (
                      <button key={p.id} onClick={() => applyPreset(p.id)}
                        className="w-full text-left text-xs text-slate-500 hover:text-slate-900 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-100 transition-colors"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Download button */}
                <div className="mt-auto space-y-2">
                  <button
                    onClick={handleDownload}
                    disabled={isDownloading || selectedCols.size === 0}
                    className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-slate-900 text-sm font-semibold py-2.5 rounded-lg transition-colors"
                  >
                    {isDownloading
                      ? <><RefreshCw size={14} className="animate-spin" /> Fetching…</>
                      : <><Download size={14} /> Download CSV</>
                    }
                  </button>
                  <p className="text-[10px] text-slate-600 text-center">
                    {selectedCols.size} col{selectedCols.size !== 1 ? 's' : ''} · max {rowLimit.toLocaleString()} rows
                  </p>
                </div>

                {/* Fatal Agent Report */}
                <div className="border-t border-slate-200 pt-4 space-y-2">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-1.5 h-3 rounded-full bg-red-500 shrink-0" />
                    <p className="text-[11px] text-slate-600 font-semibold font-semibold uppercase tracking-wider">Fatal Agent Report</p>
                  </div>
                  <p className="text-[10px] text-slate-600 leading-relaxed">
                    Agent × date fatal call summary — total calls, fatal calls, fatal rate, avg quality. Uses the date range and client filter above.
                  </p>
                  <button
                    onClick={handleFatalDownload}
                    disabled={isFatalDownloading}
                    className="w-full flex items-center justify-center gap-2 bg-red-600/20 hover:bg-red-600/35 border border-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed text-red-400 hover:text-red-300 text-xs font-semibold py-2 rounded-lg transition-colors"
                  >
                    {isFatalDownloading
                      ? <><RefreshCw size={13} className="animate-spin" /> Generating…</>
                      : <><Download size={13} /> Download Fatal Report</>
                    }
                  </button>
                </div>
              </div>

              {/* ── Right panel: column checkboxes ── */}
              <div className="overflow-y-auto p-5">
                <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-4">Select Columns</p>
                <div className="space-y-5">
                  {groups.map(group => {
                    const groupCols = cols.filter(c => c.group === group);
                    const allOn  = groupCols.every(c => selectedCols.has(c.key));
                    const someOn = groupCols.some(c => selectedCols.has(c.key));
                    return (
                      <div key={group}>
                        <div className="flex items-center gap-2 mb-2.5 cursor-pointer" onClick={() => toggleGroup(group)}>
                          <div className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] font-bold shrink-0 transition-colors ${
                            allOn  ? 'bg-blue-600 border-blue-600 text-slate-900' :
                            someOn ? 'bg-blue-600/40 border-blue-500 text-slate-900' :
                            'border-slate-300 bg-transparent text-transparent'
                          }`}>✓</div>
                          <span className="text-xs font-semibold text-slate-600">{group}</span>
                          <span className="text-[10px] text-slate-600 ml-auto">
                            {groupCols.filter(c => selectedCols.has(c.key)).length}/{groupCols.length}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5 pl-6">
                          {groupCols.map(col => (
                            <label key={col.key} className="flex items-center gap-2 cursor-pointer group/col">
                              <input
                                type="checkbox"
                                checked={selectedCols.has(col.key)}
                                onChange={() => toggleCol(col.key)}
                                className="w-3.5 h-3.5 rounded accent-blue-500"
                              />
                              <span className="text-xs text-slate-500 group-hover/col:text-slate-700 transition-colors truncate" title={col.label}>
                                {col.label}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function CallMasterDashboard() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isSuperAdmin = user?.role === 'super_admin';

  const now = new Date();
  const [filters, setFilters] = useState<Filters>({
    startDate: toLocalDT(new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0)),
    endDate: toLocalDT(now),
    clientId: '',
    lob: 'All',
    period: 'daily',
  });

  const [clients, setClients] = useState<ClientItem[]>([]);
  const [kpis, setKPIs] = useState<KPIs | null>(null);
  const [trend, setTrend] = useState<TrendRow[]>([]);
  const [byHour, setByHour] = useState<HourRow[]>([]);
  const [byDay, setByDay] = useState<DayRow[]>([]);
  const [fatalByDay, setFatalByDay] = useState<FatalDayRow[]>([]);
  const [byClient, setByClient] = useState<{ inbound: ClientRow[]; outbound: ClientRow[] }>({ inbound: [], outbound: [] });
  const [funnel, setFunnel] = useState<FunnelRow[]>([]);
  const [cxData, setCXData] = useState<CXData>({ inbound: [], outbound: [], scenario: [] });
  const [agents, setAgents] = useState<{ top: AgentRow[]; bottom: AgentRow[] }>({ top: [], bottom: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<string | null>(null);
  const [agentsList, setAgentsList] = useState<ActiveAgentItem[]>([]);
  const [agentsListLoading, setAgentsListLoading]   = useState(false);
  const [processList, setProcessList]               = useState<ProcessListItem[]>([]);
  const [processListLoading, setProcessListLoading] = useState(false);
  const [exportOpen, setExportOpen]                 = useState(false);
  const [agentAudit, setAgentAudit]                 = useState<AgentAuditRow[]>([]);
  const [last7Days, setLast7Days]                   = useState<TrendRow[]>([]);

  const buildParams = useCallback(() => {
    const p: Record<string, string> = {
      startDate: filters.startDate.replace('T', ' '),  // YYYY-MM-DD HH:MM for MySQL
      endDate: filters.endDate.replace('T', ' '),
      lob: filters.lob,
    };
    if (filters.clientId) p.clientId = filters.clientId;
    if (filters.period) p.period = filters.period;
    return new URLSearchParams(p).toString();
  }, [filters]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = buildParams();
      // Build daily QS for "Last 7 Days" chart (always daily regardless of period filter)
      const dailyQs = (() => { const p = new URLSearchParams(qs); p.set('period', 'daily'); return p.toString(); })();

      const [kRes, tRes, hRes, dRes, fdRes, cRes, fRes, xRes, aRes, auditRes, l7Res] = await Promise.all([
        api.get(`/call-master/kpis?${qs}`),
        api.get(`/call-master/quality-trend?${qs}`),
        api.get(`/call-master/calls-by-hour?${qs}`),
        api.get(`/call-master/calls-by-day?${qs}`),
        api.get(`/call-master/fatal-by-day?${qs}`),
        api.get(`/call-master/calls-by-client?${qs}`),
        api.get(`/call-master/sales-funnel?${qs}`),
        api.get(`/call-master/cx-parameters?${qs}`),
        api.get(`/call-master/top-agents?${qs}`),
        api.get(`/call-master/agent-audit-summary?${qs}`),
        api.get(`/call-master/quality-trend?${dailyQs}`),
      ]);
      setKPIs(kRes.data.data);
      setTrend((tRes.data.data || []).map((r: TrendRow) => ({
        ...r, quality: parseFloat(String(r.quality)) || 0, calls: Number(r.calls) || 0, fatal: parseFloat(String(r.fatal)) || 0,
      })));
      setByHour(hRes.data.data || []);
      setByDay(dRes.data.data || []);
      setFatalByDay((fdRes.data.data || []).map((r: FatalDayRow) => ({
        day: String(r.day), fatal_calls: Number(r.fatal_calls) || 0,
      })));
      setByClient(cRes.data.data || { inbound: [], outbound: [] });
      setFunnel(fRes.data.data || []);
      const rawCX = xRes.data.data || { inbound: [], outbound: [], scenario: [] };
      setCXData({
        inbound: (rawCX.inbound || []).map((r: CXParamRow) => ({ ...r, score: parseFloat(String(r.score)) || 0 })),
        outbound: (rawCX.outbound || []).map((r: CXParamRow) => ({ ...r, score: parseFloat(String(r.score)) || 0 })),
        scenario: rawCX.scenario || [],
      });
      const agentData = aRes.data.data || { top: [], bottom: [] };
      const parseAgent = (a: AgentRow) => ({
        ...a,
        quality:    parseFloat(String(a.quality))    || 0,
        compliance: parseFloat(String(a.compliance)) || 0,
        calls:      Number(a.calls)                  || 0,
        fatal_rate: parseFloat(String(a.fatal_rate)) || 0,
      });
      setAgents({ top: agentData.top.map(parseAgent), bottom: agentData.bottom.map(parseAgent) });
      setAgentAudit((auditRes.data.data || []).map((r: AgentAuditRow) => ({
        agent:       r.agent,
        audit_count: Number(r.audit_count) || 0,
        cq_score:    parseFloat(String(r.cq_score)) || 0,
        fatal_count: Number(r.fatal_count) || 0,
        fatal_pct:   parseFloat(String(r.fatal_pct)) || 0,
        tq_count:    Number(r.tq_count) || 0,
        mq_count:    Number(r.mq_count) || 0,
        bq_count:    Number(r.bq_count) || 0,
      })));
      setLast7Days(((l7Res.data.data || []) as TrendRow[]).slice(-7).map((r: TrendRow) => ({
        ...r, quality: parseFloat(String(r.quality)) || 0, calls: Number(r.calls) || 0, fatal: parseFloat(String(r.fatal)) || 0,
      })));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load dashboard data';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [buildParams]);

  useEffect(() => {
    api.get('/call-master/clients')
      .then((r) => {
        const list: ClientItem[] = r.data.data || [];
        setClients(list);
        // If user is tenant-scoped (only 1 client returned), auto-lock the filter
        if (list.length === 1) {
          setFilters((prev) => ({ ...prev, clientId: String(list[0].dialdesk_client_id) }));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useEffect(() => { setAgentsList([]); }, [filters.lob]);

  const handleFilterChange = (k: keyof Filters, v: string) => {
    setFilters((prev) => ({ ...prev, [k]: v }));
  };

  const openDrawer = async (key: string) => {
    setDrawer(key);
    if (key === 'active_agents') {
      setAgentsList([]);
      setAgentsListLoading(true);
      try {
        const r = await api.get(`/call-master/active-agents-list?${buildParams()}`);
        setAgentsList((r.data.data || []).map((a: ActiveAgentItem) => ({
          ...a, calls: Number(a.calls), quality: parseFloat(String(a.quality)) || 0,
        })));
      } catch { setAgentsList([]); }
      finally { setAgentsListLoading(false); }
    }
    if (key === 'active_clients') {
      setProcessList([]);
      setProcessListLoading(true);
      try {
        const r = await api.get(`/call-master/process-list?${buildParams()}`);
        setProcessList((r.data.data || []).map((p: ProcessListItem) => ({
          ...p,
          total_calls:  Number(p.total_calls) || 0,
          quality_score: p.quality_score !== null ? parseFloat(String(p.quality_score)) : null,
          fatal_calls:  Number(p.fatal_calls) || 0,
          fatal_rate:   p.fatal_rate !== null ? parseFloat(String(p.fatal_rate)) : null,
        })));
      } catch { setProcessList([]); }
      finally { setProcessListLoading(false); }
    }
  };

  const DRAWER_INFO: Record<string, { title: string; description: string }> = {
    total_calls:     { title: 'Total Outbound Calls', description: 'Total number of outbound calls dialled during the selected date range. Sourced from db_external.CallDetails. Includes all call outcomes regardless of result.' },
    audited_calls:   { title: 'Audited Inbound Calls', description: 'Total inbound calls reviewed by a quality analyst. Each record in db_audit.call_quality_assessment represents one quality-evaluated call. Only audited calls contribute to the quality score.' },
    quality_score:   { title: 'Overall Quality Score', description: 'Weighted average of quality_percentage across all audited inbound calls. Covers 19 behavioral and process parameters scored 0 or 1 by QA analysts. Target: ≥ 80%.' },
    fatal_score:     { title: 'Fatal Score', description: 'Percentage of audited inbound calls that scored 0% quality — a complete failure across all parameters. These calls represent the most critical coaching opportunities. Target: < 5%.' },
    compliance:      { title: 'Compliance Score', description: 'Measures adherence to mandatory process steps: professionalism, hold procedure, accurate information, address recording, escalation, and call closure. Non-negotiable parameters with regulatory or legal implications. Target: ≥ 90%.' },
    cx_score:        { title: 'Customer Experience (CX) Score', description: 'Composite score of parameters that directly shape how a customer perceives the interaction: concern acknowledgment, assurance, active listening, politeness, pronunciation, and enthusiasm. Target: ≥ 75%.' },
    sales_conv:      { title: 'Sales Conversion Rate', description: 'Percentage of outbound calls where SaleDone = 1 in CallDetails. Calculated as (successful sales / total calls) × 100. Reflects agent effectiveness in converting outbound pitches to sales.' },
    ob_quality:      { title: 'Outbound Quality Score', description: 'Average quality score across all outbound calls, calculated per-row as (Opening + Offer Presented + Objection Handling + Prepaid Pitch + Upselling Efforts + Offer Urgency + No Sensitive Words) ÷ 7 × 100. A score of 100% means every parameter was met on every call.' },
    active_clients:  { title: 'Active Clients & Processes', description: 'All active processes grouped by client. Quality Score = average inbound quality (%) for the selected period. Fatal Score = % of calls with 0% quality (complete failures). A process with 0 calls had no audited inbound activity in this period.' },
    active_agents:   { title: 'Active Agents — Date Range', description: 'Unique agents (User field) who appear in at least one audited inbound call during the selected period. Shows their call volume, average quality score, and client(s) they handled.' },
  };

  // Chart section descriptions
  const CHART_DESC: Record<string, string> = {
    quality_trend:   'Daily / weekly / monthly trend of the average inbound quality score alongside the count of audited calls. A falling trend with rising audited calls signals a quality-capacity trade-off.',
    calls_by_hour:   'Distribution of calls across the 24-hour day. Identifies peak hours, understaffing windows, and optimal scheduling slots for both inbound and outbound teams.',
    calls_by_day:    'Call volume by day of week. Useful for scheduling, spotting weekend drops, and identifying mid-week demand spikes.',
    monthly_volume:  'Stacked monthly call volumes. Shows seasonal trends and month-over-month growth for both inbound (audited) and outbound (dialled) channels.',
    inbound_clients: 'Number of quality-audited calls per client. Reveals which clients receive the most QA attention and who might need increased audit coverage.',
    outbound_clients:'Total outbound calls and resulting sales per client. Compares dialling activity against conversion outcomes across clients.',
    sales_funnel:    'Outbound sales conversion funnel showing drop-off at each stage: Opening → Offer Presented → Objection Handled → Upsell Attempted → Sale Completed.',
    cx_params:       'Adherence rates for each CX and compliance parameter. Parameters below 60% (red) are critical coaching priorities. Parameters 60-79% (amber) need monitoring.',
    pareto_ib:       'Pareto analysis of inbound parameter adherence. The amber cumulative line identifies which few parameters drive most of the quality gap — focus coaching here first.',
    pareto_ob:       'Pareto analysis of outbound parameter adherence. Identifies which pitch/handling parameters have the biggest impact on overall outbound effectiveness.',
    scenario:        'Distribution of call types (Query / Request / Complaint / Sale) from the scenario field in call_quality_assessment. Click a slice to see the sub-scenario breakdown from the scenario1 column.',
    agent_board:     'Agent performance ranking by average quality score. Top Performers (≥ 80%) and Coaching Needed (< 60%) agents. Click any agent to see their parameter-level breakdown.',
  };

  const maxFunnelValue = funnel[0]?.value || 1;
  const showInbound  = filters.lob !== 'Outbound';
  const showOutbound = filters.lob !== 'Inbound';

  // Pre-compute Pareto download rows (sorted desc + cumulative %)
  const buildParetoRows = (data: CXParamRow[]) => {
    const sorted = [...data].sort((a, b) => b.score - a.score);
    const total = sorted.reduce((s, p) => s + p.score, 0) || 1;
    let cum = 0;
    return sorted.map(p => {
      cum += p.score;
      return { Parameter: p.parameter, 'Score (%)': p.score, 'Cumulative (%)': parseFloat((cum / total * 100).toFixed(1)) };
    });
  };
  const paretoIbRows = buildParetoRows(cxData.inbound);
  const paretoObRows = buildParetoRows(cxData.outbound);

  // Agent leaderboard combined download rows
  const agentDownloadRows = [
    ...agents.top.map(a => ({ Tier: 'Top Performer', Agent: a.agent, Calls: a.calls, 'Quality (%)': a.quality, 'Fatal (%)': a.fatal_rate, 'Compliance (%)': a.compliance })),
    ...agents.bottom.map(a => ({ Tier: 'Needs Coaching', Agent: a.agent, Calls: a.calls, 'Quality (%)': a.quality, 'Fatal (%)': a.fatal_rate, 'Compliance (%)': a.compliance })),
  ];

  const TOOLTIP_STYLE = { background: '#FFFFFF', border: '1px solid #334155', borderRadius: 8, fontSize: 12 };
  const AXIS_TICK = { fill: '#64748B', fontSize: 11 };
  const GRID = { strokeDasharray: '3 3', stroke: '#FFFFFF' };

  return (
    <div className="min-h-screen text-slate-900">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="px-6 pt-6 pb-4 bg-white border-b border-slate-200">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">Call Master</h1>
              <p className="text-xs text-slate-500 mt-0.5">Real-time analytics · {filters.lob === 'All' ? 'All LOBs' : filters.lob}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/call-master/opening-intelligence')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/15 border border-blue-500/30 text-blue-400 hover:bg-blue-600/25 hover:text-blue-300 text-xs font-medium transition-colors"
            >
              <TrendingUp size={13} />
              Opening Intelligence
            </button>
            <button
              onClick={() => navigate('/call-master/customer-intelligence')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-pink-600/15 border border-pink-500/30 text-pink-400 hover:bg-pink-600/25 hover:text-pink-300 text-xs font-medium transition-colors"
            >
              <Heart size={13} />
              Customer Intelligence
            </button>
            <button
              onClick={() => setExportOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/15 border border-blue-500/30 text-blue-400 hover:bg-blue-600/25 hover:text-blue-300 text-xs font-medium transition-colors"
            >
              <Download size={13} />
              Export Report
            </button>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/20">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs text-green-400 font-medium">Live</span>
            </div>
          </div>
        </div>
        <FilterBar filters={filters} clients={clients} onChange={handleFilterChange} onRefresh={fetchAll} loading={loading} />
      </div>

      <div className="p-6 space-y-5">
        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              className="flex items-center gap-3 bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl px-4 py-3 text-sm"
            >
              <AlertCircle size={16} /> {error}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Row 1: primary KPI cards ────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KPICard index={0} label="Total Calls"    value={kpis?.totalCalls    ?? 0} icon={<PhoneCall  size={15}/>} color={COLOR_BLUE}   sub="Outbound"   onClick={() => openDrawer('total_calls')} />
          <KPICard index={1} label="Audited Calls"  value={kpis?.totalAudited  ?? 0} icon={<CheckCircle size={15}/>} color={COLOR_PURPLE} sub="Inbound QA" onClick={() => openDrawer('audited_calls')} />
          {showInbound
            ? <KPICard index={2} label="Quality Score" value={kpis?.qualityScore ?? 0} suffix="%" dec={1} icon={<Award size={15}/>} color={COLOR_GREEN} onClick={() => openDrawer('quality_score')} />
            : <KPICard index={2} label="OB Quality"    value={kpis?.outboundQuality ?? 0} suffix="%" dec={1} icon={<Award size={15}/>} color={COLOR_PURPLE} sub="7-param score" onClick={() => openDrawer('ob_quality')} />
          }
          {showInbound
            ? <KPICard index={3} label="Fatal Score" value={kpis?.fatalScore ?? 0} suffix="%" dec={1} icon={<ThumbsDown size={15}/>} color={COLOR_RED} sub="0% quality calls" onClick={() => openDrawer('fatal_score')} />
            : <KPICard index={3} label="Compliance"  value={kpis?.compliance ?? 0} suffix="%" dec={1} icon={<Shield size={15}/>} color={COLOR_AMBER} onClick={() => openDrawer('compliance')} />
          }
          {showInbound && <KPICard index={4} label="Compliance" value={kpis?.compliance ?? 0} suffix="%" dec={1} icon={<Shield size={15}/>} color={COLOR_AMBER} onClick={() => openDrawer('compliance')} />}
          <KPICard index={showInbound ? 5 : 4} label="Soft Score" value={kpis?.customerExperience ?? 0} suffix="%" dec={1} icon={<Heart size={15}/>} color="#EC4899" onClick={() => openDrawer('cx_score')} />
        </div>

        {/* ── Row 2: operational KPIs (role-gated) ────────────────────────── */}
        <div className={`grid gap-3 ${isSuperAdmin ? 'grid-cols-2 lg:grid-cols-3' : 'grid-cols-2'}`}>
          <KPICard index={5} label="Sales Conv."   value={kpis?.salesConversion ?? 0} suffix="%" dec={1} icon={<TrendingUp size={15}/>} color={COLOR_GREEN} onClick={() => openDrawer('sales_conv')} />
          {isSuperAdmin && <KPICard index={6} label="Active Clients" value={kpis?.activeClients ?? 0} icon={<Users size={15}/>} color={COLOR_BLUE} sub="click for process list" onClick={() => openDrawer('active_clients')} />}
          <KPICard index={7} label="Active Agents" value={kpis?.activeAgents ?? 0} icon={<UserCheck size={15}/>} color={COLOR_AMBER} sub={filters.lob === 'All' ? 'IB+OB' : filters.lob} onClick={() => openDrawer('active_agents')} />
        </div>

        {/* ── Row 3: Quality Trend (3/5) + Hourly Distribution (2/5) ──────── */}
        <div className={`grid gap-5 ${showInbound ? 'grid-cols-1 lg:grid-cols-5' : 'grid-cols-1'}`}>
          {showInbound && (
            <div className="lg:col-span-3">
              <SectionCard title={`Quality Trend · Inbound (${filters.period})`} accent={COLOR_GREEN} description={CHART_DESC.quality_trend}
              downloadData={{ filename: `quality_trend_${filters.period}`, rows: trend.map(r => ({ Period: r.period, 'Quality (%)': r.quality, 'Fatal (%)': r.fatal, 'Audited Calls': r.calls })) }}>
                <ResponsiveContainer width="100%" height={270}>
                  <LineChart data={trend} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
                    <defs>
                      <linearGradient id="qualityFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={COLOR_GREEN}  stopOpacity={0.15} />
                        <stop offset="95%" stopColor={COLOR_GREEN}  stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid {...GRID} />
                    <XAxis dataKey="period" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                    <YAxis domain={[0, 100]} tick={AXIS_TICK} tickLine={false} axisLine={false} unit="%" />
                    <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: '#CBD5E1' }} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                    <Line type="monotone" dataKey="quality" stroke={COLOR_GREEN} strokeWidth={2.5} dot={{ r: 2, fill: COLOR_GREEN }} name="Quality %" />
                    <Line type="monotone" dataKey="fatal"   stroke={COLOR_RED}   strokeWidth={2}   dot={{ r: 2, fill: COLOR_RED }}   name="Fatal %" />
                    <Line type="monotone" dataKey="calls"   stroke={COLOR_BLUE}  strokeWidth={1.5} dot={false} strokeDasharray="4 2" name="Audited Calls" />
                  </LineChart>
                </ResponsiveContainer>
              </SectionCard>
            </div>
          )}

          <div className={showInbound ? 'lg:col-span-2' : ''}>
            <SectionCard title="Calls by Hour" accent={COLOR_PURPLE} description={CHART_DESC.calls_by_hour}
              downloadData={{ filename: 'calls_by_hour', rows: byHour.map(r => ({ Hour: r.hour, Inbound: r.inbound, Outbound: r.outbound, Total: r.total })) }}>
              <ResponsiveContainer width="100%" height={270}>
                <AreaChart data={byHour} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
                  <defs>
                    <linearGradient id="ibHourGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={COLOR_BLUE}   stopOpacity={0.35} />
                      <stop offset="95%" stopColor={COLOR_BLUE}   stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="obHourGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={COLOR_PURPLE} stopOpacity={0.35} />
                      <stop offset="95%" stopColor={COLOR_PURPLE} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="hour" tick={AXIS_TICK} tickLine={false} axisLine={false} interval={3} />
                  <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  {showInbound  && <Area type="monotone" dataKey="inbound"  stroke={COLOR_BLUE}   fill="url(#ibHourGrad)" strokeWidth={2} name="Inbound" />}
                  {showOutbound && <Area type="monotone" dataKey="outbound" stroke={COLOR_PURPLE}  fill="url(#obHourGrad)" strokeWidth={2} name="Outbound" />}
                </AreaChart>
              </ResponsiveContainer>
            </SectionCard>
          </div>
        </div>

        {/* ── Row 4: 3-col volume charts ───────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <SectionCard title="Calls by Day of Week" accent={COLOR_BLUE} description={CHART_DESC.calls_by_day}
            downloadData={{ filename: 'calls_by_day', rows: byDay.map(r => ({ Day: r.day, Inbound: r.inbound, Outbound: r.outbound })) }}>
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={byDay} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="day" tick={{ ...AXIS_TICK, fontSize: 10 }} tickLine={false} axisLine={false}
                  tickFormatter={(v: string) => v.slice(0, 3)} />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                {showInbound  && <Bar dataKey="inbound"  fill={COLOR_BLUE}   name="Inbound"  radius={[3,3,0,0]} />}
                {showOutbound && <Bar dataKey="outbound" fill={COLOR_PURPLE}  name="Outbound" radius={[3,3,0,0]} />}
              </BarChart>
            </ResponsiveContainer>
          </SectionCard>

          {showInbound && (
            <SectionCard title="Fatal Calls by Day" accent={COLOR_RED} description="Inbound calls that scored 0% quality — a complete failure of all parameters. Shows which days of the week have the most fatal calls. Use this to target coaching sessions mid-week."
              downloadData={{ filename: 'fatal_by_day', rows: fatalByDay.map(r => ({ Day: r.day, 'Fatal Calls': r.fatal_calls })) }}>
              <ResponsiveContainer width="100%" height={210}>
                <BarChart data={fatalByDay} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="day" tick={{ ...AXIS_TICK, fontSize: 10 }} tickLine={false} axisLine={false}
                    tickFormatter={(v: string) => v.slice(0, 3)} />
                  <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [v, 'Fatal Calls']} />
                  <Bar dataKey="fatal_calls" fill={COLOR_RED} name="Fatal Calls" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </SectionCard>
          )}

          {showInbound ? (
            <SectionCard title="Inbound by Client" accent={COLOR_GREEN} description={CHART_DESC.inbound_clients}
              downloadData={{ filename: 'inbound_by_client', rows: byClient.inbound.map(r => ({ Client: r.client_name, 'Audited Calls': r.audited ?? 0, 'Quality (%)': r.quality ?? 0 })) }}>
              <ResponsiveContainer width="100%" height={210}>
                <BarChart data={byClient.inbound.slice(0, 8)} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 0 }}>
                  <CartesianGrid {...GRID} horizontal={false} />
                  <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                  <YAxis dataKey="client_name" type="category" tick={{ ...AXIS_TICK, fontSize: 10 }} tickLine={false} axisLine={false} width={80} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="audited" fill={COLOR_GREEN} name="Audited" radius={[0,3,3,0]} />
                </BarChart>
              </ResponsiveContainer>
            </SectionCard>
          ) : (
            <SectionCard title="Outbound by Client" accent={COLOR_PURPLE} description={CHART_DESC.outbound_clients}
              downloadData={{ filename: 'outbound_by_client', rows: byClient.outbound.map(r => ({ Client: r.client_name, Calls: r.calls ?? 0, Sales: r.sales ?? 0 })) }}>
              <ResponsiveContainer width="100%" height={210}>
                <BarChart data={byClient.outbound.slice(0, 8)} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 0 }}>
                  <CartesianGrid {...GRID} horizontal={false} />
                  <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                  <YAxis dataKey="client_name" type="category" tick={{ ...AXIS_TICK, fontSize: 10 }} tickLine={false} axisLine={false} width={80} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="calls" fill={COLOR_PURPLE} name="Calls" radius={[0,3,3,0]} />
                  <Bar dataKey="sales" fill={COLOR_GREEN}  name="Sales" radius={[0,3,3,0]} />
                </BarChart>
              </ResponsiveContainer>
            </SectionCard>
          )}
        </div>

        {/* ── Row 5: Sales Funnel (2/5) + CX Parameters (3/5) ────────────── */}
        <div className={`grid gap-5 ${showOutbound ? 'grid-cols-1 lg:grid-cols-5' : 'grid-cols-1'}`}>
          {showOutbound && (
            <div className="lg:col-span-2">
              <SectionCard title="Sales Funnel · Outbound" accent={COLOR_PURPLE} description={CHART_DESC.sales_funnel}
                downloadData={{ filename: 'sales_funnel_outbound', rows: funnel.map(r => ({ Stage: r.stage, Count: r.value, 'Conversion (%)': r.pct })) }}>
                <div className="space-y-3 pt-1">
                  {funnel.map((row) => <FunnelBar key={row.stage} row={row} max={maxFunnelValue} />)}
                  {funnel.length === 0 && <p className="text-center text-slate-600 text-sm py-8">No outbound data</p>}
                </div>
              </SectionCard>
            </div>
          )}
          <div className={showOutbound ? 'lg:col-span-3' : ''}>
            <CXParametersCard cxData={cxData} lob={filters.lob} />
          </div>
        </div>

        {/* ── Pareto Analysis ──────────────────────────────────────────────── */}
        {(showInbound || showOutbound) && (
          <div className={`grid gap-5 ${showInbound && showOutbound ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
            {showInbound && cxData.inbound.length > 0 && (
              <SectionCard title="Parameter Pareto · Inbound" accent={COLOR_GREEN} description={CHART_DESC.pareto_ib}
                downloadData={{ filename: 'pareto_inbound', rows: paretoIbRows }}>
                <p className="text-xs text-slate-500 mb-3">Bars = adherence %, Line = cumulative %</p>
                <ParetoChart data={cxData.inbound} />
              </SectionCard>
            )}
            {showOutbound && cxData.outbound.length > 0 && (
              <SectionCard title="Parameter Pareto · Outbound" accent={COLOR_PURPLE} description={CHART_DESC.pareto_ob}
                downloadData={{ filename: 'pareto_outbound', rows: paretoObRows }}>
                <p className="text-xs text-slate-500 mb-3">Bars = adherence %, Line = cumulative %</p>
                <ParetoChart data={cxData.outbound} />
              </SectionCard>
            )}
          </div>
        )}

        {/* ── Scenario Distribution ────────────────────────────────────────── */}
        {showInbound && <ScenarioSection scenario={cxData.scenario} buildQS={buildParams} />}

        {/* ── Agent Leaderboard: Top 5 + Last 7 Days vs Target ───────────── */}
        {showInbound && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Top 5 Performers */}
            <SectionCard title="Top 5 Performers" accent={COLOR_AMBER} description={CHART_DESC.agent_board}
              downloadData={{ filename: 'top_5_performers', rows: agents.top.slice(0, 5).map(a => ({ Agent: a.agent, Calls: a.calls, 'Quality (%)': a.quality, 'Fatal (%)': a.fatal_rate, 'Compliance (%)': a.compliance })) }}>
              <AgentTable agents={agents.top.slice(0, 5)} type="top" buildQS={buildParams} />
            </SectionCard>

            {/* Last 7 Days vs Target */}
            <SectionCard title="Last 7 Days vs Target" accent={COLOR_GREEN}
              description="Daily quality score for the last 7 days compared against the 80% target line. Bars coloured green ≥80%, amber 60-79%, red <60%."
              downloadData={{ filename: 'last_7_days_quality', rows: last7Days.map(r => ({ Date: r.period, 'Quality (%)': r.quality, 'Fatal (%)': r.fatal, 'Target (%)': 80 })) }}>
              {last7Days.length === 0 ? (
                <p className="text-slate-600 text-sm text-center py-10">No data for this period</p>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={last7Days} margin={{ top: 8, right: 12, bottom: 24, left: -8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#FFFFFF" />
                    <XAxis dataKey="period" tick={{ fill: '#64748B', fontSize: 10 }} tickLine={false} axisLine={false}
                      tickFormatter={(v: string) => v.slice(5)} angle={-30} textAnchor="end" />
                    <YAxis domain={[0, 100]} tick={{ fill: '#64748B', fontSize: 11 }} tickLine={false} axisLine={false} unit="%" />
                    <Tooltip
                      contentStyle={{ background: '#FFFFFF', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                      formatter={(v: unknown) => `${Number(v).toFixed(1)}%`}
                    />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
                    <ReferenceLine y={80} stroke={COLOR_GREEN} strokeDasharray="5 3" strokeWidth={1.5} label={{ value: 'Target 80%', fill: COLOR_GREEN, fontSize: 10, position: 'insideTopRight' }} />
                    <Bar dataKey="quality" name="Quality %" radius={[3, 3, 0, 0]}>
                      {last7Days.map((entry, i) => (
                        <Cell key={i} fill={pctColor(entry.quality)} />
                      ))}
                    </Bar>
                    <Line type="monotone" dataKey="fatal" stroke={COLOR_RED} strokeWidth={1.5} dot={{ r: 3, fill: COLOR_RED }} name="Fatal %" strokeDasharray="4 2" />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </SectionCard>
          </div>
        )}

        {/* ── Agent Audit Summary Table ────────────────────────────────────── */}
        {showInbound && agentAudit.length > 0 && (
          <SectionCard title="Agent Audit Summary" accent={COLOR_BLUE}
            description="Per-agent breakdown of audited calls. TQ = Top Quality (≥80%), MQ = Mid Quality (60–79%), BQ = Below Quality (1–59%), Fatal = 0% quality. Sorted by CQ Score descending."
            downloadData={{ filename: 'agent_audit_summary', rows: agentAudit.map(r => ({
              Agent: r.agent, 'Audit Count': r.audit_count, 'CQ Score (%)': r.cq_score,
              'Fatal Count': r.fatal_count, 'Fatal (%)': r.fatal_pct,
              'TQ (≥80%)': r.tq_count, 'MQ (60-79%)': r.mq_count, 'BQ (<60%)': r.bq_count,
            })) }}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left text-slate-500 py-2.5 pr-3 font-semibold">#</th>
                    <th className="text-left text-slate-500 py-2.5 pr-4 font-semibold">Agent</th>
                    <th className="text-right text-slate-500 py-2.5 pr-4 font-semibold">Audit Count</th>
                    <th className="text-right text-slate-500 py-2.5 pr-4 font-semibold">CQ Score%</th>
                    <th className="text-right text-slate-500 py-2.5 pr-4 font-semibold">Fatal Count</th>
                    <th className="text-right text-slate-500 py-2.5 pr-4 font-semibold">Fatal%</th>
                    <th className="text-right text-slate-500 py-2.5 pr-4 font-semibold">
                      <span style={{ color: COLOR_GREEN }}>TQ</span>
                    </th>
                    <th className="text-right text-slate-500 py-2.5 pr-4 font-semibold">
                      <span style={{ color: COLOR_AMBER }}>MQ</span>
                    </th>
                    <th className="text-right text-slate-500 py-2.5 font-semibold">
                      <span style={{ color: COLOR_RED }}>BQ</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {agentAudit.map((r, i) => (
                    <motion.tr
                      key={r.agent}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: Math.min(i * 0.02, 0.4) }}
                      className="border-b border-slate-200 hover:bg-slate-100 transition-colors"
                    >
                      <td className="py-2.5 pr-3 text-slate-600">{i + 1}</td>
                      <td className="py-2.5 pr-4 font-medium text-slate-700">{r.agent}</td>
                      <td className="py-2.5 pr-4 text-right text-slate-500">{r.audit_count.toLocaleString()}</td>
                      <td className="py-2.5 pr-4 text-right font-semibold" style={{ color: pctColor(r.cq_score) }}>
                        {r.cq_score.toFixed(1)}%
                      </td>
                      <td className="py-2.5 pr-4 text-right font-semibold" style={{ color: r.fatal_count > 0 ? COLOR_RED : '#475569' }}>
                        {r.fatal_count > 0 ? r.fatal_count.toLocaleString() : '—'}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-semibold" style={{ color: r.fatal_pct > 0 ? COLOR_RED : '#475569' }}>
                        {r.fatal_pct > 0 ? `${r.fatal_pct.toFixed(1)}%` : '—'}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-semibold" style={{ color: COLOR_GREEN }}>
                        {r.tq_count > 0 ? r.tq_count.toLocaleString() : <span className="text-slate-600">0</span>}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-semibold" style={{ color: COLOR_AMBER }}>
                        {r.mq_count > 0 ? r.mq_count.toLocaleString() : <span className="text-slate-600">0</span>}
                      </td>
                      <td className="py-2.5 text-right font-semibold" style={{ color: r.bq_count > 0 ? COLOR_RED : '#475569' }}>
                        {r.bq_count > 0 ? r.bq_count.toLocaleString() : <span className="text-slate-600">0</span>}
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-200">
                    <td colSpan={2} className="pt-3 text-[11px] text-slate-600">{agentAudit.length} agents</td>
                    <td className="pt-3 text-right text-[11px] text-slate-500 font-semibold pr-4">
                      {agentAudit.reduce((s, r) => s + r.audit_count, 0).toLocaleString()}
                    </td>
                    <td className="pt-3 text-right text-[11px] font-semibold pr-4" style={{ color: pctColor(agentAudit.reduce((s, r) => s + r.cq_score, 0) / (agentAudit.length || 1)) }}>
                      {(agentAudit.reduce((s, r) => s + r.cq_score, 0) / (agentAudit.length || 1)).toFixed(1)}%
                    </td>
                    <td className="pt-3 text-right text-[11px] text-red-400 font-semibold pr-4">
                      {agentAudit.reduce((s, r) => s + r.fatal_count, 0).toLocaleString()}
                    </td>
                    <td colSpan={4} className="pt-3 text-right text-[11px] text-slate-600 pr-0">
                      TQ={agentAudit.reduce((s,r)=>s+r.tq_count,0).toLocaleString()} &nbsp;
                      MQ={agentAudit.reduce((s,r)=>s+r.mq_count,0).toLocaleString()} &nbsp;
                      BQ={agentAudit.reduce((s,r)=>s+r.bq_count,0).toLocaleString()}
                    </td>
                  </tr>
                </tfoot>
              </table>
              <p className="text-[10px] text-slate-600 mt-2">TQ ≥80% · MQ 60–79% · BQ 1–59% · Fatal = 0% quality calls (inbound only)</p>
            </div>
          </SectionCard>
        )}

        {/* ── Outbound Calls by Client (full width, "All" LOB only) ────────── */}
        {filters.lob === 'All' && byClient.outbound.length > 0 && (
          <SectionCard title="Outbound Calls by Client" accent={COLOR_PURPLE} description={CHART_DESC.outbound_clients}
            downloadData={{ filename: 'outbound_calls_by_client', rows: byClient.outbound.map(r => ({ Client: r.client_name, Calls: r.calls ?? 0, Sales: r.sales ?? 0 })) }}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={byClient.outbound.slice(0, 12)} layout="vertical" margin={{ top: 4, right: 32, bottom: 0, left: 0 }}>
                <CartesianGrid {...GRID} horizontal={false} />
                <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <YAxis dataKey="client_name" type="category" tick={{ ...AXIS_TICK, fontSize: 10 }} tickLine={false} axisLine={false} width={90} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="calls" fill={COLOR_PURPLE} name="Total Calls" radius={[0,3,3,0]} />
                <Bar dataKey="sales" fill={COLOR_GREEN}  name="Sales"       radius={[0,3,3,0]} />
              </BarChart>
            </ResponsiveContainer>
          </SectionCard>
        )}
      </div>

      {/* ── Detail Drawer ──────────────────────────────────────────────────── */}
      {drawer && DRAWER_INFO[drawer] && (
        <DetailDrawer
          open={!!drawer}
          onClose={() => { setDrawer(null); setAgentsList([]); }}
          title={DRAWER_INFO[drawer].title}
          description={DRAWER_INFO[drawer].description}
        >
          {/* Active Clients — process list with quality + fatal */}
          {drawer === 'active_clients' && (
            processListLoading ? (
              <div className="flex items-center justify-center py-16">
                <RefreshCw size={20} className="animate-spin text-blue-400" />
                <span className="ml-3 text-sm text-slate-500">Loading processes…</span>
              </div>
            ) : processList.length === 0 ? (
              <p className="text-slate-600 text-sm text-center py-12">No process data available</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-slate-200">
                      <th className="text-left text-slate-500 py-2 pr-3 font-semibold">Process</th>
                      <th className="text-left text-slate-500 py-2 pr-3 font-semibold">Client</th>
                      <th className="text-left text-slate-500 py-2 pr-3 font-semibold">LOB</th>
                      <th className="text-right text-slate-500 py-2 pr-3 font-semibold">Calls</th>
                      <th className="text-right text-slate-500 py-2 pr-3 font-semibold">Quality</th>
                      <th className="text-right text-slate-500 py-2 font-semibold">Fatal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {processList.map((p, i) => (
                      <tr key={i} className="border-b border-slate-200 hover:bg-slate-100 transition-colors">
                        <td className="py-2.5 pr-3 font-medium text-slate-700 max-w-[120px] truncate" title={p.process_name}>{p.process_name}</td>
                        <td className="py-2.5 pr-3 text-slate-500 max-w-[100px] truncate" title={p.client_name}>{p.client_name}</td>
                        <td className="py-2.5 pr-3">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            p.lob === 'Outbound' ? 'bg-purple-500/15 text-purple-400' : 'bg-blue-500/15 text-blue-400'
                          }`}>{p.lob === 'Outbound' ? 'OB' : 'IB'}</span>
                        </td>
                        <td className="py-2.5 pr-3 text-right text-slate-500">{fmt(p.total_calls)}</td>
                        <td className="py-2.5 pr-3 text-right font-semibold" style={{ color: p.quality_score !== null ? pctColor(p.quality_score) : '#64748B' }}>
                          {p.quality_score !== null ? `${p.quality_score.toFixed(1)}%` : '—'}
                        </td>
                        <td className="py-2.5 text-right font-semibold" style={{ color: p.fatal_calls > 0 ? COLOR_RED : '#64748B' }}>
                          {p.fatal_calls > 0 ? `${p.fatal_calls} (${(p.fatal_rate ?? 0).toFixed(1)}%)` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[11px] text-slate-600 mt-3 text-right">{processList.length} processes · fatal = 0% quality calls</p>
              </div>
            )
          )}

          {/* Active Agents — full list table */}
          {drawer === 'active_agents' && (
            agentsListLoading ? (
              <div className="flex items-center justify-center py-16">
                <RefreshCw size={20} className="animate-spin text-blue-400" />
                <span className="ml-3 text-sm text-slate-500">Loading agents…</span>
              </div>
            ) : agentsList.length === 0 ? (
              <p className="text-slate-600 text-sm text-center py-12">No agent data for this period</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-slate-200">
                      <th className="text-left text-slate-500 py-2 pr-3 font-semibold">#</th>
                      <th className="text-left text-slate-500 py-2 pr-3 font-semibold">Agent</th>
                      <th className="text-right text-slate-500 py-2 pr-3 font-semibold">Calls</th>
                      <th className="text-right text-slate-500 py-2 pr-3 font-semibold">Quality</th>
                      <th className="text-left text-slate-500 py-2 font-semibold">LOB / Clients</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agentsList.map((a, i) => (
                      <tr key={a.agent} className="border-b border-slate-200 hover:bg-slate-100 transition-colors">
                        <td className="py-2.5 pr-3 text-slate-600">{i + 1}</td>
                        <td className="py-2.5 pr-3 font-medium text-slate-700">{a.agent}</td>
                        <td className="py-2.5 pr-3 text-right text-slate-500">{fmt(a.calls)}</td>
                        <td className="py-2.5 pr-3 text-right font-semibold" style={{ color: pctColor(a.quality) }}>
                          {a.quality.toFixed(1)}%
                        </td>
                        <td className="py-2.5 text-slate-500 max-w-[160px] truncate" title={a.clients}>
                          <span className="inline-flex items-center gap-1.5">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${
                              a.lob === 'Outbound'
                                ? 'bg-purple-500/15 text-purple-400'
                                : 'bg-blue-500/15 text-blue-400'
                            }`}>
                              {a.lob === 'Outbound' ? 'OB' : 'IB'}
                            </span>
                            {a.clients}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[11px] text-slate-600 mt-3 text-right">{agentsList.length} agents · Inbound source</p>
              </div>
            )
          )}

          {/* For simple KPI drawers — show current value + date range */}
          {drawer !== 'active_agents' && drawer !== 'active_clients' && (
            <div className="space-y-4 pt-2">
              <div className="bg-slate-100 rounded-xl p-4 border border-slate-200">
                <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2">Current Value</p>
                <p className="text-3xl font-bold text-slate-900">
                  {drawer === 'total_calls'  && <AnimatedNumber value={kpis?.totalCalls ?? 0} />}
                  {drawer === 'audited_calls'&& <AnimatedNumber value={kpis?.totalAudited ?? 0} />}
                  {drawer === 'quality_score'&& <><AnimatedNumber value={kpis?.qualityScore ?? 0} dec={1} /><span className="text-lg text-slate-500 ml-1">%</span></>}
                  {drawer === 'fatal_score'  && <><AnimatedNumber value={kpis?.fatalScore ?? 0} dec={1} /><span className="text-lg text-slate-500 ml-1">%</span></>}
                  {drawer === 'compliance'   && <><AnimatedNumber value={kpis?.compliance ?? 0} dec={1} /><span className="text-lg text-slate-500 ml-1">%</span></>}
                  {drawer === 'cx_score'     && <><AnimatedNumber value={kpis?.customerExperience ?? 0} dec={1} /><span className="text-lg text-slate-500 ml-1">%</span></>}
                  {drawer === 'sales_conv'   && <><AnimatedNumber value={kpis?.salesConversion ?? 0} dec={1} /><span className="text-lg text-slate-500 ml-1">%</span></>}
                  {drawer === 'ob_quality'   && <><AnimatedNumber value={kpis?.outboundQuality ?? 0} dec={1} /><span className="text-lg text-slate-500 ml-1">%</span></>}
                </p>
              </div>
              <div className="bg-slate-100 rounded-xl p-4 border border-slate-200">
                <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2">Date Range</p>
                <p className="text-sm text-slate-600">{filters.startDate} — {filters.endDate}</p>
                <p className="text-xs text-slate-500 mt-1">LOB: {filters.lob}</p>
              </div>
            </div>
          )}
        </DetailDrawer>
      )}

      {/* ── Export Modal ─────────────────────────────────────────────────────── */}
      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        clients={clients}
        currentFilters={filters}
      />
    </div>
  );
}
