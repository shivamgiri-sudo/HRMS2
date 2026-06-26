import { useState } from 'react';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { Button } from '../../components/ui/button';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { Input } from '../../components/ui/input';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { Label } from '../../components/ui/label';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { ExpenseStatusBadge } from '../../components/expenses/ExpenseStatusBadge';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { ExpenseApprovalActions } from '../../components/expenses/ExpenseApprovalActions';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { ExpenseItemsList } from '../../components/expenses/ExpenseItemsList';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { useFinanceQueue, useClaimDetails, useFinanceApprove, useRejectClaim, useMarkAsPaid } from '../../integrations/expenses/hooks';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { ExpenseStatus } from '../../integrations/expenses/types';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import type { ExpenseClaim } from '../../integrations/expenses/types';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { Download } from 'lucide-react';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { toast } from 'sonner';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { expenseApi } from '../../integrations/expenses/api';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';

interface ClaimRowProps {
  claim: ExpenseClaim;
  onSelect: () => void;
  isSelected: boolean;
}

function ClaimRow({ claim, onSelect, isSelected }: ClaimRowProps) {
  return (
    <Card
      className={`cursor-pointer transition-colors ${isSelected ? 'border-primary' : 'hover:border-muted-foreground'}`}
      onClick={onSelect}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="font-mono text-sm">{claim.claim_number}</span>
          <ExpenseStatusBadge status={claim.status} />
        </div>
        <div className="flex items-center justify-between mt-2">
          <span className="font-bold">
            {claim.currency} {claim.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatISTDate(claim.manager_approved_date ?? claim.created_at)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

interface PayForm {
  payment_reference: string;
  payment_date: string;
  payment_method: string;
}

export default function FinanceQueue() {
  const [tab, setTab] = useState<ExpenseStatus>(ExpenseStatus.MANAGER_APPROVED);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [payDialog, setPayDialog] = useState(false);
  const [payForm, setPayForm] = useState<PayForm>({
    payment_reference: '',
    payment_date: '',
    payment_method: 'Bank Transfer',
  });

  const { data: queue } = useFinanceQueue(tab);
  const { data: claim } = useClaimDetails(selectedId ?? 0);
  const { mutate: approve, isPending: approving } = useFinanceApprove();
  const { mutate: reject, isPending: rejecting } = useRejectClaim();
  const { mutate: markPaid, isPending: paying } = useMarkAsPaid();

  const handleExport = async () => {
    try {
      const blob = await expenseApi.exportForPayment(ExpenseStatus.FINANCE_APPROVED);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'expense-payment-export.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Export failed';
      toast.error(message);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Finance Queue</h1>
          <p className="text-muted-foreground">Process and approve expense reimbursements</p>
        </div>
        <Button variant="outline" onClick={handleExport}>
          <Download className="h-4 w-4 mr-2" /> Export for Payment
        </Button>
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as ExpenseStatus);
          setSelectedId(null);
        }}
      >
        <TabsList>
          <TabsTrigger value={ExpenseStatus.MANAGER_APPROVED}>Pending Finance Approval</TabsTrigger>
          <TabsTrigger value={ExpenseStatus.FINANCE_APPROVED}>Approved — Pending Payment</TabsTrigger>
          <TabsTrigger value={ExpenseStatus.PAID}>Paid</TabsTrigger>
        </TabsList>
        <TabsContent value={tab} className="mt-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              {(queue?.claims ?? []).map(c => (
                <ClaimRow
                  key={c.id}
                  claim={c}
                  isSelected={selectedId === c.id}
                  onSelect={() => setSelectedId(c.id)}
                />
              ))}
              {(queue?.claims ?? []).length === 0 && (
                <p className="text-center py-8 text-muted-foreground">No claims in this queue</p>
              )}
            </div>

            {selectedId && claim && (
              <Card>
                <CardHeader>
                  <CardTitle>Claim Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-2xl font-bold">
                      {claim.currency} {claim.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                    <ExpenseStatusBadge status={claim.status} />
                  </div>
                  <ExpenseItemsList items={claim.items ?? []} claimId={selectedId} editable={false} />
                  {tab === ExpenseStatus.MANAGER_APPROVED && (
                    <ExpenseApprovalActions
                      isLoading={approving || rejecting}
                      onApprove={(comments) =>
                        approve(
                          { claimId: selectedId, dto: { comments } },
                          {
                            onSuccess: () => {
                              toast.success('Finance approved');
                              setSelectedId(null);
                            },
                            onError: (err: Error) => toast.error(err.message),
                          }
                        )
                      }
                      onReject={(reason) =>
                        reject(
                          { claimId: selectedId, dto: { rejection_reason: reason } },
                          {
                            onSuccess: () => {
                              toast.success('Claim rejected');
                              setSelectedId(null);
                            },
                            onError: (err: Error) => toast.error(err.message),
                          }
                        )
                      }
                    />
                  )}
                  {tab === ExpenseStatus.FINANCE_APPROVED && (
                    <Button onClick={() => setPayDialog(true)} disabled={paying}>
                      Mark as Paid
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={payDialog} onOpenChange={setPayDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark as Paid</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Payment Reference *</Label>
              <Input
                value={payForm.payment_reference}
                onChange={e => setPayForm(p => ({ ...p, payment_reference: e.target.value }))}
                placeholder="UTR/NEFT reference"
              />
            </div>
            <div className="space-y-1">
              <Label>Payment Date *</Label>
              <Input
                type="date"
                value={payForm.payment_date}
                onChange={e => setPayForm(p => ({ ...p, payment_date: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Payment Method</Label>
              <Input
                value={payForm.payment_method}
                onChange={e => setPayForm(p => ({ ...p, payment_method: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayDialog(false)}>
              Cancel
            </Button>
            <Button
              disabled={!payForm.payment_reference || !payForm.payment_date || paying}
              onClick={() => {
                if (!selectedId) return;
                markPaid(
                  { claimId: selectedId, dto: payForm },
                  {
                    onSuccess: () => {
                      toast.success('Marked as paid');
                      setPayDialog(false);
                      setSelectedId(null);
                    },
                    onError: (err: Error) => toast.error(err.message),
                  }
                );
              }}
            >
              Confirm Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
