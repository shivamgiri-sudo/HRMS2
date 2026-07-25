import { BudgetLinkedGrnForm } from "@/components/finance/grn/BudgetLinkedGrnForm";
import { GrnLobAttributionQueue } from "@/components/finance/grn/GrnLobAttributionQueue";
import { SmartGrnApprovalQueue } from "@/components/finance/grn/SmartGrnApprovalQueue";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function NativeGRNManagement() {
  return (
    <DashboardLayout>
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
          <div>
            <h1 className="text-sm font-semibold">GRN Management</h1>
            <p className="text-[11px] text-slate-500">
              Budget-controlled invoice capture, LOB attribution and approval
            </p>
          </div>
        </div>

        <Tabs defaultValue="create" className="flex flex-1 flex-col overflow-hidden">
          <TabsList className="mx-4 mt-2 h-8">
            <TabsTrigger value="create" className="h-7 text-xs">Create GRN</TabsTrigger>
            <TabsTrigger value="attribution" className="h-7 text-xs">LOB Attribution</TabsTrigger>
            <TabsTrigger value="queue" className="h-7 text-xs">Approval Queue</TabsTrigger>
          </TabsList>
          <TabsContent value="create" className="m-0 flex-1 overflow-auto p-0">
            <BudgetLinkedGrnForm />
          </TabsContent>
          <TabsContent value="attribution" className="m-0 flex-1 overflow-hidden">
            <GrnLobAttributionQueue />
          </TabsContent>
          <TabsContent value="queue" className="m-0 flex-1 overflow-hidden">
            <SmartGrnApprovalQueue />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
