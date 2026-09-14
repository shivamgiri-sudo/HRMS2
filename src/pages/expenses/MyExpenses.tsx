import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { ExpenseClaimCard } from '../../components/expenses/ExpenseClaimCard';
import { useMyClaims, useCreateClaim } from '../../integrations/expenses/hooks';
import { ExpenseStatus } from '../../integrations/expenses/types';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { AlertTriangle, Plus, Receipt } from 'lucide-react';

export default function MyExpenses() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<string>('all');
  const { data, isLoading, isError, error, refetch } = useMyClaims(activeTab !== 'all' ? activeTab as ExpenseStatus : undefined);
  const { isPending } = useCreateClaim();

  const handleNewClaim = () => {
    navigate('/expenses/new');
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="p-6 text-center text-muted-foreground">Loading expenses...</div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">My Expenses</h1>
          <p className="text-muted-foreground">Track and manage your expense claims</p>
        </div>
        <Button onClick={handleNewClaim} disabled={isPending}>
          <Plus className="h-4 w-4 mr-2" /> New Claim
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value={ExpenseStatus.DRAFT}>Drafts</TabsTrigger>
          <TabsTrigger value={ExpenseStatus.SUBMITTED}>Submitted</TabsTrigger>
          <TabsTrigger value={ExpenseStatus.MANAGER_APPROVED}>Approved</TabsTrigger>
          <TabsTrigger value={ExpenseStatus.PAID}>Paid</TabsTrigger>
          <TabsTrigger value={ExpenseStatus.REJECTED}>Rejected</TabsTrigger>
        </TabsList>
        <TabsContent value={activeTab} className="mt-4">
          {/*
            Three states, not two. `data` is undefined when the query fails, and
            `undefined === 0` is false — so a failed load previously fell through
            to the grid below and rendered nothing at all: no claims, no empty
            state, no error. CEO UAT 31-Jul-2026 reported exactly that ("tabs
            render but nothing below them, so the user cannot tell whether it is
            loading, empty or broken"). A failure must say so.
          */}
          {isError ? (
            <div className="text-center py-12">
              <AlertTriangle className="h-12 w-12 mx-auto text-destructive mb-4" />
              <p className="font-medium">Could not load your expense claims</p>
              <p className="text-sm text-muted-foreground mt-1">
                {error instanceof Error ? error.message : 'The expenses service did not respond.'}
              </p>
              <Button variant="outline" className="mt-4" onClick={() => void refetch()}>Try again</Button>
            </div>
          ) : !data || data.claims.length === 0 ? (
            <div className="text-center py-12">
              <Receipt className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No expense claims yet</p>
              <Button className="mt-4" onClick={handleNewClaim}>Create your first claim</Button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {data?.claims.map(claim => (
                <ExpenseClaimCard
                  key={claim.id}
                  claim={claim}
                  onClick={() => navigate(`/expenses/${claim.id}`)}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
      </div>
    </DashboardLayout>
  );
}
