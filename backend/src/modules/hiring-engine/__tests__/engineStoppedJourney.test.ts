import { beforeEach, describe, expect, it, vi } from "vitest";

/** A follow-up journey stopped for criteria_failed / requisition_closed / opted_out keeps the engine away from that person for
 *  THAT requisition: the line-up never picks them and a match suggested before the stop is never invited. Other requisitions are
 *  untouched, and a stop for another reason (replied, joined, ...) blocks nothing. */
const h = vi.hoisted(() => ({ calls: [] as Array<{ sql: string; p: unknown[] }> }));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, p: unknown[] = []) => {
      const q = sql.replace(/\s+/g, " ").trim();
      h.calls.push({ sql: q, p });
      if (/FROM he_drive WHERE id = \?/.test(q)) return [[{ id: "d1", requisition_id: "rX", branch_name: "NOIDA-2", drive_date: "2026-10-12", slot_start: "10:00", slot_end: "16:00",
        slot_minutes: 30, slot_capacity: 4, target_shows: 4, show_rate_pct: 50, status: "active", auto_send: 0, source_kind: "pool", source_ids: null, max_lead_age_days: null, run_label: null, reinvite: 0 }]];
      if (/FROM job_requisition jr/.test(q)) return [[{ id: "rX", branch_name: "NOIDA-2", process_name: "Onfido", designation_name: "CSE", requested_headcount: 5, fulfilled_headcount: 0, approval_status: "approved",
        active_status: 1, meta_target_age_min: null, meta_target_age_max: null, meta_target_radius_km: null, education_requirement: null, experience_min_years: null, night_shift_required: 0,
        salary_max: null, meta_screening_config: null, skills_required: null, blat: null, blng: null, bcity: "Noida", bstate: "Uttar Pradesh" }]];
      return [[]];
    }),
  },
}));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../qualified-followup.service.js", () => ({ enqueueMatchedFollowups: vi.fn(async () => ({})) }));
vi.mock("../he-eligibility.service.js", () => ({ applyEligibilityGate: vi.fn(async () => ({ verdicts: new Map(), blockedByReason: {} })) }));
vi.mock("../he-profile.service.js", () => ({ loadProfiles: vi.fn(async () => new Map()) }));
vi.mock("../he-jd.service.js", () => ({ getRequisitionJd: vi.fn(async () => null) }));
vi.mock("../he-showup.service.js", () => ({ loadMatchParams: vi.fn(async () => ({})) }));
vi.mock("../he-master.service.js", () => ({ refreshHistoryChunk: vi.fn(async () => ({})) }));
vi.mock("../he-policy.service.js", () => ({ whatsappRequiresOptIn: vi.fn(async () => false) }));

import { lineUpCandidates } from "../he-drive.service.js";
import { inviteForDrive } from "../he-engine.service.js";
import { ENGINE_BLOCKING_STOPS, followupStoppedSql } from "../qualified-followup.policy.js";

beforeEach(() => { h.calls = []; });

describe("engine respects a stopped follow-up journey for the same person + requisition", () => {
  it("the blocking stops are exactly criteria_failed, requisition_closed and opted_out", () => {
    expect([...ENGINE_BLOCKING_STOPS].sort()).toEqual(["criteria_failed", "opted_out", "requisition_closed"]);
    const sql = followupStoppedSql({ mobileExpr: "l.mobile10", requisitionExpr: "m.requisition_id" });
    expect(sql).toContain("qs.requisition_id = m.requisition_id");
    expect(sql).toContain("qs.stopped_reason IN ('criteria_failed','requisition_closed','opted_out')");
    expect(sql).toContain("qs.mode_at_enqueue IN ('live','canary')");
    expect(sql).not.toMatch(/replied|joined/);
  });
  it("the line-up leaves out people whose journey for this requisition was stopped (bound to the drive's requisition)", async () => {
    await lineUpCandidates("d1", { write: false });
    const pick = h.calls.find((c) => c.sql.includes("FROM he_lead l LEFT JOIN he_lead_insight"))!;
    expect(pick.sql).toContain(followupStoppedSql({ mobileExpr: "l.mobile10", requisitionExpr: "?" }).replace(/\s+/g, " ").trim());
    const at = pick.sql.split("?").length - 1;
    expect(pick.p).toHaveLength(at);
    // the requisition id is bound for the stop clause (and for the ordering), never interpolated
    expect(pick.p.filter((v) => v === "rX").length).toBeGreaterThanOrEqual(2);
    expect(pick.sql).not.toContain("'rX'");
  });
  it("a match suggested before the stop is never invited", async () => {
    await inviteForDrive("d1", { dryRun: true, max: 5 });
    const pick = h.calls.find((c) => c.sql.includes("m.state = 'suggested'"))!;
    expect(pick.sql).toContain(followupStoppedSql({ mobileExpr: "l.mobile10", requisitionExpr: "m.requisition_id" }).trim());
  });
});
