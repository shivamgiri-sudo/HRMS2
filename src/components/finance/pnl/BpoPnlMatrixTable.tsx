import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, CircleDollarSign, DatabaseZap } from "lucide-react";
import type { BpoPnlRow } from "@/hooks/useBpoProcessPnl";

function currency(value: number | null | undefined) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value ?? 0);
}

function number(value: number | null | undefined) {
  if (value == null) return "-";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(value);
}

function percent(value: number | null | undefined) {
  return value == null ? "-" : `${value.toFixed(1)}%`;
}

function statusClass(status: BpoPnlRow["processStatus"]) {
  if (status === "profitable") return "bg-emerald-100 text-emerald-700";
  if (status === "loss-making") return "bg-rose-100 text-rose-700";
  return "bg-amber-100 text-amber-800";
}

function dataStatus(row: BpoPnlRow) {
  if (row.revenueDataStatus === "configured") {
    return {
      label: "Live delivery",
      icon: CheckCircle2,
      className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    };
  }
  if (row.revenueDataStatus === "configured_no_delivery") {
    return {
      label: "Delivery missing",
      icon: AlertTriangle,
      className: "bg-amber-50 text-amber-800 border-amber-200",
    };
  }
  return {
    label: "Accounting fallback",
    icon: DatabaseZap,
    className: "bg-slate-100 text-slate-700 border-slate-200",
  };
}

function moneyTone(value: number) {
  return value >= 0 ? "text-emerald-700" : "text-rose-700";
}

export function BpoPnlMatrixTable({ rows, period }: { rows: BpoPnlRow[]; period: string }) {
  return (
    <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-950">
            <CircleDollarSign className="h-5 w-5 text-emerald-600" />
            Process-wise BPO P&amp;L matrix
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Contract, delivery, complete revenue, Agent Salary, DSC, BMC, GRN/vendor spend, EBITDA and budget in one reconciled grid.
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
          Scroll horizontally for the complete finance statement. Select a process for supporting ledgers.
        </div>
      </div>

      <div className="max-h-[720px] overflow-auto">
        <table className="min-w-[5200px] w-full border-separate border-spacing-0 text-xs">
          <thead className="sticky top-0 z-30 text-slate-600 shadow-sm">
            <tr className="text-[10px] font-bold uppercase tracking-[0.18em] text-white">
              <th colSpan={4} className="sticky left-0 z-40 border-r border-white/20 bg-slate-900 px-4 py-2 text-left">Process identity</th>
              <th colSpan={12} className="border-r border-white/20 bg-sky-700 px-4 py-2 text-center">Commercial &amp; delivery</th>
              <th colSpan={14} className="border-r border-white/20 bg-emerald-700 px-4 py-2 text-center">Revenue statement</th>
              <th colSpan={13} className="border-r border-white/20 bg-amber-700 px-4 py-2 text-center">Cost statement</th>
              <th colSpan={8} className="border-r border-white/20 bg-violet-700 px-4 py-2 text-center">Profitability</th>
              <th colSpan={5} className="bg-indigo-700 px-4 py-2 text-center">Budget control</th>
            </tr>
            <tr className="bg-slate-50 text-[10px] font-bold uppercase tracking-[0.12em]">
              <th className="sticky left-0 z-40 min-w-[220px] border-b border-r border-slate-200 bg-slate-50 px-3 py-3 text-left">Process</th>
              <th className="min-w-[150px] border-b border-slate-200 px-3 py-3 text-left">Client</th>
              <th className="min-w-[130px] border-b border-slate-200 px-3 py-3 text-left">Branch</th>
              <th className="min-w-[130px] border-b border-r border-slate-200 px-3 py-3 text-left">Cost centre</th>

              <th className="min-w-[150px] border-b border-slate-200 px-3 py-3 text-left">Billing model</th>
              <th className="min-w-[130px] border-b border-slate-200 px-3 py-3 text-left">Revenue data</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">Mandated seats</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">Active HC</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">Agent HC</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">Billable HC</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">Seat fill</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">Planned units</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">Delivered</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">Billable units</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">Delivery %</th>
              <th className="border-b border-r border-slate-200 px-3 py-3 text-right">Acceptance %</th>

              <th className="border-b border-slate-200 px-3 py-3 text-right">Potential revenue</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">Base earned</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">Min. commitment</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">Incentive/reward</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">Penalty/SLA</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">Credit note</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">Earned revenue</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">Recognized revenue</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">Invoiced</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">Collected</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">Outstanding</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">Unbilled</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">Revenue at risk</th>
              <th className="border-b border-r border-slate-200 px-3 py-3 text-right">Revenue variance</th>

              <th className="border-b border-slate-200 px-3 py-3 text-right">Agent salary</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">Avg agent salary</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">Agent salary %</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">DSC people</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">DSC non-people</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">Total DSC</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">DSC %</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">BMC people</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">BMC non-people</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">Total BMC</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">BMC %</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">GRN/vendor actual</th>
              <th className="border-b border-r border-slate-200 px-3 py-3 text-right">People cost %</th>

              <th className="border-b border-slate-200 px-3 py-3 text-right">Contribution</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">Contribution %</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">EBITDA</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">EBITDA %</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">EBIT</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">Operating profit %</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">PBT</th>
              <th className="border-b border-r border-slate-200 px-3 py-3 text-right">PAT</th>

              <th className="border-b border-slate-200 px-3 py-3 text-right">Approved</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">Reserved</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">Consumed</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">Available</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right">Utilization</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.map((row) => {
              const revenueStatus = dataStatus(row);
              const RevenueIcon = revenueStatus.icon;
              return (
                <tr key={row.processId} className="group hover:bg-slate-50/70">
                  <td className="sticky left-0 z-20 border-r border-slate-200 bg-white px-3 py-3 group-hover:bg-slate-50">
                    <Link to={`/finance/process-pnl/${row.processId}?period=${period}`} className="font-bold text-slate-950 hover:text-emerald-700">
                      {row.processName}
                    </Link>
                    <div className="mt-1 flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusClass(row.processStatus)}`}>{row.processStatus}</span>
                      {row.freshness && <span className="text-[10px] text-slate-400">Updated {new Date(row.freshness).toLocaleDateString("en-IN")}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-slate-600">{row.clientName ?? "Unmapped"}</td>
                  <td className="px-3 py-3 text-slate-600">{row.branchName ?? "Unassigned"}</td>
                  <td className="border-r border-slate-100 px-3 py-3 font-medium text-slate-700">{row.costCentreCode ?? "Not mapped"}</td>

                  <td className="px-3 py-3 text-slate-700">{row.billingModels.length ? row.billingModels.join(" + ").replaceAll("_", " ") : "Not configured"}</td>
                  <td className="px-3 py-3">
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-bold ${revenueStatus.className}`}>
                      <RevenueIcon className="h-3 w-3" /> {revenueStatus.label}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right">{number(row.mandatedSeats)}</td>
                  <td className="px-3 py-3 text-right">{number(row.activeHc)}</td>
                  <td className="px-3 py-3 text-right">{number(row.agentHeadcount)}</td>
                  <td className="px-3 py-3 text-right">{number(row.billableHc)}</td>
                  <td className="px-3 py-3 text-right">{percent(row.seatFillPct)}</td>
                  <td className="px-3 py-3 text-right">{number(row.plannedDeliveryUnits)}</td>
                  <td className="px-3 py-3 text-right">{number(row.deliveredUnits)}</td>
                  <td className="px-3 py-3 text-right">{number(row.billableUnits)}</td>
                  <td className="px-3 py-3 text-right font-semibold">{percent(row.deliveryAttainmentPct)}</td>
                  <td className="border-r border-slate-100 px-3 py-3 text-right">{percent(row.acceptancePct)}</td>

                  <td className="px-3 py-3 text-right">{currency(row.grossPotentialRevenue)}</td>
                  <td className="px-3 py-3 text-right">{currency(row.baseEarnedRevenue)}</td>
                  <td className="px-3 py-3 text-right">{currency(row.minimumCommitmentTopUp)}</td>
                  <td className="px-3 py-3 text-right text-emerald-700">{currency(row.incentiveRevenue + row.rewardRevenue)}</td>
                  <td className="px-3 py-3 text-right text-rose-700">{currency(row.penalty + row.slaDeduction)}</td>
                  <td className="px-3 py-3 text-right text-rose-700">{currency(row.creditNote)}</td>
                  <td className="px-3 py-3 text-right font-semibold text-slate-900">{currency(row.earnedRevenue)}</td>
                  <td className="px-3 py-3 text-right font-bold text-emerald-800">{currency(row.recognizedRevenue)}</td>
                  <td className="px-3 py-3 text-right">{currency(row.invoicedRevenue)}</td>
                  <td className="px-3 py-3 text-right text-emerald-700">{currency(row.collectedRevenue)}</td>
                  <td className="px-3 py-3 text-right text-rose-700">{currency(row.outstandingReceivable)}</td>
                  <td className="px-3 py-3 text-right text-amber-700">{currency(row.unbilledRevenue)}</td>
                  <td className="px-3 py-3 text-right text-amber-700">{currency(row.revenueAtRisk)}</td>
                  <td className={`border-r border-slate-100 px-3 py-3 text-right font-semibold ${moneyTone(row.revenueVariance ?? 0)}`}>{row.revenueVariance == null ? "No budget" : currency(row.revenueVariance)}</td>

                  <td className="px-3 py-3 text-right font-semibold">{currency(row.agentSalary)}</td>
                  <td className="px-3 py-3 text-right">{currency(row.averageAgentSalary)}</td>
                  <td className="px-3 py-3 text-right font-semibold">{percent(row.agentSalaryPctRevenue)}</td>
                  <td className="px-3 py-3 text-right">{currency(row.dscPeople)}</td>
                  <td className="px-3 py-3 text-right">{currency(row.dscNonPeople)}</td>
                  <td className="px-3 py-3 text-right font-semibold">{currency(row.dsc)}</td>
                  <td className="px-3 py-3 text-right">{percent(row.dscPctRevenue)}</td>
                  <td className="px-3 py-3 text-right">{currency(row.bmcPeople)}</td>
                  <td className="px-3 py-3 text-right">{currency(row.bmcNonPeople)}</td>
                  <td className="px-3 py-3 text-right font-semibold">{currency(row.bmc)}</td>
                  <td className="px-3 py-3 text-right">{percent(row.bmcPctRevenue)}</td>
                  <td className="px-3 py-3 text-right text-amber-800">{currency(row.grnVendorActual)}</td>
                  <td className="border-r border-slate-100 px-3 py-3 text-right font-semibold">{percent(row.peopleCostPctRevenue)}</td>

                  <td className={`px-3 py-3 text-right font-semibold ${moneyTone(row.contribution)}`}>{currency(row.contribution)}</td>
                  <td className="px-3 py-3 text-right">{percent(row.contributionMarginPct)}</td>
                  <td className={`px-3 py-3 text-right text-sm font-black ${moneyTone(row.ebitda)}`}>{currency(row.ebitda)}</td>
                  <td className={`px-3 py-3 text-right font-bold ${moneyTone(row.ebitdaMarginPct ?? 0)}`}>{percent(row.ebitdaMarginPct)}</td>
                  <td className={`px-3 py-3 text-right font-semibold ${moneyTone(row.ebit)}`}>{currency(row.ebit)}</td>
                  <td className="px-3 py-3 text-right">{percent(row.operatingProfitPct)}</td>
                  <td className={`px-3 py-3 text-right font-semibold ${moneyTone(row.pbt)}`}>{currency(row.pbt)}</td>
                  <td className={`border-r border-slate-100 px-3 py-3 text-right font-bold ${moneyTone(row.pat)}`}>{currency(row.pat)}</td>

                  <td className="px-3 py-3 text-right">{currency(row.approvedBudget)}</td>
                  <td className="px-3 py-3 text-right text-amber-700">{currency(row.reservedBudget)}</td>
                  <td className="px-3 py-3 text-right">{currency(row.consumedBudget)}</td>
                  <td className={`px-3 py-3 text-right font-semibold ${moneyTone(row.availableBudget)}`}>{currency(row.availableBudget)}</td>
                  <td className={`px-3 py-3 text-right font-bold ${(row.budgetUtilizationPct ?? 0) > 100 ? "text-rose-700" : "text-slate-800"}`}>{percent(row.budgetUtilizationPct)}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={56} className="px-6 py-14 text-center text-sm text-slate-500">
                  No BPO P&amp;L data is available for the selected period and filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
