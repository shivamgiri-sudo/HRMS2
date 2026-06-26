import { useState } from 'react';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { ExpenseStatusBadge } from '../../components/expenses/ExpenseStatusBadge';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { ExpenseApprovalActions } from '../../components/expenses/ExpenseApprovalActions';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { ExpenseItemsList } from '../../components/expenses/ExpenseItemsList';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { usePendingApprovals, useClaimDetails, useManagerApprove, useRejectClaim } from '../../integrations/expenses/hooks';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { ClipboardList } from 'lucide-react';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { toast } from 'sonner';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';

interface ClaimDetailProps {
  claimId: number;
  onApprove: (comments?: string) => void;
  onReject: (reason: string) => void;
  isLoading: boolean;
}

function ClaimDetail({ claimId, onApprove, onReject, isLoading }: ClaimDetailProps) {
  const { data: claim } = useClaimDetails(claimId);
  if (!claim) return <div className="p-4 text-center text-muted-foreground">Loading...</div>;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono font-medium">{claim.claim_number}</p>
          <p className="text-2xl font-bold">
            {claim.currency} {claim.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </p>
        </div>
        <ExpenseStatusBadge status={claim.status} />
      </div>
      <ExpenseItemsList items={claim.items ?? []} claimId={claimId} editable={false} />
      <ExpenseApprovalActions onApprove={onApprove} onReject={onReject} isLoading={isLoading} />
    </div>
  );
}

export default function ExpenseApprovals() {
  const { data: claims = [], isLoading } = usePendingApprovals();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { mutate: approve, isPending: approving } = useManagerApprove();
  const { mutate: reject, isPending: rejecting } = useRejectClaim();

  if (isLoading) return <div className="p-6 text-center text-muted-foreground">Loading approvals...</div>;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Expense Approvals</h1>
        <p className="text-muted-foreground">
          {claims.length} pending approval{claims.length !== 1 ? 's' : ''}
        </p>
      </div>

      {claims.length === 0 ? (
        <div className="text-center py-12">
          <ClipboardList className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">No pending approvals</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            {claims.map(claim => (
              <Card
                key={claim.id}
                className={`cursor-pointer transition-colors ${selectedId === claim.id ? 'border-primary' : 'hover:border-muted-foreground'}`}
                onClick={() => setSelectedId(claim.id)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm">{claim.claim_number}</span>
                    <span className="font-bold">
                      {claim.currency} {claim.total_amount.toLocaleString('en-IN')}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Submitted {formatISTDate(claim.submitted_date ?? claim.created_at)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          {selectedId && (
            <Card>
              <CardHeader>
                <CardTitle>Review Claim</CardTitle>
              </CardHeader>
              <CardContent>
                <ClaimDetail
                  claimId={selectedId}
                  isLoading={approving || rejecting}
                  onApprove={(comments) =>
                    approve(
                      { claimId: selectedId, dto: { comments } },
                      {
                        onSuccess: () => {
                          toast.success('Claim approved');
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
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
