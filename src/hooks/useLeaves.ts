import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employee: {
    name: string;
    avatar?: string;
    department: string;
  };
  type: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: "pending" | "pending_branch_head" | "approved" | "rejected" | "cancelled" | "discarded";
  submittedAt: string;
  reviewedBy?: {
    name: string;
  };
  reviewedAt?: string;
  reviewNotes?: string;
}

/**
 * Leave rows are fetched by STATUS, not by downloading the whole table.
 *
 * The previous fetchAllLeaveRows() asked for `/leave/requests?page=1&limit=100`, read the
 * total, and then fired every remaining page in a single Promise.all. For a manager with a
 * real team that is 9,424 rows across 95 parallel requests, each costing ~4.3s server-side
 * (the list query joins employees, department, branch, process, leave type, a correlated
 * latest-approval-log subquery and the reviewer employee row, and re-runs a COUNT over the
 * same join on every page). Against a 10-connection pool it never finished: measured live on
 * 2026-08-27, 48 of the 95 pages had been requested and ZERO had returned after six minutes,
 * so the page sat at "PENDING 0" forever and no Approve button ever rendered. The list is
 * also sorted applied_at DESC, so page 1 held no pending rows at all — nothing could be
 * actioned until all 95 pages landed, which they never did.
 *
 * Measured cost of the same endpoint when the status filter is used:
 *   ?page=1&limit=100                            4.35s
 *   ?status=pending,pending_branch_head&limit=200 0.51s
 *   ?status=pending&limit=1  (count only)         0.41s
 *
 * So: pending is fetched in full (it is the actionable set and it is small — 378 rows on the
 * largest live scope), processed is fetched newest-first up to a cap, and the counts come
 * from the server's own `total` rather than from the length of a downloaded array. The cap is
 * surfaced to the user by useLeaveLoadInfo() — a truncated list that looks complete is the
 * failure this fix exists to avoid, so it must never be silent.
 */

/** Statuses that still need someone to act. Kept in one place — the page and the fetch agree. */
export const PENDING_STATUSES = ["pending", "pending_branch_head"] as const;

/** Rows per request. The endpoint caps `limit` at 500. */
const PAGE_SIZE = 200;

/** Most processed (approved/rejected/cancelled) rows held in memory, newest first. */
export const PROCESSED_ROW_CAP = 600;

interface LeaveListResponse { success: boolean; data: any[]; total?: number; page?: number; limit?: number }

function dedupeRows(items: any[]): any[] {
  const byId = new Map<string, any>();
  for (const item of items) {
    const key = String(item?.id ?? "");
    if (!key || byId.has(key)) continue;
    byId.set(key, item);
  }
  return Array.from(byId.values());
}

/**
 * Pages through one scoped query up to `cap` rows. Pages are requested in sequence, not as a
 * Promise.all burst — the burst is what starved the connection pool. Returns the rows plus
 * the server's own total, so a caller can tell "this is everything" from "this is the newest
 * N of M".
 */
async function fetchScoped(
  params: Record<string, string>,
  cap: number,
): Promise<{ rows: any[]; total: number }> {
  const query = (page: number) =>
    new URLSearchParams({ ...params, page: String(page), limit: String(PAGE_SIZE) }).toString();

  const first = await hrmsApi.get<LeaveListResponse>(`/api/leave/requests?${query(1)}`);
  const rows = first.data ?? [];
  const total = Number(first.total ?? rows.length);
  const wanted = Math.min(total, cap);

  for (let page = 2; rows.length < wanted; page += 1) {
    const next = await hrmsApi.get<LeaveListResponse>(`/api/leave/requests?${query(page)}`);
    const batch = next.data ?? [];
    if (!batch.length) break; // server ran out earlier than `total` claimed — stop, don't loop
    rows.push(...batch);
  }

  return { rows: dedupeRows(rows).slice(0, cap), total };
}

/** The count of rows matching a status, taken from the server rather than from a download. */
async function fetchCount(status: string): Promise<number> {
  const res = await hrmsApi.get<LeaveListResponse>(
    `/api/leave/requests?status=${encodeURIComponent(status)}&limit=1`,
  );
  return Number(res.total ?? (res.data ?? []).length);
}

async function fetchLeaveRows(): Promise<{ rows: any[]; processedTotal: number; processedLoaded: number }> {
  // Pending first and on its own request: it is what the default tab renders and what the
  // approve/reject dialog acts on, so it must not wait behind the processed history.
  const pending = await fetchScoped({ status: PENDING_STATUSES.join(",") }, PROCESSED_ROW_CAP * 4);
  const processed = await fetchScoped({ status: "approved,rejected,cancelled" }, PROCESSED_ROW_CAP);

  return {
    rows: dedupeRows([...pending.rows, ...processed.rows]),
    processedTotal: processed.total,
    processedLoaded: processed.rows.length,
  };
}

/**
 * Every row in a date range, straight from the server — used by CSV/PDF export so an export
 * is never silently limited to whatever the screen happened to have in memory.
 */
export async function fetchLeaveRowsForExport(from?: string, to?: string): Promise<LeaveRequest[]> {
  const range: Record<string, string> = {};
  if (from) range.fromDate = from;
  if (to) range.toDate = to;
  const { rows } = await fetchScoped(range, Number.MAX_SAFE_INTEGER);
  return rows.map(mapRawToLeaveRequest);
}

function mapRawToLeaveRequest(req: any): LeaveRequest {
  const empName = req.employee_name
    ?? (req.first_name && req.last_name ? `${req.first_name} ${req.last_name}` : null)
    ?? req.employee?.name
    ?? "Unknown";

  const dept = req.department_name ?? req.employee?.department ?? "Unassigned";
  const avatar = req.avatar_url ?? req.employee?.avatar ?? undefined;

  const startRaw = req.from_date ?? req.start_date;
  const endRaw = req.to_date ?? req.end_date;
  const days = req.total_days ?? req.days_count ?? 0;
  const submittedRaw = req.applied_at ?? req.created_at;
  const typeName = req.leave_type_name ?? req.leave_type?.name ?? req.type ?? "Unknown";
  const reviewerName = req.reviewer_name ?? req.reviewed_by_name ?? undefined;
  const reviewedAtRaw = req.reviewed_at ?? undefined;
  const reviewNotes = req.review_notes ?? req.remarks ?? undefined;

  return {
    id: req.id,
    employeeId: req.employee_id,
    employee: { name: empName, avatar, department: dept },
    type: typeName,
    startDate: startRaw ?? "",
    endDate: endRaw ?? "",
    days,
    reason: req.reason || "",
    status: req.status as LeaveRequest["status"],
    submittedAt: submittedRaw ?? "",
    reviewedBy: reviewerName ? { name: reviewerName } : undefined,
    reviewedAt: reviewedAtRaw ?? undefined,
    reviewNotes: reviewNotes || undefined,
  };
}

function useLeaveList() {
  return useQuery({
    queryKey: ["leave-requests"],
    queryFn: fetchLeaveRows,
    staleTime: 30_000,
    gcTime: 2 * 60_000,
  });
}

export function useLeaveRequests() {
  const query = useLeaveList();
  return { ...query, data: query.data?.rows.map(mapRawToLeaveRequest) };
}

/**
 * How much of the processed history is actually on screen.
 *
 * Rendered by the page as an explicit line when `truncated` — see PROCESSED_ROW_CAP. A capped
 * list that presents itself as the whole history is worse than a slow one, because the year
 * and leave-type filter options are derived from what was loaded: without this notice, an
 * older year simply disappears from the dropdown with nothing to say it ever existed.
 */
export function useLeaveLoadInfo() {
  const query = useLeaveList();
  return {
    processedLoaded: query.data?.processedLoaded ?? 0,
    processedTotal: query.data?.processedTotal ?? 0,
    truncated: (query.data?.processedTotal ?? 0) > (query.data?.processedLoaded ?? 0),
  };
}

/**
 * Status counts from the server's own totals, so they stay correct no matter how much of the
 * history is held in memory. Three count-only requests (~0.4s each) instead of a 9,424-row
 * download.
 */
export function useLeaveStats() {
  return useQuery({
    queryKey: ["leave-stats"],
    queryFn: async () => {
      const [pending, approved, rejected] = await Promise.all([
        fetchCount(PENDING_STATUSES.join(",")),
        fetchCount("approved"),
        fetchCount("rejected"),
      ]);
      return { pending, approved, rejected };
    },
    staleTime: 30_000,
    gcTime: 2 * 60_000,
  });
}

export function useUpdateLeaveStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "rejected" }) => {
      await hrmsApi.patch(`/api/leave/requests/${id}/review`, { status, remarks: null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["leave-stats"] });
    },
  });
}
