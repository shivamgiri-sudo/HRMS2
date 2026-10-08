import { beforeEach, describe, expect, it, vi } from "vitest";

/** One enrolment for every source: switches, D8, eligibility, held_manual, promotion, line-up linking. */
const h = vi.hoisted(() => ({
  sqls: [] as Array<{ sql: string; p: unknown[] }>,
  req: { approval_status: "approved", active_status: 1, closed_at: null, requested_headcount: 5, fulfilled_headcount: 0, requisition_validity: null } as Record<string, unknown> | null,
  existing: null as Record<string, unknown> | null,
  meta: null as Record<string, unknown> | null,
  leads: [] as Array<Record<string, unknown>>,
  inel: null as string | null,
  events: [] as unknown[][],
}));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, p: unknown[] = []) => {
      const q = sql.replace(/\s+/g, " ").trim();
      h.sqls.push({ sql: q, p });
      if (q.includes("FROM job_requisition")) return [h.req ? [h.req] : []];
      if (q.startsWith("SELECT") && q.includes("FROM qualified_followup WHERE mobile10 = ? AND requisition_id = ?")) return [h.existing ? [h.existing] : []];
      if (q.startsWith("INSERT INTO qualified_followup")) {
        if (!h.existing) h.existing = { id: p[0], source_type: p[1], also_in_sources: null, mode_at_enqueue: p[p.length - 1], stopped_reason: null, email: p[11], he_lead_id: p[3], match_id: null, drive_id: p[7] };
        return [{ affectedRows: 1 }];
      }
      if (q.includes("FROM meta_lead_raw r")) return [h.meta ? [h.meta] : []];
      if (q.includes("FROM he_lead l LEFT JOIN he_match m")) return [h.leads];
      if (q.includes("SELECT email, he_lead_id FROM qualified_followup WHERE id = ?")) return [[{ email: "a@b.com", he_lead_id: "L1" }]];
      return [{ affectedRows: 1 }];
    }),
  },
}));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../followup-enrol-eligibility.service.js", async () => {
  const actual = await vi.importActual<typeof import("../followup-enrol-eligibility.service.js")>("../followup-enrol-eligibility.service.js");
  return { ...actual, enrolIneligibility: vi.fn(async () => h.inel) };
});
vi.mock("../he-lead.service.js", () => ({ addEvent: vi.fn(async (...a: unknown[]) => { h.events.push(a); }) }));

import { enqueueMatchedFollowups, enqueueMetaLeadFollowup, enqueueQualifiedFollowup, releaseHeldManual } from "../qualified-followup.service.js";
import { ineligibleCode } from "../followup-enrol-eligibility.service.js";
import { readSwitches } from "../qualified-followup.policy.js";
import type { EnqueueInput } from "../qualified-followup.types.js";

const live = { QUAL_FOLLOWUP_MODE: "live" } as NodeJS.ProcessEnv;
const sw = (codes: Record<string, number>, canary: Array<{ sourceType: "meta_live" | "meta_old" | "he"; requisitionId: string }> = []) =>
  readSwitches(live, new Map(Object.entries(codes).map(([k, v]) => [`policy.followup.${k}`, v])), canary);
const LIVE_ALL = sw({ meta_live: 4, meta_old: 4, he: 4 });
const input: EnqueueInput = { sourceType: "meta_live", requisitionId: "R1", originId: "c1", originLabel: "Camp", phone: "+91 98765 43210", email: "a@b.com", metaLeadId: "m1" };
const inserts = () => h.sqls.filter((s) => s.sql.startsWith("INSERT INTO qualified_followup"));
const updates = () => h.sqls.filter((s) => s.sql.startsWith("UPDATE qualified_followup"));
const col = (s: { sql: string; p: unknown[] }, name: string) => {
  const cols = s.sql.slice(s.sql.indexOf("(") + 1, s.sql.indexOf(")")).split(",").map((c) => c.trim());
  return s.p[cols.indexOf(name)];
};

beforeEach(() => {
  h.sqls = []; h.existing = null; h.meta = null; h.leads = []; h.inel = null; h.events = [];
  h.req = { approval_status: "approved", active_status: 1, closed_at: null, requested_headcount: 5, fulfilled_headcount: 0, requisition_validity: null };
});

describe("enqueueQualifiedFollowup", () => {
  it("off source makes no db call", async () => {
    expect(await enqueueQualifiedFollowup(input, sw({ meta_live: 0, he: 4 }))).toEqual({ status: "skipped_off" });
    expect(await enqueueQualifiedFollowup(input, readSwitches({} as NodeJS.ProcessEnv))).toEqual({ status: "skipped_off" });
    expect(h.sqls).toHaveLength(0);
  });

  it("pending-approval requisition -> invalid, no insert", async () => {
    h.req = { ...h.req, approval_status: "pending_approval" };
    expect(await enqueueQualifiedFollowup(input, LIVE_ALL)).toEqual({ status: "invalid", reason: "requisition is not approved" });
    expect(inserts()).toHaveLength(0);
  });

  it("a new live enrolment: pipeline-owned, enrolled, due times, tag live", async () => {
    const r = await enqueueQualifiedFollowup(input, LIVE_ALL);
    expect(r.status).toBe("enqueued");
    const ins = inserts()[0];
    expect(col(ins, "mode_at_enqueue")).toBe("live");
    expect(col(ins, "owner")).toBe("pipeline");
    expect(col(ins, "journey_state")).toBe("enrolled");
    expect(col(ins, "email_due_at")).toBeInstanceOf(Date);
    expect(col(ins, "wa_due_at")).toBeInstanceOf(Date);
    expect(col(ins, "mobile10")).toBe("9876543210");
    expect(h.sqls.some((s) => s.sql.includes("owner = 'engine'") || s.p.includes("engine"))).toBe(false);
  });

  it("canary tags canary only for listed requisitions, others shadow as dry_run", async () => {
    const s = sw({ meta_live: 3 }, [{ sourceType: "meta_live", requisitionId: "R1" }]);
    await enqueueQualifiedFollowup(input, s);
    expect(col(inserts()[0], "mode_at_enqueue")).toBe("canary");
    h.existing = null; h.sqls = [];
    await enqueueQualifiedFollowup({ ...input, requisitionId: "R2" }, s);
    expect(col(inserts()[0], "mode_at_enqueue")).toBe("dry_run");
  });

  it("promotes a dry_run row on live enrolment", async () => {
    h.existing = { id: "Q1", source_type: "meta_live", also_in_sources: null, mode_at_enqueue: "dry_run", stopped_reason: null, email: "a@b.com", he_lead_id: "L1", match_id: null, drive_id: null };
    const r = await enqueueQualifiedFollowup(input, LIVE_ALL);
    expect(r).toEqual({ status: "promoted", id: "Q1" });
    const u = updates().find((x) => x.sql.includes("SET mode_at_enqueue = ?"))!;
    expect(u.p[0]).toBe("live");
    for (const frag of ["journey_state = ?", "email_status = NULL", "wa_status = NULL", "call_state = 'pending'", "owner = 'pipeline'", "WHERE id = ? AND mode_at_enqueue = ? AND stopped_reason IS NULL"]) expect(u.sql).toContain(frag);
    expect(inserts()).toHaveLength(0);
    expect(h.events).toContainEqual(["L1", "followup_promoted", expect.objectContaining({ detail: "dry_run -> live" })]);
  });

  it("does not promote a stopped row", async () => {
    h.existing = { id: "Q1", source_type: "meta_live", also_in_sources: null, mode_at_enqueue: "dry_run", stopped_reason: "replied", email: null, he_lead_id: null, match_id: null, drive_id: null };
    expect(await enqueueQualifiedFollowup(input, LIVE_ALL)).toEqual({ status: "exists", id: "Q1" });
    expect(updates()).toHaveLength(0);
  });

  it("does not demote a live row on a dry_run enrolment", async () => {
    h.existing = { id: "Q1", source_type: "meta_live", also_in_sources: null, mode_at_enqueue: "live", stopped_reason: null, email: null, he_lead_id: null, match_id: null, drive_id: null };
    expect(await enqueueQualifiedFollowup(input, sw({ meta_live: 1 }))).toEqual({ status: "exists", id: "Q1" });
    expect(updates()).toHaveLength(0);
  });

  it("re-enrolment is idempotent: exists, one INSERT attempt only", async () => {
    expect((await enqueueQualifiedFollowup(input, LIVE_ALL)).status).toBe("enqueued");
    expect((await enqueueQualifiedFollowup(input, LIVE_ALL)).status).toBe("exists");
    expect(inserts()).toHaveLength(1);
  });

  it("a different source on an existing row is recorded in also_in_sources", async () => {
    h.existing = { id: "Q1", source_type: "he", also_in_sources: null, mode_at_enqueue: "live", stopped_reason: null, email: null, he_lead_id: null, match_id: null, drive_id: null };
    await enqueueQualifiedFollowup(input, LIVE_ALL);
    expect(updates().find((u) => u.sql.includes("also_in_sources"))!.p[0]).toBe(JSON.stringify(["meta_live"]));
  });

  it.each(["cooling_off", "approach_cap", "no_show_cap", "ex_employee", "hard_reject", "location_elsewhere"])("ineligible %s -> stopped row ineligible_<code>, no due times", async (code) => {
    h.inel = code;
    const r = await enqueueQualifiedFollowup(input, LIVE_ALL);
    expect(r.status).toBe("ineligible");
    expect(r.reason).toBe(code);
    const ins = inserts()[0];
    expect(col(ins, "journey_state")).toBe("stopped");
    expect(col(ins, "stopped_reason")).toBe(`ineligible_${code}`);
    expect(col(ins, "email_due_at")).toBeNull();
    expect(col(ins, "wa_due_at")).toBeNull();
    expect(col(ins, "mode_at_enqueue")).toBe("live"); // a live row keeps the engine and legacy away (one method)
  });

  it("held_manual: no due times, held_reason kept", async () => {
    const r = await enqueueQualifiedFollowup({ ...input, heldReason: "skip_outreach" }, LIVE_ALL);
    expect(r.status).toBe("held");
    const ins = inserts()[0];
    expect(col(ins, "journey_state")).toBe("held_manual");
    expect(col(ins, "held_reason")).toBe("skip_outreach");
    expect(col(ins, "email_due_at")).toBeNull();
    expect(col(ins, "wa_due_at")).toBeNull();
  });
});

describe("enqueueMetaLeadFollowup", () => {
  const lead = { id: "m1", screening_result: "qualified", parsed_phone: "9876543210", parsed_name: "A", parsed_email: "a@b.com", campaign_id: "c1", req_id: "R1", campaign_name: "Camp", jr_id: "R1",
    branch_name: "AHMEDABAD-JALDARSHAN", designation_name: "CSE", meta_screening_config: null, parsed_location: "Ahmedabad", current_address: null, permanent_address: null, branch_city: "Ahmedabad", branch_state: "Gujarat", ats_candidate_id: null };
  it("Live Meta off: no database call", async () => {
    expect(await enqueueMetaLeadFollowup("m1", { switches: sw({ meta_live: 0, he: 4 }) })).toEqual({ status: "skipped_off" });
    expect(h.sqls).toHaveLength(0);
  });
  it("uses the lead's routed requisition only (no campaign fallback)", async () => {
    h.meta = lead;
    await enqueueMetaLeadFollowup("m1", { switches: LIVE_ALL });
    const q = h.sqls[0].sql;
    expect(q).toContain("r.requisition_id AS req_id");
    expect(q).not.toContain("COALESCE(r.requisition_id, c.requisition_id)");
  });
  it("auto_notify off -> held_manual with no due times", async () => {
    h.meta = { ...lead, meta_screening_config: JSON.stringify({ auto_notify: false }) };
    expect((await enqueueMetaLeadFollowup("m1", { switches: LIVE_ALL })).status).toBe("held");
    expect(col(inserts()[0], "held_reason")).toBe("auto_notify_off");
    expect(col(inserts()[0], "email_due_at")).toBeNull();
  });
  it("skipOutreach -> held_manual, held_reason skip_outreach", async () => {
    h.meta = lead;
    expect((await enqueueMetaLeadFollowup("m1", { switches: LIVE_ALL, skipOutreach: true })).status).toBe("held");
    expect(col(inserts()[0], "held_reason")).toBe("skip_outreach");
  });
  it("not qualified / no requisition", async () => {
    h.meta = { ...lead, screening_result: "rejected" };
    expect((await enqueueMetaLeadFollowup("m1", { switches: LIVE_ALL })).status).toBe("not_qualified");
    h.meta = { ...lead, jr_id: null };
    expect((await enqueueMetaLeadFollowup("m1", { switches: LIVE_ALL })).status).toBe("invalid");
  });
});

describe("enqueueMatchedFollowups", () => {
  const drive = { id: "D1", requisitionId: "R1", sourceKind: "pool", runLabel: null, driveDate: "2026-10-12" };
  it("matched line-up writes pipeline-owned rows with match_id; no owner = 'engine' anywhere", async () => {
    h.leads = [{ id: "L1", mobile10: "9876543210", full_name: "A", email: null, ats_candidate_id: null, meta_lead_id: null, match_id: "M1" }];
    const out = await enqueueMatchedFollowups(drive, ["L1"], null, LIVE_ALL);
    expect(out).toEqual({ enqueued: 1, promoted: 0, exists: 0, linked: 0 });
    const ins = inserts()[0];
    expect(col(ins, "owner")).toBe("pipeline");
    expect(col(ins, "match_id")).toBe("M1");
    expect(col(ins, "source_type")).toBe("he");
    expect(h.sqls.some((s) => s.sql.includes("'engine'") || s.p.includes("engine"))).toBe(false);
  });
  it("an existing row gets the match linked (no hand-over)", async () => {
    h.leads = [{ id: "L1", mobile10: "9876543210", full_name: "A", email: null, ats_candidate_id: null, meta_lead_id: null, match_id: "M1" }];
    h.existing = { id: "Q1", source_type: "he", also_in_sources: null, mode_at_enqueue: "live", stopped_reason: null, email: null, he_lead_id: "L1", match_id: null, drive_id: null };
    const out = await enqueueMatchedFollowups(drive, ["L1"], null, LIVE_ALL);
    expect(out).toEqual({ enqueued: 0, promoted: 0, exists: 1, linked: 1 });
    const u = updates().find((x) => x.sql.includes("match_id = COALESCE(match_id, ?)"))!;
    expect(u.p).toEqual(["M1", "D1", "Q1"]);
  });
  it("off: no database call", async () => {
    expect(await enqueueMatchedFollowups(drive, ["L1"], null, sw({ he: 0, meta_live: 4 }))).toEqual({ enqueued: 0, promoted: 0, exists: 0, linked: 0 });
    expect(h.sqls).toHaveLength(0);
  });
});

describe("releaseHeldManual", () => {
  it("held_manual -> enrolled with due times from now, by HR", async () => {
    expect(await releaseHeldManual("Q1", "u-1")).toBe(true);
    const u = updates()[0];
    expect(u.sql).toContain("SET journey_state = 'enrolled', held_reason = NULL, email_due_at = ?, wa_due_at = ? WHERE id = ? AND journey_state = 'held_manual' AND stopped_reason IS NULL");
    expect(h.events).toContainEqual(["L1", "followup_released", expect.objectContaining({ actor: "u-1" })]);
  });
});

describe("ineligibleCode", () => {
  it("maps the gate's first block; location last; null when eligible", () => {
    expect(ineligibleCode(["rejected_in_process_cooling"], true)).toBe("cooling_off");
    expect(ineligibleCode(["contact_cap_30d"], false)).toBe("approach_cap");
    expect(ineligibleCode(["no_show_cap_here"], false)).toBe("no_show_cap");
    expect(ineligibleCode(["ex_employee_not_eligible"], false)).toBe("ex_employee");
    expect(ineligibleCode(["hard_rejected_in_process"], false)).toBe("hard_reject");
    expect(ineligibleCode(["current_employee"], false)).toBe("current_employee");
    expect(ineligibleCode([], true)).toBe("location_elsewhere");
    expect(ineligibleCode([], false)).toBeNull();
  });
});
