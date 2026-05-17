import { ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useWorkforceAccess } from "@/hooks/useUserRole";

type WorkforcePageGateProps = {
  pageCode: string;
  children: ReactNode;
};

export default function WorkforcePageGate({ pageCode, children }: WorkforcePageGateProps) {
  const { isLoading, canViewPage, roleKeys } = useWorkforceAccess();

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="rounded-3xl border bg-white p-8 shadow-sm">
          <p className="text-sm font-semibold text-slate-500">Checking access...</p>
        </div>
      </DashboardLayout>
    );
  }

  if (!canViewPage(pageCode)) {
    return (
      <DashboardLayout>
        <div className="mx-auto max-w-2xl rounded-3xl border border-rose-200 bg-rose-50 p-8 text-center shadow-sm">
          <ShieldAlert className="mx-auto h-12 w-12 text-rose-600" />
          <h1 className="mt-4 text-2xl font-black text-rose-950">Access not available</h1>
          <p className="mt-3 text-sm leading-6 text-rose-800">
            Your current role does not have permission to open this Workforce OS page.
          </p>
          <p className="mt-3 rounded-2xl bg-white/70 px-4 py-3 text-xs font-semibold text-rose-700">
            Page Code: {pageCode} · Roles: {roleKeys.length ? roleKeys.join(", ") : "not mapped"}
          </p>
        </div>
      </DashboardLayout>
    );
  }

  return <>{children}</>;
}
