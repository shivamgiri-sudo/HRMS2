import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every client-portal route carrying a process id must check that id against the token.
 *
 * The token's `processIds` array is the portal's tenant boundary — a client user holds one
 * or more process ids and must never read another client's process. Nothing enforces that
 * structurally: `requireClientAuth` is mounted per path prefix and only authenticates, and
 * the `:id` in `/portal/processes/:id/...` is attacker-controlled. What actually enforces
 * the boundary is a call to assertProcessAccess() at the top of each controller method.
 *
 * All seven process routes do call it today (verified 2026-08-11). That is a property of
 * seven hand-written methods, not of the routing, so it holds only until someone adds an
 * eighth. This test makes the routing responsible for saying so.
 *
 * The equivalent drift has already happened elsewhere in this repo — a page-gate and its API
 * role check disagreeing, an exit-status guard that was dead code across three routers — so
 * "they all do it right now" is not a durable answer.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const ROUTES = "src/modules/portal/portal.routes.ts";
const CONTROLLER = "src/modules/portal/portal.controller.ts";

/**
 * The handler must call the explicit assertion. Deliberately narrow.
 *
 * An earlier version of this test also accepted "the handler mentions portalUser.processIds",
 * on the theory that passing the allowed list to a service is equivalent. It is not, and the
 * test proved it: after adding that argument to getAttrition, deleting its
 * assertProcessAccess() call left this suite green. Two services happen to re-check the list,
 * so the request was still refused — but the guard was then relying on a downstream
 * implementation detail rather than on the boundary, and the check it was written to enforce
 * had silently gone.
 *
 * So: match the assertion itself, and nothing that merely resembles scope-awareness.
 */
const ASSERTS_SCOPE = /\bassert(ProcessAccess|CommentaryAccess)\s*\(\s*req\s*\)/;

interface Route { verb: string; path: string; handler: string }

function processRoutes(): Route[] {
  const src = read(ROUTES);
  const out: Route[] = [];
  const re = /router\.(get|post|put|patch|delete)\s*\(\s*"(\/processes\/:id[^"]*)"[\s\S]{0,200}?c\.(\w+)/g;
  for (const m of src.matchAll(re)) {
    out.push({ verb: m[1].toUpperCase(), path: m[2], handler: m[3] });
  }
  return out;
}

function controllerMethods(): Map<string, string> {
  const src = read(CONTROLLER);
  const marks = [...src.matchAll(/^\s{2}async (\w+)\s*\(/gm)];
  const map = new Map<string, string>();
  marks.forEach((m, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].index! : src.length;
    map.set(m[1], src.slice(m.index!, end));
  });
  return map;
}

describe("client portal process-scope boundary", () => {
  const routes = processRoutes();
  const methods = controllerMethods();

  it("finds the process routes — a silent 0 would make this suite vacuous", () => {
    expect(routes.length).toBeGreaterThanOrEqual(7);
    expect(methods.size).toBeGreaterThan(10);
  });

  it("every /processes/:id route checks the id against the token's processIds", () => {
    const unguarded = routes.filter((r) => {
      const body = methods.get(r.handler);
      // A route pointing at a handler this test cannot find is itself a failure: it means
      // the boundary cannot be verified, which is not the same as it being present.
      return !body || !ASSERTS_SCOPE.test(body);
    });

    expect(
      unguarded.map((r) => `${r.verb} ${r.path} -> ${r.handler}`),
      "These portal routes take a process id from the URL and never check it against the " +
        "caller's token. requireClientAuth only authenticates — it does not bind :id to the " +
        "client's processIds — so this reads another client's data. Call assertProcessAccess(req) " +
        "at the top of the handler.",
    ).toEqual([]);
  });

  it("assertProcessAccess actually compares against the token and fails closed", () => {
    const src = read(CONTROLLER);
    const fn = /function assertProcessAccess[\s\S]{0,400}?\n}/.exec(src)?.[0] ?? "";

    expect(fn, "assertProcessAccess must exist — it is the boundary").toBeTruthy();
    // It must read the token side, not just any local variable, and must reject rather than
    // fall through. An `includes` against the wrong array would pass a shallower check.
    expect(fn).toMatch(/portalUser!?\.processIds/);
    expect(fn).toMatch(/req\.params\.id/);
    expect(fn).toMatch(/403/);
    expect(fn).toMatch(/!\s*req\.portalUser!?\.processIds\.includes/);
  });

  it("the KPI and attrition services receive the allowed list, so their own guard is live", () => {
    const src = read(CONTROLLER);
    // Both service guards are written as `if (allowedProcessIds !== undefined && ...)`, so a
    // caller that omits the argument silently disables them. Defence in depth that is never
    // passed its input is decoration.
    expect(src).toMatch(/getScorecards\([\s\S]{0,160}?processIds/);
    expect(src).toMatch(/getAttrition\([\s\S]{0,160}?processIds/);
  });

  it("the service-side guard still rejects a process outside the allowed list", async () => {
    const kpi = read("src/modules/portal/portal.kpi.service.ts");
    const attr = read("src/modules/portal/portal.attrition.service.ts");
    for (const [name, src] of [["kpi", kpi], ["attrition", attr]] as const) {
      expect(src, `${name} service must still check the allowed list`).toMatch(
        /allowedProcessIds\s*!==\s*undefined\s*&&\s*!allowedProcessIds\.includes\(processId\)/,
      );
    }
  });
});
