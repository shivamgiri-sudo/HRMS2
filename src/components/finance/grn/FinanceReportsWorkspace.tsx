import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileClock, FileSpreadsheet, Search, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MonthYearPicker } from "@/components/finance/MonthYearPicker";
import { hrmsApi } from "@/lib/hrmsApi";
import { useToast } from "@/hooks/use-toast";
import { formatDateDDMMYYYY, formatDateTimeDDMMYYYY } from "@/lib/date-format";

/**
 * Finance reports for GRN Management.
 *
 * THE FINANCE MONTH IS THE ACCOUNTING PERIOD, NOT THE BILL DATE.
 * A July-booked invoice dated in August reports under July, because accounting_period is what
 * P&L, budget consumption and the period lock all read. The legacy sheet this replaces already
 * behaved that way — its Finance Month column reads "Jul" beside a Bill Date of 03-05-2026 —
 * and the Month filter here therefore filters accounting_period. Bill Date is shown as its own
 * column so both facts are visible at once and neither is mistaken for the other.
 *
 * Three reports rather than one, because the old system only had the first and the two missing
 * ones are the questions people actually had to ask a developer for:
 *   Register     — the legacy Imprest Report columns, plus workflow facts it could not carry.
 *   Audit Trail  — who did what to which GRN, from finance_approval_event.
 *   Top-ups      — every budget increase request across branches and months, with ageing.
 */

type ReportKey = "register" | "audit" | "topups";

type Filters = {
  branchId: string;
  financialYear: string;
  month: string;
  head: string;
  subHead: string;
  expenseMode: string;
  grnNumber: string;
  status: string;
  pendingWith: string;
  entityType: string;
  action: string;
  from: string;
  to: string;
};

const EMPTY: Filters = {
  branchId: "", financialYear: "", month: "", head: "", subHead: "",
  expenseMode: "", grnNumber: "", status: "", pendingWith: "",
  entityType: "", action: "", from: "", to: "",
};

const REPORTS: Array<{ key: ReportKey; label: string; icon: typeof Search; endpoint: string; hint: string }> = [
  {
    key: "register", label: "GRN Register", icon: FileSpreadsheet, endpoint: "register",
    hint: "Every GRN for the selected finance month, with its GST split, dates and payment.",
  },
  {
    key: "audit", label: "Audit Trail", icon: FileClock, endpoint: "audit-trail",
    hint: "Every recorded action on a GRN or budget top-up — who, when, from which status to which.",
  },
  {
    key: "topups", label: "Top-up Requests", icon: TrendingUp, endpoint: "topups",
    hint: "Budget increase requests across all branches and months in your scope, with ageing.",
  },
];

const money = (value: unknown) =>
  Number(value ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const date = (value: unknown) => formatDateDDMMYYYY(value);

const dateTime = (value: unknown) => formatDateTimeDDMMYYYY(value) ?? "—";

/** "2026-08" -> "Aug 2026". The month a finance reader thinks in, not the code. */
function monthLabel(period: unknown) {
  const raw = String(period ?? "");
  if (!/^\d{4}-\d{2}$/.test(raw)) return raw || "—";
  const [year, month] = raw.split("-").map(Number);
  return `${new Date(year, month - 1, 1).toLocaleString("en-IN", { month: "short" })} ${year}`;
}

/** Financial year from a YYYY-MM period — April to March, the same rule the budgets use. */
function financialYearOf(period: string) {
  if (!/^\d{4}-\d{2}$/.test(period)) return "";
  const [year, month] = period.split("-").map(Number);
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * CSV, built from the same rows and column definitions the table renders.
 *
 * Deriving the export from the table's own columns is the point: an export that builds its own
 * column list drifts from the screen, and the first anyone knows is a reconciliation that will
 * not tie. Quotes are doubled and every field is quoted, so a description containing a comma or
 * a newline — which they routinely do — cannot shift every later column by one.
 */
function toCsv(columns: Column[], rows: any[]) {
  const cell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const header = columns.map((column) => cell(column.label)).join(",");
  const body = rows.map((row, index) =>
    columns.map((column) => cell(column.csv ? column.csv(row, index) : column.render(row, index))).join(","),
  );
  return [header, ...body].join("\r\n");
}

type Column = {
  label: string;
  render: (row: any, index: number) => any;
  /** Plain value for the CSV when render() returns markup. */
  csv?: (row: any, index: number) => string;
  numeric?: boolean;
};

const REGISTER_COLUMNS: Column[] = [
  { label: "S.No.", render: (_row, index) => index + 1, numeric: true },
  { label: "GRN", render: (row) => row.grn_number ?? "—" },
  { label: "Branch", render: (row) => row.branch_name ?? "—" },
  // The column the whole report turns on. Named "Finance Month" exactly as the legacy sheet does.
  { label: "Finance Month", render: (row) => monthLabel(row.accounting_period) },
  { label: "Exp. Type", render: (row) => row.vendor_name ?? "—" },
  { label: "Year Month", render: (row) => row.financial_year ?? "—" },
  { label: "Exp. Head", render: (row) => row.head ?? "—" },
  { label: "Exp. SubHead", render: (row) => row.sub_head ?? "—" },
  { label: "Description", render: (row) => row.description ?? row.remarks ?? "—" },
  { label: "Invoice No.", render: (row) => row.invoice_number ?? "—" },
  { label: "Amount", render: (row) => money(row.amount_without_tax), numeric: true },
  { label: "CGST", render: (row) => money(row.cgst_amount), numeric: true },
  { label: "SGST", render: (row) => money(row.sgst_amount), numeric: true },
  { label: "IGST", render: (row) => money(row.igst_amount), numeric: true },
  { label: "Total", render: (row) => money(row.amount_with_tax), numeric: true },
  { label: "Grn Date", render: (row) => date(row.grn_date) },
  { label: "Approval Date", render: (row) => date(row.approval_date) },
  { label: "Bill Date", render: (row) => date(row.bill_date) },
  { label: "Due Date", render: (row) => date(row.due_date) },
  { label: "Payment Date", render: (row) => date(row.payment_date) },
  { label: "TDS Deduct", render: (row) => money(row.tds_deducted_amount), numeric: true },
  { label: "Mode", render: (row) => row.expense_mode ?? "—" },
  { label: "Status", render: (row) => String(row.status ?? "").replace(/_/g, " ") },
  // Everything below this line is new. The legacy sheet came out of a system with no approval
  // chain, so it could not say who a document was waiting on or how long it had been waiting —
  // which is the first question anyone asks of a month's register.
  { label: "Pending With", render: (row) => row.pending_with ?? "—" },
  { label: "Ageing (days)", render: (row) => (row.ageing_days == null ? "—" : row.ageing_days), numeric: true },
  { label: "Raised By", render: (row) => row.raised_by_name || "—" },
  { label: "Cost Centre", render: (row) => row.cost_centre_name ?? "—" },
  { label: "Unbudgeted", render: (row) => (Number(row.is_unbudgeted) ? "Yes" : "No") },
  { label: "Late Invoice", render: (row) => (Number(row.is_late_invoice) ? "Yes" : "No") },
  { label: "Multi-month", render: (row) => (Number(row.is_multi_month) ? "Yes" : "No") },
  // Honest about provenance: an allocated split is recorded, a derived one is inferred from
  // gst_type because the migrated row never carried a split of its own.
  { label: "GST Split", render: (row) => row.gst_split_source ?? "—" },
];

const AUDIT_COLUMNS: Column[] = [
  { label: "S.No.", render: (_row, index) => index + 1, numeric: true },
  { label: "When", render: (row) => dateTime(row.created_at) },
  { label: "Entity", render: (row) => String(row.entity_type ?? "").replace(/_/g, " ") },
  { label: "Reference", render: (row) => row.reference ?? "—" },
  { label: "Branch", render: (row) => row.branch_name ?? "—" },
  { label: "Finance Month", render: (row) => monthLabel(row.finance_month) },
  { label: "Action", render: (row) => row.action ?? "—" },
  { label: "From", render: (row) => String(row.from_status ?? "—").replace(/_/g, " ") },
  { label: "To", render: (row) => String(row.to_status ?? "—").replace(/_/g, " ") },
  { label: "Stage Role", render: (row) => String(row.actor_role ?? "—").replace(/_/g, " ") },
  { label: "By", render: (row) => row.actor_name ?? "—" },
  { label: "Head", render: (row) => row.head ?? "—" },
  { label: "Amount", render: (row) => money(row.amount), numeric: true },
  { label: "Remarks", render: (row) => row.remarks ?? "—" },
];

const TOPUP_COLUMNS: Column[] = [
  { label: "S.No.", render: (_row, index) => index + 1, numeric: true },
  { label: "Raised", render: (row) => date(row.created_at) },
  { label: "Branch", render: (row) => row.branch_name ?? "—" },
  { label: "Finance Month", render: (row) => monthLabel(row.finance_month) },
  { label: "Budget", render: (row) => row.budget_number ?? "—" },
  { label: "Exp. Head", render: (row) => row.head ?? "—" },
  { label: "Exp. SubHead", render: (row) => row.sub_head ?? "—" },
  { label: "Item", render: (row) => row.item_name ?? "—" },
  { label: "Requested", render: (row) => money(row.requested_amount), numeric: true },
  { label: "Units", render: (row) => Number(row.requested_quantity ?? 0), numeric: true },
  { label: "Reason", render: (row) => row.reason ?? "—" },
  { label: "Status", render: (row) => String(row.status ?? "").replace(/_/g, " ") },
  { label: "Pending With", render: (row) => row.pending_with ?? "—" },
  { label: "Ageing (days)", render: (row) => (row.ageing_days == null ? "—" : row.ageing_days), numeric: true },
  { label: "Raised By", render: (row) => row.requested_by_name ?? "—" },
  { label: "Applied", render: (row) => date(row.applied_at) },
  { label: "Rejection Reason", render: (row) => row.rejection_reason ?? "—" },
];

const COLUMNS: Record<ReportKey, Column[]> = {
  register: REGISTER_COLUMNS,
  audit: AUDIT_COLUMNS,
  topups: TOPUP_COLUMNS,
};

export function FinanceReportsWorkspace() {
  const { toast } = useToast();
  const [report, setReport] = useState<ReportKey>("register");
  const [draft, setDraft] = useState<Filters>({ ...EMPTY, month: currentPeriod() });
  // Applied separately from the draft so typing in a filter does not refetch on every keystroke.
  // The legacy screen had an explicit Show button for the same reason and people expect it.
  const [applied, setApplied] = useState<Filters>({ ...EMPTY, month: currentPeriod() });
  const [ran, setRan] = useState(false);

  const branches = useQuery({
    queryKey: ["org-branches"],
    queryFn: async () => {
      const response = await hrmsApi.get<any>("/api/org/branches?limit=200");
      return ((response as any)?.data?.data ?? (response as any)?.data ?? []) as Array<{
        id: string; branch_name: string;
      }>;
    },
    staleTime: 5 * 60 * 1000,
  });

  /** Heads, sub-heads and periods that actually occur in the caller's own scope. */
  const options = useQuery({
    queryKey: ["grn-report-filters", applied.branchId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (applied.branchId) params.set("branchId", applied.branchId);
      const response = await hrmsApi.get<any>(`/api/finance/grn-reports/filters?${params}`);
      return (response as any)?.data ?? { heads: [], financialYears: [], periods: [] };
    },
    staleTime: 5 * 60 * 1000,
  });

  const active = REPORTS.find((item) => item.key === report)!;

  const results = useQuery({
    queryKey: ["grn-report", report, applied],
    enabled: ran,
    // Never auto-retry a timed-out report query. Each retry runs the same expensive query
    // again, and three concurrent 30-second queries exhaust the DB connection pool and
    // make unrelated endpoints return 500. Show the error immediately instead.
    retry: 0,
    queryFn: async () => {
      const params = new URLSearchParams();
      const add = (key: string, value: string) => { if (value) params.set(key, value); };
      add("branchId", applied.branchId);
      add("financialYear", applied.financialYear);
      add("month", applied.month);
      add("head", applied.head);
      add("subHead", applied.subHead);
      add("pendingWith", applied.pendingWith);
      add("status", applied.status);
      if (report === "register") {
        add("expenseMode", applied.expenseMode);
        add("grnNumber", applied.grnNumber);
      }
      if (report === "audit") {
        add("entityType", applied.entityType);
        add("action", applied.action);
        add("from", applied.from);
        add("to", applied.to);
      }
      // 90-second timeout: finance reports scan a large table and the all-branches scope
      // for super_admin can take longer than the default 30s on first run.
      const response = await hrmsApi.get<any>(`/api/finance/grn-reports/${active.endpoint}?${params}`, 90_000);
      return response as { rows: any[]; totals?: any; truncated?: boolean; limit?: number };
    },
  });

  const rows = results.data?.rows ?? [];
  const columns = COLUMNS[report];
  const subHeadOptions = useMemo(
    () => options.data?.heads?.find((entry: any) => entry.head === draft.head)?.subHeads ?? [],
    [options.data, draft.head],
  );

  const set = (key: keyof Filters) => (value: string) =>
    setDraft((current) => ({
      ...current,
      [key]: value,
      // Changing the head invalidates whatever sub-head was chosen under the previous one.
      ...(key === "head" ? { subHead: "" } : {}),
      // The FY is implied by the month; keeping a contradictory pair returns nothing at all.
      ...(key === "month" && value ? { financialYear: financialYearOf(value) } : {}),
    }));

  const show = () => { setApplied(draft); setRan(true); };

  const exportCsv = () => {
    if (!rows.length) {
      toast({ title: "Nothing to export", description: "Run the report first.", variant: "destructive" });
      return;
    }
    const csv = toCsv(columns, rows);
    const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${report}-${applied.month || "all"}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <Card className="rounded-2xl border-slate-200">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">Finance reports</CardTitle>
            <div className="flex flex-wrap gap-1.5">
              {REPORTS.map((item) => {
                const Icon = item.icon;
                return (
                  <Button
                    key={item.key}
                    size="sm"
                    variant={report === item.key ? "default" : "outline"}
                    onClick={() => { setReport(item.key); setRan(false); }}
                  >
                    <Icon className="mr-1.5 h-3.5 w-3.5" />{item.label}
                  </Button>
                );
              })}
            </div>
          </div>
          <p className="mt-1 text-xs text-slate-500">{active.hint}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-xs">Branch</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={draft.branchId}
                onChange={(event) => set("branchId")(event.target.value)}
              >
                <option value="">All branches in my scope</option>
                {(branches.data ?? []).map((branch) => (
                  <option key={branch.id} value={branch.id}>{branch.branch_name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              {/* Named "Finance Month" and not "Month", because it is not the invoice's month.
                  This label is the difference between a reader trusting the report and quietly
                  reconciling it against a bill-date view that will never tie. */}
              <Label className="text-xs">Finance Month (accounting period)</Label>
              {/* MonthYearPicker, not <input type="month">: Safari has never implemented the
                  native control and degrades it to a bare text box, which reads as "the month
                  filter is broken" rather than as a browser gap. Same shared component the
                  Branch Budget workspace uses; src/tests/finance-month-picker.contract.test.ts
                  enforces this across every finance page. */}
              <MonthYearPicker
                value={draft.month}
                onChange={set("month")}
                className="w-full"
                selectClassName="h-9"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Financial Year</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={draft.financialYear}
                onChange={(event) => set("financialYear")(event.target.value)}
              >
                <option value="">Any</option>
                {(options.data?.financialYears ?? []).map((year: string) => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Exp. Head</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={draft.head}
                onChange={(event) => set("head")(event.target.value)}
              >
                <option value="">All</option>
                {(options.data?.heads ?? []).map((entry: any) => (
                  <option key={entry.head} value={entry.head}>{entry.head}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Exp. Sub Head</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={draft.subHead}
                disabled={!draft.head}
                onChange={(event) => set("subHead")(event.target.value)}
              >
                <option value="">All</option>
                {subHeadOptions.map((subHead: string) => (
                  <option key={subHead} value={subHead}>{subHead}</option>
                ))}
              </select>
            </div>

            {report === "register" && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">Expense Mode</Label>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={draft.expenseMode}
                    onChange={(event) => set("expenseMode")(event.target.value)}
                  >
                    <option value="">All</option>
                    <option value="imprest">Imprest</option>
                    <option value="non_imprest">Non Imprest</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">GRN No.</Label>
                  <Input
                    className="h-9"
                    placeholder="GrnNo"
                    value={draft.grnNumber}
                    onChange={(event) => set("grnNumber")(event.target.value)}
                  />
                </div>
              </>
            )}

            {report === "audit" && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">Entity</Label>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={draft.entityType}
                    onChange={(event) => set("entityType")(event.target.value)}
                  >
                    <option value="">GRN and top-ups</option>
                    <option value="grn">GRN only</option>
                    <option value="budget_topup">Budget top-up only</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Action</Label>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={draft.action}
                    onChange={(event) => set("action")(event.target.value)}
                  >
                    <option value="">Any action</option>
                    {["create", "submit", "approve", "reject", "return", "resubmit", "cancel", "reverse", "billing_cycle_set"].map((action) => (
                      <option key={action} value={action}>{action.replace(/_/g, " ")}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Acted from</Label>
                  <Input type="date" className="h-9" value={draft.from} onChange={(event) => set("from")(event.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Acted to</Label>
                  <Input type="date" className="h-9" value={draft.to} onChange={(event) => set("to")(event.target.value)} />
                </div>
              </>
            )}

            {report !== "audit" && (
              <div className="space-y-1">
                <Label className="text-xs">Pending with</Label>
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={draft.pendingWith}
                  onChange={(event) => set("pendingWith")(event.target.value)}
                >
                  <option value="">Any</option>
                  <option value="branch_head">Branch Head</option>
                  <option value="finance_head">Finance Head</option>
                </select>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={show} disabled={results.isFetching}>
              <Search className="mr-1.5 h-3.5 w-3.5" />{results.isFetching ? "Loading…" : "Show"}
            </Button>
            <Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows.length}>
              <Download className="mr-1.5 h-3.5 w-3.5" />Export
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setDraft({ ...EMPTY, month: currentPeriod() }); setRan(false); }}
            >
              Reset
            </Button>
            {applied.month && ran && (
              <Badge variant="outline" className="ml-1">
                Finance Month {monthLabel(applied.month)}
              </Badge>
            )}
          </div>

          {/* Stated in the UI, not only in a comment: this is the rule most likely to be
              misread, and misreading it silently produces two different totals for one month. */}
          <p className="text-xs text-slate-500">
            Finance Month is the <strong>accounting period</strong> the GRN books into, not the invoice
            date. An invoice raised in Aug'26 but booked to Jul'26 appears under Jul'26 here, with its
            own Bill Date shown separately.
          </p>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-slate-200">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">
            Details{rows.length ? ` — ${rows.length} row${rows.length === 1 ? "" : "s"}` : ""}
          </CardTitle>
          {results.data?.truncated && (
            // Never let a capped result read as a complete one: a silently truncated report is
            // a wrong total that looks like a right one.
            <Badge variant="destructive">
              Showing the first {results.data.limit} — narrow the filters
            </Badge>
          )}
        </CardHeader>
        <CardContent>
          {!ran ? (
            <p className="py-10 text-center text-sm text-slate-500">
              Choose a Finance Month and press Show.
            </p>
          ) : results.isFetching ? (
            <p className="py-10 text-center text-sm text-slate-500">Building the report…</p>
          ) : results.isError ? (
            <p className="py-10 text-center text-sm text-rose-600">
              {(results.error as Error)?.message || "The report could not be built."}
            </p>
          ) : !rows.length ? (
            <p className="py-10 text-center text-sm text-slate-500">
              No rows for these filters. Finance Month filters the accounting period — a GRN billed
              this month but booked to another will sit under that other month.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    {columns.map((column) => (
                      <th
                        key={column.label}
                        className={`whitespace-nowrap px-2 py-2 font-semibold text-slate-700 ${column.numeric ? "text-right" : "text-left"}`}
                      >
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={row.id ?? index} className="border-b border-slate-100 hover:bg-slate-50/60">
                      {columns.map((column) => (
                        <td
                          key={column.label}
                          className={`px-2 py-1.5 align-top ${column.numeric ? "text-right tabular-nums" : "text-left"}`}
                        >
                          {column.render(row, index)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {results.data?.totals && report === "register" && (
                  <tfoot>
                    {/* Totals are computed server-side from the rows actually returned, so the
                        footer cannot claim more than the table shows. */}
                    <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                      {columns.map((column) => {
                        const map: Record<string, unknown> = {
                          "S.No.": "",
                          GRN: "Total",
                          Amount: money(results.data.totals.amountWithoutTax),
                          CGST: money(results.data.totals.cgstAmount),
                          SGST: money(results.data.totals.sgstAmount),
                          IGST: money(results.data.totals.igstAmount),
                          Total: money(results.data.totals.amountWithTax),
                          "TDS Deduct": money(results.data.totals.tdsDeducted),
                        };
                        return (
                          <td
                            key={column.label}
                            className={`px-2 py-2 ${column.numeric ? "text-right tabular-nums" : "text-left"}`}
                          >
                            {(map[column.label] as any) ?? ""}
                          </td>
                        );
                      })}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
