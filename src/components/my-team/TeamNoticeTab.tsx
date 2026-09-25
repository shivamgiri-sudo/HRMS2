import { useQuery } from "@tanstack/react-query";
import { UserMinus } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** Every stage in which someone has resigned and has not yet left - visible from the day of submission. */
export const NOTICE_STATUSES = [
  "submitted",
  "manager_review",
  "accepted",
  "notice_serving",
  "clearance_pending",
] as const;

interface NoticeRow {
  id: string;
  employee_code: string | null;
  employee_name: string | null;
  process_name: string | null;
  status: string;
  submitted_at: string | null;
  created_at: string | null;
  notice_period_days: number | null;
  last_working_day_proposed: string | null;
  last_working_day_confirmed: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  submitted: "Submitted",
  manager_review: "With manager",
  accepted: "Accepted",
  notice_serving: "Serving notice",
  clearance_pending: "Clearance pending",
};

/** Confirmed last working day when there is one, otherwise the proposed one. */
export function lastWorkingDay(
  row: Pick<
    NoticeRow,
    "last_working_day_confirmed" | "last_working_day_proposed"
  >,
): {
  date: string | null;
  confirmed: boolean;
} {
  if (row.last_working_day_confirmed)
    return { date: row.last_working_day_confirmed, confirmed: true };
  return { date: row.last_working_day_proposed, confirmed: false };
}

/**
 * Team notice-period view: who in my span (TL: my team, AM: each TL's team) has resigned and is
 * working out notice, with their last working day. Read-only - approvals stay in Exit Management.
 * Reads the existing Exit list, whose scope already follows the reporting line.
 */
export default function TeamNoticeTab() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["team-notice"],
    queryFn: () =>
      hrmsApi.get<{ data: NoticeRow[] }>(
        `/api/exit?statuses=${NOTICE_STATUSES.join(",")}&limit=200`,
      ),
    staleTime: 30_000,
  });
  const rows = (data?.data ?? [])
    .map((row) => ({ row, lwd: lastWorkingDay(row) }))
    .sort((a, b) => (a.lwd.date ?? "9999").localeCompare(b.lwd.date ?? "9999"));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <UserMinus className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-700">Serving notice</h3>
        <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-amber-100 px-1.5 text-xs font-bold text-amber-700">
          {rows.length}
        </span>
        <p className="ml-2 text-xs text-slate-500">
          Visible from the day the resignation is submitted, with the last
          working day.
        </p>
      </div>
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-xl" />
          ))}
        </div>
      ) : error instanceof Error ? (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          Could not load notice periods. {error.message}
        </p>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-14 text-center text-sm text-slate-500">
          Nobody in your team is serving notice.
        </div>
      ) : (
        <div className="overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 hover:bg-slate-50">
                <TableHead className="font-semibold text-slate-600">
                  Employee
                </TableHead>
                <TableHead className="font-semibold text-slate-600">
                  Process
                </TableHead>
                <TableHead className="font-semibold text-slate-600">
                  Stage
                </TableHead>
                <TableHead className="font-semibold text-slate-600">
                  Submitted
                </TableHead>
                <TableHead className="font-semibold text-slate-600">
                  Notice (days)
                </TableHead>
                <TableHead className="font-semibold text-slate-600">
                  Last working day
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ row, lwd }) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <p className="text-sm font-semibold text-slate-900">
                      {row.employee_name ?? "-"}
                    </p>
                    <p className="text-xs text-slate-400">
                      {row.employee_code}
                    </p>
                  </TableCell>
                  <TableCell className="text-sm text-slate-600">
                    {row.process_name ?? "-"}
                  </TableCell>
                  <TableCell className="text-sm text-slate-700">
                    {STATUS_LABEL[row.status] ?? row.status}
                  </TableCell>
                  <TableCell className="font-mono text-sm text-slate-600">
                    {(row.submitted_at ?? row.created_at ?? "").slice(0, 10) ||
                      "-"}
                  </TableCell>
                  <TableCell className="text-sm text-slate-600">
                    {row.notice_period_days ?? "-"}
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {lwd.date ? (
                      <span
                        className={
                          lwd.confirmed
                            ? "font-semibold text-emerald-700"
                            : "text-slate-600"
                        }
                      >
                        {lwd.date.slice(0, 10)}
                        {lwd.confirmed ? "" : " (proposed)"}
                      </span>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
