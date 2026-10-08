import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Final integration (criteria hook items 2-3): an enrolment from an approved shortlist stores shortlist_id and criteria_version_id, and a
 * shortlisted person skips only the eligibility checks the criteria already made (ruling: the approach and no-show caps still apply).
 */
const h = vi.hoisted(() => ({
  sqls: [] as Array<{ sql: string; p: unknown[] }>,
  existing: null as Record<string, unknown> | null,
  inelCalls: [] as Array<Record<string, unknown>>,
  inel: null as string | null,
}));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, p: unknown[] = []) => {
      const q = sql.replace(/\s+/g, " ").trim();
      h.sqls.push({ sql: q, p });
      if (q.includes("FROM job_requisition")) return [[{ approval_status: "approved", active_status: 1, closed_at: null, requested_headcount: 5, fulfilled_headcount: 0, requisition_validity: null }]];
      if (q.startsWith("SELECT") && q.includes("FROM qualified_followup WHERE mobile10 = ? AND requisition_id = ?")) return [h.existing ? [h.existing] : []];
      if (q.startsWith("INSERT INTO qualified_followup")) {
        if (!h.existing) h.existing = { id: p[0], source_type: p[1], also_in_sources: null, mode_at_enqueue: "live", stopped_reason: null, email: null, he_lead_id: null, match_id: null };
        return [{ affectedRows: 1 }];
      }
      return [{ affectedRows: 1 }];
    }),
  },
}));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../followup-enrol-eligibility.service.js", async () => {
  const actual = await vi.importActual<typeof import("../followup-enrol-eligibility.service.js")>("../followup-enrol-eligibility.service.js");
  return { ...actual, enrolIneligibility: vi.fn(async (i: Record<string, unknown>) => { h.inelCalls.push(i); return h.inel; }) };
});
vi.mock("../he-lead.service.js", () => ({ addEvent: vi.fn() }));

import { enqueueQualifiedFollowup } from "../qualified-followup.service.js";
import { ineligibleCode } from "../followup-enrol-eligibility.service.js";
import { readSwitches } from "../qualified-followup.policy.js";
import { toEnqueueInput } from "../../selection/enrolment-port.js";

const LIVE = readSwitches({ QUAL_FOLLOWUP_MODE: "live" } as NodeJS.ProcessEnv, new Map([["policy.followup.meta_live", 4], ["policy.followup.meta_old", 4], ["policy.followup.he", 4]]), []);
const insert = () => h.sqls.find((s) => s.sql.startsWith("INSERT INTO qualified_followup"))!;
const col = (s: { sql: string; p: unknown[] }, name: string) => {
  const cols = s.sql.slice(s.sql.indexOf("(") + 1, s.sql.indexOf(")")).split(",").map((c) => c.trim());
  return cols.includes(name) ? s.p[cols.indexOf(name)] : undefined;
};

beforeEach(() => { h.sqls = []; h.existing = null; h.inelCalls = []; h.inel = null; });

describe("shortlist link on enrolment", () => {
  it("writes shortlist_id and criteria_version_id for a shortlisted person", async () => {
    const r = await enqueueQualifiedFollowup({ sourceType: "he", requisitionId: "R1", originId: "run1", originLabel: "Approved shortlist", phone: "9876543210",
      shortlistId: "42", criteriaVersionId: "V1" }, LIVE);
    expect(r.status).toBe("enqueued");
    expect(col(insert(), "shortlist_id")).toBe("42");
    expect(col(insert(), "criteria_version_id")).toBe("V1");
  });
  it("an enrolment without a shortlist keeps the statement without the new columns (works before 2148)", async () => {
    await enqueueQualifiedFollowup({ sourceType: "meta_live", requisitionId: "R1", originId: "c1", originLabel: "Camp", phone: "9876543210" }, LIVE);
    expect(insert().sql).not.toContain("shortlist_id");
    expect(insert().sql).not.toContain("criteria_version_id");
  });
  it("an existing row gains the shortlist link once, never overwritten", async () => {
    h.existing = { id: "Q1", source_type: "he", also_in_sources: null, mode_at_enqueue: "live", stopped_reason: null, email: null, he_lead_id: null, match_id: null };
    const r = await enqueueQualifiedFollowup({ sourceType: "he", requisitionId: "R1", originId: "run1", originLabel: "x", phone: "9876543210", shortlistId: "42", criteriaVersionId: "V1" }, LIVE);
    expect(r).toEqual({ status: "exists", id: "Q1" });
    const u = h.sqls.find((s) => s.sql.startsWith("UPDATE qualified_followup SET shortlist_id"))!;
    expect(u.sql).toBe("UPDATE qualified_followup SET shortlist_id = COALESCE(shortlist_id, ?), criteria_version_id = COALESCE(criteria_version_id, ?) WHERE id = ?");
    expect(u.p).toEqual(["42", "V1", "Q1"]);
  });
  it("a shortlisted person runs the caps only; others the full gate", async () => {
    await enqueueQualifiedFollowup({ sourceType: "he", requisitionId: "R1", originId: "run1", originLabel: "x", phone: "9876543210", shortlistId: "42", criteriaVersionId: "V1" }, LIVE);
    h.existing = null;
    await enqueueQualifiedFollowup({ sourceType: "meta_live", requisitionId: "R1", originId: "c1", originLabel: "x", phone: "9876543211" }, LIVE);
    expect(h.inelCalls.map((c) => c.capsOnly ?? false)).toEqual([true, false]);
  });
  it("caps only: approach and no-show caps block; ex-employee, hard reject, cooling-off and location are the criteria's", () => {
    expect(ineligibleCode(["ex_employee_not_eligible", "contact_cap_30d"], true, { capsOnly: true })).toBe("approach_cap");
    expect(ineligibleCode(["no_show_cap_here"], false, { capsOnly: true })).toBe("no_show_cap");
    expect(ineligibleCode(["ex_employee_not_eligible", "hard_rejected_in_process", "rejected_in_process_cooling"], true, { capsOnly: true })).toBeNull();
    expect(ineligibleCode([], true)).toBe("location_elsewhere");
  });
});

describe("the selection enrolment port", () => {
  it("maps the shortlist link, the mobile, the Meta lead and the hold to the unified enrolment input", () => {
    expect(toEnqueueInput({ sourceType: "meta_live", requisitionId: "R1", mobile10: "9876543210", metaLeadId: "M1", campaignId: "C1", originId: "A1", originLabel: "Standing approval",
      shortlistId: "7", criteriaVersionId: "V2", heldReason: "auto_notify_off" })).toEqual({
      sourceType: "meta_live", requisitionId: "R1", phone: "9876543210", heLeadId: null, metaLeadId: "M1", atsCandidateId: null, campaignId: "C1", fullName: null, email: null,
      branchName: null, roleName: null, originId: "A1", originLabel: "Standing approval", shortlistId: "7", criteriaVersionId: "V2", heldReason: "auto_notify_off" });
  });
});
