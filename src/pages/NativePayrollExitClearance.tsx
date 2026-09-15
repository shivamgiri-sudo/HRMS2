import { useState } from "react";
import { Wallet } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ExitClearanceQueue } from "@/components/exit/ExitClearanceQueue";
import { NoticePeriodDrawer } from "@/components/exit/NoticePeriodDrawer";

export default function NativePayrollExitClearance() {
  const [drawerExitId, setDrawerExitId] = useState<string | null>(null);

  return (
    <DashboardLayout>
      <div className="relative mb-5 overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-600 to-blue-700 p-6 text-white shadow-lg">
        <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
        <p className="text-xs font-bold uppercase tracking-widest text-blue-100 flex items-center gap-1.5">
          <Wallet className="h-3.5 w-3.5" /> Payroll
        </p>
        <h1 className="mt-1 text-2xl font-bold text-white">Exit Clearance</h1>
        <p className="mt-1 text-sm text-blue-100">
          Salary hold, advances, notice recovery, leave encashment and F&amp;F readiness for employees serving notice.
        </p>
      </div>

      <ExitClearanceQueue
        ownerRole="payroll"
        title="Payroll Exit Clearance Queue"
        description="Click an employee row to view the full exit record. Clear or waive a payroll readiness task directly from this list."
        onRowClick={setDrawerExitId}
      />

      {drawerExitId && (
        <NoticePeriodDrawer
          exitId={drawerExitId}
          onClose={() => setDrawerExitId(null)}
        />
      )}
    </DashboardLayout>
  );
}
