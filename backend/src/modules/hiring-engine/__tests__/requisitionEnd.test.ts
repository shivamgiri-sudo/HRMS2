/** WS3 E1: the requisition end date stops new outreach when enforced (env key + policy); booked people are untouched (reminders are other paths). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ sqls: [] as Array<{ sql: string; p: unknown[] }>, policy: 1 as number | null, validity: "2026-10-08" as string | null, writes: [] as string[] }));
vi.mock("../../../db/mysql.js", () => {
  const exec = async (sql: string, p: unknown[] = []) => {
    const s = sql.replace(/\s+/g, " ").trim();
    h.sqls.push({ sql: s, p });
    if (s.startsWith("SELECT value FROM he_model_param WHERE param_key = ?") && p[0] === "policy.req_end_date_enforced") return [h.policy == null ? [] : [{ value: h.policy }], []];
    if (s.startsWith("SELECT requisition_validity FROM job_requisition")) return [[{ requisition_validity: h.validity }], []];
    if (s.includes("FROM he_drive d JOIN job_requisition jr")) return [[{ requisition_id: "r1", requisition_validity: h.validity }], []];
    if (s.includes("FROM requisition_stream s")) return [[{ id: "s1", requisition_id: "r1", branch_name: "NOIDA-2", source_type: "he", origin_id: "pool", origin_label: "Pool", open_from: "2026-10-05", open_days: 20,
      daily_invites: null, status: "open", closed_reason: null, version: 0, created_by: null, created_at: "2026-10-05", approval_status: "approved", active_status: 1, requested_headcount: 10,
      fulfilled_headcount: 0, jr_id: "r1", requisition_validity: h.validity }], []];
    if (/^(INSERT|UPDATE)/.test(s)) h.writes.push(s);
    return [s.startsWith("UPDATE") ? { affectedRows: 1 } : [], []];
  };
  const conn = { execute: exec, beginTransaction: async () => undefined, commit: async () => undefined, rollback: async () => undefined, release: () => undefined };
  return { db: { execute: exec, query: exec, getConnection: async () => conn } };
});

import { endDateEnforcementAllowed, loadEndDateEnforced, requisitionEndRefusal } from "../requisition-criteria.js";
import { autoCloseStreams } from "../requisition-stream.service.js";
import { inviteForDrive } from "../he-engine.service.js";

const NOW = new Date("2026-10-09T06:00:00Z");
beforeEach(() => { h.sqls = []; h.writes = []; h.policy = 1; h.validity = "2026-10-08"; process.env.REQ_END_DATE_ENFORCEMENT = "policy"; });

describe("the two keys", () => {
  it("env off: never enforced and nothing read", async () => {
    delete process.env.REQ_END_DATE_ENFORCEMENT;
    expect(endDateEnforcementAllowed()).toBe(false);
    expect(await loadEndDateEnforced()).toBe(false);
    expect(await requisitionEndRefusal("r1", NOW)).toBeNull();
    expect(h.sqls).toHaveLength(0);
  });
  it("env allows, policy decides", async () => {
    expect(await loadEndDateEnforced()).toBe(true);
    h.policy = 0;
    expect(await loadEndDateEnforced()).toBe(false);
    h.policy = null;
    expect(await loadEndDateEnforced()).toBe(false);
  });
  it("yesterday's end date refuses; today's is still open (inclusive)", async () => {
    expect(await requisitionEndRefusal("r1", NOW)).toBe("requisition end date passed (2026-10-08)");
    h.validity = "2026-10-09";
    expect(await requisitionEndRefusal("r1", NOW)).toBeNull();
    h.validity = null;
    expect(await requisitionEndRefusal("r1", NOW)).toBeNull();
  });
});

describe("stream auto-close", () => {
  it("enforced: a stream of an ended requisition closes window_ended even with days left", async () => {
    const out = await autoCloseStreams("2026-10-09", false);
    expect(out).toEqual([{ streamId: "s1", requisitionId: "r1", reason: "window_ended" }]);
    expect(h.sqls.find((x) => x.sql.includes("FROM requisition_stream s"))!.sql).toContain("jr.requisition_validity");
  });
  it("not enforced: the stream stays open", async () => {
    h.policy = 0;
    expect(await autoCloseStreams("2026-10-09", false)).toEqual([]);
  });
});

describe("engine first invites", () => {
  // "ended" is judged against today (IST): the clock is pinned to the fixtures' day (2026-10-09).
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });
  it("enforced and ended: no first invite for the drive, nothing written", async () => {
    const r = await inviteForDrive("d1", { dryRun: false, max: 10 });
    expect(r.considered).toBe(0);
    expect(r.blocked).toEqual({ "requisition end date passed (2026-10-08)": 1 });
    expect(h.writes).toEqual([]);
    expect(h.sqls.some((x) => x.sql.includes("FROM he_match m JOIN he_lead l"))).toBe(false);
  });
  it("not ended: the drive is invited as before", async () => {
    h.validity = "2026-10-20";
    await inviteForDrive("d1", { dryRun: true, max: 10 });
    expect(h.sqls.some((x) => x.sql.includes("FROM he_match m JOIN he_lead l"))).toBe(true);
  });
});
