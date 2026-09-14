import { ExpenseItem } from '../../integrations/expenses/types';

interface ExpenseSummaryProps {
  items: ExpenseItem[];
  currency?: string;
}

export function ExpenseSummary({ items, currency = 'INR' }: ExpenseSummaryProps) {
  const total = items.reduce((sum, item) => sum + item.amount, 0);
  return (
    <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
      <span className="text-sm text-muted-foreground">{items.length} item{items.length !== 1 ? 's' : ''}</span>
      <span className="text-lg font-semibold">
        {currency} {total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
      </span>
    </div>
  );
}
