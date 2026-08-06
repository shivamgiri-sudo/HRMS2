import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Documents and guards a route collision found during a 2026-08-06 route
 * audit (same class of bug fixed for /api/wfm/attendance/daily that
 * session): rosterSelfSecureRouter and rosterGovRouter both define GET
 * "/my-cycles" and GET "/my-roster/:cycleId", mounted at the identical
 * "/api/roster-gov" prefix. Express resolves an exact-path collision by
 * registration order — rosterSelfSecureRouter is mounted first, so its
 * handlers always win and rosterGovRouter's versions are dead code.
 *
 * Unlike the attendance/daily case, no live user-facing bug was found here
 * (no caller depends on the governance version's behavior — it's simply
 * unreachable), and "/my-cycles" specifically has a real behavioral gap
 * (no branch_id scoping) that would be a regression if it ever started
 * executing. So this is deliberately NOT "fixed" by reordering mounts or
 * merging the handlers — it's marked with an explanatory comment in
 * roster.governance.routes.ts, and guarded here so a future accidental
 * mount reorder (which would silently start serving the branch-scope-leaky
 * version) gets caught by a test, not discovered live.
 */
describe("roster-gov /my-cycles and /my-roster/:cycleId route collision", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/app.ts"), "utf8");

  it("mounts rosterSelfSecureRouter before rosterGovRouter at the same /api/roster-gov prefix", () => {
    const selfSecureIdx = appSource.indexOf('app.use("/api/roster-gov", rosterSelfSecureRouter)');
    const govIdx = appSource.indexOf('app.use("/api/roster-gov", rosterGovRouter)');
    expect(selfSecureIdx).toBeGreaterThan(-1);
    expect(govIdx).toBeGreaterThan(-1);
    expect(selfSecureIdx).toBeLessThan(govIdx);
  });

  it("rosterSelfSecureRouter still defines the winning /my-cycles and /my-roster/:cycleId handlers", () => {
    const selfSecureSource = readFileSync(
      resolve(process.cwd(), "src/modules/roster/roster.self.secure.routes.ts"),
      "utf8",
    );
    expect(selfSecureSource).toContain('rosterSelfSecureRouter.get("/my-cycles"');
    expect(selfSecureSource).toContain('rosterSelfSecureRouter.get("/my-roster/:cycleId"');
  });

  it("rosterGovRouter's shadowed versions are still clearly marked as dead code", () => {
    const govSource = readFileSync(
      resolve(process.cwd(), "src/modules/roster/roster.governance.routes.ts"),
      "utf8",
    );
    expect(govSource).toContain('router.get("/my-cycles"');
    expect(govSource).toContain('router.get("/my-roster/:cycleId"');
    // If this fails, someone removed the warning without resolving the
    // underlying collision (or the collision was actually fixed — in which
    // case this whole test file should be updated/removed, not just this
    // assertion).
    expect(govSource).toMatch(/DEAD CODE — unreachable in production.*"\/my-cycles"/s);
    expect(govSource).toMatch(/DEAD CODE — unreachable in production, same class of collision.*"\/my-roster/s);
  });
});
