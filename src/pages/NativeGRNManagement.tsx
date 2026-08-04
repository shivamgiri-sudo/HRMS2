import { FileCheck2, FileClock, FileText, GitBranch } from "lucide-react";
import { BudgetLinkedGrnForm } from "@/components/finance/grn/BudgetLinkedGrnForm";
import { GrnHistoryTable } from "@/components/finance/grn/GrnHistoryTable";
import { GrnLobAttributionQueue } from "@/components/finance/grn/GrnLobAttributionQueue";
import { SmartGrnApprovalQueue } from "@/components/finance/grn/SmartGrnApprovalQueue";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useHasRole } from "@/hooks/useUserRole";

/** Folder-tab treatment, scoped to this page only via className overrides (tailwind-merge wins
 *  on the conflicting utilities) — the shared Tabs component elsewhere in the app is untouched.
 *  Tabs sit on the content's top border like real document tabs, instead of a pill switcher. */
const TAB_LIST_CLASS =
  "h-auto w-full justify-start gap-0.5 rounded-none border-0 border-b border-slate-200 bg-transparent p-0 shadow-none";
// !-prefixed radius utilities: tailwind-merge (default config) does not recognize rounded-t-lg/
// rounded-b-none as conflicting with the base component's rounded-xl shorthand — verified by
// running twMerge directly, rounded-xl survives in the merged string either way. The !important
// these compile to is what actually wins in the browser regardless of merge/source order.
const TAB_TRIGGER_CLASS =
  "-mb-px !rounded-t-lg !rounded-b-none border border-b-0 border-transparent px-4 py-2 text-xs font-bold text-slate-500 data-[state=active]:border-slate-200 data-[state=active]:bg-white data-[state=active]:text-[#073f78] data-[state=active]:shadow-none";

export default function NativeGRNManagement() {
  // Branch admins raise GRNs but cannot review them — the backend's
  // GRN_REVIEW_ROLES excludes them, so the approval queue would only offer
  // actions that 403. Hiding it is presentation; the backend remains the gate.
  // Uses useHasRole rather than user.role: HrmsUser carries no role field, so
  // the `user?.role` idiom used elsewhere silently evaluates to undefined.
  const canReview = useHasRole(
    "finance_head",
    "accounts_head",
    "admin",
    "super_admin",
    "branch_head"
  );

  return (
    <DashboardLayout>
      <div className="flex h-full flex-col overflow-hidden" style={{ fontFamily: '"IBM Plex Sans", var(--font-sans, ui-sans-serif), sans-serif' }}>
        <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
          <div>
            <h1 className="text-sm font-bold text-slate-950">GRN Management</h1>
            <p className="text-[11px] text-slate-500">
              Budget-controlled invoice capture, LOB attribution and four-stage approval
            </p>
          </div>
        </div>

        <Tabs defaultValue="create" className="flex flex-1 flex-col overflow-hidden">
          <TabsList className={`${TAB_LIST_CLASS} mx-4 mt-2`}>
            <TabsTrigger value="create" className={TAB_TRIGGER_CLASS}>
              <FileText className="mr-1.5 h-3.5 w-3.5" />Create GRN
            </TabsTrigger>
            <TabsTrigger value="attribution" className={TAB_TRIGGER_CLASS}>
              <GitBranch className="mr-1.5 h-3.5 w-3.5" />LOB Attribution
            </TabsTrigger>
            {canReview && (
              <TabsTrigger value="queue" className={TAB_TRIGGER_CLASS}>
                <FileCheck2 className="mr-1.5 h-3.5 w-3.5" />Approval Queue
              </TabsTrigger>
            )}
            <TabsTrigger value="history" className={TAB_TRIGGER_CLASS}>
              <FileClock className="mr-1.5 h-3.5 w-3.5" />History
            </TabsTrigger>
          </TabsList>
          <TabsContent value="create" className="m-0 flex-1 overflow-auto p-0">
            <BudgetLinkedGrnForm />
          </TabsContent>
          <TabsContent value="attribution" className="m-0 flex-1 overflow-hidden">
            <GrnLobAttributionQueue />
          </TabsContent>
          {canReview && (
            <TabsContent value="queue" className="m-0 flex-1 overflow-hidden">
              <SmartGrnApprovalQueue />
            </TabsContent>
          )}
          <TabsContent value="history" className="m-0 flex-1 overflow-auto">
            <GrnHistoryTable />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
