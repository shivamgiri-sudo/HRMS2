import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Separator } from '../../components/ui/separator';
import { ExpenseItemForm } from '../../components/expenses/ExpenseItemForm';
import { ExpenseItemsList } from '../../components/expenses/ExpenseItemsList';
import { ExpenseSummary } from '../../components/expenses/ExpenseSummary';
import { ExpenseStatusBadge } from '../../components/expenses/ExpenseStatusBadge';
import { useCreateClaim, useAddClaimItem, useClaimDetails, useSubmitClaim } from '../../integrations/expenses/hooks';
import { ExpenseStatus } from '../../integrations/expenses/types';
import type { AddExpenseItemDto } from '../../integrations/expenses/types';
import { ArrowLeft, Send } from 'lucide-react';
import { toast } from 'sonner';

export default function NewExpenseClaim() {
  const navigate = useNavigate();
  const { claimId } = useParams<{ claimId?: string }>();
  const [activeClaim, setActiveClaim] = useState<number | null>(claimId ? parseInt(claimId) : null);

  const { data: claimData } = useClaimDetails(activeClaim ?? 0);
  const { mutate: createClaim, isPending: creatingClaim } = useCreateClaim();
  const { mutate: addItem, isPending: addingItem } = useAddClaimItem();
  const { mutate: submitClaim, isPending: submitting } = useSubmitClaim();

  const claim = claimData;
  const items = claim?.items ?? [];
  const isDraft = claim?.status === ExpenseStatus.DRAFT;

  const handleCreateClaim = () => {
    createClaim(
      { process_id: 0, branch_id: 0 },
      {
        onSuccess: (newClaim) => {
          setActiveClaim(newClaim.id);
          navigate(`/expenses/new/${newClaim.id}`, { replace: true });
        },
      }
    );
  };

  const handleAddItem = (itemData: AddExpenseItemDto) => {
    if (!activeClaim) return;
    addItem(
      { claimId: activeClaim, dto: itemData },
      {
        onSuccess: () => toast.success('Expense item added'),
        onError: (err: Error) => toast.error(err.message ?? 'Failed to add item'),
      }
    );
  };

  const handleSubmit = () => {
    if (!activeClaim) return;
    submitClaim(activeClaim, {
      onSuccess: () => {
        toast.success('Claim submitted for approval');
        navigate('/expenses');
      },
      onError: (err: Error) => toast.error(err.message ?? 'Failed to submit'),
    });
  };

  if (!activeClaim) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/expenses')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-bold">New Expense Claim</h1>
        </div>
        <Card>
          <CardContent className="pt-6 text-center space-y-4">
            <p className="text-muted-foreground">Start a new expense claim to add your receipts</p>
            <Button onClick={handleCreateClaim} disabled={creatingClaim}>
              {creatingClaim ? 'Creating...' : 'Create Claim'}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/expenses')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{claim?.claim_number ?? 'New Claim'}</h1>
            {claim && <ExpenseStatusBadge status={claim.status} />}
          </div>
        </div>
        {isDraft && (
          <Button onClick={handleSubmit} disabled={submitting || items.length === 0}>
            <Send className="h-4 w-4 mr-2" />
            {submitting ? 'Submitting...' : 'Submit for Approval'}
          </Button>
        )}
      </div>

      {isDraft && (
        <Card>
          <CardHeader>
            <CardTitle>Add Expense Item</CardTitle>
          </CardHeader>
          <CardContent>
            <ExpenseItemForm onSubmit={handleAddItem} isLoading={addingItem} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Expense Items</CardTitle>
        </CardHeader>
        <CardContent>
          <ExpenseItemsList items={items} claimId={activeClaim} editable={isDraft} />
          {items.length > 0 && (
            <>
              <Separator className="my-4" />
              <ExpenseSummary items={items} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
