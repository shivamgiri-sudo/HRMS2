/**
 * LMS launch-context portal/access key contract.
 *
 * CEO UAT 31-Jul-2026 reported /lms/my-learning blocked with
 *   "LMS access is not assigned for the trainee portal"
 *
 * The cause was not a role check or a missing enrolment row: the route indexed
 * the access object by PORTAL NAME ("trainee"), while lms.service.ts builds
 * that object with the key "employee". `access["trainee"]` was therefore always
 * undefined and /launch-context 403'd for EVERY user of every role. TypeScript
 * could not catch it because currentLmsContext returns a loosely-typed shape.
 *
 * These assertions are cross-file on purpose — the defect only exists in the
 * gap between the two files, so testing either one alone would not have caught
 * it, and renaming the service key to match would silently break
 * /native/employee, which reads `.employee` directly.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(resolve(process.cwd(), "src/modules/lms/lms.routes.ts"), "utf8");
const serviceSource = readFileSync(resolve(process.cwd(), "src/modules/lms/lms.service.ts"), "utf8");

/** Keys the service actually puts on the access object it returns. */
function serviceAccessKeys(): string[] {
  const block = serviceSource.match(/access:\s*\{([^}]*)\}/);
  if (!block) throw new Error("access:{} literal not found in lms.service.ts");
  return [...block[1].matchAll(/(\w+)\s*:/g)].map((m) => m[1]);
}

/** Portal names accepted on the wire by ?portal=. */
function wirePortals(): string[] {
  const block = routeSource.match(/type LmsPortal\s*=\s*([^;]+);/);
  if (!block) throw new Error("LmsPortal union not found in lms.routes.ts");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** The route's portal -> access-key translation. */
function portalAccessMap(): Record<string, string> {
  const block = routeSource.match(/PORTAL_ACCESS_KEY[^=]*=\s*\{([^}]*)\}/);
  if (!block) throw new Error("PORTAL_ACCESS_KEY map not found in lms.routes.ts");
  return Object.fromEntries([...block[1].matchAll(/(\w+)\s*:\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]));
}

describe("LMS /launch-context portal access resolution", () => {
  it("the wire portal names and the service access keys genuinely differ", () => {
    // This is the premise of the whole bug. If someone later reconciles the two
    // vocabularies, this test should be revisited rather than silently passing.
    expect(wirePortals()).toContain("trainee");
    expect(serviceAccessKeys()).not.toContain("trainee");
    expect(serviceAccessKeys()).toContain("employee");
  });

  it("maps every accepted portal onto a key the service actually returns", () => {
    const map = portalAccessMap();
    const keys = serviceAccessKeys();

    for (const portal of wirePortals()) {
      expect(map[portal], `no PORTAL_ACCESS_KEY entry for portal "${portal}"`).toBeDefined();
      expect(
        keys,
        `portal "${portal}" maps to access key "${map[portal]}", which lms.service.ts never sets — ` +
          `the lookup would be undefined and 403 every caller`
      ).toContain(map[portal]);
    }
  });

  it("translates trainee to the employee access flag", () => {
    expect(portalAccessMap().trainee).toBe("employee");
  });

  it("does not index the access object by raw portal name", () => {
    expect(routeSource).not.toMatch(/access\.access\[\s*portal\s*\]/);
    expect(routeSource).toMatch(/access\.access\[\s*PORTAL_ACCESS_KEY\[\s*portal\s*\]\s*\]/);
  });

  it("leaves /native/employee reading the service key directly", () => {
    // Guards against "fixing" this by renaming the service key instead.
    expect(routeSource).toContain("ctx.access.access.employee");
  });
});
