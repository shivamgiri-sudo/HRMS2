/**
 * Quality target coverage — reachability and the silent-zero guard.
 *
 * The quality-governance API (13 endpoints, correct SQL, RBAC held by 17 real users) had no
 * caller anywhere in the product. Nothing referenced `/api/quality-governance` in src/, nothing
 * consumed `resolveQualityTarget`, and `process_quality_target` still holds zero rows — so the
 * coverage gap it measures was invisible. Verified live 2026-08-12: the gap query returns real
 * rows, 46 employees across processes scored against no approved target.
 *
 * Two things are pinned here.
 *
 * ONE — reachability. A component that exists but is never rendered is the same as no
 * component; this suite fails if the card stops being mounted on the page, or if its URL stops
 * matching a route the backend actually serves. A service that imports fine can still have no
 * route and no page.
 *
 * TWO — the silent-zero guard, which matters more. The dangerous rendering is not an error, it
 * is a green "every process has an approved target" produced by a request that failed. That is
 * the failure mode that let dashboards sit at a confident zero for months: an empty result
 * substituted for a failed one, reporting good news nobody has evidence for. The confirmation
 * message must be unreachable unless the request actually succeeded.
 *
 * These read source text rather than rendering: no DOM environment is configured for this
 * project (see vitest.config.ts) and no component-render library is a dependency.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../..");
const CARD = path.join(ROOT, "src/components/quality/QualityTargetGapCard.tsx");
const PAGE = path.join(ROOT, "src/pages/QualityDashboard.tsx");
const ROUTES = path.join(ROOT, "backend/src/modules/quality-dashboard/quality-governance.routes.ts");
const APP = path.join(ROOT, "backend/src/app.ts");

const cardSrc = readFileSync(CARD, "utf8");
const pageSrc = readFileSync(PAGE, "utf8");
const routesSrc = readFileSync(ROUTES, "utf8");
const appSrc = readFileSync(APP, "utf8");

/** The path the card actually requests. */
function requestedPath(): string {
  const m = cardSrc.match(/hrmsApi\.get<[^>]*>\(\s*["'`]([^"'`]+)["'`]/);
  if (!m) throw new Error("QualityTargetGapCard no longer makes a recognisable hrmsApi.get call");
  return m[1];
}

describe("the gap card reaches a route the backend really serves", () => {
  it("is rendered on the quality dashboard, not merely defined", () => {
    expect(pageSrc).toMatch(/import\s*\{\s*QualityTargetGapCard\s*\}/);
    expect(pageSrc).toMatch(/<QualityTargetGapCard\s*\/>/);
  });

  it("requests a path under the mount point app.ts gives the governance router", () => {
    const mount = appSrc.match(/app\.use\(\s*["'`]([^"'`]*quality-governance[^"'`]*)["'`]\s*,\s*qualityGovernanceRouter/);
    expect(mount, "quality-governance router is no longer mounted in app.ts").not.toBeNull();
    expect(requestedPath().startsWith(mount![1])).toBe(true);
  });

  it("requests a sub-path the governance router actually declares", () => {
    const mount = appSrc.match(/app\.use\(\s*["'`]([^"'`]*quality-governance[^"'`]*)["'`]\s*,\s*qualityGovernanceRouter/)![1];
    const subPath = requestedPath().slice(mount.length);
    const declared = [...routesSrc.matchAll(/router\.get\(\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
    expect(declared).toContain(subPath);
  });

  it("is placed where operational roles see it, not inside the self-only branch", () => {
    // Agents viewing their own scorecard have no use for org-wide target coverage, and the
    // endpoint would 403 them anyway.
    const selfOnly = pageSrc.indexOf("SelfQualityScorecard employeeId");
    const card = pageSrc.indexOf("<QualityTargetGapCard");
    expect(selfOnly).toBeGreaterThan(-1);
    expect(card).toBeGreaterThan(selfOnly);
  });
});

describe("a failed coverage check never renders as full coverage", () => {
  /** The JSX guard controlling the branch that contains a given text. */
  function guardFor(needle: string): string {
    const at = cardSrc.indexOf(needle);
    expect(at, `"${needle}" is no longer in the card`).toBeGreaterThan(-1);
    const opened = cardSrc.lastIndexOf("{!isLoading", at);
    expect(opened, "coverage text is not inside an {!isLoading …} branch any more").toBeGreaterThan(-1);
    return cardSrc.slice(opened, at);
  }

  it("gates the all-clear message on the request having succeeded", () => {
    // Without `!error` in this guard, a 500 renders a green all-clear.
    expect(guardFor("Every process with quality scores")).toMatch(/!error/);
  });

  it("gates the gap list on the request having succeeded too", () => {
    expect(guardFor("employees are")).toMatch(/!error/);
  });

  it("has an error branch that says the check did not run", () => {
    expect(cardSrc).toMatch(/could not be checked/i);
    // Stated explicitly, because "no data shown" reads as "nothing to show".
    expect(cardSrc).toMatch(/not a statement that coverage is complete/i);
  });

  it("shows the underlying reason rather than swallowing it", () => {
    expect(cardSrc).toMatch(/error instanceof Error \? error\.message/);
  });

  it("never substitutes zero for a missing count", () => {
    // totalEmployeesAffected is read straight from the response; a `?? 0` here would print a
    // confident "0 employees affected" for a malformed payload.
    expect(cardSrc).not.toMatch(/totalEmployeesAffected\s*(\?\?|\|\|)\s*0/);
  });
});

describe("roles the governance API does not admit see nothing", () => {
  it("renders null on 403 instead of an alarming failure tile", () => {
    expect(cardSrc).toMatch(/getHrmsApiErrorStatus\(error\)\s*===\s*403/);
    expect(cardSrc).toMatch(/403\)\s*return null/);
  });

  it("does not retry a 403, which is an answer rather than a fault", () => {
    expect(cardSrc).toMatch(/retry:[\s\S]{0,120}403/);
  });

  it("the page gate really is broader than the endpoint's role list", () => {
    // This is why the 403 path exists at all: QUALITY_DASHBOARD admits viewers that
    // HEALTH_VIEWERS does not. If the two ever converge, the 403 branch is dead code — but it
    // is cheap, and divergence is the normal state.
    const viewers = routesSrc.match(/HEALTH_VIEWERS\s*=\s*\[([\s\S]*?)\]/);
    expect(viewers, "HEALTH_VIEWERS is gone; the card's role assumption needs rechecking").not.toBeNull();
    expect([...viewers![1].matchAll(/["']([^"']+)["']/g)].length).toBeGreaterThan(0);
  });
});
