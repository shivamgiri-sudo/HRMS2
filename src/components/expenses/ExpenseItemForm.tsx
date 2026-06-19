import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { useExpenseCategories } from '../../integrations/expenses/hooks';
import type { AddExpenseItemDto } from '../../integrations/expenses/types';

const schema = z.object({
  category_id: z.coerce.number().positive('Category is required'),
  expense_date: z.string().min(1, 'Date is required'),
  amount: z.coerce.number().positive('Amount must be positive'),
  description: z.string().min(3, 'Description must be at least 3 characters'),
  vendor_name: z.string().optional(),
});

interface ExpenseItemFormProps {
  onSubmit: (data: AddExpenseItemDto) => void;
  isLoading?: boolean;
}

export function ExpenseItemForm({ onSubmit, isLoading }: ExpenseItemFormProps) {
  const { data: categories = [] } = useExpenseCategories();
  const { register, handleSubmit, setValue, formState: { errors }, reset } = useForm<AddExpenseItemDto>({
    resolver: zodResolver(schema),
  });

  const handleFormSubmit = (data: AddExpenseItemDto) => {
    onSubmit(data);
    reset();
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label>Category *</Label>
          <Select onValueChange={(v) => setValue('category_id', parseInt(v))}>
            <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
            <SelectContent>
              {categories.map(cat => (
                <SelectItem key={cat.id} value={String(cat.id)}>{cat.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.category_id && <p className="text-xs text-destructive">{errors.category_id.message}</p>}
        </div>
        <div className="space-y-1">
          <Label>Date *</Label>
          <Input type="date" {...register('expense_date')} />
          {errors.expense_date && <p className="text-xs text-destructive">{errors.expense_date.message}</p>}
        </div>
        <div className="space-y-1">
          <Label>Amount (INR) *</Label>
          <Input type="number" step="0.01" min="0" placeholder="0.00" {...register('amount')} />
          {errors.amount && <p className="text-xs text-destructive">{errors.amount.message}</p>}
        </div>
        <div className="space-y-1">
          <Label>Vendor</Label>
          <Input placeholder="Vendor name" {...register('vendor_name')} />
        </div>
        <div className="col-span-2 space-y-1">
          <Label>Description *</Label>
          <Input placeholder="Brief description of expense" {...register('description')} />
          {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
        </div>
      </div>
      <Button type="submit" disabled={isLoading} className="w-full">
        {isLoading ? 'Adding...' : 'Add Expense Item'}
      </Button>
    </form>
  );
}
