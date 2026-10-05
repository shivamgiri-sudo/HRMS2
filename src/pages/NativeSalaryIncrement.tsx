import { SalaryChangeHub } from "@/pages/payroll/SalaryChangeCenter";

/**
 * Salary Increment now lives inside the Salary Change Center (one page for every salary change). This route is kept
 * so existing links and the HR menu entry still work; it opens the Increment requests tab.
 */
export default function NativeSalaryIncrement() {
  return <SalaryChangeHub initialTab="increment" />;
}
