import type { ComponentType } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import CallMasterDashboard from "./upstream/CallMasterDashboard";
import OpeningIntelligenceDashboard from "./upstream/OpeningIntelligenceDashboard";
import CustomerIntelligenceDashboard from "./upstream/CustomerIntelligenceDashboard";
import OutboundSalesDashboard from "./upstream/OutboundSalesDashboard";

/*
 * Pages for the dashboards synced from tausifansari-mcn/Mydashboards (scripts/sync-mydashboards.mjs). Upstream
 * renders bare content inside its own shell; here each one sits in the HRMS dashboard layout.
 */
const inLayout = (Page: ComponentType) => () => (
  <DashboardLayout>
    <Page />
  </DashboardLayout>
);

export const CallMasterPage = inLayout(CallMasterDashboard);
export const OpeningIntelligencePage = inLayout(OpeningIntelligenceDashboard);
export const CustomerIntelligencePage = inLayout(CustomerIntelligenceDashboard);
export const OutboundSalesPage = inLayout(OutboundSalesDashboard);
