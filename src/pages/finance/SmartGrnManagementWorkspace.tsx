import { ChevronRight, ClipboardList, FilePlus } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { BudgetLinkedGrnForm } from "@/components/finance/grn/BudgetLinkedGrnForm";
import { SmartGrnApprovalQueue } from "@/components/finance/grn/SmartGrnApprovalQueue";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function SmartGrnManagementWorkspace() {
  return (
    <DashboardLayout>
      <div className="min-h-screen bg-[linear-gradient(180deg,_#f8fafc_0%,_#ffffff_45%,_#f4f7fb_100%)]">
        <div className="relative overflow-hidden border-b border-slate-200 bg-white shadow-sm">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.04]"
            style={{
              backgroundImage:
                "repeating-linear-gradient(45deg, #073f78 0, #073f78 1px, transparent 0, transparent 50%)",
              backgroundSize: "8px 8px",
            }}
          />
          <div className="relative px-6 py-5">
            <nav className="mb-2 flex items-center gap-1 text-[11px] text-slate-400">
              <span>Finance</span>
              <ChevronRight className="h-3 w-3" />
              <span className="font-medium text-[#073f78]">GRN Management</span>
            </nav>
            <div className="flex items-center gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#073f78] shadow-md shadow-[#073f78]/20">
                <FilePlus className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-950">Smart GRN Management</h1>
                <p className="mt-0.5 text-xs text-slate-500">
                  Document intelligence, exact cost-centre allocation, auditable exceptions and staged finance approvals.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="px-4 py-6 sm:px-6 lg:px-8">
          <Tabs defaultValue="create">
            <TabsList className="mb-6 h-auto w-fit rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
              <TabsTrigger
                value="create"
                className="rounded-lg px-5 py-2 text-xs font-semibold data-[state=active]:bg-[#073f78] data-[state=active]:text-white"
              >
                <FilePlus className="mr-2 h-3.5 w-3.5" />Create Smart GRN
              </TabsTrigger>
              <TabsTrigger
                value="queue"
                className="rounded-lg px-5 py-2 text-xs font-semibold data-[state=active]:bg-[#073f78] data-[state=active]:text-white"
              >
                <ClipboardList className="mr-2 h-3.5 w-3.5" />Approval & Control Queue
              </TabsTrigger>
            </TabsList>
            <TabsContent value="create"><BudgetLinkedGrnForm /></TabsContent>
            <TabsContent value="queue">
              <Card className="rounded-3xl border-slate-200 shadow-sm">
                <CardContent className="p-5"><SmartGrnApprovalQueue /></CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </DashboardLayout>
  );
}
