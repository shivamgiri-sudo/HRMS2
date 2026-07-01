import { ExpenseItem } from '../../integrations/expenses/types';
import { ReceiptUpload } from './ReceiptUpload';
import { normalizeDate } from '@/lib/utils';
import { Button } from '../ui/button';
import { Trash2 } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';

interface ExpenseItemsListProps {
  items: ExpenseItem[];
  claimId: number;
  editable?: boolean;
  onDeleteItem?: (itemId: number) => void;
}

export function ExpenseItemsList({ items, claimId, editable, onDeleteItem }: ExpenseItemsListProps) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-4">No expense items yet</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Description</TableHead>
          <TableHead>Vendor</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead>Receipt</TableHead>
          {editable && <TableHead />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map(item => (
          <TableRow key={item.id}>
            <TableCell className="text-sm">{new Date(normalizeDate(item.expense_date)).toLocaleDateString('en-IN')}</TableCell>
            <TableCell className="text-sm">{item.description}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{item.vendor_name ?? '—'}</TableCell>
            <TableCell className="text-right font-medium">
              ₹{item.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </TableCell>
            <TableCell>
              {editable
                ? <ReceiptUpload claimId={claimId} itemId={item.id} existingPath={item.receipt_file_path} />
                : item.receipt_file_path
                  ? <a href={item.receipt_file_path} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 underline">View</a>
                  : <span className="text-xs text-muted-foreground">None</span>
              }
            </TableCell>
            {editable && (
              <TableCell>
                <Button variant="ghost" size="icon" onClick={() => onDeleteItem?.(item.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
