import { useEffect, useMemo, useState } from "react";
import { Check, ClipboardCheck, MessageSquarePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { usePagination } from "@/hooks/usePagination";
import type { LeaveRequest } from "@/hooks/useLeaves";
import { LeaveRequestRow } from "./LeaveRequestRow";
import { ListPager } from "./ListPager";
import { SORT_OPTIONS, sortLeaves, type SortMode } from "./leaveData";
import { isOpenStatus, normalizeLeaveStatus } from "./leaveStatus";
import type { ReviewMode } from "./ReviewDialog";

interface Props {
  /** Every loaded request; this tab keeps the open ones. */
  requests: LeaveRequest[];
  loading: boolean;
  busy: boolean;
  onQuickApprove: (request: LeaveRequest) => void;
  onReview: (request: LeaveRequest, mode: ReviewMode) => void;
}

/**
 * Requests waiting on a decision. Buttons come from the server's own `canReview` flag, so what
 * is offered is exactly what the review endpoint will accept. By default only the requests the
 * viewer can act on are listed; the switch shows the rest of the open requests in their scope
 * (view only).
 */
export function ApprovalsTab({ requests, loading, busy, onQuickApprove, onReview }: Props) {
  const [onlyMine, setOnlyMine] = useState(true);
  const [sort, setSort] = useState<SortMode>("oldest");

  const open = useMemo(() => requests.filter((r) => isOpenStatus(normalizeLeaveStatus(r.status))), [requests]);
  const actionable = useMemo(() => open.filter((r) => r.canReview), [open]);
  const shown = useMemo(() => sortLeaves(onlyMine ? actionable : open, sort), [onlyMine, actionable, open, sort]);
  const pager = usePagination(shown, { initialPageSize: 10 });

  // A viewer with nothing to act on still sees the open team requests rather than an empty tab.
  useEffect(() => { if (actionable.length === 0 && open.length > 0) setOnlyMine(false); }, [actionable.length, open.length]);

  if (loading) return <div className="space-y-3" aria-busy="true">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">Approval queue</p>
          <p className="text-xs text-muted-foreground">
            {actionable.length} waiting on you{open.length > actionable.length ? ` · ${open.length - actionable.length} more open in your scope` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" className="h-4 w-4 rounded border-border accent-[hsl(var(--primary))]" checked={onlyMine} onChange={(e) => { setOnlyMine(e.target.checked); pager.setPage(1); }} />
            Only requests I can act on
          </label>
          <Select value={sort} onValueChange={(v) => { setSort(v as SortMode); pager.setPage(1); }}>
            <SelectTrigger className="h-9 w-[150px] rounded-lg text-xs" aria-label="Sort requests"><SelectValue /></SelectTrigger>
            <SelectContent>{SORT_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState icon={<ClipboardCheck className="h-8 w-8" />} title="Nothing waiting for your decision" description="New leave requests that need you will appear here." />
      ) : (
        <>
          <div className="space-y-3">
            {pager.paginatedItems.map((r) => (
              <div key={r.id} data-approval-id={r.id} className="rounded-2xl">
              <LeaveRequestRow
                request={r}
                actions={
                  r.canReview ? (
                    <>
                      <Button size="sm" disabled={busy} onClick={() => onQuickApprove(r)} className="rounded-lg bg-green-700 text-white hover:bg-green-800">
                        <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />Approve
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => onReview(r, "approve")} className="rounded-lg" aria-label={`Approve ${r.employee.name}'s leave with a note`} title="Approve with a note">
                        <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => onReview(r, "reject")} className="rounded-lg border-red-200 text-red-700 hover:bg-red-50">
                        <X className="mr-1.5 h-4 w-4" aria-hidden="true" />Reject
                      </Button>
                    </>
                  ) : undefined
                }
              />
              </div>
            ))}
          </div>
          <ListPager
            currentPage={pager.currentPage} totalPages={pager.totalPages} pageSize={pager.pageSize} totalItems={pager.totalItems}
            onPrev={pager.goToPreviousPage} onNext={pager.goToNextPage} onPageSize={pager.setPageSize}
          />
        </>
      )}
    </div>
  );
}
