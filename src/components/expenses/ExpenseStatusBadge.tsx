import { ExpenseStatus } from '../../integrations/expenses/types';
import { Badge } from '../ui/badge';

const STATUS_CONFIG: Record<ExpenseStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  [ExpenseStatus.DRAFT]: { label: 'Draft', variant: 'secondary' },
  [ExpenseStatus.SUBMITTED]: { label: 'Submitted', variant: 'default' },
  [ExpenseStatus.MANAGER_APPROVED]: { label: 'Manager Approved', variant: 'default' },
  [ExpenseStatus.FINANCE_APPROVED]: { label: 'Finance Approved', variant: 'default' },
  [ExpenseStatus.PAID]: { label: 'Paid', variant: 'default' },
  [ExpenseStatus.REJECTED]: { label: 'Rejected', variant: 'destructive' },
};

export function ExpenseStatusBadge({ status }: { status: ExpenseStatus }) {
  const config = STATUS_CONFIG[status] ?? { label: status, variant: 'secondary' as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
