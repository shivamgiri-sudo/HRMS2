import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Users,
  TrendingUp,
  DollarSign,
  Building2,
  AlertTriangle,
  Download,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { hrmsApi } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";

// ─── Types ────────────────────────────────────────────────────────────────────

type GroupBy = "branch" | "process" | "department" | "cost_centre";

interface DimensionRow {
  dimension_name: string;
  headcount: number;
  total_basic: number;
  total_allowances: number;
  total_gross: number;
  total_deductions: number;
  total_net: number;
  total_pf_employer: number;
  total_esic_employer: number;
  total_gratuity_provision: number;
}

interface KpiSummary {
  headcount: number;
  total_gross: number;
  total_net: number;
  total_pf_employer: number;
  total_esic_employer: number;
  total_gratuity_provision: number;
}

interface CostSummaryResponse {
  success: boolean;
  runMonth: string;
  isEstimate: boolean;
  kpi: KpiSummary;
  data: DimensionRow[];
  message?: string;
}

type SortKey = keyof DimensionRow | "pct_of_total";
type SortDir = "asc" | "desc";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayYYYYMM(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}`;
}

function formatInr(n: number): string {
  if (Math.abs(n) >= 100_000) {
    return `₹${(n / 100_000).toFixed(2)}L`;
  }
  return `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function formatPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

// ─── KPI Chip ─────────────────────────────────────────────────────────────────

interface KpiChipProps {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
}

function KpiChip({ icon: Icon, label, value, sub }: KpiChipProps) {
  return (
    <Card className="flex-1 min-w-[150px]">
      <CardHeader className="pb-1 pt-4 px-4">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {label}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="text-2xl font-bold">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

// ─── Dimension Table ──────────────────────────────────────────────────────────

interface DimensionTableProps {
  rows: DimensionRow[];
  totalNet: number;
  isEstimate: boolean;
}

const COL_HEADERS: { key: SortKey; label: string }[] = [
  { key: "dimension_name", label: "Name" },
  { key: "headcount", label: "Headcount" },
  { key: "total_gross", label: "Gross" },
  { key: "total_net", label: "Net" },
  { key: "total_pf_employer", label: "PF Employer" },
  { key: "total_esic_employer", label: "ESI Employer" },
  { key: "total_gratuity_provision", label: "Gratuity" },
  { key: "pct_of_total", label: "% of Total" },
];

function DimensionTable({ rows, totalNet, isEstimate }: DimensionTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("total_gross");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sorted = [...rows].sort((a, b) => {
    let av: number | string;
    let bv: number | string;
    if (sortKey === "pct_of_total") {
      av = totalNet > 0 ? (a.total_net / totalNet) * 100 : 0;
      bv = totalNet > 0 ? (b.total_net / totalNet) * 100 : 0;
    } else if (sortKey === "dimension_name") {
      av = a.dimension_name;
      bv = b.dimension_name;
    } else {
      av = a[sortKey as keyof DimensionRow] as number;
      bv = b[sortKey as keyof DimensionRow] as number;
    }
    if (typeof av === "string" && typeof bv === "string") {
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    return sortDir === "asc"
      ? (av as number) - (bv as number)
      : (bv as number) - (av as number);
  });

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            {COL_HEADERS.map((col) => (
              <th
                key={col.key}
                className="px-4 py-3 text-left font-semibold text-slate-600 cursor-pointer select-none whitespace-nowrap hover:bg-slate-100"
                onClick={() => handleSort(col.key)}
              >
                <span className="flex items-center gap-1">
                  {col.label}
                  {sortKey === col.key && (
                    <span className="text-primary">{sortDir === "asc" ? "↑" : "↓"}</span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td colSpan={COL_HEADERS.length} className="px-4 py-8 text-center text-muted-foreground">
                No data available for this dimension and month.
              </td>
            </tr>
          )}
          {sorted.map((row, i) => {
            const pct = totalNet > 0 ? (row.total_net / totalNet) * 100 : 0;
            return (
              <tr
                key={i}
                className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
              >
                <td className="px-4 py-3 font-medium text-slate-800">{row.dimension_name}</td>
                <td className="px-4 py-3 text-right tabular-nums">{row.headcount}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatInr(row.total_gross)}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {isEstimate ? (
                    <span className="text-amber-600 italic text-xs">est.</span>
                  ) : (
                    formatInr(row.total_net)
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {isEstimate ? "—" : formatInr(row.total_pf_employer)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {isEstimate ? "—" : formatInr(row.total_esic_employer)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {isEstimate ? "—" : formatInr(row.total_gratuity_provision)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-medium">
                  {formatPct(pct)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── CSV export ───────────────────────────────────────────────────────────────

function exportCsv(rows: DimensionRow[], groupLabel: string, month: string, totalNet: number, isEstimate: boolean) {
  const header = ["Name", "Headcount", "Gross", "Net", "PF Employer", "ESI Employer", "Gratuity", "% of Total"];
  const dataRows = rows.map((r) => {
    const pct = totalNet > 0 ? (r.total_net / totalNet) * 100 : 0;
    return [
      r.dimension_name,
      r.headcount,
      r.total_gross.toFixed(2),
      isEstimate ? r.total_gross.toFixed(2) : r.total_net.toFixed(2),
      isEstimate ? "" : r.total_pf_employer.toFixed(2),
      isEstimate ? "" : r.total_esic_employer.toFixed(2),
      isEstimate ? "" : r.total_gratuity_provision.toFixed(2),
      pct.toFixed(1) + "%",
    ];
  });
  const csv = [header, ...dataRows].map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `payroll-cost-${groupLabel}-${month}${isEstimate ? "-estimate" : ""}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function fetchCostSummary(month: string, groupBy: GroupBy): Promise<CostSummaryResponse> {
  const res = await hrmsApi.get<CostSummaryResponse>(
    `/api/payroll/cost-summary?month=${month}&group_by=${groupBy}`,
  );
  return res;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const TAB_LABELS: Record<GroupBy, string> = {
  branch: "By Branch",
  process: "By Process",
  department: "By Department",
  cost_centre: "By Cost Centre",
};

const ALLOWED_ROLES = ["admin", "super_admin", "finance", "payroll", "payroll_head"];

export default function PayrollCostSummary() {
  const { roleKeys } = useWorkforceAccess();
  const canView = ALLOWED_ROLES.some((r) => roleKeys.includes(r));

  const [month, setMonth] = useState<string>(todayYYYYMM());
  const [activeTab, setActiveTab] = useState<GroupBy>("branch");

  const query = useQuery({
    queryKey: ["payroll-cost-summary", month, activeTab],
    queryFn: () => fetchCostSummary(month, activeTab),
    staleTime: 120_000,
    enabled: canView,
  });

  const summary = query.data;
  const kpi = summary?.kpi;
  const rows = summary?.data ?? [];
  const isEstimate = summary?.isEstimate ?? false;

  if (!canView) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          You do not have permission to view this page.
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-6">
        {/* Header */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <DollarSign className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Salary Bill &amp; Cost Dashboard</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Monthly payroll cost breakdown by organisational dimension
          </p>
        </div>

        {/* Month picker */}
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-slate-700" htmlFor="cost-month-picker">
            Payroll Month:
          </label>
          <input
            id="cost-month-picker"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* Estimate banner */}
        {isEstimate && (
          <div className="flex items-start gap-3 rounded-md bg-yellow-50 border border-yellow-300 px-4 py-3 text-sm text-yellow-800">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-yellow-600" />
            <span>
              No payroll run found for <strong>{month}</strong> — showing estimates from salary assignments.
              Deductions, PF, ESI and Gratuity figures are not available in estimate mode.
            </span>
          </div>
        )}

        {/* Error */}
        {query.isError && (
          <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            Failed to load cost summary. Please try again.
          </div>
        )}

        {/* KPI row */}
        {query.isLoading ? (
          <div className="flex gap-4 flex-wrap">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-24 flex-1 min-w-[150px] rounded-lg bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : kpi ? (
          <div className="flex gap-4 flex-wrap">
            <KpiChip icon={Users} label="Total Headcount" value={String(kpi.headcount)} />
            <KpiChip
              icon={TrendingUp}
              label="Total Gross"
              value={formatInr(kpi.total_gross)}
              sub={isEstimate ? "estimated" : undefined}
            />
            <KpiChip
              icon={DollarSign}
              label="Total Net"
              value={isEstimate ? "—" : formatInr(kpi.total_net)}
              sub={isEstimate ? "not available" : undefined}
            />
            <KpiChip
              icon={Building2}
              label="Employer PF"
              value={isEstimate ? "—" : formatInr(kpi.total_pf_employer)}
            />
            <KpiChip
              icon={Building2}
              label="Employer ESI"
              value={isEstimate ? "—" : formatInr(kpi.total_esic_employer)}
            />
            <KpiChip
              icon={TrendingUp}
              label="Gratuity Provision"
              value={isEstimate ? "—" : formatInr(kpi.total_gratuity_provision)}
            />
          </div>
        ) : null}

        {/* Dimension tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as GroupBy)}>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <TabsList>
              {(Object.keys(TAB_LABELS) as GroupBy[]).map((gb) => (
                <TabsTrigger key={gb} value={gb}>
                  {TAB_LABELS[gb]}
                </TabsTrigger>
              ))}
            </TabsList>

            {rows.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => exportCsv(rows, activeTab, month, kpi?.total_net ?? 0, isEstimate)}
              >
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
            )}
          </div>

          {(Object.keys(TAB_LABELS) as GroupBy[]).map((gb) => (
            <TabsContent key={gb} value={gb} className="mt-4">
              {query.isLoading ? (
                <div className="space-y-2">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-12 rounded bg-slate-100 animate-pulse" />
                  ))}
                </div>
              ) : (
                <>
                  {summary?.message && (
                    <div className="mb-4 rounded-md bg-slate-50 border border-slate-200 px-4 py-3 text-sm text-slate-600">
                      {summary.message}
                    </div>
                  )}
                  <DimensionTable
                    rows={rows}
                    totalNet={kpi?.total_net ?? 0}
                    isEstimate={isEstimate}
                  />
                </>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
