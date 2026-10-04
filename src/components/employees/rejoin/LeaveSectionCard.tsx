import { Plane } from "lucide-react";
import { SectionCard, StatTile } from "./SectionCard";
import { fmtNum, fmtPct } from "./rejoinReviewFormat";
import type { LeaveSection, SectionResult } from "./rejoinTypes";

export function LeaveSectionCard({ result }: { result: SectionResult<LeaveSection> }) {
  return (
    <SectionCard
      id="leave"
      title="Leave"
      icon={Plane}
      result={result}
      isEmpty={(d) => d.totalRequests === 0 && d.balances.length === 0}
      emptyText="No leave requests in this window."
    >
      {(d) => (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 2xl:grid-cols-4">
            <StatTile label="Requests" value={d.totalRequests} hint={`${fmtNum(d.totalDays)} days`} />
            <StatTile label="Paid / unpaid days" value={`${fmtNum(d.paidDays)} / ${fmtNum(d.unpaidDays)}`} />
            <StatTile
              label="Short notice"
              value={fmtPct(d.shortNoticePct)}
              hint={`${d.shortNoticeRequests} applied at/after the day before start`}
            />
            <StatTile
              label="Weekend-adjacent"
              value={fmtPct(d.weekendAdjacentPct)}
              hint={`${d.weekendAdjacentRequests} start Monday or end Friday`}
            />
          </div>
          {d.byType.length > 0 && (
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-[420px] text-left text-xs">
                <caption className="sr-only">Leave by type</caption>
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border">
                    <th scope="col" className="py-1.5 pr-2 font-medium">Type</th>
                    <th scope="col" className="py-1.5 pr-2 font-medium">Pay</th>
                    <th scope="col" className="py-1.5 pr-2 text-right font-medium">Requests</th>
                    <th scope="col" className="py-1.5 pr-2 text-right font-medium">Days</th>
                    <th scope="col" className="py-1.5 pr-2 text-right font-medium">Short notice</th>
                    <th scope="col" className="py-1.5 text-right font-medium">Weekend-adj.</th>
                  </tr>
                </thead>
                <tbody>
                  {d.byType.map((t) => (
                    <tr key={`${t.leaveType}-${t.paid}`} className="border-b border-border/60 last:border-0">
                      {/* As written: leave names and codes (CL, EL, LWP) must not be re-cased. */}
                      <th scope="row" className="py-1.5 pr-2 font-medium">{t.leaveType}</th>
                      <td className="py-1.5 pr-2">{t.paid ? "Paid" : "Unpaid"}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{t.requests}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{fmtNum(t.days)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{t.shortNotice}</td>
                      <td className="py-1.5 text-right tabular-nums">{t.weekendAdjacent}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border font-semibold">
                    <th scope="row" className="py-1.5 pr-2">Total</th>
                    <td className="py-1.5 pr-2 text-muted-foreground">
                      {fmtNum(d.paidDays)} paid / {fmtNum(d.unpaidDays)} unpaid
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{d.totalRequests}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{fmtNum(d.totalDays)}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{d.shortNoticeRequests}</td>
                    <td className="py-1.5 text-right tabular-nums">{d.weekendAdjacentRequests}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            There is no planned/unplanned flag on leave, so "short notice" means the leave was applied at or after the day
            before it started.
          </p>
        </>
      )}
    </SectionCard>
  );
}
