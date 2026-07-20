import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { AmbientStrip } from "./AmbientStrip";
import { CommandPalette } from "./CommandPalette";

// Routes where the ambient strip is shown
const AMBIENT_ROUTES = [
  "/dashboard",
  "/my-dashboard",
  "/ceo/dashboard",
  "/operations/dashboard",
  "/operations-dashboard",
  "/quality/dashboard",
  "/quality-dashboard",
  "/wfm/dashboard",
  "/wfm-attendance",
  "/hr/dashboard",
  "/manager/dashboard",
  "/recruiter-dashboard",
  "/payroll-hr/dashboard",
  "/call-master",
  "/attendance",
  "/reports",
  "/work-inbox",
];

// Routes where neither strip nor palette should appear
const HIDDEN_ROUTES = [
  "/auth",
  "/login",
  "/register",
  "/peopleos/copilot",
  "/candidate-form",
  "/interview-registration",
  "/onboard",
  "/display/",
  "/break-desk",
  "/candidate-portal",
  "/portal/",
];

const ROUTE_CONTEXT: Record<string, string> = {
  "/dashboard":             "generic",
  "/my-dashboard":          "employee_self",
  "/ceo/dashboard":         "executive_dashboard",
  "/operations/dashboard":  "operations",
  "/operations-dashboard":  "operations",
  "/quality/dashboard":     "quality_operations",
  "/quality-dashboard":     "quality_operations",
  "/wfm/dashboard":         "wfm_roster",
  "/wfm-attendance":        "wfm_roster",
  "/hr/dashboard":          "hr_operations",
  "/manager/dashboard":     "manager_team",
  "/recruiter-dashboard":   "ats_recruiter",
  "/payroll-hr/dashboard":  "payroll_readiness",
  "/call-master":           "operations",
  "/attendance":            "wfm_roster",
};

function getContextType(pathname: string): string {
  if (ROUTE_CONTEXT[pathname]) return ROUTE_CONTEXT[pathname];
  for (const [route, ctx] of Object.entries(ROUTE_CONTEXT)) {
    if (pathname.startsWith(route + "/")) return ctx;
  }
  return "generic";
}

export function AICommandBar() {
  const { user } = useAuth();
  const location = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);

  const pathname = location.pathname;
  const isHidden = !user || HIDDEN_ROUTES.some((r) => pathname.startsWith(r));
  const showStrip = !isHidden && AMBIENT_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"));
  const contextType = getContextType(pathname);

  // Global ⌘K / Ctrl+K handler — capture phase overrides old handler in CompactDashboardLayout
  useEffect(() => {
    if (isHidden) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        e.stopPropagation();
        setPaletteOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [isHidden]);

  if (isHidden) return null;

  return (
    <>
      {showStrip && (
        <AmbientStrip
          contextType={contextType}
          onOpen={() => setPaletteOpen(true)}
        />
      )}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
      />
    </>
  );
}
