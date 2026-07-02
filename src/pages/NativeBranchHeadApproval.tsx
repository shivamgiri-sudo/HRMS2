import { useState, useEffect, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { hrmsApi } from '@/lib/hrmsApi';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';

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

export default function NativeBranchHeadApproval() {
  const [offers, setOffers] = useState<PendingOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [remarks, setRemarks] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await hrmsApi.get<unknown>('/api/ats/onboarding/pending-approval');
      setOffers(offersFrom(r));
    } catch (error: any) {
      alert(error?.message ?? 'Failed to load pending approvals');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (offerId: string, action: 'approve' | 'reject') => {
    if (action === 'reject' && !remarks[offerId]?.trim()) {
      alert('Please enter rejection remarks before rejecting.');
      return;
    }
    setActing(offerId);
    try {
      await hrmsApi.post(`/api/ats/onboarding/offers/${offerId}/${action}`, {
        remarks: remarks[offerId] ?? '',
      });
      await load();
    } catch (e: any) {
      alert(e?.message ?? `Failed to ${action} the offer.`);
    } finally {
      setActing(null);
    }
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-4">
        <h1 className="text-xl font-semibold">Offer Approvals</h1>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="animate-spin" />
          </div>
        ) : (
          <>
            {!offers.length && (
              <p className="text-muted-foreground py-8 text-center">
                No offers pending your approval.
              </p>
            )}
            <div className="grid gap-4 max-w-2xl">
              {offers.map(o => (
                <Card key={o.offer_id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{o.full_name}</CardTitle>
                      <Badge variant="outline">{o.candidate_code}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {o.branch_name} | {o.emp_type}
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-sm bg-gray-50 rounded p-3">
                      <div>
                        <span className="text-muted-foreground">Joining Date:</span>{' '}
                        <strong>{o.date_of_joining}</strong>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Salary Band:</span>{' '}
                        <strong>{o.salary_band}</strong>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Monthly CTC:</span>{' '}
                        <strong>₹{o.offered_ctc?.toLocaleString('en-IN')}</strong>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Gross:</span>{' '}
                        <strong>₹{o.gross?.toLocaleString('en-IN')}</strong>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Net in Hand:</span>{' '}
                        <strong>₹{o.net_in_hand?.toLocaleString('en-IN')}</strong>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Mobile:</span> {o.mobile}
                      </div>
                    </div>

                    <div>
                      <label className="text-sm font-medium">Remarks</label>
                      <input
                        className="w-full border rounded px-3 py-1.5 text-sm mt-1 bg-background"
                        value={remarks[o.offer_id] ?? ''}
                        onChange={e =>
                          setRemarks(p => ({ ...p, [o.offer_id]: e.target.value }))
                        }
                        placeholder="Optional for approval — required for rejection"
                      />
                    </div>

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700 text-white"
                        disabled={acting === o.offer_id}
                        onClick={() => act(o.offer_id, 'approve')}
                      >
                        {acting === o.offer_id ? (
                          <Loader2 className="animate-spin w-4 h-4 mr-1" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4 mr-1" />
                        )}
                        Approve & Activate
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={acting === o.offer_id}
                        onClick={() => act(o.offer_id, 'reject')}
                      >
                        <XCircle className="w-4 h-4 mr-1" />
                        Reject
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
