import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Criteria hook item 7: ONE Live Meta arrival path. With a standing approval and policy.shortlist.enrol = 1 the arrival goes through
 * the criteria (enrolLiveArrival -> the enrolment port); otherwise through the unified enqueueMetaLeadFollowup. Both end in the same
 * idempotent enrolment. A source that is off issues no statement at all.
 */
const h = vi.hoisted(() => ({
  sqls: [] as string[],
  lead: { id: "M1", requisition_id: "R1", campaign_id: "C1", ats_candidate_id: null, screening_result: "qualified", meta_screening_config: null } as Record<string, unknown> | null,
  enrolOn: true, standing: { id: "A1", versionId: "V1" } as { id: string; versionId: string } | null,
  facts: { personKey: "9876543210" } as Record<string, unknown> | null,
  arrival: vi.fn(), unified: vi.fn(), throwArrival: false,
}));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: vi.fn(async (sql: string) => { h.sqls.push(sql.replace(/\s+/g, " ").trim()); return [h.lead ? [h.lead] : []]; }) },
}));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../selection-switches.js", () => ({ shortlistEnrolOn: vi.fn(async () => { h.sqls.push("enrol switch"); return h.enrolOn; }) }));
vi.mock("../approval.service.js", () => ({
  standingApprovalFor: vi.fn(async () => h.standing),
  enrolLiveArrival: vi.fn(async (a: Record<string, unknown>) => { h.arrival(a); if (h.throwArrival) throw Object.assign(new Error("Not open"), { statusCode: 409 }); return { decision: "enrolled", status: "enqueued", id: "Q1" }; }),
}));
vi.mock("../facts-loader.service.js", () => ({ loadMetaLeadFacts: vi.fn(async () => h.facts) }));
vi.mock("../../hiring-engine/qualified-followup.service.js", () => ({ enqueueMetaLeadFollowup: vi.fn(async (id: string, o: unknown) => { h.unified(id, o); return { status: "enqueued", id: "Q2" }; }) }));

import { enrolMetaArrival } from "../meta-arrival.service.js";
import { readSwitches } from "../../hiring-engine/qualified-followup.policy.js";

const ON = readSwitches({ QUAL_FOLLOWUP_MODE: "live" } as NodeJS.ProcessEnv, new Map([["policy.followup.meta_live", 4]]), []);
const OFF = readSwitches({} as NodeJS.ProcessEnv);

beforeEach(() => {
  h.sqls = []; h.enrolOn = true; h.standing = { id: "A1", versionId: "V1" }; h.facts = { personKey: "9876543210" }; h.throwArrival = false;
  h.lead = { id: "M1", requisition_id: "R1", campaign_id: "C1", ats_candidate_id: null, screening_result: "qualified", meta_screening_config: null };
  h.arrival.mockClear(); h.unified.mockClear();
});

describe("enrolMetaArrival", () => {
  it("source off: the arrival reads nothing and hands over to the unified enrolment (which answers skipped_off without a statement)", async () => {
    await enrolMetaArrival("M1", { switches: OFF });
    expect(h.sqls).toEqual([]);
    expect(h.unified).toHaveBeenCalledWith("M1", { switches: OFF, skipOutreach: false });
    expect(h.arrival).not.toHaveBeenCalled();
  });
  it("standing approval + enrol switch: through the criteria with the lead, campaign and auto_notify hold", async () => {
    h.lead = { ...h.lead!, meta_screening_config: JSON.stringify({ auto_notify: false }) };
    const r = await enrolMetaArrival("M1", { switches: ON });
    expect(r).toEqual({ path: "standing_approval", decision: "enrolled", status: "enqueued", id: "Q1" });
    expect(h.arrival.mock.calls[0][0]).toMatchObject({ requisitionId: "R1", facts: h.facts, arrival: { metaLeadId: "M1", campaignId: "C1", atsCandidateId: null, heldReason: "auto_notify_off" } });
    expect(h.unified).not.toHaveBeenCalled();
  });
  it("no standing approval, or the enrol switch off: the unified enrolment", async () => {
    h.standing = null;
    expect(await enrolMetaArrival("M1", { switches: ON })).toEqual({ path: "unified", status: "enqueued", id: "Q2" });
    h.standing = { id: "A1", versionId: "V1" }; h.enrolOn = false;
    expect(await enrolMetaArrival("M1", { switches: ON })).toEqual({ path: "unified", status: "enqueued", id: "Q2" });
    expect(h.arrival).not.toHaveBeenCalled();
    expect(h.unified).toHaveBeenCalledTimes(2);
  });
  it("a backfill (skipOutreach) is always the unified held_manual enrolment", async () => {
    await enrolMetaArrival("M1", { switches: ON, skipOutreach: true });
    expect(h.unified).toHaveBeenCalledWith("M1", { switches: ON, skipOutreach: true });
    expect(h.sqls).toEqual([]);
  });
  it("a review under the standing approval waits for HR: no unified enrolment behind its back", async () => {
    const svc = await import("../approval.service.js");
    vi.mocked(svc.enrolLiveArrival).mockResolvedValueOnce({ decision: "review_waits" } as never);
    expect(await enrolMetaArrival("M1", { switches: ON })).toEqual({ path: "standing_approval", decision: "review_waits" });
    expect(h.unified).not.toHaveBeenCalled();
  });
  it("the criteria path refuses (requisition no longer open, criteria incomplete): falls back to the unified enrolment and its own open rule", async () => {
    h.throwArrival = true;
    expect(await enrolMetaArrival("M1", { switches: ON })).toEqual({ path: "unified", status: "enqueued", id: "Q2" });
  });
  it("not qualified or no facts: the unified path decides (it refuses unqualified leads)", async () => {
    h.lead = { ...h.lead!, screening_result: "disqualified" };
    await enrolMetaArrival("M1", { switches: ON });
    h.lead = { ...h.lead!, screening_result: "qualified" }; h.facts = null;
    await enrolMetaArrival("M1", { switches: ON });
    expect(h.arrival).not.toHaveBeenCalled();
    expect(h.unified).toHaveBeenCalledTimes(2);
  });
});
