import { describe, expect, it } from "vitest";
import { matrixCell, matrixRows, REASON_ORDER, type MatrixFacts } from "../campaign-matrix.js";

const facts = (o: Partial<MatrixFacts> = {}): MatrixFacts => ({
  campaign: { id: "c1", name: "AHM SBI Oct", status: "active", hasForm: true },
  requisition: { id: "r1", code: "AHM-SBI-01", branch: "AHMEDABAD", closedReason: null, endDate: "2026-12-31", endDatePassed: false, seatsLeft: 32, bmiLinkPresent: true,
    completeness: { score: 100, label: "complete", missing: [], enrolmentReady: true } },
  streams: {}, activity48h: { meta_live: 0, meta_old: 0, he: 0 }, responses3d: null, drivesNext3d: 1, eligible: {},
  pendingApproval: {}, enrolmentOn: { meta_live: true, meta_old: true, he: true }, enforcedEndDate: false,
  ...o,
});
const open = { id: "s1", status: "open" as const, originId: "c1" };

describe("matrix cell reasons (C1, first failing reason in a fixed order)", () => {
  it("K7BK-like: an active campaign on a closed requisition is idle with requisition_closed", () => {
    const f = facts({ requisition: { ...facts().requisition, closedReason: "requisition is inactive" }, streams: { meta_live: open } });
    const c = matrixCell(f, "meta_live");
    expect(c).toMatchObject({ state: "idle", reason: "requisition_closed" });
    expect(c.reasonText).toContain("closed");
  });

  it("K7BK without a stream: still idle requisition_closed (not 'not mapped'), with the relink offer on Live Meta only", () => {
    const f = facts({ requisition: { ...facts().requisition, closedReason: "requisition is closed" } });
    expect(matrixCell(f, "meta_live")).toMatchObject({ state: "idle", reason: "requisition_closed", mapIt: null, relink: true });
    expect(matrixCell(f, "he")).toMatchObject({ state: "idle", reason: "requisition_closed", relink: false });
    const full = facts({ requisition: { ...facts().requisition, seatsLeft: 0 } });
    expect(matrixCell(full, "meta_live")).toMatchObject({ state: "idle", reason: "requisition_full", relink: true });
  });

  it("an open requisition with no stream and no activity is not mapped, with the Open-a-stream prefill", () => {
    const f = facts();
    expect(matrixCell(f, "meta_live")).toMatchObject({ state: "not_mapped", mapIt: { requisitionId: "r1", sourceType: "meta_live", originId: "c1" } });
    expect(matrixCell(f, "meta_old").mapIt).toEqual({ requisitionId: "r1", sourceType: "meta_old", originId: null });
    expect(matrixCell(f, "he").mapIt).toEqual({ requisitionId: "r1", sourceType: "he", originId: "pool" });
  });

  it("open stream, no activity and no drive planned: no_drive_planned (he); Live Meta needs no drive", () => {
    const f = facts({ streams: { he: { id: "s2", status: "open", originId: "pool" }, meta_live: open }, drivesNext3d: 0 });
    expect(matrixCell(f, "he")).toMatchObject({ state: "idle", reason: "no_drive_planned" });
    expect(matrixCell(f, "meta_live")).toMatchObject({ state: "idle", reason: "no_contact_48h" });
  });

  it("past end date, enforcement off: a warning reason; the cell still runs when people are contacted", () => {
    const req = { ...facts().requisition, endDate: "2026-10-01", endDatePassed: true };
    const idle = matrixCell(facts({ requisition: req, streams: { meta_live: open } }), "meta_live");
    expect(idle).toMatchObject({ state: "idle", reason: "requisition_ended" });
    expect(idle.reasonText).toContain("warning");
    const busy = matrixCell(facts({ requisition: req, streams: { meta_live: open }, activity48h: { meta_live: 5, meta_old: 0, he: 0 } }), "meta_live");
    expect(busy).toMatchObject({ state: "running", reason: "requisition_ended", activity48h: 5 });
  });

  it("past end date, enforcement on: idle even with activity", () => {
    const req = { ...facts().requisition, endDate: "2026-10-01", endDatePassed: true };
    const c = matrixCell(facts({ requisition: req, enforcedEndDate: true, streams: { meta_live: open }, activity48h: { meta_live: 5, meta_old: 0, he: 0 } }), "meta_live");
    expect(c).toMatchObject({ state: "idle", reason: "requisition_ended" });
  });

  it("running with activity and nothing wrong", () => {
    const c = matrixCell(facts({ streams: { meta_live: open }, activity48h: { meta_live: 3, meta_old: 0, he: 0 } }), "meta_live");
    expect(c).toMatchObject({ state: "running", reason: null, activity48h: 3, streamId: "s1" });
  });

  it("activity without a stream (legacy outreach) counts as mapped and running", () => {
    const c = matrixCell(facts({ activity48h: { meta_live: 2, meta_old: 0, he: 0 } }), "meta_live");
    expect(c).toMatchObject({ state: "running", streamId: null });
    expect(c.reasonText).toContain("no stream");
  });

  it("criteria incomplete and awaiting approval come after the stream state and before the switches (amended C1)", () => {
    const req = { ...facts().requisition, completeness: { score: 30, label: "incomplete" as const, missing: ["age", "education_min"], enrolmentReady: false } };
    expect(matrixCell(facts({ requisition: req, streams: { he: { id: "s", status: "paused", originId: "pool" } } }), "he").reason).toBe("stream_paused");
    expect(matrixCell(facts({ requisition: req, streams: { he: { id: "s", status: "open", originId: "pool" } } }), "he").reason).toBe("criteria_incomplete");
    expect(matrixCell(facts({ pendingApproval: { he: true }, streams: { he: { id: "s", status: "open", originId: "pool" } } }), "he").reason).toBe("awaiting_approval");
    expect(matrixCell(facts({ enrolmentOn: { meta_live: true, meta_old: true, he: false }, streams: { he: { id: "s", status: "open", originId: "pool" } } }), "he").reason).toBe("enrolment_off");
  });

  it("no form id and no BMI link are Meta reasons only", () => {
    const f = facts({ campaign: { id: "c1", name: "x", status: "active", hasForm: false }, requisition: { ...facts().requisition, bmiLinkPresent: false }, streams: { meta_live: open, he: { id: "s", status: "open", originId: "pool" } } });
    expect(matrixCell(f, "meta_live").reason).toBe("no_form");
    expect(matrixCell(f, "he").reason).toBe("no_contact_48h");
  });

  it("a draft or paused campaign: campaign_not_active on the Meta cells", () => {
    const f = facts({ campaign: { id: "c1", name: "x", status: "paused", hasForm: true }, streams: { meta_live: open } });
    expect(matrixCell(f, "meta_live").reason).toBe("campaign_not_active");
  });

  it("requisition-only row: Meta cells not applicable, HE computed", () => {
    const f = facts({ campaign: null });
    expect(matrixCell(f, "meta_live").state).toBe("not_applicable");
    expect(matrixCell(f, "meta_old").state).toBe("not_applicable");
    expect(matrixCell(f, "he").state).toBe("not_mapped");
  });

  it("no responses in 3 days only when people were contacted and WS2 responses are known", () => {
    const f = facts({ streams: { meta_live: open }, activity48h: { meta_live: 4, meta_old: 0, he: 0 }, responses3d: { meta_live: 0, meta_old: 0, he: 0 } });
    expect(matrixCell(f, "meta_live")).toMatchObject({ state: "running", reason: "no_responses_3d" });
    expect(matrixCell({ ...f, responses3d: null }, "meta_live").reason).toBeNull();
  });

  it("the last shortlist found nobody for this source", () => {
    const f = facts({ streams: { he: { id: "s", status: "open", originId: "pool" } }, eligible: { he: 0, meta_old: 5 } });
    expect(matrixCell(f, "he").reason).toBe("no_eligible_people");
  });

  it("full requisition and closed stream", () => {
    const full = facts({ requisition: { ...facts().requisition, seatsLeft: 0 }, streams: { meta_live: open } });
    expect(matrixCell(full, "meta_live").reason).toBe("requisition_full");
    const closed = facts({ streams: { he: { id: "s", status: "closed", originId: "pool" } } });
    expect(matrixCell(closed, "he").reason).toBe("stream_closed");
  });

  it("the reason order is stable", () => {
    expect(REASON_ORDER.slice(0, 6)).toEqual(["requisition_closed", "requisition_ended", "requisition_full", "campaign_not_active", "no_form", "no_bmi_link"]);
    expect(REASON_ORDER.indexOf("criteria_incomplete")).toBeGreaterThan(REASON_ORDER.indexOf("stream_paused"));
    expect(REASON_ORDER.indexOf("enrolment_off")).toBeGreaterThan(REASON_ORDER.indexOf("awaiting_approval"));
  });
});

describe("matrixRows", () => {
  it("one row per campaign x requisition, keyed, with the three cells", () => {
    const rows = matrixRows([facts(), facts({ campaign: null, requisition: { ...facts().requisition, id: "r2", code: "R2" } })]);
    expect(rows.map((r) => r.key)).toEqual(["c1|r1", "~|r2"]);
    expect(Object.keys(rows[0].cells)).toEqual(["meta_live", "meta_old", "he"]);
    expect(rows[1].campaign).toBeNull();
  });
});
