import { useEffect, useMemo, useState } from 'react';
import { hrmsApi } from '@/lib/hrmsApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { AlertTriangle, Award, Building2, CalendarDays, CheckCircle2, Clock, TrendingUp, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types — mirrors backend/src/modules/ats/branch-activity-report/metrics.ts ReportData ──

interface SlaStat {
  met: number;
  breached: number;
  measured: number;
  population: number;
  coveragePct: number;
  reliable: boolean;
  pct: number | null;
  avgMin: number | null;
  p90Min: number | null;
}

interface Summary {
  walkins: number;
  tokens: number;
  called: number;
  closed: number;
  interviewed: number;
  selected: number;
  rejected: number;
  noShow: number;
  walkout: number;
  hold: number;
  clientRound: number;
  open: number;
  joined: number;
  formsSubmitted: number;
  formsFromEarlier: number;
  callPct: number;
  closurePct: number;
  selectionPct: number;
  yieldPct: number;
  sla1: SlaStat;
  sla2: SlaStat;
}

type EscalationLevel = 1 | 2 | 3;

interface Escalation {
  level: EscalationLevel;
  escalateTo: string;
  branch: string;
  tokenNumber: string;
  candidateName: string;
  process: string;
  recruiter: string;
  stage: string;
  arrivalHhmm: string;
  arrivalDate: string;
  runningMin: number;
  stageSlaMin: number;
  overSlaMin: number;
  totalAgeMin: number;
}

interface RecruiterRow {
  recruiter: string;
  ftd: Summary;
  wtd: Summary;
  mtd: Summary;
  openNow: number;
  worstOpenMin: number;
}

interface ProcessRow {
  process: string;
  ftd: Summary;
  wtd: Summary;
  mtd: Summary;
}

interface BranchBlock {
  branch: string;
  ftd: Summary;
  wtd: Summary;
  mtd: Summary;
  recruiters: RecruiterRow[];
  processes: ProcessRow[];
  escalations: Escalation[];
}

interface DataQuality {
  closedWithoutCallTime: number;
  negativeDurations: number;
  walkinsWithoutToken: number;
  staleOpenTokens: number;
  instantClosures: number;
  measuredHandle: number;
}

interface ReportData {
  reportDate: string;
  weekStart: string;
  monthStart: string;
  overall: { ftd: Summary; wtd: Summary; mtd: Summary };
  branches: BranchBlock[];
  escalations: Escalation[];
  onTrackOpen: number;
  dataQuality: DataQuality;
}

type Period = 'ftd' | 'wtd' | 'mtd';

// ── Formatting helpers (same rules as the email template) ──────────────────────────────────

const n = (v: number) => v.toLocaleString('en-IN');
const pct = (v: number | null) => (v == null ? '—' : `${v}%`);
function fmtMin(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m) || m < 0) return '—';
  const r = Math.round(m);
  if (r < 60) return `${r}m`;
  const h = Math.floor(r / 60);
  if (h < 48) return `${h}h ${String(r % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

const PERIOD_LABEL: Record<Period, string> = { ftd: 'Today', wtd: 'Week to date', mtd: 'Month to date' };

const LEVEL_META: Record<EscalationLevel, { label: string; className: string }> = {
  3: { label: 'L3 · HR Head', className: 'bg-red-600 text-white hover:bg-red-600' },
  2: { label: 'L2 · Branch Head', className: 'bg-orange-500 text-white hover:bg-orange-500' },
  1: { label: 'L1 · Recruiter', className: 'bg-amber-100 text-amber-800 hover:bg-amber-100' },
};

function slaBadgeClass(s: SlaStat): string {
  if (!s.reliable) return 'bg-gray-100 text-gray-500 hover:bg-gray-100';
  if (s.pct == null) return 'bg-gray-100 text-gray-500 hover:bg-gray-100';
  if (s.pct >= 90) return 'bg-green-100 text-green-700 hover:bg-green-100';
  if (s.pct >= 70) return 'bg-amber-100 text-amber-700 hover:bg-amber-100';
  return 'bg-red-100 text-red-700 hover:bg-red-100';
}

// ── KPI card ─────────────────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, icon: Icon, tone = 'default',
}: {
  label: string; value: string; sub?: string; icon: React.ComponentType<{ className?: string }>;
  tone?: 'default' | 'green' | 'red' | 'blue';
}) {
  const toneClass = {
    default: 'text-gray-900', green: 'text-green-600', red: 'text-red-600', blue: 'text-blue-600',
  }[tone];
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-600">{label}</span>
        <Icon className="w-5 h-5 text-gray-400" />
      </div>
      <p className={cn('text-2xl font-bold', toneClass)}>{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

// ── Funnel chart (recharts, one bar per stage, coloured by outcome) ────────────────────────

/** [label, value, index of the step its conversion % is measured against]. */
function funnelStages(s: Summary): Array<{ stage: string; value: number; convFrom: number | null }> {
  const raw: Array<[string, number, number]> = [
    ['Walk-in', s.walkins, -1], ['Token', s.tokens, 0], ['Called', s.called, 1], ['Closed', s.closed, 1],
    ['Interviewed', s.interviewed, 3], ['Selected', s.selected, 4], ['Joined', s.joined, 5],
  ];
  return raw.map(([stage, value, parent], i) => ({
    stage, value, convFrom: parent < 0 ? null : Math.round((value / Math.max(1, raw[parent][1])) * 100),
  }));
}

const FUNNEL_COLORS = ['#64748b', '#64748b', '#64748b', '#64748b', '#64748b', '#16a34a', '#0f766e'];

function FunnelChart({ summary }: { summary: Summary }) {
  const data = useMemo(() => funnelStages(summary), [summary]);
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} layout="vertical" margin={{ left: 24, right: 24 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
        <XAxis type="number" stroke="#6b7280" fontSize={12} allowDecimals={false} />
        <YAxis type="category" dataKey="stage" stroke="#6b7280" fontSize={12} width={80} />
        <Tooltip
          formatter={(value: number, _key, ctx) => {
            const conv = (ctx?.payload as { convFrom: number | null })?.convFrom;
            return [conv == null ? n(value) : `${n(value)} (${conv}%)`, 'Count'];
          }}
          contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12px' }}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
          {data.map((d, i) => <Cell key={d.stage} fill={FUNNEL_COLORS[i]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Escalations ──────────────────────────────────────────────────────────────────────────

function EscalationsPanel({ escalations, onTrackOpen }: { escalations: Escalation[]; onTrackOpen: number }) {
  const counts = (level: EscalationLevel) => escalations.filter((e) => e.level === level).length;
  if (escalations.length === 0) {
    return (
      <div className="flex items-center gap-2 p-4 bg-green-50 text-green-700 rounded-lg text-sm font-medium">
        <CheckCircle2 className="w-5 h-5" />
        All open tokens are inside their SLA — nothing to escalate.
        {onTrackOpen > 0 && <span className="text-green-600 font-normal">({onTrackOpen} open, still within SLA)</span>}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Badge className={LEVEL_META[3].className}>{LEVEL_META[3].label} · {counts(3)}</Badge>
        <Badge className={LEVEL_META[2].className}>{LEVEL_META[2].label} · {counts(2)}</Badge>
        <Badge className={LEVEL_META[1].className}>{LEVEL_META[1].label} · {counts(1)}</Badge>
        <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Open, inside SLA · {onTrackOpen}</Badge>
      </div>
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50">
              <TableHead>Escalate</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead>Token</TableHead>
              <TableHead>Candidate</TableHead>
              <TableHead>Recruiter</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead className="text-right">Clock running</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {escalations.map((e) => (
              <TableRow key={`${e.branch}-${e.tokenNumber}`}>
                <TableCell><Badge className={LEVEL_META[e.level].className}>{LEVEL_META[e.level].label}</Badge></TableCell>
                <TableCell className="text-sm">{e.branch}</TableCell>
                <TableCell className="text-sm font-medium">{e.tokenNumber}</TableCell>
                <TableCell className="text-sm">{e.candidateName}</TableCell>
                <TableCell className="text-sm">{e.recruiter}</TableCell>
                <TableCell className="text-sm">{e.stage}</TableCell>
                <TableCell className="text-right text-sm">
                  <span className="font-semibold text-red-600">{fmtMin(e.runningMin)}</span>
                  <span className="text-gray-400"> (+{fmtMin(e.overSlaMin)} over {fmtMin(e.stageSlaMin)})</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-gray-500">
        Clock = time since arrival while waiting for the call, then time since the interview call until the recruiter closes the token.
      </p>
    </div>
  );
}

// ── SLA scorecard ────────────────────────────────────────────────────────────────────────

function SlaScorecard({ overall, period }: { overall: ReportData['overall']; period: Period }) {
  const s = overall[period];
  const rows: Array<{ label: string; target: string; stat: SlaStat }> = [
    { label: 'SLA 1 · Waiting → Interview call', target: '≤ 20m from token', stat: s.sla1 },
    { label: 'SLA 2 · Interview call → Token closure', target: '≤ 2h 00m from call', stat: s.sla2 },
  ];
  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <Table>
        <TableHeader>
          <TableRow className="bg-gray-50">
            <TableHead>SLA</TableHead>
            <TableHead>Target</TableHead>
            <TableHead className="text-right">Met</TableHead>
            <TableHead className="text-right">Avg</TableHead>
            <TableHead className="text-right">P90</TableHead>
            <TableHead className="text-right">Breaches</TableHead>
            <TableHead className="text-right">Data coverage</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.label}>
              <TableCell className="text-sm font-medium">{r.label}</TableCell>
              <TableCell className="text-sm text-gray-500">{r.target}</TableCell>
              <TableCell className="text-right"><Badge className={slaBadgeClass(r.stat)}>{r.stat.reliable ? pct(r.stat.pct) : 'n/a'}</Badge></TableCell>
              <TableCell className="text-right text-sm">{fmtMin(r.stat.avgMin)}</TableCell>
              <TableCell className="text-right text-sm">{fmtMin(r.stat.p90Min)}</TableCell>
              <TableCell className="text-right text-sm font-semibold text-red-600">{n(r.stat.breached)}</TableCell>
              <TableCell className="text-right text-sm text-gray-500">{r.stat.measured}/{r.stat.population} · {r.stat.coveragePct}%</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Performance summary table ────────────────────────────────────────────────────────────

const METRIC_ROWS: Array<{ label: string; get: (s: Summary) => string; strong?: boolean; tone?: (s: Summary) => string }> = [
  { label: 'Walk-ins', get: (s) => n(s.walkins), strong: true },
  { label: 'Tokens generated', get: (s) => n(s.tokens), strong: true },
  { label: 'Interview called', get: (s) => n(s.called) },
  { label: 'Token closed', get: (s) => n(s.closed) },
  { label: 'Interview updates filed', get: (s) => `${n(s.formsSubmitted)}${s.formsFromEarlier ? ` (${n(s.formsFromEarlier)} old)` : ''}` },
  { label: 'Interviewed', get: (s) => n(s.interviewed) },
  { label: 'Selected', get: (s) => n(s.selected), strong: true, tone: () => 'text-green-600' },
  { label: 'Rejected', get: (s) => n(s.rejected) },
  { label: 'No-show', get: (s) => n(s.noShow) },
  { label: 'Walk-out', get: (s) => n(s.walkout) },
  { label: 'Hold / Client round', get: (s) => n(s.hold + s.clientRound) },
  { label: 'Closure pending (open)', get: (s) => n(s.open), strong: true, tone: (s) => (s.open > 0 ? 'text-red-600' : 'text-green-600') },
  { label: 'Token closure %', get: (s) => pct(s.closurePct) },
  { label: 'Selection % (of interviewed)', get: (s) => pct(s.selectionPct), strong: true },
  { label: 'Yield % (selected ÷ walk-ins)', get: (s) => pct(s.yieldPct) },
];

function PerformanceTable({ ftd, wtd, mtd }: { ftd: Summary; wtd: Summary; mtd: Summary }) {
  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <Table>
        <TableHeader>
          <TableRow className="bg-gray-50">
            <TableHead>Metric</TableHead>
            <TableHead className="text-right">Today</TableHead>
            <TableHead className="text-right">Week to date</TableHead>
            <TableHead className="text-right">Month to date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {METRIC_ROWS.map((m) => (
            <TableRow key={m.label}>
              <TableCell className={cn('text-sm', m.strong && 'font-semibold')}>{m.label}</TableCell>
              {[ftd, wtd, mtd].map((s, i) => (
                <TableCell key={i} className={cn('text-right text-sm', m.strong && 'font-semibold', m.tone?.(s))}>{m.get(s)}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Recruiter table (per branch) ─────────────────────────────────────────────────────────

function RecruiterTable({ recruiters }: { recruiters: RecruiterRow[] }) {
  const active = recruiters.filter((r) => r.ftd.tokens > 0 || r.openNow > 0 || r.ftd.formsSubmitted > 0);
  const idle = recruiters.length - active.length;
  if (recruiters.length === 0) return <p className="text-sm text-gray-500">No recruiter activity recorded.</p>;
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50">
              <TableHead>Recruiter</TableHead>
              <TableHead className="text-right">Tkn</TableHead>
              <TableHead className="text-right">Called</TableHead>
              <TableHead className="text-right">Closed</TableHead>
              <TableHead className="text-right">Sel</TableHead>
              <TableHead className="text-right">Rej</TableHead>
              <TableHead className="text-right">NS</TableHead>
              <TableHead className="text-right">Open</TableHead>
              <TableHead className="text-right">SLA-1</TableHead>
              <TableHead className="text-right">SLA-2</TableHead>
              <TableHead className="text-right">Mth Tkn</TableHead>
              <TableHead className="text-right">Mth Sel%</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {active.map((r) => (
              <TableRow key={r.recruiter}>
                <TableCell className="text-sm font-medium">{r.recruiter}</TableCell>
                <TableCell className="text-right text-sm">{n(r.ftd.tokens)}</TableCell>
                <TableCell className="text-right text-sm">{n(r.ftd.called)}</TableCell>
                <TableCell className="text-right text-sm">{n(r.ftd.closed)}</TableCell>
                <TableCell className="text-right text-sm font-semibold text-green-600">{n(r.ftd.selected)}</TableCell>
                <TableCell className="text-right text-sm">{n(r.ftd.rejected)}</TableCell>
                <TableCell className="text-right text-sm">{n(r.ftd.noShow)}</TableCell>
                <TableCell className="text-right text-sm">
                  {r.openNow > 0
                    ? <span className="font-semibold text-red-600">{r.openNow} <span className="font-normal text-gray-400">({fmtMin(r.worstOpenMin)})</span></span>
                    : <span className="text-green-600">0</span>}
                </TableCell>
                <TableCell className="text-right"><Badge className={slaBadgeClass(r.ftd.sla1)}>{r.ftd.sla1.reliable ? pct(r.ftd.sla1.pct) : 'n/a'}</Badge></TableCell>
                <TableCell className="text-right"><Badge className={slaBadgeClass(r.ftd.sla2)}>{r.ftd.sla2.reliable ? pct(r.ftd.sla2.pct) : 'n/a'}</Badge></TableCell>
                <TableCell className="text-right text-sm">{n(r.mtd.tokens)}</TableCell>
                <TableCell className="text-right text-sm">{pct(r.mtd.selectionPct)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-gray-500">
        Today's figures except the last two columns. Tkn = tokens issued · NS = no-show · Open = closure pending (oldest wait shown).
        {idle > 0 && ` ${idle} recruiter${idle > 1 ? 's' : ''} with no activity today not shown.`}
      </p>
    </div>
  );
}

// ── Process breakdown table (per branch) ─────────────────────────────────────────────────

function ProcessTable({ processes, period }: { processes: ProcessRow[]; period: Period }) {
  if (processes.length === 0) return <p className="text-sm text-gray-500">No process data recorded.</p>;
  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <Table>
        <TableHeader>
          <TableRow className="bg-gray-50">
            <TableHead>Process</TableHead>
            <TableHead className="text-right">Walk-ins</TableHead>
            <TableHead className="text-right">Called</TableHead>
            <TableHead className="text-right">Closed</TableHead>
            <TableHead className="text-right">Selected</TableHead>
            <TableHead className="text-right">Rejected</TableHead>
            <TableHead className="text-right">No-show</TableHead>
            <TableHead className="text-right">Open</TableHead>
            <TableHead className="text-right">Sel%</TableHead>
            <TableHead className="text-right">Yield%</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {processes.map((p) => {
            const s = p[period];
            return (
              <TableRow key={p.process}>
                <TableCell className="text-sm font-medium">{p.process}</TableCell>
                <TableCell className="text-right text-sm font-semibold">{n(s.walkins)}</TableCell>
                <TableCell className="text-right text-sm">{n(s.called)}</TableCell>
                <TableCell className="text-right text-sm">{n(s.closed)}</TableCell>
                <TableCell className="text-right text-sm font-semibold text-green-600">{n(s.selected)}</TableCell>
                <TableCell className="text-right text-sm">{n(s.rejected)}</TableCell>
                <TableCell className="text-right text-sm">{n(s.noShow)}</TableCell>
                <TableCell className="text-right text-sm">
                  {s.open > 0
                    ? <span className="font-semibold text-red-600">{s.open}</span>
                    : <span className="text-green-600">0</span>}
                </TableCell>
                <TableCell className="text-right text-sm">{pct(s.selectionPct)}</TableCell>
                <TableCell className="text-right text-sm">{pct(s.yieldPct)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Branch panel ─────────────────────────────────────────────────────────────────────────

function BranchPanel({ branch, period }: { branch: BranchBlock; period: Period }) {
  const s = branch[period];
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Building2 className="w-4 h-4 text-gray-400" />
          {branch.branch}
        </CardTitle>
        <div className="text-xs text-gray-500">
          {PERIOD_LABEL[period]} · {n(s.walkins)} walk-ins · <span className="text-green-600 font-medium">{n(s.selected)} selected</span>
          {s.open > 0 && <> · <span className="text-red-600 font-medium">{n(s.open)} open</span></>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <PerformanceTable ftd={branch.ftd} wtd={branch.wtd} mtd={branch.mtd} />
        {branch.escalations.length > 0 && (
          <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              <b>{branch.escalations.length} token{branch.escalations.length > 1 ? 's' : ''} past SLA</b>
              {' — oldest: '}{branch.escalations[0].tokenNumber} · {branch.escalations[0].recruiter} · {fmtMin(branch.escalations[0].runningMin)}
            </span>
          </div>
        )}
        {branch.processes && branch.processes.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Process-wise activity</p>
            <ProcessTable processes={branch.processes} period={period} />
          </div>
        )}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Recruiter-wise activity</p>
          <RecruiterTable recruiters={branch.recruiters} />
        </div>
      </CardContent>
    </Card>
  );
}

// ── Root component ───────────────────────────────────────────────────────────────────────

function todayISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

export default function BranchActivityReportTab() {
  const [date, setDate] = useState(todayISO());
  const [report, setReport] = useState<ReportData | null>(null);
  const [period, setPeriod] = useState<Period>('ftd');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    hrmsApi
      .get<{ success: boolean; data: ReportData }>(`/api/ats/branch-activity-report?date=${date}`)
      .then((res) => { if (!cancelled) setReport(res.data); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load report'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [date]);

  if (loading && !report) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-10 h-10 border-4 border-purple-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return <div className="p-4 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>;
  }

  if (!report) return null;

  const { overall } = report;
  const s = overall[period];
  const pendingCount = report.escalations.length + report.onTrackOpen;

  return (
    <div className="space-y-6">
      {/* Date + period controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-gray-400" />
          <input
            type="date"
            value={date}
            max={todayISO()}
            onChange={(e) => setDate(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
          />
        </div>
        <div className="flex rounded-lg border border-gray-200 overflow-hidden">
          {(['ftd', 'wtd', 'mtd'] as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={cn(
                'px-3 py-1.5 text-sm font-medium transition-colors',
                period === p ? 'bg-purple-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50',
              )}
            >
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <KpiCard label="Walk-ins" value={n(s.walkins)} sub={`Month ${n(overall.mtd.walkins)}`} icon={Users} />
        <KpiCard label="Tokens" value={n(s.tokens)} sub={`Month ${n(overall.mtd.tokens)}`} icon={TrendingUp} />
        <KpiCard label="Tokens closed" value={n(s.closed)} sub={`Month ${n(overall.mtd.closed)}`} icon={CheckCircle2} tone="blue" />
        <KpiCard label="Selected" value={n(s.selected)} sub={`Month ${n(overall.mtd.selected)}`} icon={Award} tone="green" />
        <KpiCard label="Closure pending" value={n(pendingCount)} sub={`Month ${n(overall.mtd.open)}`} icon={AlertTriangle} tone={pendingCount > 0 ? 'red' : 'green'} />
        <KpiCard
          label="SLA-2 met"
          value={s.sla2.reliable ? pct(s.sla2.pct) : 'n/a'}
          sub={`Month ${overall.mtd.sla2.reliable ? pct(overall.mtd.sla2.pct) : 'n/a'}`}
          icon={Clock}
          tone={s.sla2.reliable && (s.sla2.pct ?? 0) >= 90 ? 'green' : s.sla2.reliable ? 'red' : 'default'}
        />
      </div>

      {/* Escalations */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            Escalations — token closure pending
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EscalationsPanel escalations={report.escalations} onTrackOpen={report.onTrackOpen} />
        </CardContent>
      </Card>

      {/* Performance summary (all branches combined) */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Performance summary — all branches</CardTitle></CardHeader>
        <CardContent><PerformanceTable ftd={overall.ftd} wtd={overall.wtd} mtd={overall.mtd} /></CardContent>
      </Card>

      {/* Funnel */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recruitment funnel — {PERIOD_LABEL[period]}</CardTitle>
        </CardHeader>
        <CardContent><FunnelChart summary={s} /></CardContent>
      </Card>

      {/* SLA scorecard */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">SLA scorecard</CardTitle></CardHeader>
        <CardContent><SlaScorecard overall={overall} period={period} /></CardContent>
      </Card>

      {/* Per-branch panels */}
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-400 mb-3">Branch-wise activity</h3>
        <div className="space-y-4">
          {report.branches
            .slice()
            .sort((a, b) => b.ftd.walkins - a.ftd.walkins)
            .map((b) => <BranchPanel key={b.branch} branch={b} period={period} />)}
        </div>
      </div>
    </div>
  );
}
