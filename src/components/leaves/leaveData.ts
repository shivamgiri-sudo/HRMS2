import { format, parseISO } from "date-fns";
import type { LeaveRequest } from "@/hooks/useLeaves";
import { isOpenStatus, normalizeLeaveStatus, type LeaveStatusKey } from "./leaveStatus";
import { normalizeDate } from "@/lib/utils";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const ymd = (value: string) => normalizeDate(value).slice(0, 10);

/**
 * May this request be cancelled by its owner from the page?
 * Open requests always; an approved leave only before it starts. The server would accept an
 * approved leave that is already under way, but reversing days already worked is an HR decision,
 * so the page does not offer it.
 */
export function canCancelLeave(request: Pick<LeaveRequest, "status" | "startDate">, todayYmd: string): boolean {
  const key = normalizeLeaveStatus(request.status);
  if (isOpenStatus(key)) return true;
  if (key === "approved") return ymd(request.startDate) > todayYmd;
  return false;
}

/** Approved days per calendar month of `year` (by start date), always 12 buckets. */
export function buildMonthlyDays(requests: LeaveRequest[], year: number): Array<{ month: string; days: number }> {
  const buckets = MONTH_LABELS.map((month) => ({ month, days: 0 }));
  for (const r of requests) {
    if (normalizeLeaveStatus(r.status) !== "approved") continue;
    const start = ymd(r.startDate);
    if (!start.startsWith(`${year}-`)) continue;
    buckets[Number(start.slice(5, 7)) - 1].days += Number(r.days) || 0;
  }
  return buckets;
}

/** Approved days per leave type in `year`, largest first. */
export function buildTypeTotals(requests: LeaveRequest[], year: number): Array<{ type: string; days: number }> {
  const totals = new Map<string, number>();
  for (const r of requests) {
    if (normalizeLeaveStatus(r.status) !== "approved") continue;
    if (!ymd(r.startDate).startsWith(`${year}-`)) continue;
    totals.set(r.type, (totals.get(r.type) ?? 0) + (Number(r.days) || 0));
  }
  return [...totals.entries()].map(([type, days]) => ({ type, days })).sort((a, b) => b.days - a.days);
}

export interface HistoryFilters {
  status: "all" | Exclude<LeaveStatusKey, "pending" | "escalated">;
  type: string;
  month: string; // "0".."11" or "all"
  year: string;
  branch: string;
  process: string;
  search: string;
}

export const EMPTY_HISTORY_FILTERS: HistoryFilters = {
  status: "all", type: "all", month: "all", year: "all", branch: "all", process: "all", search: "",
};

export function countActiveFilters(f: HistoryFilters): number {
  return [f.status, f.type, f.month, f.year, f.branch, f.process].filter((v) => v !== "all").length + (f.search.trim() ? 1 : 0);
}

/** History = every request that is no longer open, narrowed by the filters. */
export function filterHistory(requests: LeaveRequest[], f: HistoryFilters): LeaveRequest[] {
  const query = f.search.trim().toLowerCase();
  return requests.filter((r) => {
    const key = normalizeLeaveStatus(r.status);
    if (isOpenStatus(key)) return false;
    if (f.status !== "all" && key !== f.status) return false;
    if (f.type !== "all" && r.type !== f.type) return false;
    if (f.branch !== "all" && r.branch !== f.branch) return false;
    if (f.process !== "all" && r.process !== f.process) return false;
    if (query && !r.employee.name.toLowerCase().includes(query)) return false;
    if (f.month !== "all" || f.year !== "all") {
      const d = parseISO(ymd(r.startDate));
      if (f.month !== "all" && d.getMonth().toString() !== f.month) return false;
      if (f.year !== "all" && d.getFullYear().toString() !== f.year) return false;
    }
    return true;
  });
}

/** "5 Oct 2026" or "5 Oct – 7 Oct 2026". Empty-safe. */
export function formatLeaveRange(start: string, end: string): string {
  if (!start) return "—";
  const s = parseISO(ymd(start));
  const e = end ? parseISO(ymd(end)) : s;
  if (ymd(start) === ymd(end || start)) return format(s, "d MMM yyyy");
  return s.getFullYear() === e.getFullYear()
    ? `${format(s, "d MMM")} – ${format(e, "d MMM yyyy")}`
    : `${format(s, "d MMM yyyy")} – ${format(e, "d MMM yyyy")}`;
}

export type SortMode = "newest" | "oldest" | "longest" | "type";

export const SORT_OPTIONS: Array<{ value: SortMode; label: string }> = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "longest", label: "Longest first" },
  { value: "type", label: "Leave type" },
];

/** Stable sort by leave start date / length / type. Does not mutate the input. */
export function sortLeaves(requests: LeaveRequest[], mode: SortMode): LeaveRequest[] {
  const start = (r: LeaveRequest) => ymd(r.startDate);
  const copy = [...requests];
  switch (mode) {
    case "oldest": return copy.sort((a, b) => start(a).localeCompare(start(b)));
    case "longest": return copy.sort((a, b) => Number(b.days) - Number(a.days) || start(b).localeCompare(start(a)));
    case "type": return copy.sort((a, b) => a.type.localeCompare(b.type) || start(b).localeCompare(start(a)));
    default: return copy.sort((a, b) => start(b).localeCompare(start(a)));
  }
}
