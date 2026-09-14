// src/pages/wfm/RosterCommandCenter.tsx
//
// Roster Command Center console — merges 7 previously separate WFM roster dashboard
// pages (Live Monitoring, Analytics, Trends & Publish, Compliance, Shift Effectiveness,
// Interventions, Audit Trail) plus one brand-new tab (Team Roster, Phase C) behind one
// tab bar with per-tab RBAC gating and a shared global filter bar (Branch / Process /
// From-To date range).
//
// Structural pattern copied directly from src/pages/wfm/AttendanceIntegrityConsole.tsx —
// this repo's own established precedent for exactly this kind of merge. See that file's
// header comment for the full rationale; the same mechanics apply here:
//
// --- Per-tab gating -----------------------------------------------------------------
// Each tab is keyed to its own new page code (see backend/sql/1757_roster_command_center_
// console_page_codes.sql) rather than the old shared WFM_ROSTER code, because the 7
// source pages' backends enforce 7 different role sets — one page code cannot express
// that union without over- or under-granting. A tab renders only when canViewPage(code)
// is true for that tab's code.
//
// --- URL sync -------------------------------------------------------------------------
// Active tab lives at `?tab=<key>`, alongside the shared filters `branchId`/`processId`/
// `from`/`to` — so a link like `?tab=compliance&branchId=xxx` is independently
// deep-linkable and refreshable. Switching tabs or changing a filter rewrites only its
// own key via the functional setSearchParams updater, so everything else survives.
//
// --- Lazy loading -----------------------------------------------------------------
// All 7 panels are behind React.lazy(), moved verbatim (Phase A of the merge plan) from
// their original standalone page files into ./roster-command-center/*Panel.tsx. Only the
// active tab's panel chunk + dataset loads — switching tabs triggers the next chunk.
//
// Phase A shipped this shell + verbatim panels + shared filter infrastructure. Phase B
// fixed the 18 cataloged bugs in each panel (broken branch filter, dead process-filter
// capability, the Compliance Violations/Overview domain mismatch, etc.). Phase C adds
// the new "Team Roster" color-coded panel (2nd tab, right after Live Monitoring) — see
// the approved merge plan for the full bug list and phasing.

import { lazy, Suspense, useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { ShieldAlert, RefreshCw } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { RequestAccessButton } from "@/components/security/WorkforcePageGate";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import {
  RosterConsoleFilterProvider,
  type RosterConsoleFilters,
} from "./roster-command-center/RosterConsoleFilterContext";
import { RosterConsoleFilterBar } from "./roster-command-center/RosterConsoleFilterBar";

const LiveMonitoringPanel = lazy(() => import("./roster-command-center/LiveMonitoringPanel"));
const ProcessTeamRosterPanel = lazy(() => import("./roster-command-center/ProcessTeamRosterPanel"));
const AnalyticsPanel = lazy(() => import("./roster-command-center/AnalyticsPanel"));
const TrendsPanel = lazy(() => import("./roster-command-center/TrendsPanel"));
const CompliancePanel = lazy(() => import("./roster-command-center/CompliancePanel"));
const ShiftEffectivenessPanel = lazy(() => import("./roster-command-center/ShiftEffectivenessPanel"));
const InterventionsPanel = lazy(() => import("./roster-command-center/InterventionsPanel"));
const AuditTrailPanel = lazy(() => import("./roster-command-center/AuditTrailPanel"));

type TabKey =
  | "live"
  | "team-roster"
  | "analytics"
  | "trends"
  | "compliance"
  | "shifts"
  | "interventions"
  | "audit";

type TabDef = {
  key: TabKey;
  label: string;
  /** New per-tab page code — see backend/sql/1757_roster_command_center_console_page_codes.sql */
  pageCode: string;
  Component: React.ComponentType;
};

const TAB_DEFS: TabDef[] = [
  { key: "live", label: "Live Monitoring", pageCode: "WFM_ROSTER_LIVE_MONITORING", Component: LiveMonitoringPanel },
  { key: "team-roster", label: "Team Roster", pageCode: "WFM_ROSTER_TEAM_ROSTER", Component: ProcessTeamRosterPanel },
  { key: "analytics", label: "Analytics", pageCode: "WFM_ROSTER_ANALYTICS", Component: AnalyticsPanel },
  { key: "trends", label: "Trends & Publish", pageCode: "WFM_ROSTER_TRENDS", Component: TrendsPanel },
  { key: "compliance", label: "Compliance", pageCode: "WFM_ROSTER_COMPLIANCE", Component: CompliancePanel },
  { key: "shifts", label: "Shift Effectiveness", pageCode: "WFM_ROSTER_SHIFT_EFFECTIVENESS", Component: ShiftEffectivenessPanel },
  { key: "interventions", label: "Interventions", pageCode: "WFM_ROSTER_INTERVENTIONS", Component: InterventionsPanel },
  { key: "audit", label: "Audit Trail", pageCode: "WFM_ROSTER_AUDIT_TRAIL", Component: AuditTrailPanel },
];

/** The code offered to the Request Access flow when no tab is visible at all. */
const DENIED_STATE_REQUEST_CODE = "WFM_ROSTER_LIVE_MONITORING";

function TabFallback() {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-slate-500">
      <RefreshCw className="h-5 w-5 animate-spin" />
      <span className="text-sm font-medium">Loading…</span>
    </div>
  );
}

function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export default function RosterCommandCenter() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { isResolved, isLoading, isError, error, canViewPage } = useWorkforceAccess();

  const requestedTab = searchParams.get("tab");

  // Gate tab visibility on isResolved, not !isLoading — canViewPage() reads false for
  // every code until page-access data lands, and computing visibleTabs before that would
  // flicker every tab off on first render.
  const visibleTabs = useMemo(
    () => (isResolved ? TAB_DEFS.filter((t) => canViewPage(t.pageCode)) : []),
    [isResolved, canViewPage],
  );

  const activeKey = useMemo<TabKey | null>(() => {
    if (!isResolved || visibleTabs.length === 0) return null;
    const found = visibleTabs.find((t) => t.key === requestedTab);
    return (found ?? visibleTabs[0]).key;
  }, [isResolved, visibleTabs, requestedTab]);

  // Keep the URL in step with the resolved tab, same self-correcting mechanic as
  // AttendanceIntegrityConsole — fills in a missing ?tab=, corrects one the viewer can't
  // see. Only the `tab` key is rewritten; the shared filters already on the URL survive.
  useEffect(() => {
    if (!isResolved || visibleTabs.length === 0 || !activeKey) return;
    if (requestedTab !== activeKey) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("tab", activeKey);
          return next;
        },
        { replace: true },
      );
    }
  }, [isResolved, visibleTabs.length, activeKey, requestedTab, setSearchParams]);

  const handleTabChange = useCallback(
    (nextKey: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("tab", nextKey);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Shared filter state — owned here, in the URL, so any tab+filter combination is
  // independently deep-linkable. Defaults: no branch/process filter, last 14 days
  // (matches TrendsPanel's own prior default before this merge).
  const filters: RosterConsoleFilters = useMemo(
    () => ({
      branchId: searchParams.get("branchId") ?? "",
      processId: searchParams.get("processId") ?? "",
      from: searchParams.get("from") ?? todayISO(-13),
      to: searchParams.get("to") ?? todayISO(),
    }),
    [searchParams],
  );

  const setBranchId = useCallback(
    (branchId: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (branchId) next.set("branchId", branchId);
        else next.delete("branchId");
        return next;
      }, { replace: true });
    },
    [setSearchParams],
  );

  const setProcessId = useCallback(
    (processId: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (processId) next.set("processId", processId);
        else next.delete("processId");
        return next;
      }, { replace: true });
    },
    [setSearchParams],
  );

  const setDateRange = useCallback(
    (from: string, to: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("from", from);
        next.set("to", to);
        return next;
      }, { replace: true });
    },
    [setSearchParams],
  );

  const filterContextValue = useMemo(
    () => ({ filters, setBranchId, setProcessId, setDateRange }),
    [filters, setBranchId, setProcessId, setDateRange],
  );

  let body: React.ReactNode;

  if (isLoading || !isResolved) {
    // Loading: page-access data hasn't resolved yet.
    body = (
      <div className="flex h-40 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-4 border-slate-200 border-t-slate-600" />
      </div>
    );
  } else if (isError) {
    // Error: could not verify access at all (auth/network failure).
    body = (
      <div className="mx-auto max-w-2xl rounded-3xl border border-amber-200 bg-amber-50 p-8 text-center shadow-sm">
        <ShieldAlert className="mx-auto h-12 w-12 text-amber-600" />
        <h1 className="mt-4 text-2xl font-black text-amber-950">Unable to verify access</h1>
        <p className="mt-3 text-sm leading-6 text-amber-800">
          Could not load your permissions. This may be a temporary issue.
        </p>
        {error && <p className="mt-2 text-xs text-amber-700">{String(error)}</p>}
        <Button
          variant="outline"
          size="sm"
          className="mt-4 border-amber-300 text-amber-700 hover:bg-amber-100"
          onClick={() => window.location.reload()}
        >
          Refresh Page
        </Button>
      </div>
    );
  } else if (visibleTabs.length === 0 || !activeKey) {
    // Denied: resolved, but no tab's page code is visible to this viewer.
    body = (
      <div className="mx-auto max-w-2xl rounded-3xl border border-rose-200 bg-rose-50 p-8 text-center shadow-sm">
        <ShieldAlert className="mx-auto h-12 w-12 text-rose-600" />
        <h1 className="mt-4 text-2xl font-black text-rose-950">Access not available</h1>
        <p className="mt-3 text-sm leading-6 text-rose-800">
          Your current role does not have permission to open this Workforce OS page.
        </p>
        <p className="mt-3 rounded-2xl bg-white/70 px-4 py-3 text-xs font-semibold text-rose-700">
          Contact your administrator or use the button below to request access.
        </p>
        <RequestAccessButton pageCode={DENIED_STATE_REQUEST_CODE} />
      </div>
    );
  } else {
    body = (
      <RosterConsoleFilterProvider value={filterContextValue}>
        <div className="space-y-6">
          <div className="rounded-2xl bg-gradient-to-r from-teal-600 via-cyan-600 to-blue-600 p-6 text-white shadow-lg shadow-teal-500/20">
            <p className="text-xs font-semibold uppercase tracking-widest text-teal-100">WFM · Roster</p>
            <h1 className="mt-1 text-2xl font-bold">Roster Command Center</h1>
            <p className="mt-1 max-w-2xl text-sm text-teal-100">
              Live attendance, analytics, compliance, shift effectiveness, interventions and audit
              trail — one console, gated per tab to what your role can open.
            </p>
            <div className="mt-4">
              <RosterConsoleFilterBar />
            </div>
          </div>

          <Tabs value={activeKey} onValueChange={handleTabChange}>
            <TabsList className="h-auto w-full flex-nowrap justify-start gap-1 overflow-x-auto">
              {visibleTabs.map((t) => (
                <TabsTrigger
                  key={t.key}
                  value={t.key}
                  className="min-h-11 min-w-11 flex-shrink-0 px-4 text-xs sm:text-sm"
                >
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>

            {visibleTabs.map((t) => (
              // Radix only mounts the active TabsContent's children, so only the selected
              // panel's lazy chunk (and its data fetch) is triggered.
              <TabsContent key={t.key} value={t.key} className="mt-4">
                <Suspense fallback={<TabFallback />}>
                  <t.Component />
                </Suspense>
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </RosterConsoleFilterProvider>
    );
  }

  // This is the PAGE component only — it does not self-wrap in <DashboardLayout>, exactly
  // like AttendanceIntegrityConsole.tsx. The route wires DashboardLayout (see
  // workforce.routes.tsx's /wfm/roster-command-center entry) and owns wrapper placement.
  return <div className="p-4 sm:p-6">{body}</div>;
}
