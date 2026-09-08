import { ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { RequestAccessButton } from "@/components/security/WorkforcePageGate";

/**
 * Per-tab RBAC for pages that merged several former screens into one tabbed page.
 *
 * WHY THIS EXISTS
 * ---------------
 * Access resolves one page code per URL: ProtectedRoute reads PAGE_CODE_BY_ROUTE for
 * location.pathname, and WorkforcePageGate checks the code the route hands it. A tab is
 * not a URL, so nothing checked it — once a merge folded N screens behind one code, one
 * grant opened all N. Payment Center is the clearest case: a single
 * PAYROLL_BANK_READINESS grant opened bank readiness, the payment-file export, disbursal
 * status, CSV upload and manual payment entry.
 *
 * The merges did not delete the codes the folded screens used, and the grants for them
 * are still in role_page_access. This hook points the tabs back at those existing codes;
 * it introduces no new codes of its own.
 *
 * NOT A SECURITY BOUNDARY. Every payroll endpoint behind these tabs enforces its own
 * role check (requireRole / hasAnyRole). This decides what the UI offers, so a user is
 * not handed a console whose every request would 403.
 */
export type TabPageCodes = Record<string, string>;

export type TabAccess = {
  /** True when the tab may be shown to this viewer. */
  canViewTab: (tab: string) => boolean;
  /** Tabs this viewer may see, in the order they were declared. */
  visibleTabs: string[];
  /**
   * The tab to render: the requested one when permitted, else the first permitted tab.
   * Null only when the viewer may see none of them — see NoTabAccess.
   */
  activeTab: string | null;
};

export function useTabAccess(
  tabPageCodes: TabPageCodes,
  requestedTab: string | null | undefined,
): TabAccess {
  const { canViewPage, isResolved } = useWorkforceAccess();
  const tabs = Object.keys(tabPageCodes);

  // canViewPage returns false for every code until the access query resolves, which would
  // briefly hide every tab. That render is not reachable in practice — ProtectedRoute holds
  // a spinner until isResolved before it mounts the page at all — but treating the tabs as
  // visible while unresolved keeps this hook safe if it is ever used outside that gate, and
  // costs nothing: the tab's own API calls still enforce the role.
  const visibleTabs = isResolved ? tabs.filter((tab) => canViewPage(tabPageCodes[tab])) : tabs;

  const canViewTab = (tab: string) => visibleTabs.includes(tab);
  const activeTab =
    requestedTab && canViewTab(requestedTab) ? requestedTab : visibleTabs[0] ?? null;

  return { canViewTab, visibleTabs, activeTab };
}

/**
 * Rendered in place of the tab strip when a viewer holds the page grant but none of the
 * per-tab grants. Reuses WorkforcePageGate's own request-access control rather than a
 * second copy, so the request path is identical to the page-level denial.
 */
export function NoTabAccess({ pageCode, children }: { pageCode: string; children?: ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl rounded-3xl border border-rose-200 bg-rose-50 p-8 text-center shadow-sm">
      <ShieldAlert className="mx-auto h-12 w-12 text-rose-600" />
      <h1 className="mt-4 text-2xl font-black text-rose-950">No sections available</h1>
      <p className="mt-3 text-sm leading-6 text-rose-800">
        {children ??
          "Your role can open this page but none of its sections. Request access below and an administrator will review it."}
      </p>
      <RequestAccessButton pageCode={pageCode} />
    </div>
  );
}
