import path from "path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../logger.js", () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock("../worker-utils.js", () => ({ registerTimer: vi.fn(), unregisterTimer: vi.fn(), withWorkerLock: vi.fn() }));

import { resolveSyncScript, syncScriptCandidates } from "../db-bill-hr-sync.worker.js";

const BACKEND = path.resolve("/srv/app/backend");

describe("db-bill-hr-sync script lookup", () => {
  it("finds the script from the dev layout (src/workers -> backend/scripts)", () => {
    const dir = path.join(BACKEND, "src", "workers");
    const want = path.join(BACKEND, "scripts", "sync-all-tables-from-dbbill.mjs");
    expect(resolveSyncScript(dir, (p) => p === want)).toBe(want);
  });

  it("finds the copy the build puts in dist/scripts from the compiled layout", () => {
    const dir = path.join(BACKEND, "dist", "src", "workers");
    const want = path.join(BACKEND, "dist", "scripts", "sync-all-tables-from-dbbill.mjs");
    expect(resolveSyncScript(dir, (p) => p === want)).toBe(want);
  });

  it("falls back to the server's backend/scripts when dist has no copy — the finance-sync outage's fix, applied here too", () => {
    const dir = path.join(BACKEND, "dist", "src", "workers");
    const want = path.join(BACKEND, "scripts", "sync-all-tables-from-dbbill.mjs");
    expect(resolveSyncScript(dir, (p) => p === want)).toBe(want);
  });

  it("returns null instead of a path that does not exist", () => {
    const dir = path.join(BACKEND, "dist", "src", "workers");
    expect(resolveSyncScript(dir, () => false)).toBeNull();
  });

  it("never looks for the salary-gap script — that one stays manual, unscheduled", () => {
    const dir = path.join(BACKEND, "src", "workers");
    expect(syncScriptCandidates(dir).join(" ")).not.toContain("salary-gap");
  });
});
