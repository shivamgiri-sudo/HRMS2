import { useMemo, useState } from "react";
import { useApprovalFocus } from "@/hooks/useApprovalFocus";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CalendarDays, ClipboardCheck, History, UserRound } from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { AIInsightPanel } from "@/components/ai";
import { DateRangeExportDialog } from "@/components/export/DateRangeExportDialog";
import { DiscardDialog } from "@/components/discard/DiscardDialog";
import { LeaveRequestForm } from "@/components/profile/LeaveRequestForm";
import { LeaveConsentBanner } from "@/components/leaves/LeaveConsentBanner";
import { LeaveCalendarView } from "@/components/leaves/LeaveCalendarView";
import { LeaveHero } from "@/components/leaves/LeaveHero";
import { LeaveBalanceStrip } from "@/components/leaves/LeaveBalanceStrip";
import { MyLeaveTab } from "@/components/leaves/MyLeaveTab";
import { ApprovalsTab } from "@/components/leaves/ApprovalsTab";
import { HistoryTab } from "@/components/leaves/HistoryTab";
import { ReviewDialog, type ReviewMode } from "@/components/leaves/ReviewDialog";
import { downloadLeaveCsv, downloadLeavePdf, filterByStartRange } from "@/components/leaves/leaveExport";
import { isOpenStatus, normalizeLeaveStatus } from "@/components/leaves/leaveStatus";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useCanDiscard } from "@/hooks/useDiscard";
import { useIsAdminOrHR } from "@/hooks/useUserRole";
import {
  LEAVE_QUERY_KEYS, fetchLeaveRowsForExport, useLeaveLoadInfo, useLeaveRequests, useLeaveStats, type LeaveRequest,
} from "@/hooks/useLeaves";
import { hrmsApi } from "@/lib/hrmsApi";
import { format } from "date-fns";

type TabId = "my" | "approvals" | "history" | "calendar";

const reviewStatus = (request: LeaveRequest, mode: ReviewMode) => {
  // The server requires the branch_head_* value for a request sitting in the exception tier.
  const escalated = normalizeLeaveStatus(request.status) === "escalated";
  if (mode === "approve") return escalated ? "branch_head_approved" : "approved";
  return escalated ? "branch_head_rejected" : "rejected";
};

/**
 * Leave workspace. This file only wires data to the tab components in components/leaves/:
 *  - My Leave   everyone: balances, own requests with progress, cancel, usage charts
 *  - Approvals  only when the server says the viewer can review at least one request
 *  - History    anyone who can see other people's requests (team leads, HR, admin)
 *  - Calendar   approved leave by day
 */
const Leaves = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAdminOrHR } = useIsAdminOrHR();
  const { canDiscard } = useCanDiscard();

  const [applyOpen, setApplyOpen] = useState(false);
  const approvalFocusId = new URLSearchParams(window.location.search).get("approvalId");
  const [tab, setTab] = useState<TabId>(approvalFocusId ? "approvals" : "my");
  const [review, setReview] = useState<{ request: LeaveRequest; mode: ReviewMode } | null>(null);
  const [discardLeaveId, setDiscardLeaveId] = useState<string | null>(null);

  const { data: myEmployeeId, isLoading: loadingMe } = useQuery({
    queryKey: ["my-employee-id", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      try {
        const res = await hrmsApi.get<{ success: boolean; data: any }>("/api/employees/me");
        return (res.data?.id as string | undefined) ?? null;
      } catch {
        return null;
      }
    },
    enabled: !!user?.id,
  });

  const { data: requests = [], isLoading, isError, refetch } = useLeaveRequests();
  const { data: stats } = useLeaveStats();
  const leaveLoad = useLeaveLoadInfo();

  const reviewMutation = useMutation({
    mutationFn: async ({ request, mode, remarks }: { request: LeaveRequest; mode: ReviewMode; remarks: string }) => {
      const status = reviewStatus(request, mode);
      await hrmsApi.patch(`/api/leave/requests/${request.id}/review`, { status, remarks: remarks.trim() || null });

      // Tell the employee (fire and forget). "approved"/"rejected" regardless of tier: they care
      // about the outcome, and the template has no branch_head_* variant.
      let reviewerName = "HR Team";
      try {
        const me = await hrmsApi.get<{ success: boolean; data: any }>("/api/employees/me");
        if (me.data?.first_name) reviewerName = `${me.data.first_name} ${me.data.last_name ?? ""}`.trim();
      } catch { /* non-fatal */ }
      hrmsApi.post("/api/communication/dispatch/send", {
        template_name: "leave_status",
        recipient_employee_ids: [request.employeeId].filter(Boolean),
        data: { status: mode === "approve" ? "approved" : "rejected", reviewer_name: reviewerName, review_notes: remarks.trim() || undefined },
        channel: "email",
      }).catch((err) => console.error("Failed to send leave status notification:", err));
      return mode;
    },
    onSuccess: (mode) => {
      for (const queryKey of LEAVE_QUERY_KEYS) queryClient.invalidateQueries({ queryKey: [...queryKey] });
      toast({ title: mode === "approve" ? "Leave approved" : "Leave rejected", description: `The request has been ${mode === "approve" ? "approved" : "rejected"}.` });
      setReview(null);
    },
    onError: (error: Error) => toast({ title: "Could not update the request", description: error.message, variant: "destructive" }),
  });

  const hasApprovals = requests.some((r) => r.canReview);
  const hasTeamView = isAdminOrHR || (!!myEmployeeId && requests.some((r) => r.employeeId !== myEmployeeId));
  const openCount = useMemo(() => requests.filter((r) => r.canReview && isOpenStatus(normalizeLeaveStatus(r.status))).length, [requests]);

  const tabs = useMemo(() => {
    const list: Array<{ id: TabId; label: string; icon: typeof UserRound; badge?: number }> = [{ id: "my", label: "My Leave", icon: UserRound }];
    if (hasApprovals) list.push({ id: "approvals", label: "Approvals", icon: ClipboardCheck, badge: openCount });
    if (hasTeamView) list.push({ id: "history", label: "History", icon: History });
    list.push({ id: "calendar", label: "Calendar", icon: CalendarDays });
    return list;
  }, [hasApprovals, hasTeamView, openCount]);
  const activeTab: TabId = tabs.some((t) => t.id === tab) ? tab : "my";
  useApprovalFocus(!isLoading && activeTab === "approvals");

  const exportRows = async (startDate?: Date, endDate?: Date) => {
    try {
      const iso = (d?: Date) => (d ? format(d, "yyyy-MM-dd") : undefined);
      return filterByStartRange(await fetchLeaveRowsForExport(iso(startDate), iso(endDate)), startDate, endDate);
    } catch (error) {
      // A partial file that looks complete is worse than no file, so refuse and say why.
      toast({ title: "Export failed", description: error instanceof Error ? error.message : "Could not load leave rows to export.", variant: "destructive" });
      throw error;
    }
  };
  const exportCsv = async (s?: Date, e?: Date) => {
    const rows = await exportRows(s, e);
    downloadLeaveCsv(rows, s, e);
    toast({ title: "Export complete", description: `${rows.length} leave requests exported to CSV` });
  };
  const exportPdf = async (s?: Date, e?: Date) => {
    const rows = await exportRows(s, e);
    downloadLeavePdf(rows, s, e);
    toast({ title: "Export complete", description: `${rows.length} leave requests exported to PDF` });
  };

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <LeaveConsentBanner />

        <LeaveHero
          stats={stats}
          onApply={() => setApplyOpen(true)}
          exportSlot={
            <DateRangeExportDialog
              title="Export Leave Requests"
              description="Export leave requests with an optional date range, based on start date."
              onExportCSV={exportCsv}
              onExportPDF={exportPdf}
            />
          }
        />

        <Dialog open={applyOpen} onOpenChange={setApplyOpen}>
          <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto rounded-2xl">
            <DialogHeader>
              <DialogTitle>Apply for leave</DialogTitle>
              <DialogDescription>Submit a leave request for approval.</DialogDescription>
            </DialogHeader>
            {loadingMe ? (
              <Skeleton className="h-72 w-full rounded-2xl" />
            ) : !myEmployeeId ? (
              <p className="rounded-2xl border border-border bg-muted/40 p-4 text-sm leading-6 text-muted-foreground">
                We could not find an employee profile linked to your account. Please contact HR to link your profile.
              </p>
            ) : (
              <LeaveRequestForm employeeId={myEmployeeId} onSubmitted={() => setApplyOpen(false)} />
            )}
          </DialogContent>
        </Dialog>

        <LeaveBalanceStrip employeeId={myEmployeeId ?? undefined} />

        <AIInsightPanel
          contextType="employee_self"
          role="employee"
          title="Leave AI Brief"
          enabled={!isLoading && requests.length > 0}
          data={{
            total_requests: requests.length,
            pending_requests: requests.filter((r) => isOpenStatus(normalizeLeaveStatus(r.status))).length,
            approved_count: requests.filter((r) => normalizeLeaveStatus(r.status) === "approved").length,
            rejected_count: requests.filter((r) => normalizeLeaveStatus(r.status) === "rejected").length,
          }}
        />

        {/* The team list failing must not take the employee's own leave down with it. */}
        {isError && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            Team requests could not be loaded.
            <Button variant="outline" size="sm" className="h-8 rounded-lg border-red-200" onClick={() => refetch()}>Retry</Button>
          </div>
        )}

        <section className="rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-5">
          <Tabs value={activeTab} onValueChange={(v) => setTab(v as TabId)} className="w-full">
            <div className="mobile-scroll-x w-full">
              <TabsList className="inline-flex h-auto min-w-max gap-1 rounded-xl p-1">
                {tabs.map(({ id, label, icon: Icon, badge }) => (
                  <TabsTrigger key={id} value={id} className="gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-xs sm:text-sm">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    {label}
                    {badge ? <span className="rounded-full bg-amber-100 px-1.5 text-[11px] font-bold text-amber-800">{badge}</span> : null}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            <TabsContent value="my" className="mt-5">
              <MyLeaveTab onApply={() => setApplyOpen(true)} />
            </TabsContent>

            {hasApprovals && (
              <TabsContent value="approvals" className="mt-5">
                <ApprovalsTab
                  requests={requests}
                  loading={isLoading}
                  busy={reviewMutation.isPending}
                  onQuickApprove={(request) => reviewMutation.mutate({ request, mode: "approve", remarks: "" })}
                  onReview={(request, mode) => setReview({ request, mode })}
                />
              </TabsContent>
            )}

            {hasTeamView && (
              <TabsContent value="history" className="mt-5 space-y-4">
                {leaveLoad.truncated && (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>
                      Showing the {leaveLoad.processedLoaded.toLocaleString("en-IN")} most recent decided requests of{" "}
                      {leaveLoad.processedTotal.toLocaleString("en-IN")}. Filter options come from what is loaded. Use Export with a
                      date range for the full history.
                    </span>
                  </div>
                )}
                <HistoryTab requests={requests} loading={isLoading} onDiscard={canDiscard ? (id) => setDiscardLeaveId(id) : undefined} />
              </TabsContent>
            )}

            <TabsContent value="calendar" className="mt-5">
              <LeaveCalendarView />
            </TabsContent>
          </Tabs>
        </section>

        <ReviewDialog
          request={review?.request ?? null}
          mode={review?.mode ?? null}
          busy={reviewMutation.isPending}
          onClose={() => setReview(null)}
          onConfirm={(remarks) => review && reviewMutation.mutate({ request: review.request, mode: review.mode, remarks })}
        />

        <DiscardDialog
          open={Boolean(discardLeaveId)}
          onOpenChange={(open) => { if (!open) setDiscardLeaveId(null); }}
          entityType="leave"
          entityId={discardLeaveId}
        />
      </div>
    </DashboardLayout>
  );
};

export default Leaves;
