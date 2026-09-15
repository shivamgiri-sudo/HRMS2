import path from "path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../logger.js", () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock("../worker-utils.js", () => ({ registerTimer: vi.fn(), unregisterTimer: vi.fn(), withWorkerLock: vi.fn() }));

import { resolveSyncScript, syncChildEnv, syncScriptCandidates } from "../db-bill-finance-sync.worker.js";

const norm = (p: string) => p.split(path.sep).join("/");
const BACKEND = path.resolve("/srv/app/backend");

describe("db-bill-finance-sync script lookup", () => {
  it("finds the script from the dev layout (src/workers -> backend/scripts)", () => {
    const dir = path.join(BACKEND, "src", "workers");
    const want = path.join(BACKEND, "scripts", "sync-db-bill-snapshot.mjs");
    expect(resolveSyncScript(dir, (p) => p === want)).toBe(want);
  });

  it("finds the copy the build puts in dist/scripts from the compiled layout", () => {
    const dir = path.join(BACKEND, "dist", "src", "workers");
    const want = path.join(BACKEND, "dist", "scripts", "sync-db-bill-snapshot.mjs");
    expect(resolveSyncScript(dir, (p) => p === want)).toBe(want);
  });

  it("falls back to the server's backend/scripts when dist has no copy", () => {
    // This is the case that silently failed every night: dist/src/workers/../../scripts does
    // not exist in a deployed artifact.
    const dir = path.join(BACKEND, "dist", "src", "workers");
    const want = path.join(BACKEND, "scripts", "sync-db-bill-snapshot.mjs");
    expect(resolveSyncScript(dir, (p) => p === want)).toBe(want);
  });

  it("returns null instead of a path that does not exist", () => {
    const dir = path.join(BACKEND, "dist", "src", "workers");
    expect(resolveSyncScript(dir, () => false)).toBeNull();
    expect(syncScriptCandidates(dir).map(norm)).toEqual([
      norm(path.join(BACKEND, "dist", "scripts", "sync-db-bill-snapshot.mjs")),
      norm(path.join(BACKEND, "scripts", "sync-db-bill-snapshot.mjs")),
    ]);
  });
});

describe("db-bill-finance-sync child environment", () => {
  it("hands the app's DB host to the script as HRMS_DB_HOST", () => {
    expect(syncChildEnv({ DB_HOST: "10.0.0.6" }).HRMS_DB_HOST).toBe("10.0.0.6");
    expect(syncChildEnv({ DB_HOST: "10.0.0.6", HRMS_DB_HOST: "10.0.0.9" }).HRMS_DB_HOST).toBe("10.0.0.9");
  });

  it("drops an empty BILL_DB_HOST so the script's own default applies", () => {
    expect("BILL_DB_HOST" in syncChildEnv({ BILL_DB_HOST: "" })).toBe(false);
    expect(syncChildEnv({ BILL_DB_HOST: "10.0.0.22" }).BILL_DB_HOST).toBe("10.0.0.22");
  });
});
