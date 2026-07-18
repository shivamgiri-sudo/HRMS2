import { Route } from "react-router-dom";
import { lazy } from "./lazy";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";

const VisitorManagement         = lazy(() => import("@/pages/VisitorManagement"));
const VisitorApprovals          = lazy(() => import("@/pages/VisitorApprovals"));
const VisitorDesk               = lazy(() => import("@/pages/VisitorDesk"));
const VisitorSecurityOperations = lazy(() => import("@/pages/VisitorSecurityOperations"));

const SECURITY_ROLES = [
  "super_admin", "admin", "security_head",
  "visitor_security", "visitor_reception",
  "branch_head", "branch_hr", "hr_branch",
] as const;

export function VisitorRoutes() {
  return (
    <>
      <Route path="/visitor-management"           element={<ProtectedRoute><VisitorManagement /></ProtectedRoute>} />
      <Route path="/visitor-management/approvals" element={<ProtectedRoute><VisitorApprovals /></ProtectedRoute>} />
      <Route path="/visitor-management/desk"      element={<ProtectedRoute roles={[...SECURITY_ROLES]}><VisitorDesk /></ProtectedRoute>} />
      <Route path="/visitor-management/security"  element={<ProtectedRoute roles={[...SECURITY_ROLES]}><VisitorSecurityOperations /></ProtectedRoute>} />
    </>
  );
}
