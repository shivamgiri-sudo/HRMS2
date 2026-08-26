import { useState, useEffect, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { hrmsApi } from '@/lib/hrmsApi';
import { useAuth } from "@/contexts/AuthContext";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, XCircle, X, AlertCircle, RefreshCw, Users, History, Ban, Search } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CandidateJourneyDrawer } from '@/components/ats/CandidateJourneyDrawer';
import { OnboardingTabBar } from "@/components/onboarding/OnboardingTabBar";
import { useSearchParams } from 'react-router-dom';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface PendingOffer {
  offer_id: string;
  candidate_id: string;
  candidate_code: string;
  full_name: string;
  mobile: string;
  email: string;
  offered_ctc: number;
  gross: number;
  net_in_hand: number;
  emp_type: string;
  /**
   * Whatever was typed into the Employment Offer form's "Date of Joining" field,
   * which in practice is the ATS walk-in date -- hence the "ATS Walkin" column
   * label. The dates Payroll HR actually commits to are the two below.
   */
  date_of_joining: string;
  /** Day 1 in office, per ats_payroll_hr_validation. Null until Payroll HR validates. */
  payroll_joining_date?: string | null;
  /** When salary generation begins, per ats_payroll_hr_validation. */
  payroll_salary_start_date?: string | null;
  salary_band: string;
  branch_name: string;
  /** Cost centre the head is being approved against. Null when the offer carries none. */
  cost_centre_code?: string | null;
  cost_centre_name?: string | null;
  client_name?: string | null;
  /** Process resolved against process_master. Null when it could not be. */
  process_name?: string | null;
  /** The raw applied_for_process label, minus unresolved UUIDs. */
  process_raw?: string | null;
  /** 1 when applied_for_process holds a designation, not a process. */
  process_is_designation?: number | boolean;
  profile_status: string;
  offer_status: string;
  /** 1 when Payroll HR has validated this salary. Employee creation requires it. */
  payroll_validated?: number | boolean;
}

type DecisionRow = {
  offer_id: string | null;
  candidate_id: string;
  candidate_code: string | null;
  candidate_name: string | null;
  branch_name: string | null;
  decision: string;
  decided_at: string | null;
  decided_by_name: string | null;
  remarks: string | null;
  employee_code: string | null;
  gross: string | null;
};

const inr = (n: number | null | undefined) =>
  n == null ? '—' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

/** "2026-08-04T18:30:00Z" -> "04 Aug 2026". Never throws on a bad value. */
function shortDate(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * What to print in the Process column.
 *
 * A designation is never shown as a process. 93 candidates carry one in
 * applied_for_process — 'Team Leader', 'Quality Analyst', 'Operations' — and
 * printing it produced a Process column that confidently stated the wrong
 * thing. Saying it is not mapped, and naming the value that was found instead,
 * is the honest reading and is also what gets it fixed.
 */
function processCell(offer: PendingOffer): { text: string; tone: string; title?: string } {
  if (offer.process_name) {
    return { text: offer.process_name, tone: 'text-slate-700' };
  }
  if (offer.process_is_designation === 1 || offer.process_is_designation === true) {
    return {
      text: 'Not mapped',
      tone: 'text-amber-700',
      title: `"${offer.process_raw}" is a designation, not a process. This candidate's process was never recorded — ask Recruitment to set it before conversion.`,
    };
  }
  if (offer.process_raw) {
    return {
      text: offer.process_raw,
      tone: 'text-slate-500 italic',
      title: `"${offer.process_raw}" is not in the process master, so it could not be verified.`,
    };
  }
  return { text: '—', tone: 'text-slate-400' };
}

function offersFrom(payload: unknown): PendingOffer[] {
  if (Array.isArray(payload)) return payload as PendingOffer[];
  if (payload && typeof payload === 'object') {
    const data = (payload as { data?: unknown }).data;
    if (Array.isArray(data)) return data as PendingOffer[];
  }
  return [];
}

// Single offer row component
function OfferRow({
  offer,
  acting,
  onAct,
  remark,
  onRemarkChange,
  onOpenJourney,
}: {
  offer: PendingOffer;
  acting: string | null;
  onAct: (id: string, action: 'approve' | 'reject', remark: string) => void;
  remark: string;
  onRemarkChange: (offerId: string, value: string) => void;
  onOpenJourney: (candidateId: string) => void;
}) {
  const isActing = acting === offer.offer_id;
  const proc = processCell(offer);
  // Employee creation needs a validated salary (validateSalaryLock). Without
  // it Approve throws "Branch Head approval pending", which the branch head
  // cannot act on — so the blocker is shown here instead.
  const payrollReady = offer.payroll_validated === 1 || offer.payroll_validated === true;

  return (
    <TableRow
      onClick={() => onOpenJourney(offer.candidate_id)}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpenJourney(offer.candidate_id); }}
      tabIndex={0}
      role="button"
      aria-label={`Open journey for ${offer.full_name}`}
      className="group cursor-pointer border-slate-100 transition-colors even:bg-slate-50/40 hover:bg-blue-50/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
    >
      {/* Candidate — sticky, so identity stays visible while the row is scrolled. */}
      <TableCell className="sticky left-0 z-10 bg-inherit py-3">
        <div className="flex flex-col gap-1">
          <span className="font-semibold text-slate-900">{offer.full_name}</span>
          <span className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-slate-500">{offer.candidate_code}</span>
            <span className="text-[11px] text-slate-400">
              {offer.mobile ? offer.mobile.slice(0, 3) + 'XXXXX' + offer.mobile.slice(-3) : '—'}
            </span>
          </span>
        </div>
      </TableCell>

      <TableCell className="py-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm text-slate-800">{offer.branch_name}</span>
          <span className="text-[11px] uppercase tracking-wide text-slate-400">{offer.emp_type}</span>
        </div>
      </TableCell>

      {/* Cost centre code and the client it bills to, both off the offer's
          cost_centre. An em-dash where the offer carries none — a blank cell
          reads as "no cost centre exists" rather than "not set". */}
      <TableCell className="py-3">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-xs text-slate-700">{offer.cost_centre_code ?? '—'}</span>
          {offer.client_name && (
            <span className="max-w-[110px] truncate text-[11px] text-slate-400" title={offer.client_name}>
              {offer.client_name}
            </span>
          )}
        </div>
      </TableCell>

      <TableCell className="py-3">
        <span className={`text-sm ${proc.tone}`} title={proc.title}>{proc.text}</span>
      </TableCell>

      <TableCell className="py-3 text-sm whitespace-nowrap text-slate-700">
        {shortDate(offer.date_of_joining)}
      </TableCell>

      <TableCell className="py-3 text-sm whitespace-nowrap text-slate-700">
        {offer.payroll_joining_date ? shortDate(offer.payroll_joining_date) : <span className="text-slate-400">—</span>}
      </TableCell>

      <TableCell className="py-3 text-sm whitespace-nowrap text-slate-700">
        {offer.payroll_salary_start_date ? shortDate(offer.payroll_salary_start_date) : <span className="text-slate-400">—</span>}
      </TableCell>

      <TableCell className="py-3 text-center">
        <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-1.5 font-mono text-xs text-slate-600">
          {offer.salary_band || '—'}
        </span>
      </TableCell>

      {/* CTC + Gross stacked — saves one column and keeps the key numbers together. */}
      <TableCell className="py-3 text-right tabular-nums whitespace-nowrap">
        <div className="font-semibold text-slate-900">{inr(offer.offered_ctc)}</div>
        <div className="text-[11px] text-slate-400">{inr(offer.gross)} gross</div>
      </TableCell>
      <TableCell className="py-3 text-right tabular-nums text-slate-600 whitespace-nowrap">
        {inr(offer.net_in_hand)}
      </TableCell>

      <TableCell className="py-3">
        <Input
          value={remark}
          onChange={e => onRemarkChange(offer.offer_id, e.target.value)}
          placeholder="Remarks…"
          disabled={isActing}
          className="h-9 w-full min-w-[140px] text-sm"
          onClick={(e) => e.stopPropagation()}
        />
      </TableCell>

      {/* Actions — sticky right, so they never scroll out of reach on a wide table. */}
      <TableCell
        className="sticky right-0 z-10 bg-inherit py-3"
        onClick={(e) => e.stopPropagation()}
      >
        {!payrollReady && (
          <p className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-amber-700">
            <AlertCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
            Salary not validated
          </p>
        )}
        <div className="flex flex-nowrap gap-2">
          <Button
            size="sm"
            className="h-9 cursor-pointer bg-emerald-600 px-3 text-white shadow-sm transition-colors hover:bg-emerald-700"
            disabled={isActing || !payrollReady}
            title={payrollReady ? undefined : 'Payroll HR must validate the salary before this can be approved'}
            onClick={() => onAct(offer.offer_id, 'approve', remark)}
            aria-label={`Approve and activate ${offer.full_name}`}
          >
            {isActing ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            )}
            <span className="ml-1.5">Approve</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-9 cursor-pointer border-rose-200 px-3 text-rose-700 transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-800"
            disabled={isActing}
            onClick={() => onAct(offer.offer_id, 'reject', remark)}
            aria-label={`Reject offer for ${offer.full_name}`}
          >
            <XCircle className="h-4 w-4" aria-hidden="true" />
            <span className="ml-1.5">Reject</span>
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export default function NativeBranchHeadApproval() {
  const { user } = useAuth();
  const { roleKeys } = useWorkforceAccess();
  const ALLOWED = ["admin", "super_admin", "hr", "branch_head"];

  const [offers, setOffers]           = useState<PendingOffer[]>([]);
  const [loading, setLoading]         = useState(true);
  const [loadError, setLoadError]     = useState<string | null>(null);
  const [acting, setActing]           = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [approvalSuccess, setApprovalSuccess] = useState<{ employeeCode: string; employeeName: string } | null>(null);
  const [remarks, setRemarks]         = useState<Record<string, string>>({});
  const [query, setQuery]             = useState('');

  // Client-side filter: the queue is a handful of rows, so a round trip per
  // keystroke would be slower and no more correct.
  const q = query.trim().toLowerCase();
  const visibleOffers = !q ? offers : offers.filter((o) =>
    [o.full_name, o.candidate_code, o.branch_name, o.cost_centre_code, o.client_name,
     o.process_name, o.process_raw, o.emp_type, o.salary_band]
      .some((f) => String(f ?? '').toLowerCase().includes(q)));

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const r = await hrmsApi.get<unknown>('/api/ats/onboarding/pending-approval');
      setOffers(offersFrom(r));
    } catch (error: any) {
      setLoadError(error?.message ?? 'Failed to load pending approvals');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRemarkChange = (offerId: string, value: string) => {
    setRemarks(prev => ({ ...prev, [offerId]: value }));
  };

  const act = async (offerId: string, action: 'approve' | 'reject', remark: string) => {
    if (action === 'reject' && !remark.trim()) {
      setActionError('Please enter rejection remarks before rejecting.');
      return;
    }
    setActing(offerId);
    setActionError(null);
    try {
      const result: any = await hrmsApi.post(`/api/ats/onboarding/offers/${offerId}/${action}`, { remarks: remark });
      if (action === 'approve' && result?.employeeCode) {
        const approvedOffer = offers.find(o => o.offer_id === offerId);
        setApprovalSuccess({ employeeCode: result.employeeCode, employeeName: approvedOffer?.full_name ?? '' });
      }
      // Clear remark after successful action
      setRemarks(prev => {
        const updated = { ...prev };
        delete updated[offerId];
        return updated;
      });
    } catch (e: any) {
      setActionError(e?.message ?? `Failed to ${action} the offer.`);
    } finally {
      setActing(null);  // unfreeze button as soon as POST resolves
    }
    void load();       // refresh list in background
    void loadStats();  // refresh tab counts
  };

  if (user && !roleKeys.some(k => ALLOWED.includes(k))) {
    return (
      <DashboardLayout>
        <div className="p-8 text-center text-rose-600 font-bold">You do not have access to this page.</div>
      </DashboardLayout>
    );
  }

  // ── past decisions ────────────────────────────────────────────────────
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') ?? 'pending';
  const journeyCandidate = searchParams.get('candidate');

  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [decisionsLoading, setDecisionsLoading] = useState(false);
  const [scopeEmpty, setScopeEmpty] = useState(false);
  const [stats, setStats] = useState<{ total_pending: number; total_approved: number; total_rejected: number } | null>(null);

  const setTab = (next: string) => {
    const p = new URLSearchParams(searchParams);
    p.set('tab', next);
    setSearchParams(p, { replace: true });
  };

  const openJourney = (candidateId: string) => {
    const p = new URLSearchParams(searchParams);
    p.set('candidate', candidateId);
    setSearchParams(p, { replace: false });
  };

  const closeJourney = () => {
    const p = new URLSearchParams(searchParams);
    p.delete('candidate');
    setSearchParams(p, { replace: true });
  };

  const loadDecisions = useCallback(async (status: 'approved' | 'rejected') => {
    setDecisionsLoading(true);
    try {
      const r = await hrmsApi.get<{ data: DecisionRow[]; scopeEmpty?: boolean }>(
        `/api/ats/branch-head-approval/decisions?status=${status}`,
      );
      setDecisions(Array.isArray(r.data) ? r.data : []);
      setScopeEmpty(Boolean(r.scopeEmpty));
    } catch {
      setDecisions([]);
    } finally {
      setDecisionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'approved' || tab === 'rejected') void loadDecisions(tab);
  }, [tab, loadDecisions]);

  const loadStats = useCallback(() => {
    hrmsApi.get<{ data: typeof stats }>('/api/ats/branch-head-approval/stats')
      .then((r) => setStats(r.data ?? null))
      .catch(() => setStats(null));
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  return (
    <DashboardLayout>
      <div className="space-y-5 p-6">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-600 text-white p-6 mb-5 shadow-lg">
          <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
          <div className="absolute right-24 bottom-0 h-16 w-16 rounded-full bg-emerald-300/20 blur-xl" />
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-emerald-200">Branch Head · Approvals</p>
              <h1 className="mt-1 text-2xl font-bold text-white">Offer Approvals</h1>
              <p className="mt-1 text-sm text-emerald-100">Salaries validated by Payroll HR, waiting on your decision.</p>
            </div>
            <Button variant="outline" size="sm" onClick={load} disabled={loading} aria-label="Refresh offer list"
              className="min-h-[44px] cursor-pointer border-white/30 bg-white/10 text-white hover:bg-white/20">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span className="ml-2">Refresh</span>
            </Button>
          </div>
        </div>
        <OnboardingTabBar />

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="pending" className="cursor-pointer">
              Pending{stats ? ` (${stats.total_pending})` : ''}
            </TabsTrigger>
            <TabsTrigger value="approved" className="cursor-pointer">
              Approved{stats ? ` (${stats.total_approved})` : ''}
            </TabsTrigger>
            <TabsTrigger value="rejected" className="cursor-pointer">
              Rejected{stats ? ` (${stats.total_rejected})` : ''}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="approved" className="mt-4">
            <DecisionTable
              rows={decisions} loading={decisionsLoading} scopeEmpty={scopeEmpty}
              kind="approved" onOpenJourney={openJourney}
            />
          </TabsContent>
          <TabsContent value="rejected" className="mt-4">
            <DecisionTable
              rows={decisions} loading={decisionsLoading} scopeEmpty={scopeEmpty}
              kind="rejected" onOpenJourney={openJourney}
            />
          </TabsContent>
        </Tabs>

        {/* Approval success banner */}
        {approvalSuccess && (
          <div
            role="status"
            aria-live="polite"
            className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex items-start gap-3 shadow-sm"
          >
            <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="font-bold text-emerald-900">
                Offer Approved — Employee Code {approvalSuccess.employeeCode}
              </p>
              <p className="text-sm text-emerald-700 mt-1">
                {approvalSuccess.employeeName} has been activated. Payroll HR has been notified to issue joining documents.
              </p>
            </div>
            <button
              onClick={() => setApprovalSuccess(null)}
              className="text-emerald-500 hover:text-emerald-700 flex-shrink-0 p-2 rounded-lg focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
              aria-label="Dismiss success message"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Action error banner */}
        {actionError && (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 p-4 flex items-start gap-3"
          >
            <AlertCircle className="h-5 w-5 text-rose-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <p className="flex-1 text-sm text-rose-700 font-medium">{actionError}</p>
            <button
              onClick={() => setActionError(null)}
              className="text-rose-400 hover:text-rose-600 flex-shrink-0 p-2 rounded-lg focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2"
              aria-label="Dismiss error"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Load error with retry */}
        {loadError && (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 p-4 flex items-start gap-3"
          >
            <AlertCircle className="h-5 w-5 text-rose-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-rose-700 font-medium">{loadError}</p>
              <Button variant="outline" size="sm" onClick={load} className="mt-2 min-h-[44px]">
                <RefreshCw className="h-4 w-4 mr-1" aria-hidden="true" /> Retry
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <div
            role="status"
            aria-label="Loading pending approvals"
            className="flex items-center justify-center h-64"
          >
            <Loader2 className="animate-spin h-8 w-8 text-blue-500" aria-hidden="true" />
          </div>
        ) : (
          <>
            {!loadError && !offers.length && (
              <div className={`flex-col items-center py-16 text-center ${tab === 'pending' ? 'flex' : 'hidden'}`}>
                <Users className="h-10 w-10 text-slate-300 mb-4" aria-hidden="true" />
                <h3 className="text-base font-bold text-slate-700">No pending approvals</h3>
                <p className="mt-1 text-sm text-slate-500">Offers submitted by HR will appear here for your approval.</p>
              </div>
            )}

            {tab === 'pending' && offers.length > 0 && (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                {/* Toolbar: what is in the table, and a way to cut it down. */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                  <p className="text-sm text-slate-500">
                    <span className="font-semibold text-slate-900">{visibleOffers.length}</span>
                    {visibleOffers.length === offers.length
                      ? ` offer${offers.length === 1 ? '' : 's'} awaiting your approval`
                      : ` of ${offers.length} shown`}
                  </p>
                  <div className="relative w-full sm:w-72">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Filter by name, code, branch, cost centre…"
                      aria-label="Filter pending approvals"
                      className="h-9 pl-8 text-sm"
                    />
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="[&_tr]:border-slate-200">
                      <TableRow className="bg-slate-50 hover:bg-slate-50">
                        {[
                          ['Candidate',     'sticky left-0 z-20 bg-slate-50 min-w-[160px]'],
                          ['Branch & Type', 'min-w-[140px]'],
                          ['Cost Centre',   'min-w-[120px]'],
                          ['Process',       'min-w-[110px]'],
                          ['ATS Walkin',    'min-w-[90px]'],
                          ['Joining (Payroll HR)', 'min-w-[110px]'],
                          ['Salary Start',  'min-w-[100px]'],
                          ['Band',          'w-14 text-center'],
                          ['CTC / Gross',   'text-right min-w-[130px]'],
                          ['Net in Hand',   'text-right min-w-[100px]'],
                          ['Remarks',       'min-w-[160px]'],
                          ['Actions',       'sticky right-0 z-20 bg-slate-50 min-w-[170px]'],
                        ].map(([label, cls]) => (
                          <TableHead
                            key={label}
                            className={`h-10 whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-slate-500 ${cls}`}
                          >
                            {label}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleOffers.map(o => (
                        <OfferRow
                          key={o.offer_id}
                          offer={o}
                          acting={acting}
                          onAct={act}
                          remark={remarks[o.offer_id] || ''}
                          onRemarkChange={handleRemarkChange}
                          onOpenJourney={openJourney}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {visibleOffers.length === 0 && (
                  <div className="px-4 py-12 text-center">
                    <p className="text-sm font-medium text-slate-700">No offer matches “{query}”</p>
                    <Button variant="outline" size="sm" className="mt-3 cursor-pointer" onClick={() => setQuery('')}>
                      Clear filter
                    </Button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <CandidateJourneyDrawer
        candidateId={journeyCandidate}
        open={Boolean(journeyCandidate)}
        onClose={closeJourney}
      />
    </DashboardLayout>
  );
}


/**
 * Past decisions. No action buttons — these are settled; the row exists so it
 * can be found again and opened.
 */
function DecisionTable({
  rows, loading, scopeEmpty, kind, onOpenJourney,
}: {
  rows: DecisionRow[];
  loading: boolean;
  scopeEmpty: boolean;
  kind: 'approved' | 'rejected';
  onOpenJourney: (candidateId: string) => void;
}) {
  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-label="Loading decisions" />
      </div>
    );
  }

  // A branch head with no branches assigned would otherwise see an ordinary
  // empty table and conclude there is no history, when in fact they are scoped
  // to nothing.
  if (scopeEmpty) {
    return (
      <div className="flex flex-col items-center py-16 text-center">
        <Ban className="mb-4 h-10 w-10 text-amber-300" aria-hidden="true" />
        <h3 className="text-base font-bold text-slate-700">No branches assigned to you</h3>
        <p className="mt-1 max-w-md text-sm text-slate-500">
          Approval history is filtered to the branches you head. Ask HR to assign your branches
          so past decisions appear here.
        </p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center py-16 text-center">
        <History className="mb-4 h-10 w-10 text-slate-300" aria-hidden="true" />
        <h3 className="text-base font-bold text-slate-700">Nothing {kind} yet</h3>
        <p className="mt-1 text-sm text-slate-500">
          Offers you {kind === 'approved' ? 'approve' : 'reject'} will be listed here.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Candidate</TableHead>
            <TableHead>Branch</TableHead>
            <TableHead>Decided</TableHead>
            <TableHead>By</TableHead>
            <TableHead>Employee Code</TableHead>
            <TableHead>Remarks</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow
              key={`${r.offer_id ?? r.candidate_id}`}
              onClick={() => onOpenJourney(r.candidate_id)}
              onKeyDown={(e) => { if (e.key === 'Enter') onOpenJourney(r.candidate_id); }}
              tabIndex={0}
              role="button"
              aria-label={`Open journey for ${r.candidate_name ?? 'candidate'}`}
              className="cursor-pointer transition-colors hover:bg-slate-50 focus:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
            >
              <TableCell>
                <div className="font-medium text-slate-900">{r.candidate_name ?? '—'}</div>
                <div className="font-mono text-xs text-slate-500">{r.candidate_code ?? '—'}</div>
              </TableCell>
              <TableCell className="text-sm">{r.branch_name ?? '—'}</TableCell>
              <TableCell className="text-sm">
                {r.decided_at
                  ? new Date(r.decided_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                  : '—'}
              </TableCell>
              <TableCell className="text-sm">{r.decided_by_name ?? '—'}</TableCell>
              <TableCell>
                {r.employee_code
                  ? <Badge variant="outline" className="border-teal-200 bg-teal-50 text-teal-700">{r.employee_code}</Badge>
                  : <span className="text-xs text-slate-400">not created</span>}
              </TableCell>
              <TableCell className="max-w-[16rem] truncate text-sm text-slate-600" title={r.remarks ?? ''}>
                {r.remarks ?? '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
