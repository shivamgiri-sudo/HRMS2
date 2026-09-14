/**
 * Annual Budget Summary (/finance/annual-budget-summary) — budget vs. actual vs. variance,
 * per branch or all branches, for every month of a financial year, with an annual rollup.
 *
 * Built 2026-08-21 in response to: "we have real historical budgets (db_bill mirror) and
 * expenses (GRN, full 2017-2027 history) for past months, why can't we see an annual
 * summary". Backend: annual-budget-summary.service.ts / .routes.ts (same day). Follows
 * BranchBudgetManagementWorkspace.tsx's `Metric` stat-tile pattern and this codebase's
 * established branch multi-select convention (checkbox list in a Popover, "All branches"
 * as the default/clear state) rather than inventing new components.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { hrmsApi } from "@/lib/hrmsApi";

interface MonthRow {
  periodCode: string;
  budget: number;
  actual: number;
  variance: number;
}

interface BranchRow {
  branchId: string;
  branchName: string;
  months: MonthRow[];
  annualBudget: number;
  annualActual: number;
  annualVariance: number;
}

interface SummaryResponse {
  financialYear: string;
  periods: string[];
  branches: BranchRow[];
  grandTotal: { budget: number; actual: number; variance: number };
}

function money(n: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);
}

function monthLabel(periodCode: string): string {
  const [y, m] = periodCode.split("-");
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${MONTHS[Number(m) - 1]}-${y.slice(2)}`;
}

/** Same visual language as BranchBudgetManagementWorkspace.tsx's own `Metric` tile. */
function Metric({ label, value, tone = "slate" }: { label: string; value: string; tone?: "slate" | "blue" | "emerald" | "rose" }) {
  const tones = {
    slate: "border-slate-200 bg-white",
    blue: "border-blue-200 bg-blue-50/80",
    emerald: "border-emerald-200 bg-emerald-50/80",
    rose: "border-rose-200 bg-rose-50/80",
  };
  return (
    <div className={`rounded-2xl border p-4 ${tones[tone]}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-600">{label}</p>
      <p className="mt-2 text-lg font-black text-slate-950">{value}</p>
    </div>
  );
}

function defaultFinancialYear(): string {
  const now = new Date();
  const year = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
}

export default function AnnualBudgetSummaryPage() {
  const [financialYear, setFinancialYear] = useState(defaultFinancialYear());
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>([]);
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [expandedBranchId, setExpandedBranchId] = useState<string | null>(null);

  const branchesQuery = useQuery({
    queryKey: ["annual-budget-summary", "branches"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: Array<{ id: string; branchName: string }> }>(
        "/api/finance/annual-budget-summary/branches"
      );
      return res.data;
    },
  });
  const branchOptions = (branchesQuery.data ?? []).map((b) => ({ id: b.id, name: b.branchName }));

  const summaryQuery = useQuery({
    queryKey: ["annual-budget-summary", financialYear, selectedBranchIds],
    queryFn: async () => {
      const params = new URLSearchParams({ financialYear });
      if (selectedBranchIds.length) params.set("branchIds", selectedBranchIds.join(","));
      const res = await hrmsApi.get<{ success: boolean; data: SummaryResponse }>(
        `/api/finance/annual-budget-summary?${params.toString()}`
      );
      return res.data;
    },
    enabled: /^\d{4}-\d{2}$/.test(financialYear),
  });

  const data = summaryQuery.data;
  const branches = data?.branches ?? [];
  const nonZeroBranches = branches.filter((b) => b.annualBudget > 0 || b.annualActual > 0);

  function toggleBranch(id: string) {
    setSelectedBranchIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  return (
    <DashboardLayout>
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Annual Budget Summary</h1>
            <p className="text-xs text-muted-foreground">
              Budget vs. actual, per branch or all branches, for every month of a financial year.
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => void summaryQuery.refetch()}>
            <RefreshCw className={`h-3.5 w-3.5 ${summaryQuery.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b bg-slate-50/60 px-4 py-3">
          <Input
            className="h-8 w-28 text-xs"
            value={financialYear}
            onChange={(e) => setFinancialYear(e.target.value)}
            placeholder="2026-27"
            title="Financial year (YYYY-YY)"
          />
          <Popover open={branchPickerOpen} onOpenChange={setBranchPickerOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs">
                {selectedBranchIds.length === 0
                  ? "All branches"
                  : `${selectedBranchIds.length} branch${selectedBranchIds.length > 1 ? "es" : ""} selected`}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-0" align="start">
              <div className="flex items-center justify-between border-b px-3 py-2">
                <span className="text-xs font-medium">Select branches</span>
                <Button
                  variant="ghost" size="sm" className="h-6 px-2 text-[11px]"
                  onClick={() => setSelectedBranchIds([])}
                >
                  Clear (all branches)
                </Button>
              </div>
              <div className="max-h-72 overflow-y-auto p-2">
                {branchOptions.map((b) => (
                  <label key={b.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-slate-50">
                    <Checkbox
                      checked={selectedBranchIds.includes(b.id)}
                      onCheckedChange={() => toggleBranch(b.id)}
                    />
                    {b.name}
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {data && (
          <div className="grid grid-cols-3 gap-2 border-b bg-slate-50/40 px-4 py-3">
            <Metric label="Total Budget" value={money(data.grandTotal.budget)} tone="blue" />
            <Metric label="Total Actual" value={money(data.grandTotal.actual)} tone="slate" />
            <Metric
              label="Variance"
              value={money(data.grandTotal.variance)}
              tone={data.grandTotal.variance >= 0 ? "emerald" : "rose"}
            />
          </div>
        )}

        {summaryQuery.isError && (
          <div className="m-4 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {summaryQuery.error instanceof Error ? summaryQuery.error.message : "Unable to load annual budget summary"}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {summaryQuery.isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Branch</TableHead>
                    <TableHead className="text-right">Annual Budget</TableHead>
                    <TableHead className="text-right">Annual Actual</TableHead>
                    <TableHead className="text-right">Variance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nonZeroBranches.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                        No budget or actual data for {financialYear}
                      </TableCell>
                    </TableRow>
                  ) : (
                    nonZeroBranches
                      .sort((a, b) => b.annualActual - a.annualActual)
                      .map((b) => (
                        <>
                          <TableRow key={b.branchId} className="cursor-pointer hover:bg-slate-50" onClick={() => setExpandedBranchId((cur) => (cur === b.branchId ? null : b.branchId))}>
                            <TableCell>
                              {expandedBranchId === b.branchId ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            </TableCell>
                            <TableCell className="font-medium">{b.branchName}</TableCell>
                            <TableCell className="text-right tabular-nums">{money(b.annualBudget)}</TableCell>
                            <TableCell className="text-right tabular-nums">{money(b.annualActual)}</TableCell>
                            <TableCell className={`text-right tabular-nums font-medium ${b.annualVariance >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                              {money(b.annualVariance)}
                            </TableCell>
                          </TableRow>
                          {expandedBranchId === b.branchId && (
                            <TableRow key={`${b.branchId}-detail`}>
                              <TableCell colSpan={5} className="bg-slate-50/60 p-3">
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>Month</TableHead>
                                      <TableHead className="text-right">Budget</TableHead>
                                      <TableHead className="text-right">Actual</TableHead>
                                      <TableHead className="text-right">Variance</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {b.months.map((m) => (
                                      <TableRow key={m.periodCode}>
                                        <TableCell>{monthLabel(m.periodCode)}</TableCell>
                                        <TableCell className="text-right tabular-nums">{money(m.budget)}</TableCell>
                                        <TableCell className="text-right tabular-nums">{money(m.actual)}</TableCell>
                                        <TableCell className={`text-right tabular-nums ${m.variance >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                                          {money(m.variance)}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </TableCell>
                            </TableRow>
                          )}
                        </>
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
