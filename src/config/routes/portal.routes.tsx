import { Route } from "react-router-dom";
import { lazy } from "./lazy";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { PortalRoute } from "@/components/portal/PortalRoute";

const PortalOverview         = lazy(() => import("@/pages/portal/PortalOverview"));
const PortalProcessDashboard = lazy(() => import("@/pages/portal/PortalProcessDashboard"));
const SuperAdminDashboardV2  = lazy(() => import("@/pages/SuperAdminDashboardV2"));

export const portalRouteElements = (
  <>
      {/* Client Portal — authenticated surfaces (/portal/login is in public.routes) */}
      <Route path="/portal"               element={<PortalRoute><PortalOverview /></PortalRoute>} />
      <Route path="/portal/processes/:id" element={<PortalRoute><PortalProcessDashboard /></PortalRoute>} />

      {/* Super admin portal */}
      <Route path="/super-admin/dashboard" element={<ProtectedRoute roles={['super_admin','admin']}><SuperAdminDashboardV2 /></ProtectedRoute>} />

      {/* Public kiosk displays and candidate portal are declared in public.routes */}
  </>
);
