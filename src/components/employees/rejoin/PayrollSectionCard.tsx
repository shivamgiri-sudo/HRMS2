import { Wallet } from "lucide-react";
import { SectionCard, StatTile } from "./SectionCard";
import { DASH, fmtInr, fmtMonth } from "./rejoinReviewFormat";
import type { PayrollSection, SectionResult } from "./rejoinTypes";

const isEmpty = (d: PayrollSection) =>
  d.payslips.length === 0 && d.currentSalary === null && d.pendingRecoveries !== null && d.pendingRecoveries.total === 0;

/** 'YYYY-MM' run months read as 'Aug 2026'; anything else is shown as stored rather than hidden. */
const monthLabel = (m: string) => (/^\d{4}-\d{2}/.test(m) ? fmtMonth(m, true) : m || DASH);

/** Final payroll runs only (the backend skips drafts). Recoveries that could not be read say so, never ₹0. */
export function PayrollSectionCard({ result }: { result: SectionResult<PayrollSection> }) {
  return (
    <SectionCard id="payroll" title="Payroll" icon={Wallet} result={result} isEmpty={isEmpty} emptyText="No payslips or salary on record.">
      {(d) => {
        const rec = d.pendingRecoveries;
        return (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <StatTile label="Last net pay" value={fmtInr(d.lastNet)} hint={d.payslips[0] ? monthLabel(d.payslips[0].month) : undefined} />
              <StatTile label="Average net pay" value={fmtInr(d.avgNet)} hint={d.payslips.length ? `over ${d.payslips.length} payslips` : undefined} />
              <StatTile
                label="Pending recoveries"
                value={rec === null ? "Unavailable" : fmtInr(rec.total)}
                tone={rec === null ? undefined : rec.total > 0 ? "warn" : undefined}
                hint={
                  rec === null
                    ? "Recovery records could not be read"
                    : `Loans ${fmtInr(rec.loans)} · advances ${fmtInr(rec.advances)} · deductions ${fmtInr(rec.deductions)}`
                }
              />
              <StatTile label="Current gross (monthly)" value={fmtInr(d.currentSalary?.gross ?? null)} />
              <StatTile label="Current CTC" value={fmtInr(d.currentSalary?.ctc ?? null)} />
            </div>

            {d.payslips.length > 0 ? (
              <div className="-mx-1 overflow-x-auto px-1">
                <table className="w-full min-w-[360px] text-left text-xs">
                  <caption className="sr-only">Recent payslips, newest first</caption>
                  <thead className="text-muted-foreground">
                    <tr className="border-b border-border">
                      <th scope="col" className="py-1.5 pr-2 font-medium">Month</th>
                      <th scope="col" className="py-1.5 pr-2 text-right font-medium">Gross</th>
                      <th scope="col" className="py-1.5 pr-2 text-right font-medium">Deductions</th>
                      <th scope="col" className="py-1.5 text-right font-medium">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.payslips.map((p, i) => (
                      <tr key={`${p.month}-${i}`} className="border-b border-border/60 last:border-0">
                        <th scope="row" className="py-1.5 pr-2 font-medium">{monthLabel(p.month)}</th>
                        <td className="py-1.5 pr-2 text-right tabular-nums">{fmtInr(p.gross)}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">{fmtInr(p.deductions)}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmtInr(p.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs italic text-muted-foreground">No final payroll runs for this employee.</p>
            )}
          </>
        );
      }}
    </SectionCard>
  );
}
