/**
 * Discard & Reversal Center
 *
 * The audit surface for reversed approvals. Discards happen inline on the Leaves,
 * Attendance Regularization and Attendance Disputes pages — where the reviewer
 * already has the context to judge one. This page answers the other question:
 * what has been reversed, by whom, and why.
 */

import { useMemo, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import {
  AlertTriangle, ChevronLeft, ChevronRight, RefreshCw, RotateCcw, ShieldAlert,
} from "lucide-react";
import { useDiscardHistory, type DiscardEntityType } from "@/hooks/useDiscard";
import { formatDateTime } from "@/lib/utils";

const ENTITY_BADGE: Record<string, string> = {
  leave: "bg-sky-100 text-sky-800 border-sky-200",
  regularization: "bg-violet-100 text-violet-800 border-violet-200",
  dispute: "bg-amber-100 text-amber-900 border-amber-200",
};

const MODE_BADGE: Record<string, { label: string; className: string }> = {
  snapshot: { label: "Exact restore", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  delete: { label: "Row removed", className: "bg-slate-100 text-slate-700 border-slate-300" },
  partial: { label: "Partial", className: "bg-amber-100 text-amber-900 border-amber-200" },
  rederive: { label: "Recomputed", className: "bg-amber-100 text-amber-900 border-amber-200" },
  mixed: { label: "Mixed", className: "bg-slate-100 text-slate-700 border-slate-300" },
  skip_locked: { label: "Skipped — locked", className: "bg-red-100 text-red-800 border-red-200" },
  skip_owned: { label: "Skipped", className: "bg-red-100 text-red-800 border-red-200" },
  none: { label: "—", className: "bg-slate-100 text-slate-600 border-slate-200" },
};

const PAGE_SIZE = 25;

export default function NativeDiscardCenter() {
  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState<"all" | DiscardEntityType>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const query = useDiscardHistory({
    page,
    limit: PAGE_SIZE,
    entityType: entityType === "all" ? undefined : entityType,
    fromDate: fromDate || undefined,
    toDate: toDate || undefined,
  });

  const rows = query.data?.data ?? [];
  const total = query.data?.meta?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const stats = useMemo(() => {
    const degraded = rows.filter(
      (r: any) => r.restore_mode === "partial" || r.restore_mode === "rederive" || r.restore_mode === "mixed"
    ).length;
    const daysBack = rows.reduce((sum: number, r: any) => sum + Number(r.days_restored ?? 0), 0);
    return { degraded, daysBack };
  }, [rows]);

  return (
    <DashboardLayout>
      <div className="space-y-5 p-1">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-slate-900">
              <RotateCcw className="h-6 w-6 text-rose-600" />
              Discard &amp; Reversal Center
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Every reversed approval — leave credited back, attendance restored — with who did it and why.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => query.refetch()} disabled={query.isFetching}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Discards (total)</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{total}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Leave days credited back</p>
              <p className="mt-1 text-2xl font-semibold text-emerald-700">{stats.daysBack || 0}</p>
              <p className="text-[11px] text-slate-400">on this page</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
                <ShieldAlert className="h-3.5 w-3.5" /> Partial restores
              </p>
              <p className="mt-1 text-2xl font-semibold text-amber-700">{stats.degraded}</p>
              <p className="text-[11px] text-slate-400">approved before snapshots existed</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            <div className="min-w-[180px]">
              <label className="mb-1 block text-xs font-medium text-slate-600">Type</label>
              <Select
                value={entityType}
                onValueChange={(v) => { setEntityType(v as any); setPage(1); }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="leave">Leave</SelectItem>
                  <SelectItem value="regularization">Regularization</SelectItem>
                  <SelectItem value="dispute">Dispute</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">From</label>
              <Input type="date" value={fromDate}
                onChange={(e) => { setFromDate(e.target.value); setPage(1); }} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">To</label>
              <Input type="date" value={toDate}
                onChange={(e) => { setToDate(e.target.value); setPage(1); }} />
            </div>
            {(fromDate || toDate || entityType !== "all") && (
              <Button variant="ghost" size="sm"
                onClick={() => { setFromDate(""); setToDate(""); setEntityType("all"); setPage(1); }}>
                Clear
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {query.isLoading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : query.isError ? (
              <div className="p-6 text-sm text-destructive">
                Could not load discard history: {(query.error as any)?.message ?? "unknown error"}
              </div>
            ) : rows.length === 0 ? (
              <EmptyState
                title="No discards yet"
                description="Approved leave, regularizations and disputes that get reversed will be listed here."
                icon={<RotateCcw className="h-7 w-7" />}
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="font-semibold">When</TableHead>
                      <TableHead className="font-semibold">Employee</TableHead>
                      <TableHead className="font-semibold">Type</TableHead>
                      <TableHead className="font-semibold">Restored</TableHead>
                      <TableHead className="font-semibold">Balance</TableHead>
                      <TableHead className="font-semibold">By</TableHead>
                      <TableHead className="font-semibold">Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row: any) => {
                      const mode = MODE_BADGE[row.restore_mode] ?? MODE_BADGE.none;
                      return (
                        <TableRow key={row.id}>
                          <TableCell className="whitespace-nowrap text-xs text-slate-600">
                            {formatDateTime(row.discarded_at)}
                          </TableCell>
                          <TableCell>
                            <div className="font-medium text-slate-900">{row.employee_name || "—"}</div>
                            <div className="text-xs text-slate-500">{row.employee_code || ""}</div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline"
                              className={`text-xs ${ENTITY_BADGE[row.entity_type] ?? ""}`}>
                              {row.entity_type}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-xs ${mode.className}`}>
                              {mode.label}
                            </Badge>
                            {row.payroll_month && (
                              <div className="mt-0.5 text-[11px] text-slate-400">{row.payroll_month}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">
                            {row.days_restored != null ? (
                              <span className="text-emerald-700 font-medium">
                                +{row.days_restored}d
                              </span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                            {row.balance_before != null && row.balance_after != null && (
                              <div className="text-[11px] text-slate-400">
                                {row.balance_before} → {row.balance_after}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-xs">
                            <div className="text-slate-700">{row.discarded_by_email || row.discarded_by}</div>
                            {row.discarded_by_role && (
                              <div className="text-slate-400">{row.discarded_by_role}</div>
                            )}
                          </TableCell>
                          <TableCell className="max-w-[280px] text-xs text-slate-600">
                            {row.reason}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2">
                <span className="text-xs text-slate-500">
                  Page {page} of {totalPages} · {total} record{total === 1 ? "" : "s"}
                </span>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="sm" disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="flex items-start gap-1.5 text-xs text-slate-500">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          A discard cannot be undone. To reverse one, the employee raises the request again
          and it goes back through the normal approval flow.
        </p>
      </div>
    </DashboardLayout>
  );
}
