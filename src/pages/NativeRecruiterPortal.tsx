import { useState, useEffect, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { hrmsApi } from '@/lib/hrmsApi';
import {
  TrendingUp, Users, CheckCircle, XCircle, AlertCircle, Clock,
  BarChart2, Award, Target, RefreshCw, Briefcase, Megaphone,
  ChevronDown, UserCheck, UserX, ClipboardList,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

type Period = 'FTD' | 'WTD' | 'MTD' | 'L30';

interface KPI {
  total: number;
  selected: number;
  rejected: number;
  hold: number;
  no_show: number;
  client_pending: number;
  conversion_rate: number;
  avg_interview_min: number | null;
  avg_typing_wpm: number | null;
  avg_ai_score: number | null;
}

interface HiringKpi {
  total_entries: number;
  walkin_flag: number;
  final_selected: number;
  joined: number;
}

interface FunnelRow {
  stage: string;
  entered: number;
  passed: number;
  rejected: number;
  hold: number;
  no_show: number;
  pending: number;
  completed: number;
  pass_rate: number;
}

interface TrendRow  { day: string; total: number; selected: number; rejected: number; no_show: number; }
interface ProcessRow { process: string; total: number; selected: number; rate: number; }
interface VocRow    { voc_reason: string; cnt: number; }
interface SourceRow { source: string; total: number; selected: number; }

interface PerformanceData {
  kpi: KPI;
  hiringKpi: HiringKpi;
  funnel: FunnelRow[];
  trend: TrendRow[];
  byProcess: ProcessRow[];
  voc: VocRow[];
  bySource: SourceRow[];
}

interface Profile { name: string; recruiterCode: string; branch: string; }

// ── Helpers ────────────────────────────────────────────────────────────────────

const PERIOD_LABELS: Record<Period, string> = {
  FTD: 'Today', WTD: 'This Week', MTD: 'This Month', L30: 'Last 30 Days',
};

const STAGE_SHORT: Record<string, string> = {
  'Arrival': 'Arrival',
  'Round 1- HR Screening': 'HR Round',
  'Interview - Skill Test': 'Skill Test',
  "Round 2- Op's": 'Ops Round',
  'Round 3- Client': 'Client Round',
  'Selection Discussion': 'Final Selection',
};

function n(v: number | null | undefined) { return v ?? 0; }
function pct(a: number, b: number) { if (!b) return 0; return Math.round((a / b) * 10) / 10; }

// ── Stat Card ──────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon: Icon, bg, text }: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; bg: string; text: string;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide leading-tight">{label}</span>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${bg}`}>
          <Icon className={`w-4 h-4 ${text}`} />
        </div>
      </div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      {sub && <div className="text-[11px] text-gray-400">{sub}</div>}
    </div>
  );
}

// ── Funnel Stage Card ──────────────────────────────────────────────────────────

function FunnelCard({ row, prev, isFirst }: { row: FunnelRow; prev?: FunnelRow; isFirst: boolean }) {
  const dropOff = !isFirst && prev ? prev.entered - row.entered : 0;
  const dropOffPct = !isFirst && prev?.entered ? pct(dropOff, prev.entered) : 0;
  const barW = (isFirst || !prev?.entered) ? 100 : Math.max(4, Math.round((row.entered / prev.entered) * 100));

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-2">
      {/* Stage name + drop-off */}
      <div className="flex items-start justify-between gap-2">
        <span className="font-semibold text-gray-800 text-sm">{STAGE_SHORT[row.stage] ?? row.stage}</span>
        {!isFirst && dropOff > 0 && (
          <span className="text-[10px] bg-red-50 text-red-600 border border-red-200 rounded px-1.5 py-0.5 shrink-0">
            −{dropOff} dropped ({dropOffPct}%)
          </span>
        )}
      </div>

      {/* Funnel width bar */}
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full bg-purple-400 rounded-full transition-all" style={{ width: `${barW}%` }} />
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-3 gap-x-3 gap-y-1 text-[11px]">
        <div className="flex flex-col">
          <span className="text-gray-400 font-medium">Entered</span>
          <span className="font-bold text-gray-800 text-sm">{row.entered}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-gray-400 font-medium">Passed</span>
          <span className="font-bold text-green-600 text-sm">{row.passed}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-gray-400 font-medium">Pass Rate</span>
          <span className={`font-bold text-sm ${row.pass_rate >= 50 ? 'text-green-600' : row.pass_rate >= 25 ? 'text-yellow-600' : 'text-red-500'}`}>
            {row.pass_rate}%
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-gray-400 font-medium">Rejected</span>
          <span className="font-semibold text-red-500">{row.rejected}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-gray-400 font-medium">Hold</span>
          <span className="font-semibold text-yellow-600">{row.hold}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-gray-400 font-medium">No Show</span>
          <span className="font-semibold text-gray-400">{row.no_show}</span>
        </div>
        {row.pending > 0 && (
          <div className="flex flex-col col-span-3 mt-0.5">
            <span className="text-blue-500 text-[10px]">⏳ {row.pending} pending decision</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Trend Chart ────────────────────────────────────────────────────────────────

function TrendChart({ rows }: { rows: TrendRow[] }) {
  if (!rows.length) return (
    <div className="flex items-center justify-center h-40 text-sm text-gray-400">No data for this period</div>
  );
  const maxVal = Math.max(...rows.map(r => r.total), 1);

  return (
    <div className="flex flex-col gap-3">
      {/* Bar chart */}
      <div className="flex items-end gap-1" style={{ height: 100 }}>
        {rows.map(row => {
          const totalH = Math.max(4, Math.round((row.total / maxVal) * 96));
          const selH   = row.total ? Math.round((n(row.selected) / row.total) * totalH) : 0;
          const rejH   = row.total ? Math.round((n(row.rejected) / row.total) * totalH) : 0;
          const nsH    = totalH - selH - rejH;

          return (
            <div key={row.day} className="flex-1 flex flex-col items-center group relative" style={{ minWidth: 6 }}>
              {/* Tooltip */}
              <div className="absolute bottom-full mb-1 hidden group-hover:flex z-20 flex-col bg-gray-900 text-white text-[10px] rounded-lg px-2 py-1.5 gap-0.5 whitespace-nowrap shadow-lg pointer-events-none" style={{ left: '50%', transform: 'translateX(-50%)' }}>
                <span className="font-semibold">{row.day}</span>
                <span>Total: {row.total}</span>
                <span className="text-green-300">Selected: {n(row.selected)}</span>
                <span className="text-red-300">Rejected: {n(row.rejected)}</span>
                {n(row.no_show) > 0 && <span className="text-gray-300">No Show: {n(row.no_show)}</span>}
              </div>
              {/* Bar segments stacked bottom-up: no_show (gray) + rejected (red) + selected (green) */}
              <div className="w-full flex flex-col-reverse rounded-t overflow-hidden" style={{ height: totalH }}>
                <div className="w-full bg-green-400" style={{ height: selH, minHeight: selH > 0 ? 1 : 0 }} />
                <div className="w-full bg-red-300"   style={{ height: rejH, minHeight: rejH > 0 ? 1 : 0 }} />
                <div className="w-full bg-gray-300"  style={{ height: nsH,  minHeight: nsH  > 0 ? 1 : 0 }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* X-axis labels */}
      <div className="flex gap-1">
        {rows.map(row => (
          <div key={row.day} className="flex-1 text-center text-[9px] text-gray-400 truncate" style={{ minWidth: 6 }}>
            {row.day.slice(5).replace('-', '/')}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[10px] text-gray-500 pt-1 border-t border-gray-100">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-green-400 inline-block" />Selected</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-300 inline-block" />Rejected</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-gray-300 inline-block" />No Show / Other</span>
      </div>
    </div>
  );
}

// ── Horizontal Bar ─────────────────────────────────────────────────────────────

function HBar({ val, total, color }: { val: number; total: number; color: string }) {
  const w = total ? Math.max(2, Math.round((val / total) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${w}%` }} />
      </div>
      <span className="text-[11px] text-gray-500 w-6 text-right tabular-nums">{val}</span>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

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
      setError(err instanceof Error ? err.message : 'Failed to load performance data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(period); }, [period, load]);

  const kpi  = data?.kpi;
  const hkpi = data?.hiringKpi;

  return (
    <DashboardLayout>
      <div className="p-6 max-w-7xl mx-auto">

        {/* ── Header ── */}
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">My Performance</h1>
            {profile && (
              <p className="text-sm text-gray-500 mt-0.5">
                {profile.name} · {profile.branch} · {profile.recruiterCode}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <select
                value={period}
                onChange={e => setPeriod(e.target.value as Period)}
                className="appearance-none pl-3 pr-8 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-purple-500 cursor-pointer"
              >
                {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
                  <option key={p} value={p}>{PERIOD_LABELS[p]}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
            <button
              onClick={() => load(period)}
              disabled={loading}
              className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 text-gray-600 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800 flex items-center gap-2">
            <XCircle className="w-4 h-4 flex-shrink-0" />{error}
          </div>
        )}

        {loading && !data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {[...Array(8)].map((_, i) => <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />)}
          </div>
        )}

        {data && (
          <>
            {/* ── Walk-in Interview KPIs ── */}
            <div className="mb-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Walk-in Interview Outcomes</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <StatCard label="Total Interviewed" value={n(kpi?.total)} icon={Users}       bg="bg-purple-100" text="text-purple-600"
                  sub={`${PERIOD_LABELS[period]}`} />
                <StatCard label="Selected"           value={n(kpi?.selected)} icon={CheckCircle} bg="bg-green-100"  text="text-green-600"
                  sub={`${n(kpi?.conversion_rate)}% conversion`} />
                <StatCard label="Rejected"           value={n(kpi?.rejected)}  icon={XCircle}     bg="bg-red-100"   text="text-red-600" />
                <StatCard label="Hold"               value={n(kpi?.hold)}      icon={AlertCircle} bg="bg-yellow-100" text="text-yellow-600" />
                <StatCard label="No Show"            value={n(kpi?.no_show)}   icon={Clock}       bg="bg-gray-100"  text="text-gray-500" />
                <StatCard label="Client Pending"     value={n(kpi?.client_pending)} icon={Target} bg="bg-blue-100"  text="text-blue-600" />
              </div>
            </div>

            {/* ── Hiring Entry KPIs ── */}
            {hkpi && (
              <div className="mb-5 mt-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Hiring Entries (Activity Tracker)</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <StatCard label="Total Entries"    value={n(hkpi.total_entries)} icon={ClipboardList} bg="bg-indigo-100" text="text-indigo-600" />
                  <StatCard label="Walk-ins"         value={n(hkpi.walkin_flag)}   icon={Users}         bg="bg-purple-100" text="text-purple-600" />
                  <StatCard label="Final Selected"   value={n(hkpi.final_selected)} icon={UserCheck}   bg="bg-green-100"  text="text-green-600" />
                  <StatCard label="Joined"           value={n(hkpi.joined)}        icon={UserX}         bg="bg-teal-100"  text="text-teal-600" />
                </div>
              </div>
            )}

            {/* ── Secondary metrics ── */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
              <div className="bg-gradient-to-br from-purple-50 to-purple-100 border border-purple-200 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="w-4 h-4 text-purple-600" />
                  <span className="text-[10px] font-bold text-purple-700 uppercase tracking-wide">Conversion Rate</span>
                </div>
                <div className="text-3xl font-bold text-purple-700">{n(kpi?.conversion_rate)}%</div>
                <div className="text-[11px] text-purple-500 mt-0.5">{n(kpi?.selected)} selected / {n(kpi?.total)} interviewed</div>
              </div>
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Award className="w-4 h-4 text-blue-600" />
                  <span className="text-[10px] font-bold text-blue-700 uppercase tracking-wide">Avg Typing Speed</span>
                </div>
                <div className="text-3xl font-bold text-blue-700">
                  {kpi?.avg_typing_wpm != null ? `${kpi.avg_typing_wpm} WPM` : '—'}
                </div>
                <div className="text-[11px] text-blue-500 mt-0.5">Net WPM from assessed candidates</div>
              </div>
              <div className="bg-gradient-to-br from-teal-50 to-teal-100 border border-teal-200 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <BarChart2 className="w-4 h-4 text-teal-600" />
                  <span className="text-[10px] font-bold text-teal-700 uppercase tracking-wide">Avg Interview Duration</span>
                </div>
                <div className="text-3xl font-bold text-teal-700">
                  {kpi?.avg_interview_min != null ? `${kpi.avg_interview_min}m` : '—'}
                </div>
                <div className="text-[11px] text-teal-500 mt-0.5">Start → submission</div>
              </div>
            </div>

            {/* ── Funnel + Trend ── */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-4">

              {/* Stage Funnel */}
              <div className="lg:col-span-3 bg-white border border-gray-200 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-1">
                  <Target className="w-4 h-4 text-purple-600" />
                  <h2 className="font-semibold text-gray-800">Interview Stage Funnel</h2>
                </div>
                <p className="text-[10px] text-gray-400 mb-4">
                  Cumulative — each stage shows all candidates who reached AT LEAST that stage. "Passed" = moved to next stage.
                </p>
                {!data.funnel.length ? (
                  <p className="text-sm text-gray-400 text-center py-6">No stage data for this period</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {data.funnel.map((row, i) => (
                      <FunnelCard
                        key={row.stage}
                        row={row}
                        prev={i > 0 ? data.funnel[i - 1] : undefined}
                        isFirst={i === 0}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Daily Trend */}
              <div className="lg:col-span-2 bg-white border border-gray-200 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="w-4 h-4 text-purple-600" />
                  <h2 className="font-semibold text-gray-800">Daily Activity</h2>
                </div>
                <p className="text-[10px] text-gray-400 mb-4">Submissions per day — hover for details</p>
                <TrendChart rows={data.trend} />
              </div>
            </div>

            {/* ── Process + VOC + Source ── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

              {/* Process */}
              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Briefcase className="w-4 h-4 text-blue-600" />
                  <h2 className="font-semibold text-gray-800">By Process</h2>
                </div>
                {!data.byProcess.length ? (
                  <p className="text-sm text-gray-400 text-center py-6">No data</p>
                ) : (
                  <div className="space-y-3">
                    {data.byProcess.map(row => (
                      <div key={row.process}>
                        <div className="flex items-center justify-between text-[11px] mb-1">
                          <span className="font-medium text-gray-700 truncate max-w-[130px]" title={row.process}>{row.process}</span>
                          <span className="text-gray-400 ml-2 shrink-0">{row.selected}/{row.total} · {row.rate}%</span>
                        </div>
                        <HBar val={row.selected} total={row.total} color="bg-blue-400" />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* VOC */}
              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-4">
                  <XCircle className="w-4 h-4 text-red-500" />
                  <h2 className="font-semibold text-gray-800">Top Rejection Reasons</h2>
                </div>
                {!data.voc.length ? (
                  <p className="text-sm text-gray-400 text-center py-6">No VOC data</p>
                ) : (() => {
                  const total = data.voc.reduce((s, r) => s + r.cnt, 0);
                  return (
                    <div className="space-y-3">
                      {data.voc.map(row => (
                        <div key={row.voc_reason}>
                          <div className="flex items-center justify-between text-[11px] mb-1">
                            <span className="font-medium text-gray-700 truncate max-w-[150px]" title={row.voc_reason}>{row.voc_reason}</span>
                            <span className="text-gray-400 ml-2 shrink-0">{row.cnt} · {pct(row.cnt, total)}%</span>
                          </div>
                          <HBar val={row.cnt} total={total} color="bg-red-400" />
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* Source */}
              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Megaphone className="w-4 h-4 text-teal-600" />
                  <h2 className="font-semibold text-gray-800">By Hiring Source</h2>
                </div>
                {!data.bySource.length ? (
                  <p className="text-sm text-gray-400 text-center py-6">No source data</p>
                ) : (() => {
                  const maxSrc = Math.max(...data.bySource.map(r => r.total), 1);
                  return (
                    <div className="space-y-3">
                      {data.bySource.map(row => (
                        <div key={row.source}>
                          <div className="flex items-center justify-between text-[11px] mb-1">
                            <span className="font-medium text-gray-700 truncate max-w-[130px]" title={row.source}>{row.source}</span>
                            <span className="text-gray-400 ml-2 shrink-0">{row.selected}/{row.total} · {pct(n(row.selected), row.total)}%</span>
                          </div>
                          <HBar val={row.total} total={maxSrc} color="bg-teal-400" />
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
