import { useState, useEffect, useCallback, useId } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { hrmsApi } from '@/lib/hrmsApi';
import { useAuth } from "@/contexts/AuthContext";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, XCircle, X, AlertCircle, RefreshCw, Users } from 'lucide-react';

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
}

function offersFrom(payload: unknown): PendingOffer[] {
  if (Array.isArray(payload)) return payload as PendingOffer[];
  if (payload && typeof payload === 'object') {
    const data = (payload as { data?: unknown }).data;
    if (Array.isArray(data)) return data as PendingOffer[];
  }
  return [];
}

// Single offer card with stable IDs for label association
function OfferCard({
  offer,
  acting,
  onAct,
}: {
  offer: PendingOffer;
  acting: string | null;
  onAct: (id: string, action: 'approve' | 'reject', remark: string) => void;
}) {
  const uid = useId();
  const remarksId = `remarks-${uid}`;
  const [remark, setRemark] = useState('');
  const isActing = acting === offer.offer_id;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{offer.full_name}</CardTitle>
          <Badge variant="outline">{offer.candidate_code}</Badge>
        </div>
        <p className="text-sm text-slate-500">
          {offer.branch_name} | {offer.emp_type}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-sm bg-slate-50 rounded-xl p-3">
          <div>
            <span className="text-slate-500">Joining Date:</span>{' '}
            <strong>{offer.date_of_joining}</strong>
          </div>
          <div>
            <span className="text-slate-500">Salary Band:</span>{' '}
            <strong>{offer.salary_band}</strong>
          </div>
          <div>
            <span className="text-slate-500">Monthly CTC:</span>{' '}
            <strong>₹{offer.offered_ctc?.toLocaleString('en-IN')}</strong>
          </div>
          <div>
            <span className="text-slate-500">Gross:</span>{' '}
            <strong>₹{offer.gross?.toLocaleString('en-IN')}</strong>
          </div>
          <div>
            <span className="text-slate-500">Net in Hand:</span>{' '}
            <strong>₹{offer.net_in_hand?.toLocaleString('en-IN')}</strong>
          </div>
          <div>
            <span className="text-slate-500">Mobile:</span>{' '}
            {offer.mobile ? offer.mobile.slice(0, 3) + 'XXXXX' + offer.mobile.slice(-3) : '—'}
          </div>
        </div>

        <div>
          <label htmlFor={remarksId} className="text-sm font-medium block mb-1">
            Remarks
            <span className="ml-1 text-slate-400 font-normal text-xs">(optional for approval — required for rejection)</span>
          </label>
          <Input
            id={remarksId}
            value={remark}
            onChange={e => setRemark(e.target.value)}
            placeholder="Enter remarks…"
            disabled={isActing}
            className="min-h-[44px]"
          />
        </div>

        <div className="flex gap-2 flex-wrap">
          <Button
            className="bg-emerald-600 hover:bg-emerald-700 text-white min-h-[44px]"
            disabled={isActing}
            onClick={() => onAct(offer.offer_id, 'approve', remark)}
            aria-label={`Approve and activate ${offer.full_name}`}
          >
            {isActing ? (
              <Loader2 className="animate-spin h-4 w-4 mr-1" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="h-4 w-4 mr-1" aria-hidden="true" />
            )}
            Approve & Activate
          </Button>
          <Button
            variant="destructive"
            disabled={isActing}
            onClick={() => onAct(offer.offer_id, 'reject', remark)}
            aria-label={`Reject offer for ${offer.full_name}`}
            className="min-h-[44px]"
          >
            <XCircle className="h-4 w-4 mr-1" aria-hidden="true" />
            Reject
          </Button>
        </div>
      </CardContent>
    </Card>
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
              <div className="flex flex-col items-center py-16 text-center">
                <Users className="h-10 w-10 text-slate-300 mb-4" aria-hidden="true" />
                <h3 className="text-base font-bold text-slate-700">No pending approvals</h3>
                <p className="mt-1 text-sm text-slate-500">Offers submitted by HR will appear here for your approval.</p>
              </div>
            )}

            <div className="grid gap-4 max-w-2xl">
              {offers.map(o => (
                <OfferCard
                  key={o.offer_id}
                  offer={o}
                  acting={acting}
                  onAct={act}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
