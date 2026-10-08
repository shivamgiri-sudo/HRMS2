import { beforeEach, describe, expect, it, vi } from "vitest";

const write = vi.fn().mockResolvedValue(undefined);
const execute = vi.fn();
vi.mock("../../db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }));
vi.mock("../../modules/meta-campaign/meta-campaign.service.js", () => ({ metaCampaignService: {} }));
vi.mock("../../modules/meta-campaign/meta-api.client.js", () => ({ isMetaConfigured: () => true }));
vi.mock("../../modules/meta-campaign/lead-outreach.service.js", () => ({ notifyQualifiedLead: vi.fn() }));
vi.mock("../../modules/meta-campaign/meta-messages.service.js", () => ({ reconcileDeliveryStatuses: vi.fn() }));
vi.mock("../../modules/meta-campaign/meta-sync-status.store.js", async (orig) => ({
  ...(await orig<typeof import("../../modules/meta-campaign/meta-sync-status.store.js")>()),
  writeSyncStatus: (...a: unknown[]) => write(...a),
}));

import { getLastMetaSyncRecord, runMetaLeadSyncNow } from "../metaLeadSync.cron.js";

beforeEach(() => { write.mockClear(); execute.mockReset(); });

describe("sync cycle persists its outcome", () => {
  it("an erroring cycle is persisted as ok:false with only an error code (no message)", async () => {
    execute.mockRejectedValue(Object.assign(new Error("access_token=SECRET leaked for Ravi"), { code: "ER_DOWN" }));
    const r = await runMetaLeadSyncNow();
    expect(r.status).toBe("error");
    expect(write).toHaveBeenCalledTimes(1);
    const saved = write.mock.calls[0][0];
    expect(saved).toMatchObject({ ok: false, errorCode: "ER_DOWN" });
    expect(JSON.stringify(saved)).not.toMatch(/SECRET|Ravi/);
    expect(getLastMetaSyncRecord()).toMatchObject({ ok: false });
  });
});
