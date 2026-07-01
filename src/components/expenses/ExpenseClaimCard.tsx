import { ExpenseClaim } from '../../integrations/expenses/types';
import { ExpenseStatusBadge } from './ExpenseStatusBadge';
import { Card, CardContent, CardHeader } from '../ui/card';
import { formatDistanceToNow } from 'date-fns';

interface ExpenseClaimCardProps {
  claim: ExpenseClaim;
  onClick?: () => void;
}

export function ExpenseClaimCard({ claim, onClick }: ExpenseClaimCardProps) {
  return (
    <Card className={onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''} onClick={onClick}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-sm font-medium">{claim.claim_number}</span>
          <ExpenseStatusBadge status={claim.status} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <span className="text-2xl font-bold">
            {claim.currency} {claim.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(claim.created_at), { addSuffix: true })}
          </span>
        </div>
        {claim.rejection_reason && (
          <p className="mt-2 text-sm text-destructive">{claim.rejection_reason}</p>
        )}
      </CardContent>
    </Card>
  );
}
