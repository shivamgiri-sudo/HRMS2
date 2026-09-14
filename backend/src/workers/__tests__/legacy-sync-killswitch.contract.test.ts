import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

/**
 * The legacy sync subsystem is deliberately, permanently off in production —
 * one of the systems it writes into (employees: PAN/Aadhaar last4/bank/EPF/
 * ESIC) has a documented cross-contamination history with the legacy source.
 * start() correctly honours LEGACY_SYNC_ENABLED before scheduling the
 * interval, but triggerManualSync() called runSyncCycle() directly with no
 * flag check at all — so any authenticated admin could fire the real sync
 * cycle on demand via POST /api/legacy/sync/trigger, writing legacy data into
 * `employees` regardless of the kill switch. This is a REGRESSION of the
 * documented "legacy sync subsystem is off" invariant, not a new feature gap.
 *
 * Found: HRMS2 delta-audit, 2026-08-14 (notifications_integrations_workers
 * cluster, P0, classification REGRESSED). Fix approved same session.
 */
describe("legacy-sync manual-trigger kill switch", () => {
  const worker = read("src/workers/legacy-sync-worker.ts");

  it("checks LEGACY_SYNC_ENABLED before running a sync cycle", () => {
    const body = worker.match(/async triggerManualSync\(\)[\s\S]*?\n  \}/)?.[0] ?? "";
    expect(body).toContain("env.LEGACY_SYNC_ENABLED");
  });

  it("guards before the sync runs, not after it", () => {
    const body = worker.match(/async triggerManualSync\(\)[\s\S]*?\n  \}/)?.[0] ?? "";
    const guardAt = body.indexOf("env.LEGACY_SYNC_ENABLED");
    const runAt = body.indexOf("this.runSyncCycle()");
    expect(guardAt).toBeGreaterThanOrEqual(0);
    expect(runAt).toBeGreaterThan(guardAt);
  });

  it("start() and triggerManualSync() use the identical flag, not a copy that can drift", () => {
    const startBody = worker.match(/start\(\): void \{[\s\S]*?\n  \}/)?.[0] ?? "";
    const triggerBody = worker.match(/async triggerManualSync\(\)[\s\S]*?\n  \}/)?.[0] ?? "";
    expect(startBody).toContain("env.LEGACY_SYNC_ENABLED");
    expect(triggerBody).toContain("env.LEGACY_SYNC_ENABLED");
  });

  it("the route stays admin-authenticated (unrelated to this fix, must not regress)", () => {
    const routes = read("src/modules/legacy/legacy.routes.ts");
    expect(routes).toContain("router.use(requireAuth)");
    expect(routes).toContain("router.use(requireRole('admin'))");
    expect(routes).toContain("/sync/trigger");
  });
});
