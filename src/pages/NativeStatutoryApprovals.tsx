import { useState, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, CheckCircle2, XCircle, FileCheck } from 'lucide-react';
import { toast } from 'sonner';
import {
  usePendingStatutoryChangeRequests,
  useActOnStatutoryChangeRequest,
  type StatutoryChangeRequest,
} from '@/hooks/useStatutoryApprovals';

const FIELD_LABELS: Record<string, string> = {
  pan_number: 'PAN',
  aadhaar_id: 'Aadhaar',
  uan_number: 'UAN',
  esi_number: 'ESI Number',
  epf_number: 'EPF Number',
  pf_eligible: 'PF Eligible',
  esi_eligible: 'ESI Eligible',
  epf_date: 'EPF Date',
};

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

export default function NativeStatutoryApprovals() {
  const { data: requests, isLoading, refetch } = usePendingStatutoryChangeRequests();
  const act = useActOnStatutoryChangeRequest();
  const [acting, setActing] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const handleAction = useCallback(
    async (req: StatutoryChangeRequest, decision: 'approved' | 'rejected') => {
      if (decision === 'rejected' && !notes[req.id]?.trim()) {
        toast.error('Please enter a reason before rejecting.');
        return;
      }
      setActing(req.id);
      try {
        await act.mutateAsync({ requestId: req.id, decision, note: notes[req.id] });
        toast.success(decision === 'approved' ? 'Request approved' : 'Request rejected');
        refetch();
      } catch (err: any) {
        toast.error(err.message ?? 'Action failed');
      } finally {
        setActing(null);
      }
    },
    [act, notes, refetch]
  );

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Statutory Details Change Approvals</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Review employee-submitted PAN, Aadhaar, UAN, ESI and PF changes before they're applied.
          </p>
        </div>

        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading requests…
          </div>
        )}

        {!isLoading && (!requests || requests.length === 0) && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <FileCheck className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-muted-foreground">No pending requests.</p>
            </CardContent>
          </Card>
        )}

        {requests?.map((req) => {
          const changedFields = Object.keys(req.new_values ?? {});
          return (
            <Card key={req.id} className="border-l-4 border-l-amber-400">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{req.employee_name}</CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">{req.employee_code}</Badge>
                    {req.branch_name && (
                      <Badge variant="secondary" className="text-xs">{req.branch_name}</Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  {changedFields.map((field) => (
                    <div key={field} className="rounded-lg border border-slate-100 p-2.5">
                      <p className="text-xs text-muted-foreground">{FIELD_LABELS[field] ?? field}</p>
                      <div className="mt-0.5 flex items-baseline gap-2">
                        {req.old_values?.[field] !== undefined && (
                          <span className="text-xs text-slate-400 line-through">
                            {formatValue(req.old_values[field])}
                          </span>
                        )}
                        <span className="text-sm font-semibold text-emerald-700">
                          {formatValue(req.new_values[field])}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                <Textarea
                  placeholder="Reviewer note (required for rejection)…"
                  value={notes[req.id] ?? ''}
                  onChange={(e) => setNotes((prev) => ({ ...prev, [req.id]: e.target.value }))}
                  rows={2}
                />

                <div className="flex gap-2 justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive border-destructive/50 hover:bg-destructive/10"
                    disabled={acting === req.id}
                    onClick={() => handleAction(req, 'rejected')}
                  >
                    {acting === req.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <XCircle className="h-4 w-4 mr-1" />
                    )}
                    Reject
                  </Button>
                  <Button
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    disabled={acting === req.id}
                    onClick={() => handleAction(req, 'approved')}
                  >
                    {acting === req.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 mr-1" />
                    )}
                    Approve
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </DashboardLayout>
  );
}
