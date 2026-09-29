/**
 * Extracted from NativeExitCommandCenter.tsx (owner ruling 2026-09-26: split the 2600+
 * line page into smaller files). Shared types/consts/primitives live in ./shared.ts.
 */
import { useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { NoticePeriodDrawer } from "@/components/exit/NoticePeriodDrawer";
import {
  CLEARANCE_STATUS_COLORS,
  NOC_STATUS_COLORS,
  NOC_STATUS_LABELS,
} from "@/lib/exitClearance";
import { exitTypeBadgeClass, reasonLabel, type ExitRow } from "./shared";

// ─────────────────────────────────────────────────────────────────────────────
// Exit Task Board Tab — master tracking view: every active exit with its clearance
// progress, NOC case status and F&F status in one place. Row click opens the same
// NoticePeriodDrawer every other tab uses, now with real Clear/Waive actions.
// ─────────────────────────────────────────────────────────────────────────────
const ACTIVE_EXIT_STATUSES = new Set([
  "accepted",
  "notice_serving",
  "exited",
  "exit_confirmed",
]);

const FF_STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  verified: "bg-blue-100 text-blue-700",
  approved: "bg-emerald-100 text-emerald-700",
  paid: "bg-emerald-100 text-emerald-700",
};

export function ExitTaskBoardTab({
  exitRequests,
  loading,
}: {
  exitRequests: ExitRow[];
  loading: boolean;
}) {
  const [drawerExitId, setDrawerExitId] = useState<string | null>(null);
  const activeExits = useMemo(
    () => exitRequests.filter((r) => ACTIVE_EXIT_STATUSES.has(r.status)),
    [exitRequests],
  );

  return (
    <Card className="rounded-2xl border border-white/60 bg-white/95 shadow-sm backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-base text-slate-900">
          Exit Task Board
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            ({activeExits.length} active exit
            {activeExits.length === 1 ? "" : "s"})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-12 w-full animate-pulse rounded-lg bg-slate-100"
              />
            ))}
          </div>
        ) : activeExits.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center">
            <ShieldCheck className="mb-3 h-10 w-10 text-slate-300" />
            <h3 className="text-base font-bold text-slate-700">
              No active exits
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Accepted, notice-serving and exited employees will appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 hover:bg-slate-50">
                  <TableHead>Employee</TableHead>
                  <TableHead>Branch / Process</TableHead>
                  <TableHead>LWD</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Clearance</TableHead>
                  <TableHead>NOC</TableHead>
                  <TableHead>F&F</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeExits.map((r) => {
                  const total = Number(r.clearance_total ?? 0);
                  const cleared = Number(r.clearance_cleared ?? 0);
                  return (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer hover:bg-blue-50/40"
                      onClick={() => setDrawerExitId(r.id)}
                    >
                      <TableCell>
                        <p className="font-medium">{r.employee_name ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">
                          {r.employee_code}
                        </p>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {r.branch_name ?? "—"}
                        {r.process_name ? ` · ${r.process_name}` : ""}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {(r.last_working_day_proposed ?? "")
                          .slice(0, 10)
                          .split("-")
                          .reverse()
                          .join("/") || "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {r.status.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${exitTypeBadgeClass(r.exit_type)}`}
                        >
                          {r.exit_type ?? "—"}
                        </span>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {reasonLabel(r.exit_reason_category)}
                        </p>
                      </TableCell>
                      <TableCell>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                            total > 0 && cleared === total
                              ? CLEARANCE_STATUS_COLORS.cleared
                              : CLEARANCE_STATUS_COLORS.pending
                          }`}
                        >
                          {cleared}/{total}
                        </span>
                      </TableCell>
                      <TableCell>
                        {r.noc_case_status ? (
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-bold ${NOC_STATUS_COLORS[r.noc_case_status] ?? "bg-slate-100 text-slate-600"}`}
                          >
                            {NOC_STATUS_LABELS[r.noc_case_status] ??
                              r.noc_case_status}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.ff_status ? (
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-bold capitalize ${FF_STATUS_COLORS[r.ff_status] ?? "bg-slate-100 text-slate-600"}`}
                          >
                            {r.ff_status}
                            {r.is_ff_provisional ? " (provisional)" : ""}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {drawerExitId && (
        <NoticePeriodDrawer
          exitId={drawerExitId}
          onClose={() => setDrawerExitId(null)}
        />
      )}
    </Card>
  );
}
