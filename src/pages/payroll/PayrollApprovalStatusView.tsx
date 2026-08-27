import { useEffect, useState, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { hrmsApi } from '@/lib/hrmsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Loader2, Search, RefreshCw, ShieldCheck, Clock, AlertTriangle,
  CheckCircle2, Building2, Briefcase, IndianRupee, ChevronRight,
  Check, X, HelpCircle,
} from 'lucide-react';
import {
  STATUS_CFG, AgingChip, OfferedSalarySection, FinalSalarySection, BgvSection, BankSection,
  SECTION_META, sectionStatus,
  inr, fmtDate, fmtTs,
  type QueueRow, type SectionKey,
} from './PayrollHeadSalaryReviewQueue';

/**
 * Read-only view for Branch Head / Payroll HR: which of their onboarded employees are still
 * waiting on Payroll Head's salary approval, and for the approved ones, what package and
 * salary date Payroll Head actually assigned.
 *
 * Backed by the SAME /api/payroll-head-review/queue and /:employeeId endpoints the full
 * Salary Review Queue uses — that endpoint already branch/process-scopes payroll_hr/branch_head
 * server-side (see payroll-head-review.service.ts getQueue()), so this page shows exactly what
 * each caller is allowed to see, nothing more. Every section component below is reused verbatim
 * from the Queue page with isReviewer={false} — they already hide every action button under
 * that flag, so this page has zero new write paths, purely a read surface.
 */

/**
 * The queue row plus the three-stage approval chain the list endpoint now returns.
 * Every field is optional: a row whose candidate has no validation/branch-approval record
 * behind it must render as "Not recorded", never as a silently-cleared stage.
 */
export interface ChainRow extends QueueRow {
  /** Selected by the queue endpoint but absent from QueueRow — used for the rejection tooltip. */
  rejection_remarks?: string | null;
  phr_status?: string | null;
  phr_at?: string | null;
  phr_by?: string | null;
  bh_status?: string | null;
  bh_at?: string | null;
  bh_by?: string | null;
  bh_remarks?: string | null;
  phr_by_employee_id?: string | null;
  bh_by_employee_id?: string | null;
  stage1_minutes?: number | null;
  stage2_minutes?: number | null;
  ph_by?: string | null;
}

// ── Approval chain ────────────────────────────────────────────────────────────
// The three sign-offs that produce a payroll-approved employee, in the order they run:
// Payroll HR validates the package, the Branch Head approves it, the Payroll Head decides.
// The first two already happened before this review row existed — they were simply never
// shown anywhere on this page, so a Branch Head could not see their own approval land.

type StageTone = 'done' | 'wait' | 'late' | 'bad' | 'idle';

const STAGE_TONE: Record<StageTone, { dot: string; icon: any; actor: string }> = {
  done: { dot: 'bg-emerald-50 border-emerald-200 text-emerald-600', icon: Check,      actor: 'text-slate-600' },
  wait: { dot: 'bg-amber-50 border-amber-200 text-amber-600',       icon: Clock,      actor: 'text-amber-600' },
  late: { dot: 'bg-red-50 border-red-200 text-red-600',             icon: Clock,      actor: 'text-red-600'   },
  bad:  { dot: 'bg-rose-50 border-rose-200 text-rose-600',          icon: X,          actor: 'text-rose-600'  },
  idle: { dot: 'bg-slate-50 border-dashed border-slate-300 text-slate-400', icon: HelpCircle, actor: 'text-slate-400' },
};

const SEG_LINE: Record<StageTone, string> = {
  done: 'border-emerald-200',
  wait: 'border-amber-300 border-dashed',
  late: 'border-red-300 border-dashed',
  bad:  'border-rose-200',
  idle: 'border-slate-200 border-dashed',
};

const titleCase = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

/** "SUDEEP NEGI" → "Sudeep N." — keeps the given name, which is what people are called here. */
function shortName(n: string | null | undefined): string | null {
  if (!n) return null;
  const parts = n.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  if (parts.length === 1) return titleCase(parts[0]);
  return `${titleCase(parts[0])} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/** Compact stamp for the node line: "26 Aug 12:27". Full timestamp lives in the tooltip. */
const fmtStamp = (d: string | null | undefined) => {
  if (!d) return '—';
  const dt = new Date(d);
  return `${String(dt.getDate()).padStart(2, '0')} ${dt.toLocaleString('en-IN', { month: 'short' })} `
    + `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
};

/** Minutes → the coarsest unit that still reads true. Under an hour is "<1h", not "0h". */
const fmtGap = (mins: number | null | undefined) => {
  if (mins == null || Number.isNaN(Number(mins))) return '—';
  const m = Math.max(0, Number(mins));
  if (m < 60) return '<1h';
  if (m < 48 * 60) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
};

interface Stage { label: string; tone: StageTone; actor: string; at: string | null; title: string; }

function buildStages(row: ChainRow): { stages: [Stage, Stage, Stage]; segs: [StageTone, StageTone] } {
  // 1 — Payroll HR validation.
  const phrSt = (row.phr_status ?? '').toLowerCase();
  const phrDone = phrSt === 'validated' || phrSt === 'approved';
  const payrollHr: Stage = !phrSt && !row.phr_at
    ? { label: 'Payroll HR', tone: 'idle', actor: 'Not recorded', at: null,
        title: 'Payroll HR — no validation record exists for this candidate' }
    : { label: 'Payroll HR', tone: phrDone ? 'done' : 'wait',
        actor: shortName(row.phr_by) ?? (phrDone ? 'Validated' : 'Pending'),
        at: row.phr_at ?? null,
        title: `Payroll HR — offer raised by ${row.phr_by ?? 'name not recorded'} · ${phrSt || 'status not recorded'}`
             + (row.phr_at ? ` · ${fmtTs(row.phr_at)}` : '') };

  // 2 — Branch Head approval.
  const bhSt = (row.bh_status ?? '').toLowerCase();
  const bhTone: StageTone = bhSt === 'approved' ? 'done'
    : bhSt === 'rejected' || bhSt === 'sent_back' ? 'bad'
    : bhSt === 'pending' ? 'wait' : 'idle';
  const branchHead: Stage = !bhSt
    ? { label: 'Branch Head', tone: 'idle', actor: 'Not recorded', at: null,
        title: 'Branch Head — no approval record exists for this candidate' }
    : { label: 'Branch Head', tone: bhTone,
        actor: shortName(row.bh_by) ?? bhSt.replace('_', ' '),
        at: row.bh_at ?? null,
        title: `Branch Head — ${row.bh_by ?? 'name not recorded'} · ${bhSt.replace('_', ' ')}`
             + (row.bh_at ? ` · ${fmtTs(row.bh_at)}` : '')
             + (row.bh_remarks ? `\n${row.bh_remarks}` : '') };

  // 3 — Payroll Head decision. This is the row's own status, so it is never "not recorded".
  const overdue = row.status === 'pending_review' && row.pending_hours >= 48;
  const payrollHead: Stage = row.status === 'approved'
    ? { label: 'Payroll Head', tone: 'done', actor: shortName(row.ph_by) ?? 'Approved', at: row.reviewed_at,
        title: `Payroll Head — approved by ${row.ph_by ?? 'name not recorded'}`
             + (row.reviewed_at ? ` · ${fmtTs(row.reviewed_at)}` : '') }
    : row.status === 'rejected'
    ? { label: 'Payroll Head', tone: 'bad',
        actor: [row.rejection_category, row.rejection_reason_code].filter(Boolean).join(' · ') || 'Rejected',
        at: row.reviewed_at,
        title: `Payroll Head — rejected by ${row.ph_by ?? 'name not recorded'}`
             + (row.reviewed_at ? ` · ${fmtTs(row.reviewed_at)}` : '')
             + (row.rejection_remarks ? `\n${row.rejection_remarks}` : '') }
    : { label: 'Payroll Head', tone: overdue ? 'late' : 'wait',
        actor: overdue ? 'Overdue' : 'Awaiting', at: null,
        title: `Payroll Head — pending for ${row.pending_hours}h` };

  // A segment is only as settled as the stage it leads into.
  const seg1: StageTone = branchHead.tone === 'idle' ? 'idle' : 'done';
  const seg2: StageTone = payrollHead.tone === 'wait' ? 'wait'
    : payrollHead.tone === 'late' ? 'late' : 'done';
  return { stages: [payrollHr, branchHead, payrollHead], segs: [seg1, seg2] };
}

function ChainNode({ stage }: { stage: Stage }) {
  const t = STAGE_TONE[stage.tone];
  const Icon = t.icon;
  return (
    <div className="w-[76px] flex-none flex flex-col items-center gap-0.5 text-center" title={stage.title}>
      <span className={`h-[19px] w-[19px] rounded-full border flex items-center justify-center ${t.dot}`}>
        <Icon className="h-2.5 w-2.5" strokeWidth={3} />
      </span>
      <span className="text-[8.5px] font-bold uppercase tracking-wide text-slate-400 leading-tight">{stage.label}</span>
      <span className={`text-[10.5px] font-semibold leading-tight max-w-[76px] truncate ${t.actor}`}>{stage.actor}</span>
      <span className="text-[9.5px] text-slate-400 tabular-nums leading-tight">{fmtStamp(stage.at)}</span>
    </div>
  );
}

function ChainSegment({ tone, label, title }: { tone: StageTone; label: string; title?: string }) {
  return (
    <div className="flex-1 min-w-[26px] flex flex-col items-center gap-1 pt-[9px]" title={title}>
      <span className={`w-full border-t-2 ${SEG_LINE[tone]}`} />
      <span className={`text-[9px] whitespace-nowrap leading-none ${
        tone === 'late' ? 'text-red-600 font-semibold' : tone === 'wait' ? 'text-amber-600' : 'text-slate-400'
      }`}>{label}</span>
    </div>
  );
}

function ApprovalChain({ row }: { row: ChainRow }) {
  const { stages, segs } = buildStages(row);
  // Only flagged when the person who raised the offer really is the person who approved it as
  // Branch Head — 1 of 23 live, and that one is a test record. (The earlier reading of "29 of
  // 31" came from ats_payroll_hr_validation.payroll_hr_id, which later writers overwrite with
  // the approver, so it was an artefact of that column, not a separation-of-duties problem.)
  const sameActor = !!row.phr_by_employee_id && row.phr_by_employee_id === row.bh_by_employee_id;
  return (
    <div className="hidden xl:flex items-start flex-[1.3] min-w-[284px] px-1">
      <ChainNode stage={stages[0]} />
      {sameActor ? (
        <div className="flex-1 min-w-[26px] flex flex-col items-center gap-1 pt-[9px]"
             title={`Offer raised and branch-approved by the same person (${row.phr_by ?? 'unknown'})`}>
          <span className={`w-full border-t-2 ${SEG_LINE[segs[0]]}`} />
          <span className="text-[8.5px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 leading-[14px]">
            same
          </span>
        </div>
      ) : (
        <ChainSegment tone={segs[0]} label={fmtGap(row.stage1_minutes)}
          title={`${fmtGap(row.stage1_minutes)} between the offer being raised and Branch Head approval`} />
      )}
      <ChainNode stage={stages[1]} />
      <ChainSegment tone={segs[1]} label={fmtGap(row.stage2_minutes)}
        title={row.status === 'pending_review'
          ? `Waiting ${fmtGap(row.stage2_minutes)} on the Payroll Head`
          : `${fmtGap(row.stage2_minutes)} from Branch Head approval to the Payroll Head's decision`} />
      <ChainNode stage={stages[2]} />
    </div>
  );
}

/** Below xl the chain collapses to three dots plus whichever stage currently holds the record. */
function ChainPill({ row }: { row: ChainRow }) {
  const { stages } = buildStages(row);
  const held = stages.find((s) => s.tone === 'wait' || s.tone === 'late' || s.tone === 'bad') ?? stages[2];
  return (
    <span className="xl:hidden inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 mt-1">
      {stages.map((s, i) => {
        const t = STAGE_TONE[s.tone];
        const Icon = t.icon;
        return (
          <span key={i} className={`h-3.5 w-3.5 rounded-full border flex items-center justify-center ${t.dot}`} title={s.title}>
            <Icon className="h-2 w-2" strokeWidth={3} />
          </span>
        );
      })}
      <span className="text-[10px] font-semibold text-slate-500">{held.label} · {held.actor}</span>
    </span>
  );
}

// ── Readiness tiles ───────────────────────────────────────────────────────────
// The same BGV and Bank readiness the Payroll Head's own queue shows, driven by the same
// sectionStatus() so the two pages can never disagree about what a status means.

const TILE_TONE: Record<string, string> = {
  good:    'border-emerald-200 bg-emerald-50/60 text-emerald-700',
  warn:    'border-amber-200 bg-amber-50/60 text-amber-700',
  bad:     'border-red-200 bg-red-50/60 text-red-700',
  neutral: 'border-slate-200 bg-slate-50/60 text-slate-500',
};

const TILE_PIP: Record<string, string> = {
  good: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-red-500', neutral: 'bg-slate-300',
};

function ReadinessTile({ section, row, onOpen }: { section: SectionKey; row: ChainRow; onOpen: () => void }) {
  const meta = SECTION_META[section];
  const Icon = meta.icon;
  // No summary means the row fell outside the server's enrichment cap — say so, rather than
  // showing "Loading…" forever or implying the check came back empty.
  const { text, tone } = row.summary
    ? sectionStatus(section, row)
    : { text: 'Not evaluated', tone: 'neutral' as const };
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
      title={`${meta.label}: ${text}`}
      className={`flex w-full min-w-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-left cursor-pointer transition-colors hover:border-indigo-300 ${TILE_TONE[tone]}`}
    >
      <Icon className="h-2.5 w-2.5 flex-shrink-0 text-slate-400" />
      <span className="text-[8.5px] font-bold uppercase tracking-wide text-slate-500 flex-shrink-0">{meta.label}</span>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${TILE_PIP[tone]}`} />
      <span className="text-[11px] font-semibold truncate">{text}</span>
    </button>
  );
}

// ── Single-section popup ──────────────────────────────────────────────────────
// Clicking a readiness tile opens just that section — the same focused popup the Salary
// Review Queue gives its reviewers, rendered read-only here (isReviewer={false} hides every
// action). Opening the whole drawer to read one BGV status made the tiles pointless.

function ReadOnlySectionDialog({
  section, employeeId, open, onClose,
}: { section: SectionKey | null; employeeId: string | null; open: boolean; onClose: () => void }) {
  const [journey, setJourney] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !employeeId) { setJourney(null); return; }
    setLoading(true);
    hrmsApi.get<{ data: any }>(`/api/payroll-head-review/${employeeId}`)
      .then((r: any) => setJourney(r?.data ?? null))
      .catch(() => setJourney(null))
      .finally(() => setLoading(false));
  }, [open, employeeId]);

  const meta = section ? SECTION_META[section] : null;
  const Icon = meta?.icon;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {Icon && <Icon className="h-4 w-4 text-slate-400" />}
            {meta?.label ?? 'Detail'}
            {journey?.employee?.full_name && (
              <span className="text-xs font-normal text-slate-400">· {journey.employee.full_name}</span>
            )}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
          </div>
        ) : !journey ? (
          <p className="text-sm text-slate-400 py-6 text-center">Could not load this section.</p>
        ) : section === 'bgv' ? (
          <BgvSection
            bgv={journey?.bgv} bgvOverall={journey?.bgv?.overall_status ?? journey?.bgv?.status}
            isReviewer={false} bgvCandidateId={null} bgvManual={() => {}} bgvWaive={() => {}}
          />
        ) : (
          <BankSection bank={journey?.bank} />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Read-only detail dialog ──────────────────────────────────────────────────

function ReadOnlyDetailDialog({
  employeeId, open, onClose,
}: { employeeId: string | null; open: boolean; onClose: () => void }) {
  const [journey, setJourney] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !employeeId) { setJourney(null); return; }
    setLoading(true);
    hrmsApi.get<{ data: any }>(`/api/payroll-head-review/${employeeId}`)
      .then((r: any) => setJourney(r?.data ?? null))
      .catch(() => setJourney(null))
      .finally(() => setLoading(false));
  }, [open, employeeId]);

  const review = journey?.review;
  const employee = journey?.employee;
  const status = review?.status;
  const statusCfg = STATUS_CFG[status as keyof typeof STATUS_CFG] ?? STATUS_CFG.pending_review;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {employee?.full_name ?? '…'}
            {status && (
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold border ${statusCfg.chip}`}>
                <statusCfg.icon className="h-3 w-3" />{statusCfg.label}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
          </div>
        ) : !journey ? (
          <p className="text-sm text-slate-400 py-6 text-center">Could not load this employee.</p>
        ) : (
          <div className="space-y-3">
            <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500 flex flex-wrap gap-x-4 gap-y-1">
              {employee?.employee_code && <span>{employee.employee_code}</span>}
              {employee?.designation_name && <span>{employee.designation_name}</span>}
              {employee?.branch_name && <span>{employee.branch_name}</span>}
              {employee?.cost_centre_name && <span>{employee.cost_centre_name}</span>}
              {employee?.process_name && <span>{employee.process_name}</span>}
            </div>

            {status === 'approved' && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800 space-y-0.5">
                <p className="font-semibold flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" />Approved for payroll</p>
                <p className="text-xs">Payroll effective date: <strong>{fmtDate(review?.package_effective_from)}</strong></p>
                {journey?.payroll_hr_validation?.salary_start_date && (
                  <p className="text-xs">Payroll HR reference date: {fmtDate(journey.payroll_hr_validation.salary_start_date)}</p>
                )}
                {review?.reviewed_at && <p className="text-xs">Approved on {fmtDate(review.reviewed_at)}</p>}
              </div>
            )}
            {status === 'rejected' && review?.rejection_remarks && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                <p className="font-semibold">Rejected — {review.rejection_category} / {review.rejection_reason_code}</p>
                <p className="text-xs mt-1">{review.rejection_remarks}</p>
              </div>
            )}
            {status === 'pending_review' && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700 flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />Still waiting on Payroll Head's decision.
              </div>
            )}

            {journey?.offered_salary && (
              <OfferedSalarySection
                os={journey.offered_salary} sc={journey.salary_components} review={review}
                status={status} isReviewer={false} effectiveDate="" setEffectiveDate={() => {}}
                busy={false} onApprove={() => {}} payrollHrValidation={journey?.payroll_hr_validation}
              />
            )}
            <FinalSalarySection
              sc={journey?.salary_components} os={journey?.offered_salary} review={review}
              status={status} isReviewer={false} effectiveDate="" setEffectiveDate={() => {}} busy={false}
              packages={[]} selectedGrade="" setSelectedGrade={() => {}} selectedPkgId="" setSelectedPkgId={() => {}}
              assignExisting={() => {}} acceptPackage={() => {}} onBuildPackage={() => {}}
            />
            <BgvSection
              bgv={journey?.bgv} bgvOverall={journey?.bgv?.overall_status ?? journey?.bgv?.status}
              isReviewer={false} bgvCandidateId={null} bgvManual={() => {}} bgvWaive={() => {}}
            />
            <BankSection bank={journey?.bank} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PayrollApprovalStatusView() {
  const [tab, setTab] = useState<'pending_review' | 'approved' | 'rejected'>('pending_review');
  const [q, setQ] = useState('');
  const [branch, setBranch] = useState('');
  const [branches, setBranches] = useState<string[]>([]);
  const [rows, setRows] = useState<ChainRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  const [detailEmployee, setDetailEmployee] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const [sectionEmployee, setSectionEmployee] = useState<string | null>(null);
  const [sectionKey, setSectionKey] = useState<SectionKey | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status: tab });
      if (q.trim()) params.set('q', q.trim());
      if (branch) params.set('branch', branch);
      const r = await hrmsApi.get<{ data: ChainRow[] }>(`/api/payroll-head-review/queue?${params}`);
      const data = (r as any)?.data ?? [];
      setRows(data);
      setCounts((prev) => ({ ...prev, [tab]: data.length }));
    } catch { setRows([]); }
    finally { setLoading(false); }
  }, [tab, q, branch]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    hrmsApi.get<{ data: string[] }>('/api/payroll-head-review/branches')
      .then((r: any) => setBranches(r?.data ?? [])).catch(() => {});
  }, []);

  const tabLabel = (s: string) => {
    const c = counts[s];
    const base = STATUS_CFG[s as keyof typeof STATUS_CFG]?.label ?? s;
    return c != null ? `${base} (${c})` : base;
  };

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-5">

        <div className="rounded-2xl bg-gradient-to-br from-slate-700 via-slate-600 to-slate-800 text-white px-6 py-5 shadow-lg">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Salary Approval Status</h1>
                <p className="text-slate-300 text-sm mt-0.5">
                  Read-only — which onboarded employees are still waiting on Payroll Head, and what was assigned once approved
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}
              className="border-white/30 bg-white/15 text-white hover:bg-white/25 cursor-pointer">
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />Refresh
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList className="rounded-xl">
              <TabsTrigger value="pending_review" className="cursor-pointer text-xs">{tabLabel('pending_review')}</TabsTrigger>
              <TabsTrigger value="approved" className="cursor-pointer text-xs">{tabLabel('approved')}</TabsTrigger>
              <TabsTrigger value="rejected" className="cursor-pointer text-xs">{tabLabel('rejected')}</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <Input placeholder="Name or employee code…" value={q} onChange={(e) => setQ(e.target.value)}
              className="pl-8 h-9 text-sm rounded-xl" />
          </div>
          <Select value={branch || '__all__'} onValueChange={(v) => setBranch(v === '__all__' ? '' : v)}>
            <SelectTrigger className="w-[160px] h-9 text-sm rounded-xl"><SelectValue placeholder="All branches" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All branches</SelectItem>
              {branches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center py-16 rounded-2xl border border-dashed border-slate-200 text-slate-400">
              <ShieldCheck className="h-10 w-10 mb-3 text-slate-300" />
              <p className="font-medium text-slate-600">No employees in this state</p>
            </div>
          ) : (
            rows.map((row) => {
              const cfg = STATUS_CFG[row.status];
              const Icon = cfg.icon;
              const isOverdue = row.status === 'pending_review' && row.pending_hours >= 48;
              const initials = row.full_name?.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase() ?? '?';
              return (
                <div
                  key={row.review_id}
                  onClick={() => { setDetailEmployee(row.employee_id); setDetailOpen(true); }}
                  className={`group flex items-center gap-3 rounded-2xl border bg-white px-4 py-3 cursor-pointer transition-all duration-200 hover:shadow-md hover:border-slate-300 ${
                    isOverdue ? 'border-l-4 border-l-red-400 border-red-100' : row.status === 'pending_review' ? 'border-l-4 border-l-amber-400 border-slate-100' : row.status === 'approved' ? 'border-l-4 border-l-emerald-400 border-slate-100' : 'border-l-4 border-l-rose-400 border-slate-100'
                  }`}
                >
                  <div className="h-9 w-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-600 font-bold text-sm flex-shrink-0">
                    {initials}
                  </div>
                  {/* Identity keeps a fixed width from lg up so the chain beside it starts on the
                      same x for every row — a ragged left edge makes three-node chains unreadable
                      as a column. Below lg it takes the width back and carries the compact pill. */}
                  <div className="flex-1 xl:flex-none xl:w-[196px] min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-slate-900 text-sm">{row.full_name}</p>
                      <span className="font-mono text-[11px] text-slate-400 bg-slate-50 rounded px-1">{row.employee_code}</span>
                      {isOverdue && <span className="text-[10px] font-bold text-red-600 bg-red-50 rounded-full px-1.5 py-0.5 flex items-center gap-0.5 border border-red-200"><AlertTriangle className="h-2.5 w-2.5" />Overdue</span>}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500">
                      {row.designation_name && <span className="flex items-center gap-1 truncate"><Briefcase className="h-3 w-3 text-slate-300 flex-shrink-0" />{row.designation_name}</span>}
                      {row.branch_name && <span className="flex items-center gap-1 truncate"><Building2 className="h-3 w-3 text-slate-300 flex-shrink-0" />{row.branch_name}</span>}
                    </div>
                    {(row.cost_centre_name || row.process_name || row.emp_type) && (
                      <p className="text-[10px] text-slate-400 mt-0.5 truncate">
                        {[row.cost_centre_name, row.process_name, row.emp_type].filter(Boolean).join(' · ')}
                      </p>
                    )}
                    {/* Raised/approved stamps duplicate the chain's own timestamps, so they stay
                        only on the narrow layouts where the chain is collapsed to the pill. */}
                    <p className="xl:hidden text-[10px] text-slate-400 mt-0.5">
                      Raised: {fmtTs(row.created_at)}
                      {row.reviewed_at && <> &nbsp;·&nbsp; Decided: {fmtTs(row.reviewed_at)}</>}
                    </p>
                    <ChainPill row={row} />
                  </div>

                  <ApprovalChain row={row} />

                  <div className="hidden 2xl:flex flex-col gap-1 flex-1 min-w-[170px] max-w-[300px]">
                    <ReadinessTile section="bgv"  row={row} onOpen={() => { setSectionEmployee(row.employee_id); setSectionKey('bgv'); }} />
                    <ReadinessTile section="bank" row={row} onOpen={() => { setSectionEmployee(row.employee_id); setSectionKey('bank'); }} />
                  </div>

                  <div className="hidden sm:flex flex-col items-end w-[92px] flex-none">
                    <p className="text-sm font-bold text-slate-900 tabular-nums flex items-center gap-1">
                      <IndianRupee className="h-3 w-3 text-slate-400" />
                      {row.final_ctc ? `${inr(row.final_ctc)}/mo` : row.offered_ctc ? `${inr(row.offered_ctc)}/mo` : '—'}
                    </p>
                    <p className="text-[10px] text-slate-400">{row.status === 'approved' ? 'assigned package' : 'monthly CTC'}</p>
                  </div>
                  <div className="hidden md:flex flex-col items-center gap-1 w-[116px] flex-none">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold border whitespace-nowrap ${cfg.chip}`}>
                      <Icon className="h-3 w-3" />{cfg.label}
                    </span>
                    <AgingChip hours={row.pending_hours} status={row.status} />
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-300 flex-shrink-0" />
                </div>
              );
            })
          )}
        </div>

        {rows.length > 0 && (
          <p className="text-xs text-slate-400">{rows.length} employee{rows.length !== 1 ? 's' : ''} shown</p>
        )}
      </div>

      <ReadOnlyDetailDialog
        employeeId={detailEmployee}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
      />

      <ReadOnlySectionDialog
        section={sectionKey}
        employeeId={sectionEmployee}
        open={!!sectionKey && !!sectionEmployee}
        onClose={() => { setSectionKey(null); setSectionEmployee(null); }}
      />
    </DashboardLayout>
  );
}
