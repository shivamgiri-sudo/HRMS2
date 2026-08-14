import { FileCheck2, FileClock, FileText, GitBranch, Search, Wallet } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { BudgetLinkedGrnForm } from "@/components/finance/grn/BudgetLinkedGrnForm";
import { GrnHistoryTable } from "@/components/finance/grn/GrnHistoryTable";
import { GrnSearchWorkspace } from "@/components/finance/grn/GrnSearchWorkspace";
import { ImprestWorkspace } from "@/components/finance/grn/imprest/ImprestWorkspace";
import { GrnLobAttributionQueue } from "@/components/finance/grn/GrnLobAttributionQueue";
import { SmartGrnApprovalQueue } from "@/components/finance/grn/SmartGrnApprovalQueue";
import { money } from "@/components/finance/grn/grn-format";
import {
  GRN_TAB_COUNT,
  GRN_TAB_TRIGGER,
  GRN_TABS_LIST,
} from "@/components/finance/grn/grn-ui";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCanAttributeGrnLob, useGrnNeedsLobCount, useGrnSummary } from "@/hooks/useGrnSummary";
import { useHasRole } from "@/hooks/useUserRole";

function HeaderStat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="text-right">
      <div className="font-grn-mono text-[18px] font-semibold leading-tight text-grn-ink">{value}</div>
      <div className="mt-0.5 text-xs uppercase tracking-[0.06em] text-grn-ink-soft">{label}</div>
    </div>
  );
}

export default function NativeGRNManagement() {
  // Branch admins raise GRNs but cannot review them — the backend's
  // GRN_REVIEW_ROLES excludes them, so the approval queue would only offer
  // actions that 403. Hiding it is presentation; the backend remains the gate.
  // Uses useHasRole rather than user.role: HrmsUser carries no role field, so
  // the `user?.role` idiom used elsewhere silently evaluates to undefined.
  // `admin` was in this list and is NOT in GRN_REVIEW_ROLES, so an admin was shown the Approval
  // Queue and Imprest tabs and every action in them 403'd — the exact outcome the note above
  // says this gate exists to prevent.
  const canReview = useHasRole(
    "finance_head",
    "accounts_head",
    "super_admin",
    "branch_head"
  );

  // The LOB Attribution tab was rendered unconditionally while its header count was already
  // role-gated, so `finance` and `payroll_head` — both of whom reach this page — opened a tab
  // whose only query 403s and which therefore renders as a permanently empty queue.
  const canAttribute = useCanAttributeGrnLob();

  const summaryQuery = useGrnSummary();
  const summary = summaryQuery.data;
  const needsLob = useGrnNeedsLobCount();

  const queueCount = summary?.inQueue.count ?? 0;

  const [activeTab, setActiveTab] = useState<string>("create");
  const [editGrnId, setEditGrnId] = useState<string | null>(null);

  function handleReopenForEdit(grnId: string) {
    setEditGrnId(grnId);
    setActiveTab("create");
  }

  function handleEditComplete() {
    setEditGrnId(null);
    setActiveTab("queue");
  }

  return (
    <DashboardLayout>
      {/* grn-scope carries this page's palette and IBM Plex face (src/styles/grn.css). The
          grn-* utilities used throughout the GRN components resolve to nothing outside it. */}
      {/* Document flow, not an app shell: the page scrolls inside the layout's #main-content-area
          so the Create tab's action bar can actually stick. Any overflow ancestor here would
          silently disable that. */}
      <div className="grn-scope mx-auto w-full max-w-[1360px] pb-16">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div>
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
                <HeaderStat value={summaryQuery.isLoading ? <Skeleton className="inline-block h-5 w-10" /> : queueCount} label="In queue" />
                <HeaderStat
                  value={summaryQuery.isLoading ? <Skeleton className="inline-block h-5 w-16" /> : money(summary?.inQueue.value, 0)}
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
              {canAttribute && (
                <TabsTrigger value="attribution" className={GRN_TAB_TRIGGER}>
                  <GitBranch className="h-3.5 w-3.5" />LOB Attribution
                  {needsLob.count ? <span className={GRN_TAB_COUNT}>{needsLob.count}</span> : null}
                </TabsTrigger>
              )}
              {canReview && (
                <TabsTrigger value="queue" className={GRN_TAB_TRIGGER}>
                  <FileCheck2 className="h-3.5 w-3.5" />Approval Queue
                  {queueCount ? <span className={GRN_TAB_COUNT}>{queueCount}</span> : null}
                </TabsTrigger>
              )}
              {canReview && (
                <TabsTrigger value="imprest" className={GRN_TAB_TRIGGER}>
                  <Wallet className="h-3.5 w-3.5" />Imprest
                </TabsTrigger>
              )}
              <TabsTrigger value="search" className={GRN_TAB_TRIGGER}>
                <Search className="h-3.5 w-3.5" />Search
              </TabsTrigger>
              <TabsTrigger value="history" className={GRN_TAB_TRIGGER}>
                <FileClock className="h-3.5 w-3.5" />History
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="create" className="mt-4">
            <BudgetLinkedGrnForm editGrnId={editGrnId} onEditComplete={handleEditComplete} />
          </TabsContent>
          {canAttribute && (
            <TabsContent value="attribution" className="mt-4">
              <GrnLobAttributionQueue />
            </TabsContent>
          )}
          {canReview && (
            <TabsContent value="queue" className="mt-4">
              <SmartGrnApprovalQueue onReopenForEdit={handleReopenForEdit} />
            </TabsContent>
          )}
          {/* Search sits beside History rather than replacing it: History is a status-chip
              view of recent activity, Search answers a specific question about any GRN. */}
          {/* Separate from the general approval queue: an imprest voucher is reviewed against a
              float balance and a proof, not against an invoice, so it needs its own columns. */}
          {canReview && (
            <TabsContent value="imprest" className="mt-4">
              {/* Approvals, allocation and the report share one tab: they are one workflow read
                  three ways, and a reviewer clearing vouchers wants the float behind them. */}
              <ImprestWorkspace />
            </TabsContent>
          )}
          <TabsContent value="search" className="mt-4">
            <GrnSearchWorkspace />
          </TabsContent>
          <TabsContent value="history" className="mt-4">
            <GrnHistoryTable onEdit={handleReopenForEdit} />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
