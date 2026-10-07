import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const warn = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../logger.js", () => ({ logger: { warn, info: vi.fn(), error: vi.fn() } }));

import { enqueueMatchedFollowups, enqueueQualifiedFollowup } from "../qualified-followup.service.js";
import { followupSkipSql } from "../qualified-followup.policy.js";
import type { EnqueueInput, MatchedDriveRef } from "../qualified-followup.types.js";

const base: EnqueueInput = { sourceType: "he", requisitionId: "req-1", originId: "pool", originLabel: "Pool: ATS history", phone: "9876543210", heLeadId: "l1" };
const drive: MatchedDriveRef = { id: "d1", requisitionId: "req-1", sourceKind: "pool", runLabel: null, driveDate: "2026-10-08" };
const leadRow = (id: string, mobile: string) => ({ id, mobile10: mobile, full_name: "A B", email: null, ats_candidate_id: null, meta_lead_id: null });

/** he_lead SELECT returns `leads`; INSERT is a no-op; the person lookup returns a fresh row (enqueued) or an existing one. */
function wire(leads: ReturnType<typeof leadRow>[], existing: { id: string; source_type: string } | null = null) {
  let lastId = "";
  execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.startsWith("SELECT id, mobile10")) return [leads];
    if (sql.startsWith("INSERT INTO qualified_followup")) { lastId = params[0] as string; return [{ affectedRows: 1 }]; }
    if (sql.startsWith("SELECT id, source_type, also_in_sources")) return [[existing ? { ...existing, also_in_sources: null } : { id: lastId, source_type: "he", also_in_sources: null }]];
    if (sql.startsWith("UPDATE qualified_followup SET owner")) return [{ affectedRows: 1 }];
    return [{ affectedRows: 1 }];
  });
}
const inserts = () => execute.mock.calls.filter(([q]) => String(q).startsWith("INSERT INTO qualified_followup"));

beforeEach(() => { execute.mockReset(); warn.mockReset(); });

describe("engineOwned INSERT values", () => {
  it("engine-owned: owner engine, statuses engine, call skipped, due times null, tag last", async () => {
    wire([]);
    await enqueueQualifiedFollowup({ ...base, engineOwned: true }, "dry_run");
    const [sql, p] = inserts()[0];
    expect(sql).toMatch(/\?, NULL, \?\)/);
    expect(p.slice(15, 22)).toEqual([p[15], null, null, "engine", "engine", "engine", "skipped"]);
    expect(p.filter((x: unknown) => x === "engine").length).toBeGreaterThanOrEqual(2);
    expect(p.at(-1)).toBe("dry_run");
  });
  it("pipeline-owned (today's values): pipeline, null statuses, pending, due dates set, tag last", async () => {
    wire([]);
    await enqueueQualifiedFollowup({ ...base, email: "a@b.com" }, "dry_run");
    const p = inserts()[0][1];
    expect(p[16]).toBeInstanceOf(Date);
    expect(p[17]).toBeInstanceOf(Date);
    expect(p.slice(18, 22)).toEqual(["pipeline", null, null, "pending"]);
    expect(p).not.toContain("engine");
    expect(p.at(-1)).toBe("dry_run");
  });
});

describe("enqueueMatchedFollowups", () => {
  it("mode off: zero database calls, zeros", async () => {
    expect(await enqueueMatchedFollowups(drive, ["l1"], null, "off")).toEqual({ enqueued: 0, exists: 0, handedOver: 0 });
    expect(execute).not.toHaveBeenCalled();
  });
  it("pool drive: he / pool / Pool: ATS history, engine-owned, drive id, one row per lead", async () => {
    wire([leadRow("l1", "9876543210"), leadRow("l2", "9876543211")]);
    const r = await enqueueMatchedFollowups(drive, ["l1", "l2"], null, "dry_run");
    expect(r.enqueued).toBe(2);
    const ins = inserts();
    expect(ins).toHaveLength(2);
    for (const [, p] of ins) {
      expect(p[1]).toBe("he"); // source_type
      expect(p[7]).toBe("d1"); // drive_id
      expect(p[8]).toBe("pool");
      expect(p[9]).toBe("Pool: ATS history");
      expect(p.slice(19, 22)).toEqual(["engine", "engine", "skipped"]);
    }
  });
  it("campaign re-run: meta_old with the drive id and the run label, or the dated default", async () => {
    wire([leadRow("l1", "9876543210")]);
    await enqueueMatchedFollowups({ ...drive, sourceKind: "campaign", runLabel: "Re-run 12 Sep batch" }, ["l1"], null, "dry_run");
    let p = inserts()[0][1];
    expect([p[1], p[8], p[9]]).toEqual(["meta_old", "d1", "Re-run 12 Sep batch"]);
    execute.mockReset(); wire([leadRow("l1", "9876543210")]);
    await enqueueMatchedFollowups({ ...drive, sourceKind: "campaign", runLabel: null }, ["l1"], null, "dry_run");
    p = inserts()[0][1];
    expect(p[9]).toBe("Re-run 2026-10-08");
  });
  it("a stream ref overrides the type and origin", async () => {
    wire([leadRow("l1", "9876543210")]);
    await enqueueMatchedFollowups(drive, ["l1"], { streamId: "s1", sourceType: "meta_live", originId: "c9", originLabel: "Oct ads" }, "dry_run");
    const p = inserts()[0][1];
    expect([p[1], p[8], p[9]]).toEqual(["meta_live", "c9", "Oct ads"]);
  });
  it("first touch: an existing meta_live row keeps its source, he goes to also_in_sources, and the hand-over is guarded in the WHERE", async () => {
    wire([leadRow("l1", "9876543210")], { id: "qf1", source_type: "meta_live" });
    const r = await enqueueMatchedFollowups(drive, ["l1"], null, "dry_run");
    expect(r).toEqual({ enqueued: 0, exists: 1, handedOver: 1 });
    const also = execute.mock.calls.find(([q]) => String(q).startsWith("UPDATE qualified_followup SET also_in_sources"))!;
    expect(also[1]).toEqual([JSON.stringify(["he"]), "qf1"]);
    const [sql, p] = execute.mock.calls.find(([q]) => String(q).startsWith("UPDATE qualified_followup SET owner"))!;
    expect(sql).toContain("WHERE id = ? AND owner = 'pipeline' AND stopped_reason IS NULL");
    expect(sql).toContain("COALESCE(wa_template_key, '') = 'he_walkin_invite'"); // a bare NULL = ... would make NOT(...) NULL and never hand over an unsent row
    expect(sql).toContain("IN ('sent','test_sent')");
    expect(sql).toContain("<> 'sending'");
    expect(p).toEqual(["d1", "qf1"]);
  });
  it("a hand-over that matches no row (T1 already out, or already engine-owned) counts zero", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT id, mobile10")) return [[leadRow("l1", "9876543210")]];
      if (sql.startsWith("SELECT id, source_type")) return [[{ id: "qf1", source_type: "he", also_in_sources: null }]];
      if (sql.startsWith("UPDATE qualified_followup SET owner")) return [{ affectedRows: 0 }];
      return [{ affectedRows: 1 }];
    });
    expect(await enqueueMatchedFollowups(drive, ["l1"], null, "dry_run")).toEqual({ enqueued: 0, exists: 1, handedOver: 0 });
  });
  it("reads he_lead in chunks of 500", async () => {
    wire([]);
    await enqueueMatchedFollowups(drive, Array.from({ length: 1001 }, (_, i) => `l${i}`), null, "dry_run");
    const sel = execute.mock.calls.filter(([q]) => String(q).startsWith("SELECT id, mobile10"));
    expect(sel.map(([, p]) => p.length)).toEqual([500, 500, 1]);
  });
  it("a rejecting he_lead SELECT: zeros, one log, no phone number in the log", async () => {
    execute.mockRejectedValue(new Error("Lock wait for 9876543210 failed"));
    expect(await enqueueMatchedFollowups(drive, ["l1"], null, "dry_run")).toEqual({ enqueued: 0, exists: 0, handedOver: 0 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls[0])).not.toMatch(/\d{10}/);
  });
});

describe("followupSkipSql owner condition", () => {
  const a = { mobileExpr: "l.mobile10", requisitionExpr: "m.requisition_id" };
  it("live: only OPEN live rows owned by the pipeline silence a lead", () => {
    const s = followupSkipSql(a, { QUAL_FOLLOWUP_MODE: "live" });
    expect(s).toContain("qf.stopped_reason IS NULL AND qf.mode_at_enqueue = 'live' AND qf.owner = 'pipeline')");
  });
  it("not owned by the pipeline (unset, dry_run, test flag): empty, byte-identical to before", () => {
    expect(followupSkipSql(a, {})).toBe("");
    expect(followupSkipSql(a, { QUAL_FOLLOWUP_MODE: "dry_run" })).toBe("");
    expect(followupSkipSql(a, { QUAL_FOLLOWUP_MODE: "live", QUAL_FOLLOWUP_TEST_MODE: "true" })).toBe("");
  });
  it("live output equals the previous string plus only the owner condition", () => {
    const prev = " AND NOT EXISTS (SELECT 1 FROM qualified_followup qf WHERE qf.mobile10 = l.mobile10 COLLATE utf8mb4_unicode_ci AND qf.requisition_id = m.requisition_id AND qf.stopped_reason IS NULL AND qf.mode_at_enqueue = 'live')";
    expect(followupSkipSql(a, { QUAL_FOLLOWUP_MODE: "live" })).toBe(prev.replace("'live')", "'live' AND qf.owner = 'pipeline')"));
  });
});
