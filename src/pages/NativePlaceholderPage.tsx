import { DashboardLayout } from "@/components/layout/DashboardLayout";
import LMSIntegrationAdmin from "./LMSIntegrationAdmin";
import LMSProgressDashboard from "./LMSProgressDashboard";
import NativeWFMLiveTracker from "./NativeWFMLiveTracker";
import NativeQualityDashboard from "./NativeQualityDashboard";
import NativeOperationsDashboard from "./NativeOperationsDashboard";

export default function NativePlaceholderPage({ title, module }: { title: string; module: string }) {
  if (title === "LMS Admin") {
    return <LMSIntegrationAdmin />;
  }

  if (title === "LMS Management Dashboard") {
    return <LMSProgressDashboard />;
  }

  if (title === "WFM Live Tracker") {
    return <NativeWFMLiveTracker />;
  }

  if (title === "Quality Dashboard") {
    return <NativeQualityDashboard />;
  }

  if (title === "Operations Dashboard") {
    return <NativeOperationsDashboard />;
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
