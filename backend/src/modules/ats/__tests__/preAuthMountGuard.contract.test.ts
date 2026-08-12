import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Five routers are sub-mounted BEFORE atsRouter.use(requireAuth):
 *
 *   /onboarding-full   38 routes   candidate self-service, token in the body/query
 *   /bgv               40 routes   candidate BGV, plus staff routes with their own guards
 *   /fraud-alerts       4 routes   staff, guarded per route
 *   /onboarding                    token-driven
 *   (unpathed)         20 routes   recruiter hiring, router-level guards
 *
 * That ordering is deliberate — a candidate completing onboarding has no login — and every
 * route audited on 2026-08-11 does establish identity. The public ones take a `token` and
 * validate it (usually one layer down, in the service), and the two document routes implement
 * both paths explicitly: token -> validateOnboardingToken -> canAccessOnboardingDocument, or
 * else a programmatic requireAuth -> role context -> canAccessOnboardingDocument, auditing
 * allow AND deny on both.
 *
 * So this test does not fix a defect. It pins a property that currently holds by hand: a route
 * added to any of these files inherits NO protection from the router it sits in, because the
 * requireAuth that would have covered it is mounted later in ats.routes.ts. The failure mode is
 * silent — the new route simply answers everyone.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const ATS = "src/modules/ats/";

/** Mounted before atsRouter.use(requireAuth) — verified against ats.routes.ts below. */
const PRE_AUTH_ROUTERS = [
  "onboarding-full.routes.ts",
  "bgv-verification.routes.ts",
  "fraud-alerts.routes.ts",
  "recruiter-hiring.routes.ts",
];

const MIDDLEWARE_GUARD = /requireAuth|requireRole|requireClientAuth|requirePortal/;
/** A credential the handler (or the service it calls) can verify. */
const CREDENTIAL = /\btoken\b|validateOnboardingToken|onboardingToken|signature|hmac|webhookSecret/i;

/**
 * Helpers that authenticate internally, so a route delegating to one is guarded even though its
 * own block names no credential. Each is asserted separately below — an entry here is a claim
 * about that helper, not an exemption.
 */
const AUTHENTICATING_HELPERS = ["streamOnboardingDocument"];

function routeBlocks(src: string): Array<{ route: string; block: string }> {
  const marks = [...src.matchAll(/^\s*\w*[Rr]outer\.(get|post|put|patch|delete)\s*\(\s*"([^"]*)"/gm)];
  return marks.map((m, i) => ({
    route: `${m[1].toUpperCase()} ${m[2]}`,
    block: src.slice(m.index!, i + 1 < marks.length ? marks[i + 1].index! : src.length),
  }));
}

describe("the pre-requireAuth mount order is what this test assumes", () => {
  const routes = read(`${ATS}ats.routes.ts`);

  it("requireAuth really is mounted after those sub-routers", () => {
    const authAt = routes.indexOf("atsRouter.use(requireAuth)");
    expect(authAt, "atsRouter.use(requireAuth) not found").toBeGreaterThan(-1);

    for (const mount of ["/onboarding-full", "/bgv", "/fraud-alerts"]) {
      const at = routes.indexOf(`atsRouter.use("${mount}"`);
      expect(at, `${mount} not mounted`).toBeGreaterThan(-1);
      expect(
        at,
        `${mount} is mounted AFTER requireAuth — this suite's premise no longer holds, and the ` +
          `routes it checks may now be covered. Re-read before deleting anything.`,
      ).toBeLessThan(authAt);
    }
  });
});

describe("every route mounted before requireAuth establishes identity", () => {
  for (const file of PRE_AUTH_ROUTERS) {
    it(`${file}`, () => {
      const src = read(ATS + file);
      const blocks = routeBlocks(src);
      expect(blocks.length, `no routes parsed from ${file} — the check would be vacuous`).toBeGreaterThan(0);

      // A router-level guard covers every route defined after it.
      const guardUseAt = [...src.matchAll(/^\s*\w*[Rr]outer\.use\(([^)]*)\)/gm)]
        .filter((m) => MIDDLEWARE_GUARD.test(m[1]))
        .map((m) => m.index!);

      const unguarded = blocks.filter(({ block }) => {
        const at = src.indexOf(block);
        if (guardUseAt.some((g) => g < at)) return false;
        if (MIDDLEWARE_GUARD.test(block.slice(0, 300))) return false;
        if (CREDENTIAL.test(block)) return false;
        if (AUTHENTICATING_HELPERS.some((h) => block.includes(h))) return false;
        return true;
      });

      expect(
        unguarded.map((u) => u.route),
        `These routes are mounted before atsRouter.use(requireAuth) and establish no identity: ` +
          `no auth middleware, no token, and no delegation to a helper that authenticates. ` +
          `They answer anyone. Add a guard, take a token, or move the route after requireAuth.`,
      ).toEqual([]);
    });
  }
});

describe("streamOnboardingDocument authenticates both of its paths", () => {
  const src = read(`${ATS}onboarding-full.routes.ts`);
  const fn = /async function streamOnboardingDocument[\s\S]*?\n}/.exec(src)?.[0] ?? "";

  it("exists — the two document routes delegate their entire guard to it", () => {
    expect(fn, "streamOnboardingDocument not found").toBeTruthy();
  });

  it("validates the candidate token and checks document ownership", () => {
    // A token that merely parses is not enough: it must also own this document, or any
    // candidate could read another's Aadhaar scan by changing the id in the URL.
    expect(fn).toContain("validateOnboardingToken");
    expect(fn).toContain("canAccessOnboardingDocument");
  });

  it("falls back to requireAuth rather than to open access", () => {
    expect(fn).toContain("requireAuth");
    expect(fn).toMatch(/Authentication required|401/);
  });

  it("audits the denial, not only the success", () => {
    // A denied read of someone else's KYC document is the event worth having.
    expect(fn).toMatch(/DENIED/);
    expect(fn).toMatch(/403/);
  });
});
