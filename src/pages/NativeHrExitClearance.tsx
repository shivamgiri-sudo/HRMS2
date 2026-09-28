import { useState } from "react";
import { UserCheck } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ExitClearanceQueue } from "@/components/exit/ExitClearanceQueue";
import { NoticePeriodDrawer } from "@/components/exit/NoticePeriodDrawer";

export default function NativeHrExitClearance() {
  const [drawerExitId, setDrawerExitId] = useState<string | null>(null);

  return (
    <DashboardLayout>
      <div className="relative mb-5 overflow-hidden rounded-2xl bg-gradient-to-br from-pink-600 via-rose-500 to-purple-600 p-6 text-white shadow-lg">
        <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
        <p className="text-xs font-bold uppercase tracking-widest text-pink-100 flex items-center gap-1.5">
          <UserCheck className="h-3.5 w-3.5" /> HR
        </p>
        <h1 className="mt-1 text-2xl font-bold text-white">Exit Clearance</h1>
        <p className="mt-1 text-sm text-pink-100">
          Exit interview, resignation acceptance and compliance/NDA closure for employees serving notice.
        </p>
      </div>

      <ExitClearanceQueue
        ownerRole="hr"
        title="HR Exit Clearance Queue"
        description="Click an employee row to view the full exit record. Clear or waive an interview/compliance task directly from this list."
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
