/**
 * Routes that are deliberately absent from the sidebar, each with the parent page it is
 * reached from.
 *
 * This replaces the flat `intentionallyNonSidebarRoutes` array that lived inside
 * app-shell-routing.contract.test.ts. That array recorded only that a route was allowed to
 * be hidden — not why, not who reaches it, and not from where. In practice it became a
 * place to silence the contract: adding a line made the test pass and asserted nothing.
 *
 * Every entry here must name a `parent` and an `accessPath`. If you cannot say how a user
 * reaches the page, that is the finding — the route is either unreachable, or it belongs in
 * navigation, or it should not be mounted at all. Do not add an entry to make a test green.
 *
 * `reason` is one of:
 *   'public'      unauthenticated by design (login, kiosk, QR landing)
 *   'contextual'  opened from a parent screen — a detail view, a sub-tab, an admin surface
 *   'redirect'    resolves an old or renamed URL to its current home
 *   'legacy'      retired page kept mounted so existing links do not 404
 */
export type HiddenRouteReason = "public" | "contextual" | "redirect" | "legacy";

export interface HiddenRoute {
  path: string;
  reason: HiddenRouteReason;
  /** The page a user is on when they reach this one. "—" only for `public`. */
  parent: string;
  /** How they get there: the control they click, or the link that points here. */
  accessPath: string;
}

/**
 * Settings surfaces added 01–02 Aug with the appointment-letter and provisioning work.
 *
 * Both are deliberately NOT in the sidebar pending a decision on where restricted Settings
 * pages belong. /settings/signing-certificate in particular holds the company signing
 * credential used to eSign appointment letters; before it is exposed in navigation it needs
 * its intended role set confirmed, its completeness verified, and its secret-at-rest
 * handling reviewed. Recording it here keeps it visible to the contract without granting it
 * a menu entry by default.
 */
export const HIDDEN_ROUTES: readonly HiddenRoute[] = [
  {
    path: "/settings/signing-certificate",
    reason: "contextual",
    parent: "Settings",
    accessPath:
      "Reached directly by an administrator configuring eSign. NOT in navigation pending " +
      "confirmation of intended roles, operational completeness, and how the certificate " +
      "secret is protected at rest. Owner decision required before it is surfaced.",
  },
  {
    path: "/settings/provisioning-recipients",
    reason: "contextual",
    parent: "Settings",
    accessPath:
      "Super Admin configures which addresses receive each branch's provisioning email. " +
      "Reached directly; NOT in navigation pending the same Settings/Security parent " +
      "decision as the signing certificate.",
  },
] as const;

export const HIDDEN_ROUTE_PATHS: readonly string[] = HIDDEN_ROUTES.map((r) => r.path);
