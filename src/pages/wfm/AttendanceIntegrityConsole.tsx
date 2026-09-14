// src/pages/wfm/AttendanceIntegrityConsole.tsx
//
// Attendance Integrity console — Task 5 (console shell) of the WFM attendance-page
// merge. Wraps the four panels built in Tasks 1-4 (Exceptions, Mismatches, Biometric
// Sync, Billing Rules) behind one tab bar with per-tab RBAC gating.
//
// This is the PAGE component only — it does not self-wrap in <DashboardLayout>. Task 6
// wires the route and owns wrapper placement, exactly the way the four panels
// themselves assume a page shell around them (see each panel's own header comment).
//
// --- Per-tab gating -----------------------------------------------------------------
// Each tab is keyed to the existing page code its panel's data already requires (the
// plan's "Target design" table). The route carries no single Gate wrapper on purpose —
// one page code cannot express the union of all four panels' audiences. A tab renders
// only when `canViewPage(code)` is true for that tab's code, so a branch-scoped role
// that can open (say) Mismatches and Biometric Sync but not Billing Rules sees exactly
// those two tabs — never a tab that 403s the moment it's opened.
//
// `isResolved` (see useUserRole.ts) is false until page-access data has actually
// loaded; `canViewPage` returns false for every code until then. Computing visible tabs
// before `isResolved` flips would render "Access not available" for one frame on every
// load, even for a super_admin — so this component shows a loading state instead of
// computing tab visibility until `isResolved` is true.
//
// If zero tabs are visible once resolved, this renders the same "Access not available"
// panel WorkforcePageGate renders elsewhere in the app, reusing its actual
// RequestAccessButton (now exported from that file — a review of this task flagged the
// original duplicate copy as a maintenance risk) so the two surfaces cannot drift apart.
// The four page codes this console covers don't collapse to one `page_code` value the
// request-access API can take (POST /api/access/access-requests requires exactly one),
// so the button here requests WFM_ATTENDANCE_EXCEPTIONS — the first tab in the
// target-design table — as the representative code; see task-5-report.md for the
// reasoning behind that choice.
//
// --- URL sync -------------------------------------------------------------------------
// Active tab lives at `?tab=<key>`. Switching tabs rewrites only the `tab` key via the
// functional `setSearchParams` updater, so any other query params already in the URL —
// the `issueType` / `status` / `severity` filters the Task 6 deep links (and
// ExceptionsPanel's own filter bar) attach — survive the switch untouched. An absent or
// unrecognised `?tab=` (a stale bookmark, a viewer who lost a grant, a typo) falls back
// to the first visible tab rather than rendering an empty shell, and the URL is then
// corrected to match so the link that gets shared back out is always valid.
//
// --- Lazy loading -----------------------------------------------------------------
// All four panels are behind React.lazy(). Each tab's content is mounted only when that
// tab is active (Radix's TabsContent does not render inactive tabs' children), so
// opening the console fetches one panel's chunk and dataset, not all four — switching
// tabs is what triggers the next chunk.

import { lazy, Suspense, useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { ShieldAlert, RefreshCw } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { RequestAccessButton } from "@/components/security/WorkforcePageGate";
import { useWorkforceAccess } from "@/hooks/useUserRole";

const ExceptionsPanel = lazy(() => import("@/pages/wfm/attendance-integrity/ExceptionsPanel"));
const MismatchesPanel = lazy(() => import("@/pages/wfm/attendance-integrity/MismatchesPanel"));
const BiometricSyncPanel = lazy(() => import("@/pages/wfm/attendance-integrity/BiometricSyncPanel"));
const BillingRulesPanel = lazy(() => import("@/pages/wfm/attendance-integrity/BillingRulesPanel"));

type TabKey = "exceptions" | "mismatches" | "biometric" | "billing";

type TabDef = {
  key: TabKey;
  label: string;
  /** Existing page code that gates this tab — see the plan's Target design table. */
  pageCode: string;
  Component: React.ComponentType;
};

const TAB_DEFS: TabDef[] = [
  { key: "exceptions", label: "Exceptions", pageCode: "WFM_ATTENDANCE_EXCEPTIONS", Component: ExceptionsPanel },
  { key: "mismatches", label: "Mismatches", pageCode: "WFM_LIVE_TRACKER", Component: MismatchesPanel },
  { key: "biometric", label: "Biometric Sync", pageCode: "WFM_LIVE_TRACKER", Component: BiometricSyncPanel },
  { key: "billing", label: "Billing Rules", pageCode: "ATTENDANCE_BILLING_CONFIG", Component: BillingRulesPanel },
];

/** The code offered to the Request Access flow when no tab is visible at all. */
const DENIED_STATE_REQUEST_CODE = "WFM_ATTENDANCE_EXCEPTIONS";

function TabFallback() {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-slate-500">
      <RefreshCw className="h-5 w-5 animate-spin" />
      <span className="text-sm font-medium">Loading…</span>
    </div>
  );
}

export default function AttendanceIntegrityConsole() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { isResolved, isLoading, isError, error, canViewPage } = useWorkforceAccess();

  const requestedTab = searchParams.get("tab");

  // Gate tab visibility on isResolved, not !isLoading — see useUserRole.ts's isResolved
  // caveat. canViewPage() reads false for every code until page-access data lands, and
  // computing visibleTabs before that would flicker every tab off on first render.
  const visibleTabs = useMemo(
    () => (isResolved ? TAB_DEFS.filter((t) => canViewPage(t.pageCode)) : []),
    [isResolved, canViewPage],
  );

  const activeKey = useMemo<TabKey | null>(() => {
    if (!isResolved || visibleTabs.length === 0) return null;
    const found = visibleTabs.find((t) => t.key === requestedTab);
    return (found ?? visibleTabs[0]).key;
  }, [isResolved, visibleTabs, requestedTab]);

  // Keep the URL in step with the resolved tab: fills in a missing ?tab=, and corrects
  // one that names a tab the viewer can't see (or that doesn't exist) to the fallback —
  // so a link copied back out of the page is always one the recipient can open. Only the
  // `tab` key is rewritten; every other param already on the URL (a panel's own filters)
  // is carried through untouched via the functional setSearchParams updater.
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

  // Loading: page-access data hasn't resolved yet. Same minimal inline spinner
  // WorkforcePageGate shows in the equivalent state.
  if (isLoading || !isResolved) {
    return (
      <div className="flex h-40 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-4 border-slate-200 border-t-slate-600" />
      </div>
    );
  }

  // Error: could not verify access at all (auth/network failure). Matches
  // WorkforcePageGate's isError branch, minus the DashboardLayout wrapper this
  // component deliberately doesn't own (Task 6 supplies page chrome).
  if (isError) {
    return (
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
  }

  // Denied: resolved, but no tab's page code is visible to this viewer. Pixel-identical
  // to WorkforcePageGate's "Access not available" panel — same copy, same structure,
  // same Request Access button — minus the DashboardLayout wrapper Task 6 owns.
  if (visibleTabs.length === 0 || !activeKey) {
    return (
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
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">WFM · Attendance</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Attendance Integrity</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Exceptions, mismatches, biometric sync health and billing rules for attendance data — one
          console, gated per tab to what your role can open.
        </p>
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
          // panel's lazy chunk (and its data fetch) is triggered — switching tabs is
          // what loads the next one.
          <TabsContent key={t.key} value={t.key} className="mt-4">
            <Suspense fallback={<TabFallback />}>
              <t.Component />
            </Suspense>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
