import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const warn = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../logger.js", () => ({ logger: { warn, info: vi.fn(), error: vi.fn() } }));

import { enqueueMatchedFollowups, enqueueQualifiedFollowup } from "../qualified-followup.service.js";
import { followupSkipSql, readSwitches } from "../qualified-followup.policy.js";
import type { EnqueueInput, MatchedDriveRef } from "../qualified-followup.types.js";

const base: EnqueueInput = { sourceType: "he", requisitionId: "req-1", originId: "pool", originLabel: "Pool: ATS history", phone: "9876543210", heLeadId: "l1", eligibilityChecked: true };
const drive: MatchedDriveRef = { id: "d1", requisitionId: "req-1", sourceKind: "pool", runLabel: null, driveDate: "2026-10-08" };
const leadRow = (id: string, mobile: string, match: string | null = `m-${id}`) => ({ id, mobile10: mobile, full_name: "A B", email: null, ats_candidate_id: null, meta_lead_id: null, match_id: match });
const ALL_DRY = readSwitches({ QUAL_FOLLOWUP_MODE: "live" } as NodeJS.ProcessEnv, new Map([["policy.followup.meta_live", 1], ["policy.followup.meta_old", 1], ["policy.followup.he", 1]]));
const ALL_OFF = readSwitches({ QUAL_FOLLOWUP_MODE: "live" } as NodeJS.ProcessEnv);
const COLS = (sql: string) => sql.slice(sql.indexOf("(") + 1, sql.indexOf(")")).split(",").map((c) => c.trim());
const val = (call: [string, unknown[]], col: string) => call[1][COLS(call[0]).indexOf(col)];

/** he_lead SELECT returns `leads`; the requisition is open; the person lookup returns nothing before the INSERT, then the row. */
function wire(leads: ReturnType<typeof leadRow>[], existing: Record<string, unknown> | null = null) {
  let row = existing;
  execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("FROM job_requisition")) return [[{ approval_status: "approved", active_status: 1, closed_at: null, requested_headcount: 5, fulfilled_headcount: 0 }]];
    if (sql.includes("FROM he_lead l LEFT JOIN he_match m")) return [leads];
    if (sql.startsWith("INSERT INTO qualified_followup")) { row = row ?? { id: params[0], source_type: params[1], also_in_sources: null, mode_at_enqueue: params.at(-1), stopped_reason: null }; return [{ affectedRows: 1 }]; }
    if (sql.includes("FROM qualified_followup WHERE mobile10 = ? AND requisition_id = ?")) { const r = row; row = existing; return [r ? [r] : []]; }
    return [{ affectedRows: 1 }];
  });
}
const inserts = () => execute.mock.calls.filter(([q]) => String(q).startsWith("INSERT INTO qualified_followup")) as Array<[string, unknown[]]>;

beforeEach(() => { execute.mockReset(); warn.mockReset(); });

describe("INSERT values (one owner: the pipeline)", () => {
  it("a new row is pipeline-owned, enrolled, pending call, due dates set, tag last", async () => {
    wire([]);
    await enqueueQualifiedFollowup({ ...base, email: "a@b.com" }, ALL_DRY);
    const ins = inserts()[0];
    expect(val(ins, "email_due_at")).toBeInstanceOf(Date);
    expect(val(ins, "wa_due_at")).toBeInstanceOf(Date);
    expect([val(ins, "owner"), val(ins, "call_state"), val(ins, "journey_state")]).toEqual(["pipeline", "pending", "enrolled"]);
    expect(ins[1]).not.toContain("engine");
    expect(ins[1].at(-1)).toBe("dry_run");
  });
});

describe("enqueueMatchedFollowups", () => {
  it("every source off: zero database calls, zeros", async () => {
    expect(await enqueueMatchedFollowups(drive, ["l1"], null, ALL_OFF)).toEqual({ enqueued: 0, promoted: 0, exists: 0, linked: 0 });
    expect(execute).not.toHaveBeenCalled();
  });
  it("pool drive: he / pool / Pool: ATS history, pipeline-owned, drive id, match id, one row per lead", async () => {
    wire([leadRow("l1", "9876543210"), leadRow("l2", "9876543211")]);
    const r = await enqueueMatchedFollowups(drive, ["l1", "l2"], null, ALL_DRY);
    expect(r.enqueued).toBe(2);
    const ins = inserts();
    expect(ins).toHaveLength(2);
    for (const c of ins) {
      expect([val(c, "source_type"), val(c, "drive_id"), val(c, "origin_id"), val(c, "origin_label"), val(c, "owner")]).toEqual(["he", "d1", "pool", "Pool: ATS history", "pipeline"]);
      expect(String(val(c, "match_id"))).toMatch(/^m-l/);
    }
  });
  it("campaign re-run: meta_old with the drive id and the run label, or the dated default", async () => {
    wire([leadRow("l1", "9876543210")]);
    await enqueueMatchedFollowups({ ...drive, sourceKind: "campaign", runLabel: "Re-run 12 Sep batch" }, ["l1"], null, ALL_DRY);
    let c = inserts()[0];
    expect([val(c, "source_type"), val(c, "origin_id"), val(c, "origin_label")]).toEqual(["meta_old", "d1", "Re-run 12 Sep batch"]);
    execute.mockReset(); wire([leadRow("l1", "9876543210")]);
    await enqueueMatchedFollowups({ ...drive, sourceKind: "campaign", runLabel: null }, ["l1"], null, ALL_DRY);
    c = inserts()[0];
    expect(val(c, "origin_label")).toBe("Re-run 2026-10-08");
  });
  it("a stream ref overrides the type and origin", async () => {
    wire([leadRow("l1", "9876543210")]);
    await enqueueMatchedFollowups(drive, ["l1"], { streamId: "s1", sourceType: "meta_live", originId: "c9", originLabel: "Oct ads" }, ALL_DRY);
    const c = inserts()[0];
    expect([val(c, "source_type"), val(c, "origin_id"), val(c, "origin_label")]).toEqual(["meta_live", "c9", "Oct ads"]);
  });
  it("an existing meta_live row keeps its source, he goes to also_in_sources, the match is linked, nothing is handed over", async () => {
    wire([leadRow("l1", "9876543210")], { id: "qf1", source_type: "meta_live", also_in_sources: null, mode_at_enqueue: "dry_run", stopped_reason: null, match_id: null });
    const r = await enqueueMatchedFollowups(drive, ["l1"], null, ALL_DRY);
    expect(r).toEqual({ enqueued: 0, promoted: 0, exists: 1, linked: 1 });
    const also = execute.mock.calls.find(([q]) => String(q).startsWith("UPDATE qualified_followup SET also_in_sources"))!;
    expect(also[1]).toEqual([JSON.stringify(["he"]), "qf1"]);
    expect(execute.mock.calls.some(([q]) => String(q).includes("owner = 'engine'"))).toBe(false);
  });
  it("reads he_lead in chunks of 500", async () => {
    wire([]);
    await enqueueMatchedFollowups(drive, Array.from({ length: 1001 }, (_, i) => `l${i}`), null, ALL_DRY);
    const sel = execute.mock.calls.filter(([q]) => String(q).includes("FROM he_lead l LEFT JOIN he_match m"));
    expect(sel.map(([, p]) => p.length)).toEqual([501, 501, 2]); // requisition id + the chunk
  });
  it("a rejecting he_lead SELECT: zeros, one log, no phone number in the log", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM job_requisition")) return [[{ approval_status: "approved", active_status: 1, closed_at: null, requested_headcount: 5, fulfilled_headcount: 0 }]];
      throw new Error("Lock wait for 9876543210 failed");
    });
    expect(await enqueueMatchedFollowups(drive, ["l1"], null, ALL_DRY)).toEqual({ enqueued: 0, promoted: 0, exists: 0, linked: 0 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls[0])).not.toMatch(/\d{10}/);
  });
  it("a closed requisition enrols nobody", async () => {
    execute.mockImplementation(async (sql: string) => (sql.includes("FROM job_requisition") ? [[{ approval_status: "closed", active_status: 1, closed_at: null, requested_headcount: 5, fulfilled_headcount: 0 }]] : [[]]));
    expect((await enqueueMatchedFollowups(drive, ["l1"], null, ALL_DRY)).enqueued).toBe(0);
    expect(inserts()).toHaveLength(0);
  });
});

describe("followupSkipSql owner condition (row-based since the unified method)", () => {
  const a = { mobileExpr: "l.mobile10", requisitionExpr: "m.requisition_id" };
  it("only pipeline-owned live/canary rows silence a lead, open or stopped, whatever the env", () => {
    const s = followupSkipSql(a);
    expect(s).toContain("qf.owner = 'pipeline' AND qf.mode_at_enqueue IN ('live','canary')");
    expect(s).not.toContain("stopped_reason");
  });
});

