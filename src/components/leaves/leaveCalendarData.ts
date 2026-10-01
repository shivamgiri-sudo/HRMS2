import { hrmsApi } from "@/lib/hrmsApi";

export interface LeaveData {
  id: string;
  start_date?: string;
  end_date?: string;
  from_date?: string;
  to_date?: string;
  days_count?: number;
  total_days?: number;
  employee_name?: string;
  avatar_url?: string | null;
  leave_type_name?: string;
  employee: { first_name: string; last_name: string; avatar_url: string | null } | null;
  leave_type: { name: string } | null;
}

export function normalizeLeave(row: any): LeaveData {
  if (row.start_date && row.end_date && row.employee && row.leave_type) return row as LeaveData;
  const employeeName = String(row.employee_name ?? "Unknown").trim();
  const [firstName = "Unknown", ...rest] = employeeName.split(/\s+/);
  return {
    ...row,
    start_date: row.from_date ?? row.start_date,
    end_date: row.to_date ?? row.end_date,
    days_count: Number(row.total_days ?? row.days_count ?? 0),
    employee: { first_name: firstName, last_name: rest.join(" "), avatar_url: row.avatar_url ?? null },
    leave_type: { name: row.leave_type_name ?? row.leave_type?.name ?? "Leave" },
  };
}

const PAGE_SIZE = 500; // the endpoint's maximum
/** Most rows held for one month. An org-wide viewer can have thousands; the page says so when it stops. */
export const CALENDAR_ROW_CAP = 1500;

/**
 * Approved leave that touches the given month.
 *
 * This used to download the whole YEAR's approved leave (hundreds of rows per page, every page
 * fired in parallel) for every month change; for an org-wide viewer that never finished. The
 * server's overlap filter returns just the leaves that start before the month ends and end after
 * it starts — which also catches a leave that began in the previous month, something the old
 * year filter (start date only) missed. Pages are requested in sequence, not as a burst.
 */
export async function fetchApprovedLeavesForMonth(
  fromYmd: string,
  toYmd: string,
): Promise<{ rows: LeaveData[]; total: number; truncated: boolean }> {
  const query = (page: number) =>
    new URLSearchParams({
      status: "approved", overlapFrom: fromYmd, overlapTo: toYmd, page: String(page), limit: String(PAGE_SIZE),
    }).toString();

  const raw: any[] = [];
  let total = 0;
  for (let page = 1; ; page += 1) {
    const res = await hrmsApi.get<{ success: boolean; data: any[]; total?: number }>(`/api/leave/requests?${query(page)}`);
    const batch = res.data ?? [];
    if (page === 1) total = Number(res.total ?? batch.length);
    if (!batch.length) break; // server ran out earlier than `total` claimed
    raw.push(...batch);
    if (raw.length >= Math.min(total, CALENDAR_ROW_CAP)) break;
  }

  const byId = new Map<string, LeaveData>();
  for (const item of raw) {
    const leave = normalizeLeave(item);
    const key = String(leave.id ?? "");
    if (!key || byId.has(key) || !leave.start_date || !leave.end_date) continue;
    byId.set(key, leave);
  }
  const rows = Array.from(byId.values()).slice(0, CALENDAR_ROW_CAP);
  return { rows, total, truncated: total > rows.length };
}
