import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * onfido-raw-bulk.service.ts's importOnfidoRawBatch() is the single entry point
 * for every Onfido raw report upload (DOC, POA, agent-daily, escalations, etc.).
 * Only two of those report tables feed getDistinctOnfidoNames() (see
 * onfido-name-mapping.service.ts and its onfido-process-dashboard.service.ts
 * getFilterOptions() precedent): onfido_doc_external_audit_raw and
 * onfido_agent_daily_raw. Re-running the full name-mapping seed after every
 * OTHER Onfido upload (POA raw, quality audits, escalations, etc.) would slow
 * those uploads down for no benefit, since none of them can produce a new
 * distinct TL/AM name getDistinctOnfidoNames would ever see.
 */
const runNameMappingSeed = vi.fn();
vi.mock("../../onfido-process/onfido-name-mapping.service.js", () => ({
  runNameMappingSeed,
}));

const { shouldTriggerNameMappingReseed, triggerNameMappingReseedIfRelevant } =
  await import("../onfido-raw-bulk.service.js");

beforeEach(() => {
  runNameMappingSeed.mockReset();
});

describe("shouldTriggerNameMappingReseed", () => {
  it("is true for onfido_doc_external_audit_raw", () => {
    expect(shouldTriggerNameMappingReseed("onfido_doc_external_audit_raw")).toBe(true);
  });

  it("is true for onfido_agent_daily_raw", () => {
    expect(shouldTriggerNameMappingReseed("onfido_agent_daily_raw")).toBe(true);
  });

  it("is false for every other Onfido raw table", () => {
    expect(shouldTriggerNameMappingReseed("onfido_poa_raw")).toBe(false);
    expect(shouldTriggerNameMappingReseed("onfido_doc_raw")).toBe(false);
    expect(shouldTriggerNameMappingReseed("onfido_doc_quality_raw")).toBe(false);
    expect(shouldTriggerNameMappingReseed("onfido_doc_escalation_cre_raw")).toBe(false);
  });
});

describe("triggerNameMappingReseedIfRelevant", () => {
  it("runs the seed when the uploaded table is one of the two name-bearing sources", async () => {
    runNameMappingSeed.mockResolvedValueOnce({ matched: 3, ambiguous: 0, unmatched: 1, errors: [] });

    await triggerNameMappingReseedIfRelevant("onfido_doc_external_audit_raw");

    expect(runNameMappingSeed).toHaveBeenCalledTimes(1);
  });

  it("does not run the seed for an unrelated table", async () => {
    await triggerNameMappingReseedIfRelevant("onfido_poa_raw");

    expect(runNameMappingSeed).not.toHaveBeenCalled();
  });

  it("swallows a seed failure rather than letting it fail the upload that triggered it", async () => {
    runNameMappingSeed.mockRejectedValueOnce(new Error("ER_LOCK_WAIT_TIMEOUT"));

    // The whole point: a re-seed hiccup must never surface as an upload failure.
    await expect(
      triggerNameMappingReseedIfRelevant("onfido_agent_daily_raw"),
    ).resolves.toBeUndefined();
  });
});
