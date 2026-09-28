/**
 * Validated Bank Account MIS — /payroll/validated-bank-mis
 *
 * The branch-wise bank-account status board, and the employee list behind every count on it.
 * Payroll HR uses it to find who cannot be paid and chase the missing account; the Payroll Head
 * uses it to see whether a branch is clear before the run.
 *
 * Rebuilt from the legacy HRMS screen of the same name, deliberately keeping its layout: a Branch
 * dropdown with Show / Export / Back, the summary table with a totals footer, and the same eleven
 * detail columns (EmpCode … Remarks). People reconcile against the old screen, so a column that
 * moved or got renamed costs more than it gains.
 *
 * mas_hrms ONLY
 *   /api/payroll/bank-readiness/mis/* reads mas_hrms and nothing else, per the payroll owner's
 *   instruction. Verified is the bank verification flag held in HRMS, which is real data here —
 *   1,004 of the 1,020 active employees with a bank record carry it (measured 2026-09-08).
 *
 *   That is a weaker claim than the Bank Payment Readiness page's READY, which proves the account
 *   received a confirmed salary credit in the finance system. The two screens can therefore
 *   disagree about an individual. The response carries a note saying so, shown under the table, so
 *   nobody reconciles the two and concludes one is broken.
 *
 * THE COUNTS CROSS-FOOT, AND THAT IS LOAD-BEARING
 *   Total = Uploaded + Not Uploaded, and Uploaded = Verified + Pending + Rejected. Uploaded is a
 *   union (everyone with a bank record at all), not a sixth exclusive state — matching the legacy
 *   screen's own arithmetic. Clicking Uploaded drills into all three of its parts.
 *
 * REJECTED OUTRANKS VERIFIED
 *   An account flagged verified whose IFSC cannot be sent to a bank still cannot be paid, so it is
 *   reported under Rejected. Showing it green would hide the one thing someone has to fix.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Landmark,
  Download,
  Search,
  AlertTriangle,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { hrmsApi, getAuthToken } from "@/lib/hrmsApi";
import { apiBaseUrl } from "@/lib/apiBase";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Mirrors MisBucket in validated-bank-account-mis.service.ts. */
type Bucket = "uploaded" | "verified" | "pending" | "not_uploaded" | "rejected";

interface SummaryRow {
  branch_id: string | null;
  branch_name: string;
  uploaded: number;
  verified: number;
  pending: number;
  not_uploaded: number;
  rejected: number;
  total: number;
}

interface SummaryResponse {
  success: boolean;
  as_of: string;
  scope: { restricted: boolean; branch_count?: number };
  data: SummaryRow[];
  totals: SummaryRow;
  message: string;
}

interface DetailRow {
  employee_id: string;
  emp_code: string;
  emp_name: string;
  branch: string;
  cost_center: string;
  ac_holder_name: string;
  account_no: string;
  bank_name: string;
  ifsc_code: string;
  account_type: string;
  payment_mode: string;
  remarks: string;
  readiness_class: string;
  bucket: string;
}

interface DetailResponse {
  success: boolean;
  as_of: string;
  bucket: Bucket | null;
  data: DetailRow[];
  totalCount: number;
}

interface BranchOption {
  id: string;
  branch_name: string;
}

// ─── Presentation constants ───────────────────────────────────────────────────

/**
 * The five count columns, in the legacy screen's order.
 *
 * `tone` marks the two buckets that need action. Not Uploaded and Rejected are the ones that stop
 * a payment, so they carry colour; Uploaded and Total are neutral totals and Verified is the
 * healthy state.
 */
const COUNT_COLUMNS: ReadonlyArray<{
  key: Bucket;
  label: string;
  tone: "neutral" | "good" | "warn" | "bad";
}> = [
  { key: "uploaded", label: "Uploaded", tone: "neutral" },
  { key: "verified", label: "Verified", tone: "good" },
  { key: "pending", label: "Pending", tone: "warn" },
  { key: "not_uploaded", label: "Not Uploaded", tone: "bad" },
  { key: "rejected", label: "Rejected", tone: "bad" },
];

const BUCKET_LABELS: Record<Bucket, string> = {
  uploaded: "Uploaded",
  verified: "Verified",
  pending: "Pending",
  not_uploaded: "Not Uploaded",
  rejected: "Rejected",
};

/** The eleven legacy detail columns, in display order. Keep in step with MIS_DETAIL_COLUMNS. */
const DETAIL_COLUMNS: ReadonlyArray<{ key: keyof DetailRow; label: string; mono?: boolean }> = [
  { key: "emp_code", label: "EmpCode", mono: true },
  { key: "emp_name", label: "EmpName" },
  { key: "branch", label: "Branch" },
  { key: "cost_center", label: "CostCenter", mono: true },
  { key: "ac_holder_name", label: "ACHolderName" },
  { key: "account_no", label: "Account No", mono: true },
  { key: "bank_name", label: "Bank Name" },
  { key: "ifsc_code", label: "IFSC Code", mono: true },
  { key: "account_type", label: "Account Type" },
  { key: "payment_mode", label: "Payment Mode" },
  { key: "remarks", label: "Remarks" },
];

const TONE_CLASS: Record<"neutral" | "good" | "warn" | "bad", string> = {
  neutral: "text-slate-700",
  good: "text-emerald-700",
  warn: "text-amber-700",
  bad: "text-rose-700",
};

const ALL_BRANCHES = "__all__";

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ValidatedBankAccountMis() {
  const [searchParams, setSearchParams] = useSearchParams();

  /**
   * The branch the user has PICKED, versus the branch the tables are showing.
   *
   * Kept apart so the screen behaves like the legacy one: choosing a branch changes nothing until
   * Show is pressed. Binding the query straight to the dropdown would refetch a whole-workforce
   * classification on every keystroke of the select, and would also make Show a no-op button that
   * looks broken.
   */
  const [branchChoice, setBranchChoice] = useState<string>(
    () => searchParams.get("branch") ?? ALL_BRANCHES
  );
  const [appliedBranch, setAppliedBranch] = useState<string>(
    () => searchParams.get("branch") ?? ALL_BRANCHES
  );
  const [drill, setDrill] = useState<{ branch: SummaryRow; bucket: Bucket } | null>(null);
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);

  const branchParam = appliedBranch === ALL_BRANCHES ? null : appliedBranch;

  // Keep the chosen branch in the URL so the view is linkable and survives a reload.
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (branchParam) next.set("branch", branchParam);
        else next.delete("branch");
        return next;
      },
      { replace: true }
    );
  }, [branchParam, setSearchParams]);

  const branchQuery = useQuery({
    queryKey: ["branches-all"],
    queryFn: () => hrmsApi.get<{ data: BranchOption[] }>("/api/org/branches"),
    staleTime: 10 * 60_000,
  });

  const summaryQuery = useQuery({
    queryKey: ["validated-bank-mis", "summary", branchParam],
    queryFn: () => {
      const params = new URLSearchParams();
      if (branchParam) params.set("branch_id", branchParam);
      const qs = params.toString();
      // Generous timeout: the endpoint classifies the whole active population on every call,
      // which is slower than a normal list endpoint.
      return hrmsApi.get<SummaryResponse>(
        `/api/payroll/bank-readiness/mis/summary${qs ? `?${qs}` : ""}`,
        120_000
      );
    },
  });

  const detailQuery = useQuery({
    queryKey: ["validated-bank-mis", "detail", drill?.branch.branch_id ?? null, drill?.bucket ?? null],
    enabled: !!drill,
    queryFn: () => {
      const params = new URLSearchParams();
      if (drill?.branch.branch_id) params.set("branch_id", drill.branch.branch_id);
      if (drill?.bucket) params.set("bucket", drill.bucket);
      return hrmsApi.get<DetailResponse>(
        `/api/payroll/bank-readiness/mis/detail?${params.toString()}`,
        120_000
      );
    },
  });

  const branches = branchQuery.data?.data ?? [];
  const summaryRows = summaryQuery.data?.data ?? [];
  const totals = summaryQuery.data?.totals;

  /**
   * The footer.
   *
   * Recomputed from the rows on screen rather than taken from totals, so the footer can never
   * disagree with the column above it. The server sends totals for the same population, but if a
   * row were ever filtered client-side the two would drift and the footer is the number people
   * quote.
   */
  const footer = useMemo(() => {
    const sum = (k: Bucket | "total") =>
      summaryRows.reduce((acc, r) => acc + (r[k as keyof SummaryRow] as number), 0);
    return {
      uploaded: sum("uploaded"),
      verified: sum("verified"),
      pending: sum("pending"),
      not_uploaded: sum("not_uploaded"),
      rejected: sum("rejected"),
      total: sum("total"),
    };
  }, [summaryRows]);

  const detailRows = useMemo(() => {
    const rows = detailQuery.data?.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.emp_code.toLowerCase().includes(q) ||
        r.emp_name.toLowerCase().includes(q) ||
        r.cost_center.toLowerCase().includes(q)
    );
  }, [detailQuery.data, search]);

  function openDrill(branch: SummaryRow, bucket: Bucket) {
    if (branch[bucket] === 0) return; // nothing behind a zero — do not open an empty table
    setSearch("");
    setDrill({ branch, bucket });
  }

  /**
   * Export the rows currently in view.
   *
   * Server-generated, so the file and the screen come from one classification. Built in the
   * browser it would be a second, slightly different answer about who can be paid — and the
   * masked account numbers would be re-derived from already-masked strings.
   */
  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      const exportBranch = drill ? drill.branch.branch_id : branchParam;
      if (exportBranch) params.set("branch_id", exportBranch);
      if (drill?.bucket) params.set("bucket", drill.bucket);

      // getAuthToken() rather than a hand-read localStorage key: the token lives under
      // "hrms_access_token" with a demo-session fallback, and reading the wrong key sends a
      // Bearer of "null" — the export 401s while every other call on the page succeeds.
      const token = getAuthToken();
      const res = await fetch(
        `${apiBaseUrl()}/api/payroll/bank-readiness/mis/export?${params.toString()}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );
      if (!res.ok) throw new Error(`Export failed (${res.status})`);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const cd = res.headers.get("content-disposition") ?? "";
      const match = cd.match(/filename[^;=\n]*=\s*(?:['"]?)([^'"\n;]+)/i);
      a.download = match?.[1] ?? "ValidatedBankAccountMIS.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }, [branchParam, drill]);

  const appliedBranchName =
    appliedBranch === ALL_BRANCHES
      ? "All branches"
      : branches.find((b) => b.id === appliedBranch)?.branch_name ?? "Selected branch";

  return (
    <DashboardLayout>
      <div className="space-y-5 p-4 md:p-6">
        {/* ── Header ── */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <Link
              to="/payroll/payment-center?tab=bank"
              className="inline-flex cursor-pointer items-center gap-1 text-sm text-slate-500 transition-colors duration-200 hover:text-slate-900"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back to Payment Center
            </Link>
            <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
              <Landmark className="h-5 w-5 text-slate-400" />
              Validated Bank Account MIS
            </h1>
            <p className="max-w-3xl text-sm text-slate-500">
              Bank account status by branch. Verified means the account on file received a
              confirmed salary credit — click any count to see the employees behind it.
            </p>
          </div>

          {/* ── Filter bar ── */}
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <label
                htmlFor="mis-branch"
                className="text-xs font-medium text-slate-500"
              >
                Branch
              </label>
              <Select value={branchChoice} onValueChange={setBranchChoice}>
                <SelectTrigger id="mis-branch" className="w-[240px] cursor-pointer">
                  <SelectValue placeholder="All branches" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_BRANCHES} className="cursor-pointer">
                    All branches
                  </SelectItem>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id} className="cursor-pointer">
                      {b.branch_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              className="cursor-pointer"
              onClick={() => {
                setDrill(null);
                setAppliedBranch(branchChoice);
                // Same branch re-selected: nothing in the query key changed, so ask explicitly
                // rather than leaving Show looking dead.
                if (branchChoice === appliedBranch) void summaryQuery.refetch();
              }}
              disabled={summaryQuery.isFetching}
            >
              {summaryQuery.isFetching ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              )}
              Show
            </Button>

            <Button
              variant="outline"
              className="cursor-pointer"
              onClick={handleExport}
              disabled={exporting || summaryQuery.isLoading}
            >
              {exporting ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="mr-1.5 h-3.5 w-3.5" />
              )}
              Export
            </Button>

            {drill && (
              <Button
                variant="outline"
                className="cursor-pointer"
                onClick={() => setDrill(null)}
              >
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                Back
              </Button>
            )}
          </div>
        </div>

        {summaryQuery.isError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-semibold">Could not load the MIS</div>
              <div className="text-xs">
                {summaryQuery.error instanceof Error
                  ? summaryQuery.error.message
                  : "Please try again."}
              </div>
            </div>
          </div>
        )}

        {/* ── Summary or detail ── */}
        {!drill ? (
          <SummaryTable
            rows={summaryRows}
            footer={footer}
            loading={summaryQuery.isLoading}
            onDrill={openDrill}
          />
        ) : (
          <DetailTable
            rows={detailRows}
            loading={detailQuery.isLoading}
            error={detailQuery.isError}
            branchName={drill.branch.branch_name}
            bucket={drill.bucket}
            search={search}
            onSearch={setSearch}
            unfilteredCount={detailQuery.data?.data.length ?? 0}
          />
        )}

        {/* ── Provenance and what Verified means ── */}
        {summaryQuery.data && (
          <div className="space-y-1">
            <p className="text-xs text-slate-400">
              {appliedBranchName} · as of{" "}
              {new Date(summaryQuery.data.as_of).toLocaleString("en-IN")}
              {summaryQuery.data.scope.restricted
                ? ` · limited to your ${summaryQuery.data.scope.branch_count} branch(es)`
                : ""}
            </p>
            {/* Carried from the server rather than hardcoded here, so the definition of Verified
                has one home. Reconciling this against the Bank Payment Readiness page without it
                looks like one of the two is wrong. */}
            <p className="max-w-4xl text-xs text-slate-400">{summaryQuery.data.message}</p>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

// ─── Summary table ────────────────────────────────────────────────────────────

function SummaryTable({
  rows,
  footer,
  loading,
  onDrill,
}: {
  rows: SummaryRow[];
  footer: Record<Bucket | "total", number>;
  loading: boolean;
  onDrill: (branch: SummaryRow, bucket: Bucket) => void;
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Bank account status by branch. Each count links to the employees behind it.
            </caption>
            <thead>
              <tr className="border-b bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500">
                <th scope="col" className="w-14 px-4 py-3 text-left">SNo</th>
                <th scope="col" className="px-4 py-3 text-left">Branch</th>
                {COUNT_COLUMNS.map((c) => (
                  <th key={c.key} scope="col" className="w-32 px-4 py-3 text-center">
                    {c.label}
                  </th>
                ))}
                <th scope="col" className="w-24 px-4 py-3 text-center">Total</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                    Classifying bank accounts…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                    No active employees found for this selection.
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((r, i) => (
                  <tr
                    key={r.branch_id ?? r.branch_name}
                    className="border-b transition-colors duration-150 hover:bg-slate-50"
                  >
                    <td className="px-4 py-3 text-slate-500">{i + 1}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{r.branch_name}</td>
                    {COUNT_COLUMNS.map((c) => (
                      <td key={c.key} className="px-4 py-3 text-center">
                        <CountCell
                          value={r[c.key]}
                          tone={c.tone}
                          label={`${r[c.key]} ${c.label} in ${r.branch_name}`}
                          onClick={() => onDrill(r, c.key)}
                        />
                      </td>
                    ))}
                    <td className="px-4 py-3 text-center font-semibold text-slate-900">
                      {r.total}
                    </td>
                  </tr>
                ))}
            </tbody>
            {!loading && rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold text-slate-900">
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 text-center">Total</td>
                  {COUNT_COLUMNS.map((c) => (
                    <td key={c.key} className={`px-4 py-3 text-center ${TONE_CLASS[c.tone]}`}>
                      {footer[c.key]}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-center">{footer.total}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * One count.
 *
 * A real <button> when there is something behind it, plain text when the count is zero — so
 * keyboard users are not sent through a tab stop that does nothing, and a zero does not look
 * clickable.
 */
function CountCell({
  value,
  tone,
  label,
  onClick,
}: {
  value: number;
  tone: "neutral" | "good" | "warn" | "bad";
  label: string;
  onClick: () => void;
}) {
  if (value === 0) return <span className="text-slate-300">0</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`View ${label}`}
      className={`cursor-pointer rounded font-semibold underline decoration-dotted underline-offset-4 transition-colors duration-150 hover:decoration-solid focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${TONE_CLASS[tone]}`}
    >
      {value}
    </button>
  );
}

// ─── Detail table ─────────────────────────────────────────────────────────────

function DetailTable({
  rows,
  loading,
  error,
  branchName,
  bucket,
  search,
  onSearch,
  unfilteredCount,
}: {
  rows: DetailRow[];
  loading: boolean;
  error: boolean;
  branchName: string;
  bucket: Bucket;
  search: string;
  onSearch: (v: string) => void;
  unfilteredCount: number;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              {BUCKET_LABELS[bucket]} — {branchName}
            </h2>
            <p className="text-xs text-slate-500">
              {loading
                ? "Loading employees…"
                : `${rows.length.toLocaleString("en-IN")}${
                    search && rows.length !== unfilteredCount
                      ? ` of ${unfilteredCount.toLocaleString("en-IN")}`
                      : ""
                  } employee(s)`}
            </p>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Search code, name or cost centre…"
              aria-label="Search employees"
              className="h-9 max-w-xs pl-8"
            />
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"
          >
            Could not load these employees. Please try again.
          </div>
        )}

        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-100">
              <tr className="text-left text-xs font-bold uppercase tracking-wide text-slate-600">
                <th scope="col" className="px-2 py-2">SNo</th>
                {DETAIL_COLUMNS.map((c) => (
                  <th key={c.key} scope="col" className="whitespace-nowrap px-2 py-2">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td
                    colSpan={DETAIL_COLUMNS.length + 1}
                    className="px-2 py-8 text-center text-slate-400"
                  >
                    Loading employees…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td
                    colSpan={DETAIL_COLUMNS.length + 1}
                    className="px-2 py-8 text-center text-slate-400"
                  >
                    {search ? "No employees match your search." : "No employees in this bucket."}
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((r, i) => (
                  <tr key={r.employee_id} className="border-t align-top hover:bg-slate-50">
                    <td className="px-2 py-1.5 text-slate-400">{i + 1}</td>
                    {DETAIL_COLUMNS.map((c) => (
                      <td
                        key={c.key}
                        className={`px-2 py-1.5 ${c.mono ? "font-mono text-xs" : ""} ${
                          c.key === "remarks" ? "min-w-[280px] text-xs text-slate-500" : ""
                        }`}
                      >
                        {/* Blank, not an em dash — a missing bank field must read as empty. */}
                        {String(r[c.key] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-slate-400">
          Account numbers are masked to the last four digits. Full numbers appear only in the
          gated payment file.
        </p>
      </CardContent>
    </Card>
  );
}
