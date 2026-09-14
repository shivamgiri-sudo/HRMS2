import { useState, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, CheckCircle2, XCircle, Users } from 'lucide-react';
import { toast } from 'sonner';
import {
  usePendingRMChangeRequests,
  useActOnRMChangeRequest,
  type RMChangeRequest,
} from '@/hooks/useReportingManagerChange';

export default function NativeWFMManagerApproval() {
  const { data: requests, isLoading, refetch } = usePendingRMChangeRequests();
  const act = useActOnRMChangeRequest();
  const [acting, setActing] = useState<string | null>(null);
  const [remarks, setRemarks] = useState<Record<string, string>>({});

  const handleAction = useCallback(
    async (req: RMChangeRequest, action: 'approved' | 'rejected') => {
      if (action === 'rejected' && !remarks[req.id]?.trim()) {
        toast.error('Please enter rejection remarks before rejecting.');
        return;
      }
      setActing(req.id);
      try {
        await act.mutateAsync({ requestId: req.id, action, remarks: remarks[req.id] });
        toast.success(action === 'approved' ? 'Request approved' : 'Request rejected');
        refetch();
      } catch (err: any) {
        toast.error(err.message ?? 'Action failed');
      } finally {
        setActing(null);
      }
    },
    [act, remarks, refetch]
  );

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Reporting Manager Change Approvals</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Review and action pending requests from your branch.
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
              <Users className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-muted-foreground">No pending requests.</p>
            </CardContent>
          </Card>
        )}

        {requests?.map((req) => (
          <Card key={req.id} className="border-l-4 border-l-amber-400">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{req.employee_name}</CardTitle>
                <Badge variant="outline" className="text-xs">
                  {req.employee_code}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Current Manager</p>
                  <p className="font-medium">{req.current_manager_name || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Requested Manager</p>
                  <p className="font-medium text-emerald-700">
                    {req.requested_manager_name}
                  </p>
                </div>
              </div>

              {req.reason && (
                <div className="text-sm bg-muted/50 rounded p-2">
                  <span className="text-xs text-muted-foreground">Reason: </span>
                  {req.reason}
                </div>
              )}

              <Textarea
                placeholder="Remarks (required for rejection)…"
                value={remarks[req.id] ?? ''}
                onChange={(e) =>
                  setRemarks((prev) => ({ ...prev, [req.id]: e.target.value }))
                }
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
        ))}
      </div>
    </DashboardLayout>
  );
}
