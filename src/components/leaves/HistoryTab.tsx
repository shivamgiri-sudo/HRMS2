import { useMemo, useState } from "react";
import { FileCheck, Filter, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { usePagination } from "@/hooks/usePagination";
import type { LeaveRequest } from "@/hooks/useLeaves";
import { LeaveRequestRow } from "./LeaveRequestRow";
import { ListPager } from "./ListPager";
import {
  EMPTY_HISTORY_FILTERS, SORT_OPTIONS, countActiveFilters, filterHistory, sortLeaves, type HistoryFilters, type SortMode,
} from "./leaveData";
import { normalizeLeaveStatus } from "./leaveStatus";
import { normalizeDate } from "@/lib/utils";
import { parseISO } from "date-fns";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const STATUS_OPTIONS: Array<{ value: HistoryFilters["status"]; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
  { value: "lapsed", label: "Lapsed" },
  { value: "discarded", label: "Discarded" },
];

interface Props {
  requests: LeaveRequest[];
  loading: boolean;
  /** Present only for roles that may discard an approved leave. */
  onDiscard?: (id: string) => void;
}

const uniq = (values: Array<string | undefined>) => [...new Set(values.filter((v): v is string => !!v && v !== "Unassigned"))].sort();

/** Decided requests in the viewer's scope, with filters. Options are built from what is loaded. */
export function HistoryTab({ requests, loading, onDiscard }: Props) {
  const [filters, setFilters] = useState<HistoryFilters>(EMPTY_HISTORY_FILTERS);
  const [sort, setSort] = useState<SortMode>("newest");
  const set = <K extends keyof HistoryFilters>(key: K, value: HistoryFilters[K]) => { setFilters((f) => ({ ...f, [key]: value })); pager.setPage(1); };

  const decided = useMemo(() => filterHistory(requests, EMPTY_HISTORY_FILTERS), [requests]);
  const types = useMemo(() => uniq(decided.map((r) => r.type)), [decided]);
  const branches = useMemo(() => uniq(decided.map((r) => r.branch)), [decided]);
  const processes = useMemo(() => uniq(decided.map((r) => r.process)), [decided]);
  const years = useMemo(
    () => [...new Set(decided.map((r) => parseISO(normalizeDate(r.startDate)).getFullYear()).filter(Number.isFinite))].sort((a, b) => b - a),
    [decided],
  );

  const filtered = useMemo(() => sortLeaves(filterHistory(requests, filters), sort), [requests, filters, sort]);
  const pager = usePagination(filtered, { initialPageSize: 10 });
  const active = countActiveFilters(filters);

  if (loading) return <div className="space-y-3" aria-busy="true">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}</div>;
  if (decided.length === 0) {
    return <EmptyState icon={<FileCheck className="h-8 w-8" />} title="No decided requests yet" description="Approved, rejected and cancelled requests in your scope appear here." />;
  }

  const trigger = "h-10 rounded-xl text-xs";
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-3">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-foreground">
          <Filter className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          Filters
          {active > 0 && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">{active} active</span>}
        </div>
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={filters.search} onChange={(e) => set("search", e.target.value)} placeholder="Search by employee name…" aria-label="Search by employee name" className="h-10 rounded-xl pl-9 text-xs" />
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Select value={filters.month} onValueChange={(v) => set("month", v)}>
            <SelectTrigger className={trigger} aria-label="Month"><SelectValue placeholder="Month" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All months</SelectItem>{MONTHS.map((m, i) => <SelectItem key={m} value={String(i)}>{m}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={filters.year} onValueChange={(v) => set("year", v)}>
            <SelectTrigger className={trigger} aria-label="Year"><SelectValue placeholder="Year" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All years</SelectItem>{years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={filters.status} onValueChange={(v) => set("status", v as HistoryFilters["status"])}>
            <SelectTrigger className={trigger} aria-label="Status"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>{STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={filters.type} onValueChange={(v) => set("type", v)}>
            <SelectTrigger className={trigger} aria-label="Leave type"><SelectValue placeholder="Leave type" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All types</SelectItem>{types.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={filters.branch} onValueChange={(v) => set("branch", v)}>
            <SelectTrigger className={trigger} aria-label="Branch"><SelectValue placeholder="Branch" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All branches</SelectItem>{branches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={filters.process} onValueChange={(v) => set("process", v)}>
            <SelectTrigger className={trigger} aria-label="Process"><SelectValue placeholder="Process" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All processes</SelectItem>{processes.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{filtered.length} of {decided.length} requests</p>
          <div className="flex items-center gap-2">
            {active > 0 && (
              <Button variant="ghost" size="sm" className="h-9 rounded-xl text-xs" onClick={() => { setFilters(EMPTY_HISTORY_FILTERS); pager.setPage(1); }}>
                <RotateCcw className="mr-2 h-3.5 w-3.5" aria-hidden="true" />Clear filters
              </Button>
            )}
            <Select value={sort} onValueChange={(v) => setSort(v as SortMode)}>
              <SelectTrigger className="h-9 w-[150px] rounded-lg text-xs" aria-label="Sort requests"><SelectValue /></SelectTrigger>
              <SelectContent>{SORT_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={<FileCheck className="h-8 w-8" />} title="No matching requests" description="Try adjusting your filters." />
      ) : (
        <>
          <div className="space-y-3">
            {pager.paginatedItems.map((r) => (
              <LeaveRequestRow
                key={r.id}
                request={r}
                actions={
                  onDiscard && normalizeLeaveStatus(r.status) === "approved" ? (
                    <Button size="sm" variant="outline" className="rounded-lg border-red-200 text-red-700 hover:bg-red-50" onClick={() => onDiscard(r.id)}>
                      <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden="true" />Discard
                    </Button>
                  ) : undefined
                }
              />
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
