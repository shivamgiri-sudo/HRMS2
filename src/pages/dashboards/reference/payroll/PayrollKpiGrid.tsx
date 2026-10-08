import { Clock3, FileCheck2, IndianRupee, Landmark, Percent, ReceiptIndianRupee, ShieldCheck, TrendingDown, Users, WalletCards } from "lucide-react";
import { PulseGrid, PulseTile } from "../../kit";
import { pctChange, type RunData } from "./payrollModel";

export interface KpiGridProps {
  run: RunData | null;
  loading: boolean;
  totalEmployees: number | null;
  readinessPct: number | null;
  readinessReason: string | null;
  blockerCount: number | null;
  incentivePending: number | null;
  loansActive: number | null;
  readinessHref: string;
  costHref: string;
  onReadinessDrill?: () => void;
}

/** Every tile is a link: run page, a drill-down, or the page where the number is fixed. */
export function PayrollKpiGrid(p: KpiGridProps) {
  const r = p.run, t = r?.totals, prev = r?.previous;
  const missingDue = r ? Math.max(0, r.headcount.missingTotal - r.headcount.missingNotDue) : null;
  const slips = r?.payslips ? Math.round((r.payslips.generated / r.payslips.expected) * 1000) / 10 : null;
  const filed = r?.filings.length ? r.filings.filter((f) => f.status === "filed").length : null;
  const overdue = r ? r.filings.filter((f) => f.status === "overdue").length : null;
  const d = (cur?: number, old?: number) => pctChange(cur, old);
  const dl = r?.previousRun ? `% vs ${r.previousRun.month}` : undefined;
  return (
    <PulseGrid cols={3} className="content-start">
      <PulseTile label="Net pay" value={t?.net ?? null} unit="inr" icon={WalletCards} tone="blue" loading={p.loading} href="/payroll" delta={d(t?.net, prev?.net)} deltaLabel={dl} formula="Sum of net_salary over this run's payroll lines in your scope" helper="Run lines, in scope" />
      <PulseTile label="Payroll cost" value={t?.payrollCost ?? null} unit="inr" icon={IndianRupee} tone="violet" loading={p.loading} href={p.costHref} delta={d(t?.payrollCost, prev?.payrollCost)} deltaLabel={dl} higherIsBetter={false} formula="Net pay + employee deductions + employer PF + employer ESI, summed from lines (not the contractual gross)" helper="Net + deductions + employer" />
      <PulseTile label="Employee deductions" value={t?.deductions ?? null} unit="inr" icon={ReceiptIndianRupee} tone="amber" loading={p.loading} href="/payroll/variance-analysis" delta={d(t?.deductions, prev?.deductions)} deltaLabel={dl} higherIsBetter={false} helper="PF, ESI, TDS, loans" />
      <PulseTile label="Employer PF + ESI" value={t?.employer ?? null} unit="inr" icon={Landmark} tone="slate" loading={p.loading} href="/payroll/statutory" delta={d(t?.employer, prev?.employer)} deltaLabel={dl} higherIsBetter={false} helper="Employer contributions" />
      <PulseTile label="Employees paid" value={t?.employees ?? null} icon={Users} tone="green" loading={p.loading} href="/payroll" delta={d(t?.employees, prev?.employees)} deltaLabel={dl} helper={p.totalEmployees !== null ? `Header says ${p.totalEmployees}` : "Lines in this run"} formula="Distinct employees with a line in this run (the run header total drifts)" />
      <PulseTile label="Active, not in run" value={missingDue} icon={Clock3} tone={missingDue ? "amber" : "green"} loading={p.loading} href="/payroll" helper={r ? `${r.headcount.missingNotDue} more joined after the run month` : undefined} formula="Active employees with no line in this run, excluding joiners after the run month end" />
      <PulseTile label="Payroll readiness" value={p.readinessPct} unit="percent" icon={ShieldCheck} tone={p.readinessPct === null ? "slate" : p.readinessPct >= 95 ? "green" : p.readinessPct >= 80 ? "amber" : "red"} loading={p.loading} href={p.readinessHref} onDrill={p.onReadinessDrill} unavailable={p.readinessReason} helper={p.blockerCount ? `${p.blockerCount} employees blocked` : "Bank + PAN gate"} formula="Active employees with a payable bank account and a valid PAN (30-day joining grace) / active employees" />
      <PulseTile label="LOP days" value={t?.lopDays ?? null} unit="days" icon={TrendingDown} tone="amber" loading={p.loading} href="/payroll/attendance-control-tower" delta={d(t?.lopDays, prev?.lopDays)} deltaLabel={dl} higherIsBetter={false} helper={t ? `${t.lopEmployees} employees with LOP` : undefined} formula="Sum of lwp_days over run lines" />
      <PulseTile label="Zero / negative net" value={t ? t.zeroNet : null} icon={FileCheck2} tone={t && t.zeroNet > 0 ? "red" : "green"} loading={p.loading} href="/payroll/variance-analysis" higherIsBetter={false} helper={t ? `${t.negativeNet} negative` : undefined} formula="Lines with net_salary <= 0" />
      <PulseTile label="Payslips generated" value={slips} unit="percent" icon={Percent} tone={slips === null ? "slate" : slips >= 100 ? "green" : "amber"} loading={p.loading} href="/payroll/payslips" helper={r?.payslips ? `${r.payslips.generated} of ${r.payslips.expected}` : "No lines"} formula="Payslips linked to this run's lines / lines" />
      <PulseTile label="Filings filed" value={filed} icon={Landmark} tone={overdue ? "red" : "blue"} loading={p.loading} href="/payroll/statutory?tab=filing" helper={r?.filings.length ? `${overdue} overdue of ${r.filings.length}` : "No filing records"} formula="statutory_filing_record for the run month, PT excluded" />
      <PulseTile label="Incentive batches pending" value={p.incentivePending} icon={Clock3} tone={p.incentivePending ? "amber" : "green"} loading={p.loading} href="/payroll/incentives" helper={p.loansActive !== null ? `${p.loansActive} active loans` : undefined} />
    </PulseGrid>
  );
}
