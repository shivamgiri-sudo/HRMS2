import { useMemo, useState } from "react";
import { CalendarPlus, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { usePagination } from "@/hooks/usePagination";
import { useMyLeaveRequests, type LeaveRequest } from "@/hooks/useLeaves";
import { CancelLeaveDialog } from "./CancelLeaveDialog";
import { LeaveCharts } from "./LeaveCharts";
import { LeaveRequestRow } from "./LeaveRequestRow";
import { LeaveTimeline } from "./LeaveTimeline";
import { ListPager } from "./ListPager";
import { canCancelLeave, sortLeaves } from "./leaveData";
import { isOpenStatus, normalizeLeaveStatus } from "./leaveStatus";

type Filter = "all" | "open" | "approved" | "rejected" | "cancelled";
const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
];

const matches = (r: LeaveRequest, f: Filter) => {
  const key = normalizeLeaveStatus(r.status);
  return f === "all" || (f === "open" ? isOpenStatus(key) : key === f);
};

const todayYmd = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/** The signed-in person's own leave: every request with its progress, cancel, and usage charts. */
export function MyLeaveTab({ onApply }: { onApply: () => void }) {
  const { data: mine = [], isLoading, isError, refetch } = useMyLeaveRequests();
  const [filter, setFilter] = useState<Filter>("all");
  const [cancelTarget, setCancelTarget] = useState<LeaveRequest | null>(null);

  const rows = useMemo(() => sortLeaves(mine.filter((r) => matches(r, filter)), "newest"), [mine, filter]);
  const pager = usePagination(rows, { initialPageSize: 10 });
  const today = todayYmd();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter my requests">
        {FILTERS.map((f) => {
          const count = mine.filter((r) => matches(r, f.value)).length;
          const active = filter === f.value;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => { setFilter(f.value); pager.setPage(1); }}
              aria-pressed={active}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted",
              )}
            >
              {f.label} <span className="opacity-80">{count}</span>
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="space-y-3" aria-busy="true">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}</div>
      ) : isError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          Could not load your leave requests.{" "}
          <button className="font-semibold underline" onClick={() => refetch()}>Retry</button>
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<CalendarPlus className="h-8 w-8" />}
          title={mine.length === 0 ? "You haven't applied for leave yet" : "No requests match this filter"}
          description={mine.length === 0 ? "Your requests and their progress will appear here." : "Choose another filter to see the rest."}
          action={mine.length === 0 ? <Button onClick={onApply} className="rounded-xl">Apply for leave</Button> : undefined}
        />
      ) : (
        <div className="space-y-3">
          {pager.paginatedItems.map((r) => (
            <LeaveRequestRow
              key={r.id}
              request={r}
              showEmployee={false}
              footer={<LeaveTimeline status={r.status} submittedAt={r.submittedAt} reviewedBy={r.reviewedBy?.name} reviewedAt={r.reviewedAt} />}
              actions={
                canCancelLeave(r, today) ? (
                  <Button variant="outline" size="sm" className="rounded-lg border-red-200 text-red-700 hover:bg-red-50" onClick={() => setCancelTarget(r)}>
                    <XCircle className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    Cancel
                  </Button>
                ) : undefined
              }
            />
          ))}
          <ListPager
            currentPage={pager.currentPage} totalPages={pager.totalPages} pageSize={pager.pageSize} totalItems={pager.totalItems}
            onPrev={pager.goToPreviousPage} onNext={pager.goToNextPage} onPageSize={pager.setPageSize}
          />
        </div>
      )}

      <LeaveCharts requests={mine} year={new Date().getFullYear()} />
      <CancelLeaveDialog request={cancelTarget} onClose={() => setCancelTarget(null)} />
    </div>
  );
}
