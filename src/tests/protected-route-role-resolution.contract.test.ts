import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/**
 * The CEO UAT reported "Access Denied for several seconds" on /ceo/dashboard before the
 * page rendered normally.
 *
 * The mechanism: useUserRole is `enabled: !!user?.id`, and React Query v5 computes
 * isLoading as `isPending && isFetching`. A disabled query — and the first render after it
 * becomes enabled, before the fetch effect runs — reports isLoading === false while data is
 * still undefined. roleKeys then falls back to [], which is indistinguishable from "this
 * user has no roles", and every denial branch in ProtectedRoute fires.
 *
 * "Not loading" and "loaded" are therefore different states, and denial must wait for the
 * second one.
 */
describe("ProtectedRoute role resolution", () => {
  const hook = read("src/hooks/useUserRole.ts");
  const guard = read("src/components/auth/ProtectedRoute.tsx");

  it("exposes resolution separately from loading on both access hooks", () => {
    // Derived from `data !== undefined`, not from isLoading — that is the whole point.
    const matches = [...hook.matchAll(/isResolved:\s*(.+?),/g)].map((m) => m[1].trim());
    expect(matches.length).toBeGreaterThanOrEqual(2);
    for (const expression of matches) {
      expect(expression).toContain("!== undefined");
      expect(expression).not.toContain("isLoading");
    }
  });

  it("blocks every denial branch until roles and page access have resolved", () => {
    expect(guard).toContain("isResolved: isRoleResolved");
    expect(guard).toContain("isResolved: isAccessResolved");
    expect(guard).toContain("if (!isRoleResolved || !isAccessResolved)");
  });

  it("holds the resolution gate ahead of the first denial", () => {
    // If any Access Denied branch preceded the gate it would still render on the
    // unresolved frame, which is exactly the defect.
    const gate = guard.indexOf("if (!isRoleResolved || !isAccessResolved)");
    // Match the rendered element, not the phrase — the explanatory comment above the gate
    // contains the words "Access Denied" and a bare indexOf finds that first.
    const firstDenial = guard.indexOf("<CardTitle>Access Denied</CardTitle>");
    expect(gate).toBeGreaterThan(-1);
    expect(firstDenial).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(firstDenial);
  });

  it("keeps the signed-out redirect ahead of the gate", () => {
    // The query never resolves without a user, so gating before this redirect would
    // replace a redirect to /auth with a spinner that never ends.
    const redirect = guard.indexOf('if (!user) {');
    const gate = guard.indexOf("if (!isRoleResolved || !isAccessResolved)");
    expect(redirect).toBeGreaterThan(-1);
    expect(redirect).toBeLessThan(gate);
  });

  it("still surfaces a role query error rather than spinning on it", () => {
    // An errored query also leaves data undefined; the error branch must win.
    const errorBranch = guard.indexOf("if (roleError || isAccessError)");
    const gate = guard.indexOf("if (!isRoleResolved || !isAccessResolved)");
    expect(errorBranch).toBeGreaterThan(-1);
    expect(errorBranch).toBeLessThan(gate);
  });
});
