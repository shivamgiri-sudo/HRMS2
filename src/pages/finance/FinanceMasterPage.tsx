import { useSearchParams } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useHasRole } from "@/hooks/useUserRole";
import { ExpenseHeadsTab } from "@/components/finance/masters/ExpenseHeadsTab";
import { SubHeadsTab } from "@/components/finance/masters/SubHeadsTab";
import { VendorHeadMappingTab } from "@/components/finance/masters/VendorHeadMappingTab";
import { VendorApprovalsTab } from "@/components/finance/masters/VendorApprovalsTab";
import { RaiseVendorRequestTab } from "@/components/finance/masters/RaiseVendorRequestTab";

export default function FinanceMasterPage() {
  const canApprove = useHasRole("finance_head", "super_admin");
  // Branch Admin has no direct /vendors access (that route is finance-role gated); this is the
  // only place they can submit a vendor create/update request for a Finance Head to approve.
  const canRaise = useHasRole("branch_admin");
  // Approval Center deep link: ?tab=approvals&approvalId=<request id>.
  const [deepLinkParams] = useSearchParams();
  const initialTab = deepLinkParams.get("tab") === "approvals" && canApprove ? "approvals" : "heads";

  return (
    <DashboardLayout>
      <div className="flex h-full flex-col">
        {/* Page header */}
        <div className="flex items-center border-b px-4 h-12 shrink-0 gap-3">
          <h1 className="text-sm font-semibold">Finance Masters</h1>
          <span className="text-xs text-slate-400">Expense heads, sub-heads, vendor mapping &amp; approval queue</span>
        </div>

        {/* Tabs */}
        <Tabs defaultValue={initialTab} className="flex flex-1 flex-col overflow-hidden">
          <div className="border-b px-4 pt-2 shrink-0">
            <TabsList className="h-8">
              <TabsTrigger value="heads" className="text-xs h-7">Expense Heads</TabsTrigger>
              <TabsTrigger value="subheads" className="text-xs h-7">Sub-Heads</TabsTrigger>
              <TabsTrigger value="mapping" className="text-xs h-7">Vendor Mapping</TabsTrigger>
              {canApprove && (
                <TabsTrigger value="approvals" className="text-xs h-7">Vendor Approvals</TabsTrigger>
              )}
              {canRaise && (
                <TabsTrigger value="raise-vendor" className="text-xs h-7">Add Vendor</TabsTrigger>
              )}
            </TabsList>
          </div>

          <div className="flex-1 overflow-y-auto">
            <TabsContent value="heads" className="m-4 mt-3">
              <ExpenseHeadsTab />
            </TabsContent>
            <TabsContent value="subheads" className="m-4 mt-3">
              <SubHeadsTab />
            </TabsContent>
            <TabsContent value="mapping" className="m-4 mt-3" style={{ height: "calc(100vh - 200px)" }}>
              <VendorHeadMappingTab />
            </TabsContent>
            {canApprove && (
              <TabsContent value="approvals" className="m-4 mt-3">
                <VendorApprovalsTab />
              </TabsContent>
            )}
            {canRaise && (
              <TabsContent value="raise-vendor" className="m-4 mt-3">
                <RaiseVendorRequestTab />
              </TabsContent>
            )}
          </div>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
