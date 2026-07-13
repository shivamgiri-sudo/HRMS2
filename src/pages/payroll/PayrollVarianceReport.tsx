import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card, CardHeader, CardTitle, CardContent,
} from "@/components/ui/card";
import { RefreshCw, ArrowUp, ArrowDown, Minus, Download } from "lucide-react";

interface VarianceRow {
  employee_id: string;
  employee_code: string | null;
  employee_name: string | null;
  branch_name: string | null;
  department_name: string | null;
  designation_name: string | null;
  category: string;
  curr_gross: number | null;
  curr_net: number | null;
  curr_basic: number | null;
  curr_tds: number | null;
  curr_pf: number | null;
  curr_esic: number | null;
  curr_incentive: number | null;
  curr_ot: number | null;
  curr_ded: number | null;
  prev_net: number | null;
  prev_gross: number | null;
  delta_net: number;
  delta_pct: number | null;
}

interface VarianceSummary {
  total_employees_current: number;
  total_employees_previous: number;
  net_bill_current: number;
  net_bill_previous: number;
  delta_net_bill: number;
  new_joiners: number;
  leavers: number;
  changed: number;
  breakdown: Record<string, number>;
}

const CAT_LABELS: Record<string, string> = {
  NEW_JOINER:       "New Joiner",
  LEAVER:           "Leaver",
  SALARY_CHANGE:    "Salary Change",
  INCENTIVE_CHANGE: "Incentive Δ",
  OVERTIME_CHANGE:  "Overtime Δ",
  STATUTORY_CHANGE: "Statutory Δ",
  DEDUCTION_CHANGE: "Deduction Δ",
  NO_CHANGE:        "No Change",
};

const CAT_COLORS: Record<string, string> = {
  NEW_JOINER:       "bg-blue-100 text-blue-800",
  LEAVER:           "bg-slate-100 text-slate-700",
  SALARY_CHANGE:    "bg-orange-100 text-orange-800",
  INCENTIVE_CHANGE: "bg-yellow-100 text-yellow-800",
  OVERTIME_CHANGE:  "bg-indigo-100 text-indigo-800",
  STATUTORY_CHANGE: "bg-pink-100 text-pink-800",
  DEDUCTION_CHANGE: "bg-purple-100 text-purple-800",
  NO_CHANGE:        "bg-slate-50 text-slate-400",
};

function fmtCur(v: number | null): string {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(v);
}

function DeltaCell({ delta, pct }: { delta: number; pct: number | null }) {
  if (Math.abs(delta) < 1) return <span className="text-slate-400">—</span>;
  const up = delta > 0;
  return (
    <span className={`flex items-center gap-0.5 font-medium ${up ? "text-green-700" : "text-red-700"}`}>
      {up ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
      ₹{fmtCur(Math.abs(delta))}
      {pct != null && <span className="text-xs opacity-70 ml-1">({up ? "+" : ""}{pct}%)</span>}
    </span>
  );
}

function prevMonth(m: string): string {
  const [yr, mo] = m.split("-").map(Number);
  return mo === 1 ? `${yr - 1}-12` : `${yr}-${String(mo - 1).padStart(2, "0")}`;
}

export default function PayrollVarianceReport() {
  const today = new Date();
  const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const [month,     setMonth]     = useState(defaultMonth);
  const [compareTo, setCompareTo] = useState(prevMonth(defaultMonth));
  const [catFilter, setCatFilter] = useState<string>("ALL");
  const [searchQ,   setSearchQ]   = useState("");
  const [applied,   setApplied]   = useState({ month: defaultMonth, compareTo: prevMonth(defaultMonth) });

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["payroll-variance", applied.month, applied.compareTo],
    queryFn: () => hrmsApi.get<{ success: boolean; data: { month: string; compare_to: string; summary: VarianceSummary; rows: VarianceRow[] } }>(
      `/payroll/variance?month=${applied.month}&compare_to=${applied.compareTo}`
    ).then(r => r.data),
    enabled: !!(applied.month && applied.compareTo),
  });

  const summary: VarianceSummary | null = data?.data?.summary ?? null;
  let rows: VarianceRow[] = data?.data?.rows ?? [];

  if (catFilter !== "ALL") rows = rows.filter(r => r.category === catFilter);
  if (searchQ.trim()) {
    const q = searchQ.toLowerCase();
    rows = rows.filter(r =>
      r.employee_name?.toLowerCase().includes(q) ||
      r.employee_code?.toLowerCase().includes(q) ||
      r.branch_name?.toLowerCase().includes(q)
    );
  }

  function exportCsv() {
    const allRows = data?.data?.rows ?? [];
    const hdr = ["Employee Code","Name","Branch","Department","Category","Prev Net","Curr Net","Delta Net","Delta%"];
    const lines = [hdr.join(","), ...allRows.map(r => [
      r.employee_code, r.employee_name, r.branch_name, r.department_name, r.category,
      r.prev_net ?? "", r.curr_net ?? "", r.delta_net, r.delta_pct ?? "",
    ].join(","))];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `payroll_variance_${applied.month}_vs_${applied.compareTo}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  return (
    <DashboardLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Payroll Variance Report</h1>
            <p className="text-slate-500 text-sm mt-0.5">Month-on-month payroll change analysis</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Label className="text-xs whitespace-nowrap">Current Month</Label>
              <Input type="month" value={month} onChange={e => setMonth(e.target.value)} className="w-36 h-8 text-sm" />
            </div>
            <div className="flex items-center gap-1.5">
              <Label className="text-xs whitespace-nowrap">Compare To</Label>
              <Input type="month" value={compareTo} onChange={e => setCompareTo(e.target.value)} className="w-36 h-8 text-sm" />
            </div>
            <Button size="sm" onClick={() => { setApplied({ month, compareTo }); }} disabled={isFetching}>
              {isFetching ? "Loading…" : "Compare"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="w-4 h-4" />
            </Button>
            {(data?.data?.rows?.length ?? 0) > 0 && (
              <Button variant="outline" size="sm" onClick={exportCsv}>
                <Download className="w-4 h-4 mr-1" />
                CSV
              </Button>
            )}
          </div>
        </div>

        {/* KPI Strip */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Net Bill (Current)", value: `₹${(summary.net_bill_current / 100000).toFixed(2)}L`, sub: applied.month },
              { label: "Net Bill (Previous)", value: `₹${(summary.net_bill_previous / 100000).toFixed(2)}L`, sub: applied.compareTo },
              {
                label: "Net Bill Delta",
                value: `${summary.delta_net_bill >= 0 ? "+" : ""}₹${(summary.delta_net_bill / 100000).toFixed(2)}L`,
                color: summary.delta_net_bill >= 0 ? "text-green-700" : "text-red-700",
              },
              { label: "Employees Changed", value: String(summary.changed + summary.new_joiners + summary.leavers), sub: `${summary.new_joiners} joined · ${summary.leavers} left` },
            ].map(k => (
              <Card key={k.label} className="py-4 text-center">
                <div className={`text-2xl font-bold ${k.color ?? "text-slate-900"}`}>{k.value}</div>
                <div className="text-slate-500 text-xs mt-0.5">{k.label}</div>
                {k.sub && <div className="text-slate-400 text-xs">{k.sub}</div>}
              </Card>
            ))}
          </div>
        )}

        {/* Category breakdown chips */}
        {summary?.breakdown && (
          <div className="flex flex-wrap gap-2">
            <button
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${catFilter === "ALL" ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"}`}
              onClick={() => setCatFilter("ALL")}
            >
              All ({data?.data?.rows?.length ?? 0})
            </button>
            {Object.entries(summary.breakdown).map(([cat, cnt]) => cnt > 0 && (
              <button
                key={cat}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${catFilter === cat ? "border-slate-700 ring-2 ring-slate-300" : "border-transparent"} ${CAT_COLORS[cat]}`}
                onClick={() => setCatFilter(catFilter === cat ? "ALL" : cat)}
              >
                {CAT_LABELS[cat] ?? cat} ({cnt})
              </button>
            ))}
          </div>
        )}

        {/* Search */}
        <Input
          placeholder="Search by name, code, or branch…"
          value={searchQ}
          onChange={e => setSearchQ(e.target.value)}
          className="max-w-sm"
        />

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-slate-400">Loading variance data…</div>
            ) : rows.length === 0 ? (
              <div className="p-8 text-center text-slate-400">No payroll data found. Ensure both months have completed payroll runs.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b sticky top-0">
                    <tr>
                      {["Employee", "Branch", "Category", `Prev Net (${applied.compareTo})`, `Curr Net (${applied.month})`, "Δ Net", "Breakdown"].map(h => (
                        <th key={h} className="px-4 py-3 text-left font-medium text-slate-600 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map(r => (
                      <tr key={r.employee_id} className={`hover:bg-slate-50/50 transition-colors ${r.category === "NO_CHANGE" ? "opacity-60" : ""}`}>
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-slate-900">{r.employee_name ?? "Unknown"}</div>
                          <div className="text-xs text-slate-400">{r.employee_code}</div>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-500">{r.branch_name ?? "—"}</td>
                        <td className="px-4 py-2.5">
                          <Badge variant="outline" className={`text-xs ${CAT_COLORS[r.category]}`}>
                            {CAT_LABELS[r.category] ?? r.category}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs">{r.prev_net != null ? `₹${fmtCur(r.prev_net)}` : "—"}</td>
                        <td className="px-4 py-2.5 font-mono text-xs">{r.curr_net != null ? `₹${fmtCur(r.curr_net)}` : "—"}</td>
                        <td className="px-4 py-2.5">
                          {r.category === "NO_CHANGE" ? (
                            <span className="text-slate-300"><Minus className="w-3 h-3" /></span>
                          ) : (
                            <DeltaCell delta={r.delta_net} pct={r.delta_pct} />
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-400 space-x-2 whitespace-nowrap">
                          {r.curr_incentive != null && r.curr_incentive > 0 && <span>Incentive: ₹{fmtCur(r.curr_incentive)}</span>}
                          {r.curr_tds != null && r.curr_tds > 0 && <span>TDS: ₹{fmtCur(r.curr_tds)}</span>}
                          {r.curr_pf != null && r.curr_pf > 0 && <span>PF: ₹{fmtCur(r.curr_pf)}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
