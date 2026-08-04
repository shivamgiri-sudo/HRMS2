import { FileCheck2, FileClock, FileText, GitBranch } from "lucide-react";
import { Link } from "react-router-dom";
import { BudgetLinkedGrnForm } from "@/components/finance/grn/BudgetLinkedGrnForm";
import { GrnHistoryTable } from "@/components/finance/grn/GrnHistoryTable";
import { GrnLobAttributionQueue } from "@/components/finance/grn/GrnLobAttributionQueue";
import { SmartGrnApprovalQueue } from "@/components/finance/grn/SmartGrnApprovalQueue";
import { money } from "@/components/finance/grn/grn-format";
import {
  GRN_TAB_COUNT,
  GRN_TAB_TRIGGER,
  GRN_TABS_LIST,
} from "@/components/finance/grn/grn-ui";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGrnNeedsLobCount, useGrnSummary } from "@/hooks/useGrnSummary";
import { useHasRole } from "@/hooks/useUserRole";

function HeaderStat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="text-right">
      <div className="font-grn-mono text-[18px] font-semibold leading-tight text-grn-ink">{value}</div>
      <div className="mt-0.5 text-[10.5px] uppercase tracking-[0.06em] text-grn-ink-soft">{label}</div>
    </div>
  );
}

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

  const summaryQuery = useGrnSummary();
  const summary = summaryQuery.data;
  const needsLob = useGrnNeedsLobCount();

  const queueCount = summary?.inQueue.count ?? 0;

  return (
    <DashboardLayout>
      {/* grn-scope carries this page's palette and IBM Plex face (src/styles/grn.css). The
          grn-* utilities used throughout the GRN components resolve to nothing outside it. */}
      <div className="grn-scope flex h-full min-h-0 flex-col overflow-hidden">
        <Tabs defaultValue="create" className="flex min-h-0 flex-1 flex-col">
          <div className="mx-auto w-full max-w-[1360px] shrink-0">
            <nav className="mb-2.5 flex items-center gap-1.5 text-[11.5px] text-grn-ink-soft" aria-label="Breadcrumb">
              <Link to="/" className="hover:text-grn-brand">Home</Link>
              <span aria-hidden>›</span>
              <span>Finance</span>
              <span aria-hidden>›</span>
              <span className="font-semibold text-grn-ink">GRN Management</span>
            </nav>

            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="text-[22px] font-bold tracking-[-0.01em] text-grn-ink">GRN Management</h1>
                <p className="mt-0.5 max-w-[52ch] text-[12.5px] text-grn-ink-soft">
                  Budget-controlled invoice capture, LOB attribution and four-stage approval.
                </p>
              </div>
              <div className="flex gap-6">
                <HeaderStat value={summaryQuery.isLoading ? "—" : queueCount} label="In queue" />
                <HeaderStat
                  value={summaryQuery.isLoading ? "—" : money(summary?.inQueue.value, 0)}
                  label="Pending value"
                />
                {/* Hidden rather than zeroed for roles the attribution endpoint rejects — see
                    useGrnNeedsLobCount. */}
                {needsLob.count !== null && (
                  <HeaderStat value={needsLob.isLoading ? "—" : needsLob.count} label="Needs LOB" />
                )}
              </div>
            </div>

            <TabsList className={`${GRN_TABS_LIST} mt-5`}>
              <TabsTrigger value="create" className={GRN_TAB_TRIGGER}>
                <FileText className="h-3.5 w-3.5" />Create GRN
              </TabsTrigger>
              <TabsTrigger value="attribution" className={GRN_TAB_TRIGGER}>
                <GitBranch className="h-3.5 w-3.5" />LOB Attribution
                {needsLob.count ? <span className={GRN_TAB_COUNT}>{needsLob.count}</span> : null}
              </TabsTrigger>
              {canReview && (
                <TabsTrigger value="queue" className={GRN_TAB_TRIGGER}>
                  <FileCheck2 className="h-3.5 w-3.5" />Approval Queue
                  {queueCount ? <span className={GRN_TAB_COUNT}>{queueCount}</span> : null}
                </TabsTrigger>
              )}
              <TabsTrigger value="history" className={GRN_TAB_TRIGGER}>
                <FileClock className="h-3.5 w-3.5" />History
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Each tab still owns its own scroll for now. The page moves to document flow in the
              next step, together with the LOB pane that depends on this height chain. */}
          <TabsContent value="create" className="m-0 min-h-0 flex-1 overflow-auto p-0">
            <BudgetLinkedGrnForm />
          </TabsContent>
          <TabsContent value="attribution" className="m-0 min-h-0 flex-1 overflow-hidden">
            <GrnLobAttributionQueue />
          </TabsContent>
          {canReview && (
            <TabsContent value="queue" className="m-0 min-h-0 flex-1 overflow-hidden">
              <SmartGrnApprovalQueue />
            </TabsContent>
          )}
          <TabsContent value="history" className="m-0 min-h-0 flex-1 overflow-auto">
            <div className="mx-auto w-full max-w-[1360px] py-4">
              <GrnHistoryTable />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
