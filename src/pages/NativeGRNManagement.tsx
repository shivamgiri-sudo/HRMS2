import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { BudgetLinkedGrnForm } from "@/components/finance/grn/BudgetLinkedGrnForm";
import { SmartGrnApprovalQueue } from "@/components/finance/grn/SmartGrnApprovalQueue";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function NativeGRNManagement() {
  return (
    <DashboardLayout>
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 h-12 shrink-0">
          <h1 className="text-sm font-semibold">GRN Management</h1>
        </div>

        <Tabs defaultValue="create" className="flex flex-1 flex-col overflow-hidden">
          <TabsList className="h-7 mx-4 mt-2">
            <TabsTrigger value="create" className="text-xs h-6">Create GRN</TabsTrigger>
            <TabsTrigger value="queue" className="text-xs h-6">Approval Queue</TabsTrigger>
          </TabsList>
          <TabsContent value="create" className="flex-1 overflow-auto p-4">
            <BudgetLinkedGrnForm />
          </TabsContent>
          <TabsContent value="queue" className="flex-1 overflow-hidden m-0">
            <SmartGrnApprovalQueue />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
