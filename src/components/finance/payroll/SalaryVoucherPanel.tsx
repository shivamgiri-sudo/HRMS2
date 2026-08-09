import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download, RefreshCw } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { money } from "@/components/finance/grn/grn-format";
import {
  GRN_TR, GrnAlert, GrnCard, GrnCardHeader, GrnCellSub, GrnChip, GrnEmptyState, GrnIconButton,
  GrnInput, GrnSelect, GrnTable, GrnTd, GrnTh,
} from "@/components/finance/grn/grn-ui";

/**
 * Payroll → Tally salary voucher.
 *
 * Shows what will be posted, per branch, before anyone imports it. That is the entire point:
 * a voucher is checked once and then trusted for the rest of the month, so the check has to be
 * possible without opening Tally.
 *
 * THREE THINGS ARE SHOWN THAT A NAIVE SCREEN WOULD HIDE.
 *
 *   - Whether the voucher BALANCES. It always should — Gross Salary is constructed as the
 *     balancing figure — so a false here means something is badly wrong, and it is worth more
 *     screen space than it will ever normally need.
 *   - The gap between the derived Gross Salary and payroll's own gross. They are different
 *     figures by design, and a large gap means the component mapping needs looking at.
 *   - Employees who were EXCLUDED: unidentifiable entity, no branch, or simply not paid. A
 *     voucher that quietly covers fewer people than the run is the hardest error to notice,
 *     because every number on it still adds up.
 */

type VoucherLine = {
  ledger_name: string;
  debit_credit: "D" | "C";
  amount: number;
  columns: number[];
  employee_code?: string;
};

type Voucher = {
  voucher_no: string;
  company_code: string;
  branch_name: string;
  cost_centre: string;
  date: string;
  narration: string;
  cohort_labels: string[];
  lines: VoucherLine[];
  totals: { debit: number; credit: number; balanced: boolean };
  payroll_gross: number;
  employees: number;
};

type Payload = {
  period: string;
  vouchers: Voucher[];
  unassigned: string[];
  unpaid: string[];
};

type Run = { id: string; run_month: string; status: string; total_employees: number };

function unwrap<T>(response: unknown): T {
  const body = (response as any)?.data ?? response;
  return (body?.data ?? body) as T;
}

export function SalaryVoucherPanel() {
  const [runId, setRunId] = useState("");
  const [companyCode, setCompanyCode] = useState("");
  /*
   * The voucher number's serial comes from TALLY's own numbering, which HRMS2 does not own and
   * cannot see. The reference files run 612, 614, 615, 616 — a sequence continuing from whatever
   * was posted before.
   *
   * So it is asked for rather than invented. Defaulting silently to 1 printed
   * "HEAD OFFICE/MAS/06/26/1" on every voucher: a number that looks authoritative, is wrong, and
   * collides with every other generation — which is a duplicate posting if anyone imports two of
   * them. Blank means "not decided yet" and the numbers show as provisional.
   */
  const [serialFrom, setSerialFrom] = useState("");

  const runsQuery = useQuery({
    queryKey: ["payroll-runs-for-voucher"],
    queryFn: async () => {
      const rows = unwrap<Run[]>(await hrmsApi.get<any>("/api/payroll/runs?limit=24"));
      return Array.isArray(rows) ? rows : [];
    },
  });

  // Only the query string is interpolated; the PATH is written out in full at each call site.
  // Hiding path segments inside a variable defeats the route-contract check, which reads the
  // client's literals to prove every call has a registered route — and a wrong /api path 401s
  // exactly like a real one, so that check is the only thing that catches a typo here.
  const search = [
    companyCode ? `companyCode=${encodeURIComponent(companyCode)}` : "",
    serialFrom.trim() ? `serialFrom=${encodeURIComponent(serialFrom.trim())}` : "",
  ].filter(Boolean).join("&");
  const query = search ? `?${search}` : "";

  const voucherQuery = useQuery({
    queryKey: ["salary-vouchers", runId, companyCode, serialFrom],
    enabled: Boolean(runId),
    queryFn: async () =>
      unwrap<Payload>(await hrmsApi.get<any>(`/api/finance/payroll/runs/${runId}/vouchers${query}`)),
  });

  const runs = runsQuery.data ?? [];
  const data = voucherQuery.data;
  const vouchers = data?.vouchers ?? [];
  const excluded = (data?.unassigned.length ?? 0) + (data?.unpaid.length ?? 0);

  return (
    <div className="space-y-4">
      <GrnCard>
        <GrnCardHeader
          title="Salary voucher"
          description="What will post to Tally for this payroll run, one journal per company and branch."
          action={
            <div className="flex items-center gap-1">
              <GrnChip
                active={false}
                onClick={() => {
                  if (!runId) return;
                  // Straight to the API so the file is produced by the same scope resolution as
                  // the table, and in the column order Tally imports by position.
                  window.open(
                    `/api/finance/payroll/runs/${runId}/vouchers/export${query}`,
                    "_blank", "noopener",
                  );
                }}
              >
                <Download className="mr-1 h-3.5 w-3.5" />
                Export for Tally
              </GrnChip>
              <GrnIconButton aria-label="Refresh" onClick={() => voucherQuery.refetch()}>
                <RefreshCw className={`h-3.5 w-3.5 ${voucherQuery.isFetching ? "animate-spin" : ""}`} />
              </GrnIconButton>
            </div>
          }
        />

        <div className="flex flex-wrap items-end gap-2 border-b border-grn-line px-4 py-3">
          <label className="text-[11px] font-semibold text-grn-ink">
            Payroll run
            <GrnSelect className="mt-1 w-[260px]" value={runId} onChange={(e) => setRunId(e.target.value)}>
              <option value="">— choose a run —</option>
              {runs.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.run_month} · {run.status} · {run.total_employees} employees
                </option>
              ))}
            </GrnSelect>
          </label>
          <label className="text-[11px] font-semibold text-grn-ink">
            Company
            <GrnSelect className="mt-1 w-[180px]" value={companyCode} onChange={(e) => setCompanyCode(e.target.value)}>
              <option value="">All companies</option>
              <option value="MAS">MAS</option>
              <option value="IDC">IDC</option>
              <option value="PIK">PIK</option>
            </GrnSelect>
          </label>
          <label className="text-[11px] font-semibold text-grn-ink">
            Starting voucher no.
            <GrnInput
              type="number"
              min="1"
              className="mt-1 w-[160px] tabular-nums"
              placeholder="e.g. 614"
              value={serialFrom}
              onChange={(e) => setSerialFrom(e.target.value)}
            />
          </label>
        </div>

        {!serialFrom.trim() && runId && (
          <div className="px-4 pt-3">
            <GrnAlert tone="warn">
              No starting voucher number given, so these are numbered from 1 and are
              <span className="font-semibold"> provisional</span>. Tally owns this sequence — enter
              the next number from Tally before exporting, or the file will collide with vouchers
              already posted.
            </GrnAlert>
          </div>
        )}

        {voucherQuery.error && (
          <div className="p-4">
            <GrnAlert tone="crit">{(voucherQuery.error as Error).message}</GrnAlert>
          </div>
        )}

        {excluded > 0 && (
          <div className="px-4 pt-3">
            {/* Named, not counted away. A voucher covering fewer people than the run is the
                hardest error to spot, because everything on it still adds up. */}
            <GrnAlert tone="warn">
              <span className="font-semibold">{excluded} employees are not on any voucher.</span>{" "}
              {data?.unpaid.length ? `${data.unpaid.length} were not paid this run. ` : ""}
              {data?.unassigned.length
                ? `${data.unassigned.length} could not be matched to a company or a branch: `
                  + `${data.unassigned.slice(0, 6).join(", ")}`
                  + `${data.unassigned.length > 6 ? "…" : ""}.`
                : ""}
            </GrnAlert>
          </div>
        )}
      </GrnCard>

      {!runId ? (
        <GrnCard>
          <GrnEmptyState
            title="Choose a payroll run"
            description="The voucher is generated from a run that already exists. Nothing here changes payroll."
          />
        </GrnCard>
      ) : vouchers.length === 0 ? (
        <GrnCard>
          <GrnEmptyState
            title={voucherQuery.isLoading ? "Generating…" : "No voucher for this run"}
            description={
              voucherQuery.isLoading
                ? undefined
                : "Either the run has no lines, or no employee in it could be matched to a company."
            }
          />
        </GrnCard>
      ) : (
        vouchers.map((voucher) => (
          <GrnCard key={voucher.voucher_no}>
            <GrnCardHeader
              title={voucher.voucher_no}
              description={
                `${voucher.branch_name} · ${voucher.cost_centre} · ${voucher.employees} employees · ${voucher.date}`
              }
              action={
                voucher.totals.balanced ? (
                  <span className="text-[11px] font-semibold text-grn-ok">Balanced</span>
                ) : (
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-grn-crit">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Does not balance
                  </span>
                )
              }
            />

            {!voucher.totals.balanced && (
              <div className="px-4 pt-3">
                <GrnAlert tone="crit">
                  Debits {money(voucher.totals.debit)} against credits {money(voucher.totals.credit)}.
                  Tally rejects an unbalanced journal, and this one should be impossible — Gross
                  Salary is constructed as the balancing figure. Do not import it; raise it.
                </GrnAlert>
              </div>
            )}

            <div className="overflow-x-auto">
              <GrnTable>
                <thead>
                  <tr>
                    <GrnTh>Ledger</GrnTh>
                    <GrnTh className="text-right">Amount</GrnTh>
                    {voucher.cohort_labels.length > 1
                      // The reference prints the cohort column first, then the remainder.
                      && [...voucher.cohort_labels.slice(1), voucher.cohort_labels[0]].map((label) => (
                        <GrnTh key={label} className="text-right">{label}</GrnTh>
                      ))}
                    <GrnTh>Dr/Cr</GrnTh>
                  </tr>
                </thead>
                <tbody>
                  {voucher.lines.map((line, index) => (
                    <tr key={`${line.ledger_name}-${index}`} className={GRN_TR}>
                      <GrnTd>
                        {line.ledger_name}
                        {line.employee_code && <GrnCellSub>{line.employee_code}</GrnCellSub>}
                      </GrnTd>
                      <GrnTd className="text-right tabular-nums">{money(line.amount)}</GrnTd>
                      {voucher.cohort_labels.length > 1
                        && [...line.columns.slice(1), line.columns[0]].map((value, i) => (
                          <GrnTd key={i} className="text-right tabular-nums text-grn-ink-soft">
                            {money(value)}
                          </GrnTd>
                        ))}
                      <GrnTd>{line.debit_credit}</GrnTd>
                    </tr>
                  ))}
                </tbody>
              </GrnTable>
            </div>

            <div className="border-t border-grn-line px-4 py-2 text-[11px] text-grn-ink-soft">
              {/* Two different figures by design: the voucher's Gross Salary is the balancing
                  plug, payroll's gross is what was actually earned. Shown side by side so the
                  gap is noticed rather than absorbed. */}
              Voucher gross{" "}
              <span className="font-semibold text-grn-ink">
                {money(voucher.lines.find((l) => l.ledger_name === "Gross Salary")?.amount ?? 0)}
              </span>{" "}
              · payroll gross <span className="font-semibold text-grn-ink">{money(voucher.payroll_gross)}</span>
              {" "}· these differ by design; a large gap means the component mapping needs review.
            </div>
          </GrnCard>
        ))
      )}
    </div>
  );
}
