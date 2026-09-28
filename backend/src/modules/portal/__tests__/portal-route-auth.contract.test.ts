/**
 * Every client-portal route must be behind an authentication boundary.
 *
 * WHY THIS EXISTS
 * ---------------
 * portal.routes.ts does NOT do `router.use(requireClientAuth)`. The client guard is applied
 * to three specific path prefixes instead:
 *
 *     router.use("/overview",   requireClientAuth);
 *     router.use("/processes",  requireClientAuth);
 *     router.use("/commentary", requireClientAuth);
 *
 * Every client route today happens to sit under one of those, so the portal is correctly
 * gated as it stands — this test is not reporting a live hole. It exists because the pattern
 * fails open: a new client-facing route added under a fourth prefix (say `/reports`) gets NO
 * client authentication at all, and nothing would say so. The portal serves per-client
 * process data, so an unguarded route there is a cross-client data leak, which CLAUDE.md
 * treats as a hard boundary ("Client Portal restricted to each client's mapped process").
 *
 * The e2e suite does not cover this. `e2e/pending-items.smoke.ts`'s "item 92" test injects an
 * `employee` HRMS session and calls an HRMS payroll endpoint — it never touches client auth,
 * which is a separate middleware (requireClientAuth) reading a different JWT claim
 * (clientUserId, demo sentinel `u-demo-`). That test passes without exercising the client
 * boundary at all.
 *
 * Source-text assertion, matching the repo's other route-contract tests: the property being
 * protected is structural — which middleware covers which path — and is knowable statically.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(
  resolve(process.cwd(), "src/modules/portal/portal.routes.ts"), "utf8");

/**
 * Routes that are unauthenticated on purpose.
 *   /health          — liveness probe, returns no client data
 *   /auth/request-otp, /auth/verify-otp — the login handshake itself; requiring a session
 *                      to obtain a session is impossible.
 */
const PUBLIC_BY_DESIGN = new Set(["/health", "/auth/request-otp", "/auth/verify-otp"]);

/** `router.use("<prefix>", <guard>)` — the prefix-level boundaries. */
function guardedPrefixes(guard: string): string[] {
  const out: string[] = [];
  for (const m of SRC.matchAll(/router\.use\(\s*"([^"]+)"\s*,\s*([A-Za-z_][A-Za-z0-9_]*)/g)) {
    if (m[2] === guard) out.push(m[1]);
  }
  return out;
}

/**
 * Every route path declared on the portal router, including multi-line declarations, plus
 * whether that SAME declaration also names a guard inline as one of its own middleware
 * arguments (e.g. `router.post("/auth/logout", requireClientAuth, h(c.logout))`).
 *
 * The original version of this helper only recorded the path, so a route guarded
 * per-route rather than via a `router.use(prefix, guard)` block (both real, both used in
 * this file — /auth/change-password predates this test and already used the inline form)
 * was invisible to `coveredBy` below and always counted as unguarded. Found live: adding
 * /auth/logout and /auth/reset-password (both correctly `requireClientAuth`-gated inline,
 * confirmed working end-to-end against the real DB) failed this test, and checking
 * revealed /auth/change-password would have failed it too had anyone run it before.
 */
function declaredRoutes(): Array<{ path: string; inlineGuards: string[] }> {
  const out: Array<{ path: string; inlineGuards: string[] }> = [];
  // Capture from the opening `router.<verb>(` through the matching top-level `)` so a
  // multi-line declaration's later arguments (the guard, the handler) are visible too.
  // Non-greedy up to the first `);` at the start of a line keeps this from swallowing
  // past the end of one route declaration into the next.
  for (const m of SRC.matchAll(/router\.(?:get|post|put|patch|delete)\s*\(\s*"([^"]+)"([\s\S]*?)\n\);/g)) {
    const path = m[1];
    const rest = m[2];
    const inlineGuards = [...rest.matchAll(/\b(requireClientAuth|requireAuth)\b/g)].map((g) => g[1]);
    out.push({ path, inlineGuards });
  }
  return out;
}

const CLIENT_PREFIXES = guardedPrefixes("requireClientAuth");
const STAFF_PREFIXES = guardedPrefixes("requireAuth");
const ROUTES_DETAILED = declaredRoutes();
const ROUTES = ROUTES_DETAILED.map((r) => r.path);

const coveredByPrefix = (path: string, prefixes: string[]): boolean =>
  prefixes.some((p) => path === p || path.startsWith(p.endsWith("/") ? p : `${p}/`));

const coveredBy = (path: string, prefixes: string[], guardName: "requireClientAuth" | "requireAuth"): boolean =>
  coveredByPrefix(path, prefixes) ||
  ROUTES_DETAILED.some((r) => r.path === path && r.inlineGuards.includes(guardName));

describe("client portal — every route sits behind an auth boundary", () => {
  it("parses the router (guards the guard)", () => {
    // If the file is restructured such that these come back empty, the coverage assertion
    // below would pass vacuously. Fail here instead.
    expect(ROUTES.length).toBeGreaterThan(10);
    expect(CLIENT_PREFIXES.length).toBeGreaterThan(0);
    expect(STAFF_PREFIXES).toContain("/internal");
  });

  it("keeps requireClientAuth on the client-facing prefixes", () => {
    for (const p of ["/overview", "/processes", "/commentary"]) {
      expect(CLIENT_PREFIXES, `${p} lost its requireClientAuth boundary`).toContain(p);
    }
  });

  it("leaves no portal route unauthenticated", () => {
    const unguarded = ROUTES.filter(
      (path) =>
        !PUBLIC_BY_DESIGN.has(path) &&
        !coveredBy(path, CLIENT_PREFIXES, "requireClientAuth") &&
        !coveredBy(path, STAFF_PREFIXES, "requireAuth"),
    );
    expect(
      [...new Set(unguarded)].sort(),
      "portal routes with neither requireClientAuth nor requireAuth covering them — the " +
      "portal serves per-client process data, so an unguarded route here leaks across clients",
    ).toEqual([]);
  });

  it("keeps every staff-only /internal route behind a role check as well as a session", () => {
    // requireAuth proves *an* employee; it does not prove the right employee. The internal
    // endpoints publish and edit client-visible content, so they carry requireRole too.
    const internal = ROUTES.filter((p) => p.startsWith("/internal"));
    expect(internal.length).toBeGreaterThan(5);

    const roleGuardCount = (SRC.match(/requireRole\(/g) ?? []).length;
    expect(
      roleGuardCount,
      "every /internal portal route should carry its own requireRole in addition to requireAuth",
    ).toBeGreaterThanOrEqual(internal.length);
  });
});
