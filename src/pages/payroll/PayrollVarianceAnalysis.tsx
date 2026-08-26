/**
 * Payroll Variance Analysis — month-over-month reconciliation with anomaly categories.
 *
 * Surfaces `/api/payroll/variance`, which was mounted in app.ts but had no frontend
 * consumer at all. That API is strictly richer than the flat `payroll-variance` entry in
 * the report library (which stays where it is, untouched, at /payroll/variance):
 *
 *   - a headline reconciliation summary — net bill this month vs last, and the delta
 *   - eight anomaly categories (NEW_JOINER, LEAVER, SALARY_CHANGE, INCENTIVE_CHANGE,
 *     OVERTIME_CHANGE, STATUTORY_CHANGE, DEDUCTION_CHANGE, NO_CHANGE) rather than a
 *     single HIGH_VARIANCE flag
 *   - a per-employee component drill-down via /variance/employee/:id
 *
 * The report library answers "which employees moved"; this page answers "why did the
 * bill move, and does the movement reconcile" — which is the sign-off question.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, Download, RefreshCw,
  Search, TrendingUp, UserMinus, UserPlus, Users, Wallet,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Types — mirror backend/src/modules/payroll/payroll-variance.routes.ts
// ─────────────────────────────────────────────────────────────────────────────
type VarCategory =
  | "NEW_JOINER" | "LEAVER" | "SALARY_CHANGE" | "INCENTIVE_CHANGE"
  | "STATUTORY_CHANGE" | "DEDUCTION_CHANGE" | "OVERTIME_CHANGE" | "NO_CHANGE";

interface VarianceRow {
  employee_id: string;
  employee_code: string | null;
  employee_name: string | null;
  branch_name: string | null;
  department_name: string | null;
  designation_name: string | null;
  category: VarCategory;
  curr_gross: string | number | null;
  curr_net: string | number | null;
  curr_basic: string | number | null;
  curr_tds: string | number | null;
  curr_pf: number | null;
  curr_esic: number | null;
  curr_incentive: string | number | null;
  curr_ot: string | number | null;
  curr_ded: string | number | null;
  prev_net: string | number | null;
  prev_gross: string | number | null;
  prev_basic: string | number | null;
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
  breakdown: Partial<Record<VarCategory, number>>;
}

interface VarianceResponse {
  success: boolean;
  data: {
    month: string;
    compare_to: string;
    summary: VarianceSummary;
    rows: VarianceRow[];
  };
}

/** `spl.*` — raw salary_prep_line columns, so every field is optional by contract. */
interface PrepLine {
  run_month?: string;
  basic?: string | number;
  gross_salary?: string | number;
  net_salary?: string | number;
  pf_employee?: string | number;
  pf_employer?: string | number;
  esic_employee?: string | number;
  esic_employer?: string | number;
  tds?: string | number;
  professional_tax?: string | number;
  incentive_total?: string | number;
  overtime_amount?: string | number;
  total_deductions?: string | number;
  paid_working_days?: string | number;
  lwp_days?: string | number;
}

interface DrilldownResponse {
  success: boolean;
  data: { month: string; compare_to: string; current: PrepLine | null; previous: PrepLine | null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const inr = (v: unknown): string =>
  num(v).toLocaleString("en-IN", { maximumFractionDigits: 0 });

const signedInr = (v: number): string => `${v > 0 ? "+" : v < 0 ? "−" : ""}₹${inr(Math.abs(v))}`;

/** Previous calendar month of a YYYY-MM string. */
const prevMonthOf = (m: string): string => {
  const [y, mo] = m.split("-").map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
};

/**
 * Payroll runs in arrears — the current calendar month has no run until it closes, so
 * defaulting to "this month" would open the page on an empty comparison every time.
 */
const defaultMonth = (): string => prevMonthOf(new Date().toISOString().slice(0, 7));

const monthOptions = (count = 18): string[] => {
  const out: string[] = [];
  let m = defaultMonth();
  for (let i = 0; i < count; i++) { out.push(m); m = prevMonthOf(m); }
  return out;
};

const CATEGORY_META: Record<VarCategory, { label: string; className: string }> = {
  NEW_JOINER:       { label: "New Joiner",      className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  LEAVER:           { label: "Leaver",          className: "bg-rose-100 text-rose-800 border-rose-200" },
  SALARY_CHANGE:    { label: "Salary Change",   className: "bg-amber-100 text-amber-800 border-amber-200" },
  INCENTIVE_CHANGE: { label: "Incentive",       className: "bg-violet-100 text-violet-800 border-violet-200" },
  OVERTIME_CHANGE:  { label: "Overtime",        className: "bg-sky-100 text-sky-800 border-sky-200" },
  STATUTORY_CHANGE: { label: "Statutory",       className: "bg-indigo-100 text-indigo-800 border-indigo-200" },
  DEDUCTION_CHANGE: { label: "Deduction",       className: "bg-orange-100 text-orange-800 border-orange-200" },
  NO_CHANGE:        { label: "No Change",       className: "bg-slate-100 text-slate-600 border-slate-200" },
};

const CATEGORY_ORDER: VarCategory[] = [
  "NEW_JOINER", "LEAVER", "SALARY_CHANGE", "INCENTIVE_CHANGE",
  "OVERTIME_CHANGE", "STATUTORY_CHANGE", "DEDUCTION_CHANGE", "NO_CHANGE",
];

// ─────────────────────────────────────────────────────────────────────────────
// Summary cards
// ─────────────────────────────────────────────────────────────────────────────
function SummaryCards({ s, month, compareTo }: { s: VarianceSummary; month: string; compareTo: string }) {
  const up = s.delta_net_bill > 0;
  const headDelta = s.total_employees_current - s.total_employees_previous;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Card className="border-l-4 border-l-slate-700">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <Wallet className="h-3.5 w-3.5" /> Net Bill Movement
          </div>
          <p className={`mt-1 text-2xl font-black ${up ? "text-rose-700" : "text-emerald-700"}`}>
            {signedInr(s.delta_net_bill)}
          </p>
          <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
            {up ? <ArrowUpRight className="h-3 w-3 text-rose-600" /> : <ArrowDownRight className="h-3 w-3 text-emerald-600" />}
            ₹{inr(s.net_bill_previous)} <span className="text-slate-400">({compareTo})</span>
            {" → "}
            ₹{inr(s.net_bill_current)} <span className="text-slate-400">({month})</span>
          </p>
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-blue-600">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <Users className="h-3.5 w-3.5" /> Headcount Paid
          </div>
          <p className="mt-1 text-2xl font-black text-slate-800">{s.total_employees_current}</p>
          <p className="mt-1 text-xs text-slate-500">
            {s.total_employees_previous} last month
            <span className={headDelta === 0 ? "text-slate-400" : headDelta > 0 ? "text-emerald-700" : "text-rose-700"}>
              {" "}({headDelta > 0 ? "+" : ""}{headDelta})
            </span>
          </p>
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-emerald-600">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <UserPlus className="h-3.5 w-3.5" /> New Joiners
          </div>
          <p className="mt-1 text-2xl font-black text-emerald-700">{s.new_joiners}</p>
          <p className="mt-1 text-xs text-slate-500">Paid this month, not last</p>
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-rose-600">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <UserMinus className="h-3.5 w-3.5" /> Leavers
          </div>
          <p className="mt-1 text-2xl font-black text-rose-700">{s.leavers}</p>
          <p className="mt-1 text-xs text-slate-500">Paid last month, not this</p>
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Drill-down dialog
// ─────────────────────────────────────────────────────────────────────────────
const COMPONENTS: Array<{ key: keyof PrepLine; label: string; money: boolean }> = [
  { key: "basic",             label: "Basic",             money: true },
  { key: "gross_salary",      label: "Gross",             money: true },
  { key: "incentive_total",   label: "Incentive",         money: true },
  { key: "overtime_amount",   label: "Overtime",          money: true },
  { key: "pf_employee",       label: "PF (Employee)",     money: true },
  { key: "pf_employer",       label: "PF (Employer)",     money: true },
  { key: "esic_employee",     label: "ESIC (Employee)",   money: true },
  { key: "esic_employer",     label: "ESIC (Employer)",   money: true },
  { key: "professional_tax",  label: "Professional Tax",  money: true },
  { key: "tds",               label: "TDS",               money: true },
  { key: "total_deductions",  label: "Total Deductions",  money: true },
  { key: "paid_working_days", label: "Paid Working Days", money: false },
  { key: "lwp_days",          label: "LWP Days",          money: false },
  { key: "net_salary",        label: "Net Salary",        money: true },
];

function DrilldownDialog({
  row, month, compareTo, onClose,
}: { row: VarianceRow | null; month: string; compareTo: string; onClose: () => void }) {
  const { data, isLoading, isError } = useQuery<DrilldownResponse>({
    queryKey: ["payroll-variance-employee", row?.employee_id, month, compareTo],
    queryFn: () => hrmsApi.get<DrilldownResponse>(
      `/api/payroll/variance/employee/${row!.employee_id}?month=${month}&compare_to=${compareTo}`,
    ),
    enabled: !!row,
    staleTime: 30_000,
  });

  const curr = data?.data?.current ?? null;
  const prev = data?.data?.previous ?? null;

  return (
    <Dialog open={!!row} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span>{row?.employee_name ?? "—"}</span>
            <span className="font-mono text-xs text-slate-500">{row?.employee_code ?? ""}</span>
            {row && (
              <Badge variant="outline" className={CATEGORY_META[row.category].className}>
                {CATEGORY_META[row.category].label}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs text-slate-500">
          {row?.branch_name ?? "—"} · {row?.department_name ?? "—"} · {row?.designation_name ?? "—"}
        </p>

        {isLoading && <div className="py-10 text-center text-sm text-slate-400 animate-pulse">Loading breakdown…</div>}
        {isError && <div className="py-10 text-center text-sm text-rose-600">Failed to load component breakdown.</div>}

        {!isLoading && !isError && (
          <div className="mt-2 max-h-[55vh] overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Component</th>
                  <th className="px-3 py-2 text-right font-semibold">{compareTo}</th>
                  <th className="px-3 py-2 text-right font-semibold">{month}</th>
                  <th className="px-3 py-2 text-right font-semibold">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {COMPONENTS.map(({ key, label, money }) => {
                  const p = num(prev?.[key]);
                  const c = num(curr?.[key]);
                  const d = c - p;
                  if (p === 0 && c === 0) return null;
                  const isNet = key === "net_salary";
                  return (
                    <tr key={String(key)} className={isNet ? "bg-slate-50 font-bold" : ""}>
                      <td className="px-3 py-2 text-slate-700">{label}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                        {money ? `₹${inr(p)}` : p}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-800">
                        {money ? `₹${inr(c)}` : c}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums font-semibold ${
                        d === 0 ? "text-slate-400" : d > 0 ? "text-emerald-700" : "text-rose-700"
                      }`}>
                        {d === 0 ? "—" : money ? signedInr(d) : `${d > 0 ? "+" : ""}${d}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!curr && !prev && (
              <p className="px-3 py-8 text-center text-sm text-slate-400">
                No payroll lines found for this employee in either month.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────
export default function PayrollVarianceAnalysis() {
  const months = useMemo(() => monthOptions(), []);
  const [month, setMonth] = useState<string>(months[0]);
  const [compareTo, setCompareTo] = useState<string>(prevMonthOf(months[0]));
  const [category, setCategory] = useState<VarCategory | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<VarianceRow | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<VarianceResponse>({
    queryKey: ["payroll-variance", month, compareTo],
    queryFn: () => hrmsApi.get<VarianceResponse>(
      `/api/payroll/variance?month=${month}&compare_to=${compareTo}`,
    ),
    staleTime: 60_000,
  });

  const summary = data?.data?.summary ?? null;
  const rows = useMemo(() => data?.data?.rows ?? [], [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (category !== "ALL" && r.category !== category) return false;
      if (!q) return true;
      return (r.employee_name ?? "").toLowerCase().includes(q)
          || (r.employee_code ?? "").toLowerCase().includes(q)
          || (r.branch_name ?? "").toLowerCase().includes(q);
    });
  }, [rows, category, search]);

  const exportCsv = () => {
    const head = [
      "Employee Code", "Employee Name", "Branch", "Department", "Designation",
      "Category", `Net ${compareTo}`, `Net ${month}`, "Delta", "Delta %",
    ];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const body = filtered.map((r) => [
      r.employee_code, r.employee_name, r.branch_name, r.department_name, r.designation_name,
      CATEGORY_META[r.category].label, num(r.prev_net), num(r.curr_net), r.delta_net,
      r.delta_pct ?? "",
    ].map(esc).join(","));
    const blob = new Blob([[head.map(esc).join(","), ...body].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payroll-variance_${month}_vs_${compareTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <DashboardLayout>
      <div className="space-y-5 p-1">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-black text-slate-900">
              <TrendingUp className="h-6 w-6 text-blue-600" />
              Payroll Variance Analysis
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Month-over-month reconciliation of the payroll bill, with per-employee anomaly
              categories and component drill-down.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="pv-month" className="text-xs font-semibold text-slate-500">Month</label>
              <select
                id="pv-month"
                className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"
                value={month}
                onChange={(e) => { setMonth(e.target.value); setCompareTo(prevMonthOf(e.target.value)); }}
              >
                {months.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="pv-compare" className="text-xs font-semibold text-slate-500">Compare to</label>
              <select
                id="pv-compare"
                className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"
                value={compareTo}
                onChange={(e) => setCompareTo(e.target.value)}
              >
                {months.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filtered.length}>
              <Download className="mr-2 h-4 w-4" /> Export CSV
            </Button>
          </div>
        </div>

        {isError && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <p className="font-semibold text-amber-900">Could not load variance data</p>
              <p className="mt-1 text-sm text-amber-800">
                {String((error as Error)?.message ?? "Request failed.")} This page needs one of the
                admin, super_admin, finance, payroll or payroll_head roles.
              </p>
            </div>
          </div>
        )}

        {isLoading && (
          <div className="py-20 text-center text-sm text-slate-400 animate-pulse">
            Loading variance for {month} vs {compareTo}…
          </div>
        )}

        {!isLoading && !isError && summary && (
          <>
            <SummaryCards s={summary} month={month} compareTo={compareTo} />

            {/* Category filter + search */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setCategory("ALL")}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                  category === "ALL"
                    ? "border-slate-800 bg-slate-800 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                All ({rows.length})
              </button>
              {CATEGORY_ORDER.filter((c) => (summary.breakdown[c] ?? 0) > 0).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(category === c ? "ALL" : c)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    category === c
                      ? "border-slate-800 bg-slate-800 text-white"
                      : `${CATEGORY_META[c].className} hover:opacity-80`
                  }`}
                >
                  {CATEGORY_META[c].label} ({summary.breakdown[c]})
                </button>
              ))}
              <div className="relative ml-auto">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  className="h-9 w-64 pl-9"
                  placeholder="Search name, code or branch…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            {/* Table */}
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="max-h-[60vh] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2.5 text-left font-semibold">Employee</th>
                      <th className="px-3 py-2.5 text-left font-semibold">Branch</th>
                      <th className="px-3 py-2.5 text-left font-semibold">Category</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Net {compareTo}</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Net {month}</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Change</th>
                      <th className="px-3 py-2.5 text-right font-semibold">%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filtered.map((r) => (
                      <tr
                        key={r.employee_id}
                        className="cursor-pointer hover:bg-blue-50/60"
                        onClick={() => setSelected(r)}
                      >
                        <td className="px-3 py-2">
                          <div className="font-semibold text-slate-800">{r.employee_name ?? "—"}</div>
                          <div className="font-mono text-xs text-slate-400">{r.employee_code ?? "—"}</div>
                        </td>
                        <td className="px-3 py-2 text-slate-600">{r.branch_name ?? "—"}</td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className={CATEGORY_META[r.category].className}>
                            {CATEGORY_META[r.category].label}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                          {r.prev_net === null ? "—" : `₹${inr(r.prev_net)}`}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-800">
                          {r.curr_net === null ? "—" : `₹${inr(r.curr_net)}`}
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums font-semibold ${
                          r.delta_net === 0 ? "text-slate-400" : r.delta_net > 0 ? "text-emerald-700" : "text-rose-700"
                        }`}>
                          {r.delta_net === 0 ? "—" : signedInr(r.delta_net)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                          {r.delta_pct === null ? "—" : `${r.delta_pct > 0 ? "+" : ""}${r.delta_pct}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!filtered.length && (
                  <p className="py-12 text-center text-sm text-slate-400">
                    No employees match the current filter.
                  </p>
                )}
              </div>
              <div className="border-t border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                Showing {filtered.length} of {rows.length} employees · {month} vs {compareTo}
              </div>
            </div>
          </>
        )}
      </div>

      <DrilldownDialog
        row={selected}
        month={month}
        compareTo={compareTo}
        onClose={() => setSelected(null)}
      />
    </DashboardLayout>
  );
}
