import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import type { ApexOptions } from 'apexcharts';

import type ReactApexChartType from 'react-apexcharts';
type ApexChartProps = React.ComponentProps<typeof ReactApexChartType>;
const ReactApexChart = lazy(async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = await import('react-apexcharts') as any;
  const Comp: React.ComponentType<ApexChartProps> = mod.default?.default ?? mod.default ?? mod;
  return { default: Comp };
});

import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { hrmsApi } from '@/lib/hrmsApi';
import {
  TrendingUp, Users, CheckCircle, XCircle, AlertCircle, Clock,
  Award, Target, RefreshCw, Briefcase, Megaphone, BarChart3,
  ChevronDown, UserCheck, ClipboardList, ArrowDown,
} from 'lucide-react';

// ══════════════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════════════

type Period = 'FTD' | 'WTD' | 'MTD' | 'L30';

interface KPI {
  total: number; selected: number; rejected: number;
  hold: number; no_show: number; client_pending: number;
  conversion_rate: number; avg_tat_min: number | null;
  sla_breach_count: number | null;
}
interface HiringFlow { total_entries: number; walkin_count: number; selected_count: number; joined_count: number; }
interface FunnelRow {
  stage: string; entered: number; passed: number; rejected: number;
  hold: number; no_show: number; pending: number; completed: number; pass_rate: number;
}
interface TrendRow  { day: string; total: number; selected: number; rejected: number; no_show: number; }
interface ProcessRow { process: string; total: number; selected: number; rate: number; }
interface VocRow    { voc_reason: string; cnt: number; }
interface SourceRow { source: string; total: number; selected: number; }

interface PerformanceData {
  kpi: KPI; hiringFlow: HiringFlow; funnel: FunnelRow[]; trend: TrendRow[];
  byProcess: ProcessRow[]; voc: VocRow[]; bySource: SourceRow[];
}
interface Profile { name: string; recruiterCode: string; branch: string; }

// ══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════════════════════

const PERIOD_LABELS: Record<Period, string> = {
  FTD: 'Today', WTD: 'This Week', MTD: 'This Month', L30: 'Last 30 Days',
};

const STAGE_CONFIG: Record<string, { color: string; bg: string; label: string; icon: React.ElementType }> = {
  'Arrival':      { color: 'text-blue-600',   bg: 'bg-blue-500',   label: 'Arrival',      icon: Users },
  'HR Round':     { color: 'text-teal-600',   bg: 'bg-teal-500',   label: 'HR Round',     icon: UserCheck },
  'Skill Test':   { color: 'text-violet-600', bg: 'bg-violet-500', label: 'Skill Test',   icon: ClipboardList },
  'Ops Round':    { color: 'text-orange-600', bg: 'bg-orange-500', label: 'Ops Round',    icon: Briefcase },
  'Client Round': { color: 'text-pink-600',   bg: 'bg-pink-500',   label: 'Client Round', icon: Target },
  'Selection':    { color: 'text-green-600',  bg: 'bg-green-500',  label: 'Selection',    icon: Award },
};

function n(v: number | null | undefined) { return v ?? 0; }
function pct(a: number, b: number) { return b ? Math.round((a / b) * 1000) / 10 : 0; }

// ══════════════════════════════════════════════════════════════════════════════
// SIMPLE FUNNEL TABLE
// ══════════════════════════════════════════════════════════════════════════════

function SimpleFunnelTable({ rows, kpi, periodLabel }: { rows: FunnelRow[]; kpi: KPI | undefined; periodLabel: string }) {
  if (!rows.length) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center text-gray-400">
        <Target className="w-10 h-10 mx-auto mb-2 opacity-30" />
        <p className="text-sm">No funnel data for this period</p>
      </div>
    );
  }

  const cohort = rows[0]?.entered ?? 0;
  // Funnel shows what happened at each stage - final passed = selected at final stage only
  const funnelSelected = rows[rows.length - 1]?.passed ?? 0;
  // KPI selected may differ if some selections happened at earlier stages (data issue)
  const kpiSelected = n(kpi?.selected);
  const convRate = cohort > 0 ? Math.round((kpiSelected / cohort) * 1000) / 10 : 0;
  const activePending = rows.reduce((s, r) => s + (r.pending ?? 0), 0);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/50">
        <div className="flex items-center gap-2">
          <Target className="w-5 h-5 text-indigo-600" />
          <h2 className="font-bold text-gray-800">Interview Stage Funnel</h2>
        </div>
        <p className="text-xs text-gray-500 mt-1">Cohort: {periodLabel}</p>
      </div>

      {/* Summary Row */}
      <div className="grid grid-cols-4 gap-3 p-4 border-b border-gray-100 bg-white">
        <div className="text-center p-3 rounded-xl bg-blue-50">
          <p className="text-2xl font-black text-blue-700">{cohort}</p>
          <p className="text-[10px] text-blue-600 font-medium uppercase">Cohort Size</p>
        </div>
        <div className="text-center p-3 rounded-xl bg-green-50">
          <p className="text-2xl font-black text-green-700">{kpiSelected}</p>
          <p className="text-[10px] text-green-600 font-medium uppercase">Total Selected</p>
        </div>
        <div className="text-center p-3 rounded-xl bg-cyan-50">
          <p className="text-2xl font-black text-cyan-700">{convRate}%</p>
          <p className="text-[10px] text-cyan-600 font-medium uppercase">Conversion</p>
        </div>
        <div className="text-center p-3 rounded-xl bg-orange-50">
          <p className="text-2xl font-black text-orange-700">{activePending || n(kpi?.client_pending)}</p>
          <p className="text-[10px] text-orange-600 font-medium uppercase">In Progress</p>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="text-left py-3 px-4 font-semibold text-gray-500 text-xs uppercase tracking-wide">Stage</th>
              <th className="text-center py-3 px-3 font-semibold text-gray-500 text-xs uppercase tracking-wide w-32">Progress</th>
              <th className="text-center py-3 px-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Entered</th>
              <th className="text-center py-3 px-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Passed</th>
              <th className="text-center py-3 px-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Pass Rate</th>
              <th className="text-center py-3 px-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Drop-off</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const config = STAGE_CONFIG[row.stage] ?? { color: 'text-gray-600', bg: 'bg-gray-500', label: row.stage, icon: Target };
              const Icon = config.icon;
              const widthPct = cohort > 0 ? Math.max(8, (row.entered / cohort) * 100) : 8;
              const dropCount = idx > 0 ? rows[idx - 1].entered - row.entered : 0;
              const dropPct = idx > 0 && rows[idx - 1].entered > 0 ? Math.round((dropCount / rows[idx - 1].entered) * 100) : 0;

              return (
                <tr key={row.stage} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                  {/* Stage */}
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <span className={`w-6 h-6 rounded-full ${config.bg} text-white text-xs font-bold flex items-center justify-center`}>
                        {idx + 1}
                      </span>
                      <Icon className={`w-4 h-4 ${config.color}`} />
                      <span className={`font-semibold ${config.color}`}>{config.label}</span>
                    </div>
                  </td>

                  {/* Progress Bar */}
                  <td className="py-3 px-3">
                    <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full ${config.bg} rounded-full transition-all`} style={{ width: `${widthPct}%` }} />
                    </div>
                    <p className="text-[10px] text-gray-400 text-center mt-1">{Math.round(widthPct)}%</p>
                  </td>

                  {/* Entered */}
                  <td className="py-3 px-3 text-center font-bold text-gray-800">{row.entered}</td>

                  {/* Passed */}
                  <td className="py-3 px-3 text-center font-bold text-green-600">{row.passed}</td>

                  {/* Pass Rate */}
                  <td className="py-3 px-3 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${
                      row.pass_rate >= 70 ? 'bg-green-100 text-green-700' :
                      row.pass_rate >= 50 ? 'bg-yellow-100 text-yellow-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {row.pass_rate}%
                    </span>
                  </td>

                  {/* Drop-off */}
                  <td className="py-3 px-3 text-center">
                    {idx === 0 ? (
                      <span className="text-xs text-gray-400">—</span>
                    ) : dropCount > 0 ? (
                      <div className="flex items-center justify-center gap-1">
                        <ArrowDown className="w-3 h-3 text-red-500" />
                        <span className="text-sm font-bold text-red-600">{dropCount}</span>
                        <span className="text-[10px] text-red-400">({dropPct}%)</span>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Final Outcome */}
      <div className="p-4 bg-green-50 border-t border-green-100 flex items-center justify-center gap-3">
        <CheckCircle className="w-5 h-5 text-green-600" />
        <span className="text-sm font-medium text-green-700">Total Selected:</span>
        <span className="text-xl font-black text-green-700">{kpiSelected}</span>
        <span className="text-xs text-green-600">({convRate}% conversion)</span>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TREND CHART
// ══════════════════════════════════════════════════════════════════════════════

function TrendChart({ rows }: { rows: TrendRow[] }) {
  if (!rows.length) {
    return <div className="h-48 flex items-center justify-center text-sm text-gray-400">No activity data</div>;
  }

  const categories = rows.map(r => r.day.slice(5).replace('-', '/'));
  const holdOther = rows.map(r => Math.max(0, r.total - n(r.selected) - n(r.rejected) - n(r.no_show)));

  const options: ApexOptions = {
    chart: { type: 'bar', stacked: true, toolbar: { show: false }, fontFamily: 'inherit', background: 'transparent' },
    plotOptions: { bar: { columnWidth: rows.length > 15 ? '75%' : '55%', borderRadius: 3 } },
    colors: ['#22c55e', '#ef4444', '#94a3b8'],
    dataLabels: { enabled: false },
    stroke: { width: 0 },
    xaxis: {
      categories,
      labels: { rotate: -45, style: { fontSize: '10px', colors: '#64748b' } },
      axisBorder: { show: false }, axisTicks: { show: false },
    },
    yaxis: { labels: { style: { fontSize: '10px', colors: ['#94a3b8'] } }, min: 0 },
    grid: { borderColor: '#f1f5f9', strokeDashArray: 3 },
    legend: { show: true, position: 'top', horizontalAlign: 'right', fontSize: '11px', labels: { colors: '#475569' } },
    tooltip: { shared: true, intersect: false, theme: 'dark' },
  };

  return (
    <div>
      <ReactApexChart
        type="bar"
        options={options}
        series={[
          { name: 'Selected', data: rows.map(r => n(r.selected)) },
          { name: 'Rejected', data: rows.map(r => n(r.rejected)) },
          { name: 'Hold/Other', data: holdOther },
        ]}
        height={200}
      />
      <div className="flex justify-between text-xs text-gray-400 mt-2 pt-2 border-t border-gray-100">
        <span>{rows.length} days · <b className="text-gray-700">{rows.reduce((s, r) => s + r.total, 0)}</b> total</span>
        <span className="text-green-600 font-semibold">{rows.reduce((s, r) => s + n(r.selected), 0)} selected</span>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// HORIZONTAL BAR SECTION
// ══════════════════════════════════════════════════════════════════════════════

function HBarSection({ items, color }: { items: { name: string; val: number; sub?: string }[]; color: string }) {
  if (!items.length) return <p className="text-sm text-gray-400 text-center py-6">No data</p>;
  const max = Math.max(...items.map(i => i.val), 1);
  return (
    <div className="space-y-3">
      {items.slice(0, 6).map(item => (
        <div key={item.name}>
          <div className="flex justify-between text-xs mb-1">
            <span className="font-medium text-gray-700 truncate max-w-[150px]">{item.name}</span>
            <span className="text-gray-500 font-semibold tabular-nums">{item.sub ?? item.val}</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(4, (item.val / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// STAT CARD
// ══════════════════════════════════════════════════════════════════════════════

function StatCard({ label, value, sub, icon: Icon, bg, iconColor }: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; bg: string; iconColor: string;
}) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">{label}</span>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${bg}`}>
          <Icon className={`w-4 h-4 ${iconColor}`} />
        </div>
      </div>
      <div className="text-2xl font-black text-gray-900">{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

export default function NativeRecruiterPortal() {
  const [period, setPeriod] = useState<Period>('MTD');
  const [data, setData] = useState<PerformanceData | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (p: Period) => {
    setLoading(true);
    setError('');
    try {
      const res = await hrmsApi.get<unknown>(`/api/ats/recruiter/my-performance?period=${p}`) as {
        success: boolean; period: string; profile: Profile | null; data: PerformanceData;
      };
      setData(res.data);
      if (res.profile) setProfile(res.profile);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(period); }, [period, load]);

  const kpi = data?.kpi;
  const hflow = data?.hiringFlow;

  return (
    <DashboardLayout>
      <div className="p-5 max-w-7xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">My Performance</h1>
            {profile && (
              <p className="text-sm text-gray-500">
                {profile.name} · {profile.branch} · <span className="font-mono text-indigo-600">{profile.recruiterCode}</span>
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <select
                value={period}
                onChange={e => setPeriod(e.target.value as Period)}
                className="appearance-none pl-3 pr-8 py-2 text-sm font-medium border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
                  <option key={p} value={p}>{PERIOD_LABELS[p]}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
            <button onClick={() => load(period)} disabled={loading} className="p-2 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40">
              <RefreshCw className={`w-4 h-4 text-gray-500 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
            <XCircle className="w-4 h-4" />{error}
          </div>
        )}

        {loading && !data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[...Array(8)].map((_, i) => <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />)}
          </div>
        )}

        {data && (
          <>
            {/* Walk-in KPIs */}
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Walk-in Interview Outcomes</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <StatCard label="Interviewed" value={n(kpi?.total)} icon={Users} bg="bg-indigo-100" iconColor="text-indigo-600" sub={PERIOD_LABELS[period]} />
                <StatCard label="Selected" value={n(kpi?.selected)} icon={CheckCircle} bg="bg-green-100" iconColor="text-green-600" sub={`${n(kpi?.conversion_rate)}%`} />
                <StatCard label="Rejected" value={n(kpi?.rejected)} icon={XCircle} bg="bg-red-100" iconColor="text-red-600" />
                <StatCard label="Hold" value={n(kpi?.hold)} icon={AlertCircle} bg="bg-amber-100" iconColor="text-amber-600" />
                <StatCard label="No Show" value={n(kpi?.no_show)} icon={Clock} bg="bg-slate-100" iconColor="text-slate-500" />
                <StatCard label="Client Pend" value={n(kpi?.client_pending)} icon={Target} bg="bg-blue-100" iconColor="text-blue-600" />
              </div>
            </div>

            {/* Hiring Flow — visual pipeline (always show) */}
            <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-3">Hiring Entry Flow</p>
              <div className="flex items-center justify-between">
                {/* Entries */}
                <div className="text-center flex-1">
                  <div className="w-14 h-14 mx-auto rounded-full bg-violet-100 flex items-center justify-center mb-1">
                    <ClipboardList className="w-6 h-6 text-violet-600" />
                  </div>
                  <div className="text-2xl font-black text-violet-700">{n(hflow?.total_entries)}</div>
                  <div className="text-[10px] text-gray-500 font-medium">Entries</div>
                </div>
                <ArrowDown className="w-5 h-5 text-gray-300 rotate-[-90deg] flex-shrink-0" />
                {/* Walkin */}
                <div className="text-center flex-1">
                  <div className="w-14 h-14 mx-auto rounded-full bg-indigo-100 flex items-center justify-center mb-1">
                    <Users className="w-6 h-6 text-indigo-600" />
                  </div>
                  <div className="text-2xl font-black text-indigo-700">{n(hflow?.walkin_count)}</div>
                  <div className="text-[10px] text-gray-500 font-medium">Walk-ins</div>
                  {n(hflow?.total_entries) > 0 && (
                    <div className="text-[9px] text-indigo-500 font-semibold">{Math.round((n(hflow?.walkin_count) / n(hflow?.total_entries)) * 100)}%</div>
                  )}
                </div>
                <ArrowDown className="w-5 h-5 text-gray-300 rotate-[-90deg] flex-shrink-0" />
                {/* Selected */}
                <div className="text-center flex-1">
                  <div className="w-14 h-14 mx-auto rounded-full bg-green-100 flex items-center justify-center mb-1">
                    <UserCheck className="w-6 h-6 text-green-600" />
                  </div>
                  <div className="text-2xl font-black text-green-700">{n(hflow?.selected_count)}</div>
                  <div className="text-[10px] text-gray-500 font-medium">Selected</div>
                  {n(hflow?.walkin_count) > 0 && (
                    <div className="text-[9px] text-green-500 font-semibold">{Math.round((n(hflow?.selected_count) / n(hflow?.walkin_count)) * 100)}%</div>
                  )}
                </div>
                <ArrowDown className="w-5 h-5 text-gray-300 rotate-[-90deg] flex-shrink-0" />
                {/* Joined */}
                <div className="text-center flex-1">
                  <div className="w-14 h-14 mx-auto rounded-full bg-teal-100 flex items-center justify-center mb-1">
                    <Award className="w-6 h-6 text-teal-600" />
                  </div>
                  <div className="text-2xl font-black text-teal-700">{n(hflow?.joined_count)}</div>
                  <div className="text-[10px] text-gray-500 font-medium">Joined</div>
                  {n(hflow?.selected_count) > 0 && (
                    <div className="text-[9px] text-teal-500 font-semibold">{Math.round((n(hflow?.joined_count) / n(hflow?.selected_count)) * 100)}%</div>
                  )}
                </div>
              </div>
            </div>

            {/* Metrics Row — Conversion, Avg TAT, SLA Breach */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-gradient-to-br from-indigo-600 to-indigo-700 rounded-xl p-4 text-white">
                <div className="flex items-center gap-1.5 mb-1 opacity-80">
                  <TrendingUp className="w-4 h-4" />
                  <span className="text-[10px] font-bold uppercase">Conversion</span>
                </div>
                <div className="text-3xl font-black">{n(kpi?.conversion_rate)}%</div>
                <div className="text-[11px] opacity-70">{n(kpi?.selected)}/{n(kpi?.total)}</div>
              </div>
              <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-4 text-white">
                <div className="flex items-center gap-1.5 mb-1 opacity-80">
                  <Clock className="w-4 h-4" />
                  <span className="text-[10px] font-bold uppercase">Avg TAT</span>
                </div>
                <div className="text-3xl font-black">{kpi?.avg_tat_min ?? '—'}<span className="text-lg opacity-70 ml-1">min</span></div>
                <div className="text-[11px] opacity-70">Interview turnaround</div>
              </div>
              <div className={`rounded-xl p-4 text-white ${n(kpi?.sla_breach_count) > 0 ? 'bg-gradient-to-br from-red-500 to-red-600' : 'bg-gradient-to-br from-teal-500 to-teal-600'}`}>
                <div className="flex items-center gap-1.5 mb-1 opacity-80">
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-[10px] font-bold uppercase">SLA Breach</span>
                </div>
                <div className="text-3xl font-black">{n(kpi?.sla_breach_count)}</div>
                <div className="text-[11px] opacity-70">TAT &gt; 90 min</div>
              </div>
            </div>

            {/* Funnel Table */}
            <SimpleFunnelTable rows={data.funnel} kpi={kpi} periodLabel={PERIOD_LABELS[period]} />

            {/* Trend + VOC */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <BarChart3 className="w-4 h-4 text-indigo-600" />
                  <h3 className="font-bold text-gray-800 text-sm">Daily Activity</h3>
                </div>
                <Suspense fallback={<div className="h-48 bg-gray-50 rounded-lg animate-pulse" />}>
                  <TrendChart rows={data.trend} />
                </Suspense>
              </div>

              <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <XCircle className="w-4 h-4 text-red-500" />
                  <h3 className="font-bold text-gray-800 text-sm">Top Rejection Reasons</h3>
                </div>
                {(() => {
                  const total = data.voc.reduce((s, r) => s + r.cnt, 0);
                  return (
                    <HBarSection
                      items={data.voc.map(r => ({ name: r.voc_reason, val: r.cnt, sub: `${r.cnt} · ${pct(r.cnt, total)}%` }))}
                      color="bg-red-400"
                    />
                  );
                })()}
              </div>
            </div>

            {/* Process + Source */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <Briefcase className="w-4 h-4 text-blue-600" />
                  <h3 className="font-bold text-gray-800 text-sm">By Process</h3>
                </div>
                <HBarSection
                  items={data.byProcess.map(r => ({ name: r.process, val: r.selected, sub: `${r.selected}/${r.total} · ${r.rate}%` }))}
                  color="bg-blue-500"
                />
              </div>

              <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <Megaphone className="w-4 h-4 text-teal-600" />
                  <h3 className="font-bold text-gray-800 text-sm">By Source</h3>
                </div>
                <HBarSection
                  items={data.bySource.map(r => ({ name: r.source, val: r.total, sub: `${n(r.selected)}/${r.total} · ${pct(n(r.selected), r.total)}%` }))}
                  color="bg-teal-500"
                />
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
