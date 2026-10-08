import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));
vi.mock("../../modules/meta-campaign/meta-campaign.service.js", () => ({ metaCampaignService: {} }));
vi.mock("../../modules/meta-campaign/meta-api.client.js", () => ({ isMetaConfigured: () => false }));
vi.mock("../../modules/meta-campaign/lead-outreach.service.js", () => ({ notifyQualifiedLead: vi.fn() }));
vi.mock("../../modules/meta-campaign/meta-messages.service.js", () => ({ reconcileDeliveryStatuses: vi.fn() }));

import { _resetParkedFormsForTest, isFormParked, parkFormOnPermanentError, runMetaLeadSyncNow } from "../metaLeadSync.cron.js";

const NONEXISTING = "fetchFormLeads(988877766655544): (#100) Tried accessing nonexisting field (leads)";

describe("meta-sync parks forms Meta says are not lead forms", () => {
  beforeEach(() => _resetParkedFormsForTest());

  it("parks a (#100) form for 24h and reports it only the first time", () => {
    const t0 = 1_000_000;
    expect(parkFormOnPermanentError("988877766655544", NONEXISTING, t0)).toBe(true);
    expect(isFormParked("988877766655544", t0 + 60_000)).toBe(true);
    expect(parkFormOnPermanentError("988877766655544", NONEXISTING, t0 + 60_000)).toBe(false);
    expect(isFormParked("988877766655544", t0 + 24 * 3600_000 + 1)).toBe(false); // retried next day
  });

  it("does not park transient errors (rate limit, network)", () => {
    expect(parkFormOnPermanentError("f1", "(#4) Application request limit reached")).toBe(false);
    expect(parkFormOnPermanentError("f1", "ETIMEDOUT")).toBe(false);
    expect(isFormParked("f1")).toBe(false);
  });
});

describe("manual Sync now", () => {
  it("reports not_configured (no throw, no DB work) when the Meta token is absent", async () => {
    await expect(runMetaLeadSyncNow()).resolves.toEqual({ status: "not_configured" });
  });
});
