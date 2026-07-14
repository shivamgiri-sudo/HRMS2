import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { ExpenseClaimCard } from '../../components/expenses/ExpenseClaimCard';
import { useMyClaims, useCreateClaim } from '../../integrations/expenses/hooks';
import { ExpenseStatus } from '../../integrations/expenses/types';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Plus, Receipt } from 'lucide-react';

export default function MyExpenses() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<string>('all');
  const { data, isLoading } = useMyClaims(activeTab !== 'all' ? activeTab as ExpenseStatus : undefined);
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
          {data?.claims.length === 0 ? (
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
