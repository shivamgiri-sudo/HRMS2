import { DashboardLayout } from "@/components/layout/DashboardLayout";
import NativeLMSAdmin from "./NativeLMSAdmin";
import NativeLMSManagementDashboard from "./NativeLMSManagementDashboard";
import NativeWFMLiveTracker from "./NativeWFMLiveTracker";

export default function NativePlaceholderPage({ title, module }: { title: string; module: string }) {
  if (title === "LMS Admin") {
    return <NativeLMSAdmin />;
  }

  if (title === "LMS Management Dashboard") {
    return <NativeLMSManagementDashboard />;
  }

  if (title === "WFM Live Tracker") {
    return <NativeWFMLiveTracker />;
  }

  return (
    <DashboardLayout>
      <div className="rounded-3xl border bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">{module}</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-950">{title}</h1>
        <p className="mt-3 max-w-3xl text-slate-600">
          Native page placeholder is ready. This route is inside HRMS and will be expanded with production workflows in the next build phase.
        </p>
      </div>
    </DashboardLayout>
  );
}
