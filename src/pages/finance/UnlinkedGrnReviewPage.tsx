/**
 * Unlinked GRN Review (/finance/unlinked-grn-review) — a live, always-checkable list of every
 * approved GRN not yet linked to a budget line, classified by why.
 *
 * Built 2026-08-22 as the permanent answer to "how would I know if this happens again", after a
 * full-FY remediation session found ~1,505 vendor/imprest GRNs that had reached approved status
 * without ever being linked (see hrms2-grn-cost-allocation-budget-blind-spot memory). Most were
 * fixed by hand that session; this page means nobody has to ask for a one-off query again.
 * Follows AnnualBudgetSummaryPage.tsx's layout conventions (stat tiles, branch filter) for
 * consistency rather than inventing a new visual language.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { hrmsApi } from "@/lib/hrmsApi";

type Category = "NO_COST_CENTRE" | "NO_BRANCH_BUDGET" | "NO_MATCHING_LINE" | "HEADROOM_EXCEEDED" | "FUTURE_DEFERRED";

interface UnlinkedGrnRow {
  grnId: string;
  grnNumber: string;
  grnType: string;
  status: string;
  branchName: string;
  costCentreName: string | null;
  head: string;
  subHead: string | null;
  accountingPeriod: string;
  amountWithTax: number;
  category: Category;
  shortfall: number | null;
}

interface Summary { category: Category; count: number; amount: number }

interface ReviewResponse {
  asOfPeriod: string;
  rows: UnlinkedGrnRow[];
  summary: Summary[];
  totalCount: number;
  totalAmount: number;
}

const CATEGORY_META: Record<Category, { label: string; tone: string; help: string }> = {
  NO_COST_CENTRE: {
    label: "No cost centre",
    tone: "border-rose-200 bg-rose-50 text-rose-700",
    help: "The GRN itself carries no cost centre — a data-quality issue on the record, not a budgeting gap.",
  },
  NO_BRANCH_BUDGET: {
    label: "No branch budget",
    tone: "border-rose-200 bg-rose-50 text-rose-700",
    help: "This branch has no budget at all for this month — needs one raised from scratch.",
  },
  NO_MATCHING_LINE: {
    label: "No matching line",
    tone: "border-amber-200 bg-amber-50 text-amber-700",
    help: "A budget exists for this branch/month, but no line covers this head/sub-head.",
  },
  HEADROOM_EXCEEDED: {
    label: "Headroom exceeded",
    tone: "border-amber-200 bg-amber-50 text-amber-700",
    help: "A matching line exists but doesn't have enough room left — needs a top-up.",
  },
  FUTURE_DEFERRED: {
    label: "Future month",
    tone: "border-slate-200 bg-slate-50 text-slate-600",
    help: "Accounting period hasn't started yet — deliberately not budgeted, not an issue.",
  },
};

function money(n: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-600">{label}</p>
      <p className="mt-2 text-lg font-black text-slate-950">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export default function UnlinkedGrnReviewPage() {
  const [showFuture, setShowFuture] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<Category | "ALL">("ALL");

  const reviewQuery = useQuery({
    queryKey: ["unlinked-grn-review", showFuture],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (showFuture) params.set("includeFutureDeferred", "true");
      const res = await hrmsApi.get<{ success: boolean; data: ReviewResponse }>(
        `/api/finance/unlinked-grn-review?${params.toString()}`
      );
      return res.data;
    },
  });

  const data = reviewQuery.data;
  const rows = (data?.rows ?? []).filter((r) => categoryFilter === "ALL" || r.category === categoryFilter);
  const problemSummary = (data?.summary ?? []).filter((s) => s.category !== "FUTURE_DEFERRED");
  const futureSummary = (data?.summary ?? []).find((s) => s.category === "FUTURE_DEFERRED");

  return (
    <DashboardLayout>
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Unlinked GRN Review</h1>
            <p className="text-xs text-muted-foreground">
              Every approved GRN not yet linked to a budget line, and why — as of {data?.asOfPeriod ?? "…"}.
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => void reviewQuery.refetch()}>
            <RefreshCw className={`h-3.5 w-3.5 ${reviewQuery.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {data && (
          <div className="grid grid-cols-2 gap-2 border-b bg-slate-50/40 px-4 py-3 md:grid-cols-4">
            <Metric label="Real gaps" value={String(data.totalCount)} sub="excludes future months" />
            <Metric label="Amount" value={money(data.totalAmount)} />
            {problemSummary.map((s) => (
              <Metric key={s.category} label={CATEGORY_META[s.category].label} value={`${s.count} · ${money(s.amount)}`} />
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-b bg-slate-50/60 px-4 py-3">
          <Button variant={categoryFilter === "ALL" ? "default" : "outline"} size="sm" className="h-7 text-xs" onClick={() => setCategoryFilter("ALL")}>
            All
          </Button>
          {(Object.keys(CATEGORY_META) as Category[])
            .filter((c) => c !== "FUTURE_DEFERRED")
            .map((c) => (
              <Button key={c} variant={categoryFilter === c ? "default" : "outline"} size="sm" className="h-7 text-xs" onClick={() => setCategoryFilter(c)}>
                {CATEGORY_META[c].label}
              </Button>
            ))}
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            {futureSummary && (
              <button
                className="underline decoration-dotted underline-offset-2 hover:text-slate-700"
                onClick={() => { setShowFuture((v) => !v); if (!showFuture) setCategoryFilter("FUTURE_DEFERRED"); else setCategoryFilter("ALL"); }}
              >
                {showFuture ? "Hide" : "Show"} {futureSummary.count} future-month rows ({money(futureSummary.amount)}) — deliberately not budgeted yet
              </button>
            )}
          </div>
        </div>

        {reviewQuery.isError && (
          <div className="m-4 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {reviewQuery.error instanceof Error ? reviewQuery.error.message : "Unable to load unlinked GRN review"}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {reviewQuery.isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>GRN</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Cost Centre</TableHead>
                    <TableHead>Head / Sub-head</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                        {categoryFilter === "ALL" && !showFuture ? "No unresolved gaps right now." : "Nothing matches this filter."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((r) => (
                      <TableRow key={r.grnId} title={CATEGORY_META[r.category].help}>
                        <TableCell className="font-medium">{r.grnNumber}</TableCell>
                        <TableCell>{r.branchName}</TableCell>
                        <TableCell>{r.costCentreName ?? <span className="text-rose-500">none</span>}</TableCell>
                        <TableCell>{r.head}{r.subHead ? ` / ${r.subHead}` : ""}</TableCell>
                        <TableCell className="tabular-nums">{r.accountingPeriod}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(r.amountWithTax)}
                          {r.shortfall ? <div className="text-[11px] text-rose-600">short {money(r.shortfall)}</div> : null}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={CATEGORY_META[r.category].tone}>
                            {CATEGORY_META[r.category].label}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
