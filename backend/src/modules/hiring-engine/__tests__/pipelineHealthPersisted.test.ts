import { beforeEach, describe, expect, it, vi } from "vitest";

const read = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { query: vi.fn().mockRejectedValue(new Error("db down")) } }));
vi.mock("../../../cron/metaLeadSync.cron.js", () => ({ getLastMetaSyncSummary: () => null, getLastMetaSyncRecord: () => null }));
vi.mock("../../meta-campaign/meta-api.client.js", () => ({ isMetaConfigured: () => false }));
vi.mock("../../meta-campaign/meta-sync-status.store.js", async (orig) => ({
  ...(await orig<typeof import("../../meta-campaign/meta-sync-status.store.js")>()),
  readSyncStatus: () => read(),
}));

import { evaluateHealth } from "../he-pipeline-health.js";
import { collectHealthSnapshot } from "../he-pipeline-health.service.js";

beforeEach(() => { read.mockReset(); });

describe("collectHealthSnapshot reads the persisted sync status", () => {
  it("ruling: after a restart (empty memory) the indicator shows the last real sync time", async () => {
    const finishedAt = new Date(Date.now() - 20 * 60_000).toISOString();
    read.mockResolvedValue({ finishedAt, ok: true, imported: 2, forms: 4, formErrors: 1, errorCode: null, lastOkAt: finishedAt });
    process.env.WORKERS_PROCESS = "external";
    const s = await collectHealthSnapshot();
    expect(s.lastSyncFinishedAt?.toISOString()).toBe(finishedAt);
    expect(s.lastSyncOk).toBe(true);
    expect(s.formErrorsLastRun).toBe(1);
    expect(evaluateHealth(s).find((c) => c.key === "sync_recent")!.level).toBe("ok");
  });
  it("ruling: a persisted failed cycle surfaces as an error state with its code", async () => {
    const finishedAt = new Date(Date.now() - 5 * 60_000).toISOString();
    const okAt = new Date(Date.now() - 60 * 60_000).toISOString();
    read.mockResolvedValue({ finishedAt, ok: false, imported: 0, forms: 0, formErrors: 0, errorCode: "ER_DOWN", lastOkAt: okAt });
    const c = evaluateHealth(await collectHealthSnapshot()).find((x) => x.key === "sync_recent")!;
    expect(c.level).toBe("warn");
    expect(c.detail).toContain("failed");
    expect(c.detail).toContain("ER_DOWN");
  });
  it("falls back to 'no sync recorded' only when nothing is persisted or in memory", async () => {
    read.mockResolvedValue(null);
    const s = await collectHealthSnapshot();
    expect(s.lastSyncFinishedAt).toBeNull();
  });
});
