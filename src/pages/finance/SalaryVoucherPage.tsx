import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { SalaryVoucherPanel } from "@/components/finance/payroll/SalaryVoucherPanel";

/**
 * Salary Voucher — the Tally journal a payroll run will post.
 *
 * Its own page rather than a tab on the GRN screen: the audience is Finance and Payroll, not the
 * people raising purchase GRNs, and the grants are correspondingly narrower.
 */
export default function SalaryVoucherPage() {
  return (
    <DashboardLayout>
      <div className="grn-scope p-4 md:p-6">
        <SalaryVoucherPanel />
      </div>
    </DashboardLayout>
  );
}
