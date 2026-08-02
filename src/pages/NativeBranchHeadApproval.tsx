import { useState, useEffect, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { hrmsApi } from '@/lib/hrmsApi';
import { useAuth } from "@/contexts/AuthContext";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, XCircle, X, AlertCircle, RefreshCw, Users, History, Ban } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CandidateJourneyDrawer } from '@/components/ats/CandidateJourneyDrawer';
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
  date_of_joining: string;
  salary_band: string;
  branch_name: string;
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
      className="cursor-pointer transition-colors hover:bg-slate-50 focus:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
    >
      <TableCell>
        <div className="flex flex-col gap-1">
          <span className="font-medium">{offer.full_name}</span>
          <Badge variant="outline" className="w-fit">{offer.candidate_code}</Badge>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-0.5 text-sm">
          <span>{offer.branch_name}</span>
          <span className="text-slate-500">{offer.emp_type}</span>
        </div>
      </TableCell>
      <TableCell className="text-sm">{offer.date_of_joining}</TableCell>
      <TableCell className="text-sm">{offer.salary_band}</TableCell>
      <TableCell className="text-right font-medium">
        ₹{offer.offered_ctc?.toLocaleString('en-IN')}
      </TableCell>
      <TableCell className="text-right">
        ₹{offer.gross?.toLocaleString('en-IN')}
      </TableCell>
      <TableCell className="text-right">
        ₹{offer.net_in_hand?.toLocaleString('en-IN')}
      </TableCell>
      <TableCell className="text-sm">
        {offer.mobile ? offer.mobile.slice(0, 3) + 'XXXXX' + offer.mobile.slice(-3) : '—'}
      </TableCell>
      <TableCell>
        <Input
          value={remark}
          onChange={e => onRemarkChange(offer.offer_id, e.target.value)}
          placeholder="Enter remarks…"
          disabled={isActing}
          className="min-h-[36px] text-sm"
          onClick={(e) => e.stopPropagation()}
        />
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        {!payrollReady && (
          <p className="mb-1.5 text-[11px] font-medium text-amber-700">
            Payroll HR has not validated this salary yet
          </p>
        )}
        <div className="flex gap-2 flex-nowrap">
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            disabled={isActing || !payrollReady}
            title={payrollReady ? undefined : 'Payroll HR must validate the salary before this can be approved'}
            onClick={() => onAct(offer.offer_id, 'approve', remark)}
            aria-label={`Approve and activate ${offer.full_name}`}
          >
            {isActing ? (
              <Loader2 className="animate-spin h-4 w-4" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={isActing}
            onClick={() => onAct(offer.offer_id, 'reject', remark)}
            aria-label={`Reject offer for ${offer.full_name}`}
          >
            <XCircle className="h-4 w-4" aria-hidden="true" />
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
      // Approving creates the employee, dispatches provisioning and generates
      // the joining-document pack — the first real one produced 4 provisioning
      // tasks and 9 checklist rows. That comfortably exceeds the 30s default,
      // and the browser aborting mid-flight showed a failure for work the
      // server went on to complete successfully.
      const result: any = await hrmsApi.post(
        `/api/ats/onboarding/offers/${offerId}/${action}`, { remarks: remark }, 180000);
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
      await load();
    } catch (e: any) {
      setActionError(e?.message ?? `Failed to ${action} the offer.`);
    } finally {
      setActing(null);
    }
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
  const [decisionTotals, setDecisionTotals] = useState<{ approved: number | null; rejected: number | null }>(
    { approved: null, rejected: null },
  );
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
      const r = await hrmsApi.get<{ data: DecisionRow[]; scopeEmpty?: boolean; total?: number }>(
        `/api/ats/branch-head-approval/decisions?status=${status}`,
      );
      setDecisions(Array.isArray(r.data) ? r.data : []);
      setScopeEmpty(Boolean(r.scopeEmpty));
      setDecisionTotals((p) => ({ ...p, [status]: Number(r.total ?? (r.data?.length ?? 0)) }));
    } catch {
      setDecisions([]);
    } finally {
      setDecisionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'approved' || tab === 'rejected') void loadDecisions(tab);
  }, [tab, loadDecisions]);

  useEffect(() => {
    // Built long ago and never called by any screen.
    hrmsApi.get<{ data: typeof stats }>('/api/ats/branch-head-approval/stats')
      .then((r) => setStats(r.data ?? null))
      .catch(() => setStats(null));
  }, []);

  return (
    <DashboardLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-3xl font-black tracking-tight text-slate-950">Offer Approvals</h1>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} aria-label="Refresh offer list" className="min-h-[44px]">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span className="ml-2">Refresh</span>
          </Button>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            {/* Counts come from the same data as the tab contents. They were
                read from /stats, which counts ats_branch_head_approval — the
                legacy queue, a different model from the offers this screen
                lists. After a successful approval Pending still showed 1,
                because a stale row in that other table had nothing to do with
                the list underneath it. */}
            <TabsTrigger value="pending" className="cursor-pointer">
              Pending ({offers.length})
            </TabsTrigger>
            <TabsTrigger value="approved" className="cursor-pointer">
              Approved{decisionTotals.approved != null ? ` (${decisionTotals.approved})` : ''}
            </TabsTrigger>
            <TabsTrigger value="rejected" className="cursor-pointer">
              Rejected{decisionTotals.rejected != null ? ` (${decisionTotals.rejected})` : ''}
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
              <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Candidate</TableHead>
                      <TableHead>Branch & Type</TableHead>
                      <TableHead>Joining Date</TableHead>
                      <TableHead>Salary Band</TableHead>
                      <TableHead className="text-right">Monthly CTC</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead className="text-right">Net in Hand</TableHead>
                      <TableHead>Mobile</TableHead>
                      <TableHead>Remarks</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {offers.map(o => (
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
