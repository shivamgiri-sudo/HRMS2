import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { cleanNote, NOTE_MAX, OUTCOME_REASONS, OUTCOME_REASON_LABEL, parseReasonBody } from "../he-outcome-reason.js";
import { listOutcomes, outcomeReasonCounts, recordOutcomeReason } from "../he-outcome-reason.service.js";

const ID = "0f1e2d3c-aaaa-bbbb-cccc-0000000abcde";
const pune = { all: false, branchName: "Pune" } as const;

describe("cleanNote / parseReasonBody", () => {
  it("scrubs control characters, emails and long digit runs", () => {
    expect(cleanNote(" call me on 98765 43210 or a@b.co\u0007 ")).toBe("call me on # or [email]");
    expect(cleanNote("x".repeat(300))).toHaveLength(NOTE_MAX);
    expect(cleanNote("  ")).toBeNull();
    expect(cleanNote(42)).toBeNull();
    expect(cleanNote("room 12345 ok")).toBe("room 12345 ok");
  });
  it("lists the six codes in order with labels", () => {
    expect([...OUTCOME_REASONS]).toEqual(["distance", "other_job", "salary", "timing", "not_interested", "other"]);
    expect(OUTCOME_REASONS.map((c) => OUTCOME_REASON_LABEL[c])).toEqual(["Distance", "Got another job", "Salary", "Timing", "Not interested", "Other"]);
  });
  it("validates the body", () => {
    expect(parseReasonBody({ reason: "distance" })).toEqual({ reason: "distance", note: null });
    expect(parseReasonBody({ reason: "weather" })).toEqual({ error: "Pick a reason from the list" });
    expect(parseReasonBody(null)).toEqual({ error: "Pick a reason from the list" });
    expect(parseReasonBody({ reason: "other", note: "y".repeat(501) })).toEqual({ error: "The note is too long" });
    expect(parseReasonBody({ reason: "other", note: " a@b.co " })).toEqual({ reason: "other", note: "[email]" });
  });
});

describe("recordOutcomeReason", () => {
  let probe: unknown[]; let affected: number;
  beforeEach(() => {
    execute.mockReset(); probe = []; affected = 1;
    execute.mockImplementation(async (sql: string) => {
      if (String(sql).includes("FROM he_match m JOIN job_requisition")) return [probe];
      if (String(sql).startsWith("INSERT INTO he_match_outcome_reason")) return [{ affectedRows: affected }];
      return [[]];
    });
  });
  const inserts = () => execute.mock.calls.filter((c) => String(c[0]).startsWith("INSERT"));
  const body = { reason: "salary" as const, note: "a note" };

  it("answers not_found for another branch, with no INSERT", async () => {
    probe = [{ id: ID, state: "no_show", branch_name: "Noida" }];
    expect(await recordOutcomeReason(ID, body, pune, "u1")).toEqual({ status: "not_found" });
    expect(inserts()).toHaveLength(0);
  });
  it("answers not_found for a missing match and for a scope with no branch", async () => {
    expect(await recordOutcomeReason(ID, body, pune, "u1")).toEqual({ status: "not_found" });
    probe = [{ id: ID, state: "no_show", branch_name: "Pune" }];
    expect(await recordOutcomeReason(ID, body, { all: false, branchName: null }, "u1")).toEqual({ status: "not_found" });
  });
  it("answers wrong_state for an arrived match", async () => {
    probe = [{ id: ID, state: "arrived", branch_name: "Pune" }];
    expect(await recordOutcomeReason(ID, body, pune, "u1")).toEqual({ status: "wrong_state" });
    expect(inserts()).toHaveLength(0);
  });
  it("saves with a guarded upsert carrying the note and the user id", async () => {
    probe = [{ id: ID, state: "no_show", branch_name: "Pune" }];
    expect(await recordOutcomeReason(ID, body, pune, "u1")).toEqual({ status: "saved", outcome: "no_show", reason: "salary", note: "a note" });
    const [sql, params] = inserts()[0];
    expect(String(sql)).toContain("AND m.state IN ('no_show','declined') ON DUPLICATE KEY UPDATE");
    expect(params).toEqual(["salary", "a note", "u1", ID]);
    expect(String(execute.mock.calls[0][0])).toContain("COLLATE utf8mb4_unicode_ci");
  });
  it("org-wide scope sees any branch", async () => {
    probe = [{ id: ID, state: "declined", branch_name: "Noida" }];
    expect((await recordOutcomeReason(ID, body, { all: true }, null)).status).toBe("saved");
  });
  it("affectedRows 0 means the match changed meanwhile: wrong_state", async () => {
    probe = [{ id: ID, state: "no_show", branch_name: "Pune" }]; affected = 0;
    expect(await recordOutcomeReason(ID, body, pune, "u1")).toEqual({ status: "wrong_state" });
  });
  it("two concurrent identical calls both resolve saved", async () => {
    probe = [{ id: ID, state: "no_show", branch_name: "Pune" }];
    const r = await Promise.all([recordOutcomeReason(ID, body, pune, "u1"), recordOutcomeReason(ID, body, pune, "u1")]);
    expect(r.map((x) => x.status)).toEqual(["saved", "saved"]);
  });
});

describe("listOutcomes", () => {
  beforeEach(() => { execute.mockReset(); vi.unstubAllEnvs(); });
  const row = { match_id: ID, lead_id: "L1", full_name: "Asha", mobile10: "9876543210", drive_id: "D1", drive_date: "2026-10-07", branch_name: "Pune", requisition_code: "REQ-1", outcome: "no_show", slot_at: "2026-10-07 10:30:00", reason_code: "distance", note: null };
  it("switch off: enabled false and no query", async () => {
    expect(await listOutcomes({ from: "2026-10-06", to: "2026-10-08" }, pune)).toEqual({ enabled: false, rows: [], truncated: false, partial: false });
    expect(execute).not.toHaveBeenCalled();
  });
  it("scope with no branch sees nothing, without a query", async () => {
    vi.stubEnv("HE_OUTCOME_REASONS", "true");
    const r = await listOutcomes({ from: "2026-10-06", to: "2026-10-08" }, { all: false, branchName: null });
    expect(r).toMatchObject({ enabled: true, rows: [] });
    expect(execute).not.toHaveBeenCalled();
  });
  it("collates, scopes, masks and never prints a 10-digit run", async () => {
    vi.stubEnv("HE_OUTCOME_REASONS", "true");
    execute.mockResolvedValueOnce([[row]]);
    const r = await listOutcomes({ from: "2026-10-06", to: "2026-10-08" }, pune);
    const [sql, params] = execute.mock.calls[0];
    expect(String(sql)).toContain("FROM he_drive d JOIN job_requisition jr ON jr.id = d.requisition_id COLLATE utf8mb4_unicode_ci");
    expect(String(sql)).toContain("jr.branch_name = ? COLLATE utf8mb4_unicode_ci");
    expect(String(sql).trimStart()).toMatch(/^SELECT STRAIGHT_JOIN /);
    expect(String(sql)).toContain("ORDER BY d.drive_date DESC, m.slot_at, m.id LIMIT 301");
    expect(params).toEqual(["2026-10-06", "2026-10-08", "Pune"]);
    expect(r.rows[0]).toMatchObject({ matchId: ID, name: "Asha", mobileMasked: "xxxxxx3210", reason: "distance", outcome: "no_show", driveDate: "2026-10-07" });
    expect(JSON.stringify(r)).not.toMatch(/\d{10}/);
    expect(r.truncated).toBe(false);
  });
  it("truncates over 300 rows", async () => {
    vi.stubEnv("HE_OUTCOME_REASONS", "true");
    execute.mockResolvedValueOnce([Array.from({ length: 301 }, () => row)]);
    const r = await listOutcomes({ from: "2026-10-06", to: "2026-10-08" }, { all: true });
    expect([r.rows.length, r.truncated]).toEqual([300, true]);
  });
  it("ER_NO_SUCH_TABLE reruns without the reason join", async () => {
    vi.stubEnv("HE_OUTCOME_REASONS", "true");
    execute.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "ER_NO_SUCH_TABLE" }));
    execute.mockResolvedValueOnce([[{ ...row, reason_code: undefined }]]);
    const r = await listOutcomes({ from: "2026-10-06", to: "2026-10-08" }, pune);
    expect(String(execute.mock.calls[1][0])).not.toContain("he_match_outcome_reason");
    expect(r.rows[0].reason).toBeNull();
    expect(r.partial).toBe(false);
  });
  it("a failed read is partial with no rows, never thrown", async () => {
    vi.stubEnv("HE_OUTCOME_REASONS", "true");
    execute.mockRejectedValueOnce(Object.assign(new Error("boom"), { code: "ER_X" }));
    expect(await listOutcomes({ from: "2026-10-06", to: "2026-10-08" }, pune)).toMatchObject({ enabled: true, rows: [], partial: true });
  });
});

describe("outcomeReasonCounts", () => {
  beforeEach(() => { execute.mockReset(); });
  it("counts per source type and outcome from he_drive, with zeros on a missing table", async () => {
    execute.mockResolvedValueOnce([[{ source_type: "he", outcome: "declined", reason_code: "salary", n: 2 }, { source_type: "he", outcome: "no_show", reason_code: "timing", n: "5" }, { source_type: "weird", outcome: "no_show", reason_code: "timing", n: 1 }, { source_type: "he", outcome: "no_show", reason_code: "nope", n: 1 }]]);
    const r = await outcomeReasonCounts(["R1"], "2026-10-01", "2026-10-07");
    expect(r.he).toEqual({ no_show: { timing: 5 }, declined: { salary: 2 } });
    expect(r.meta_live).toEqual({ no_show: {}, declined: {} });
    expect(String(execute.mock.calls[0][0]).trimStart().startsWith("SELECT")).toBe(true);
    expect(String(execute.mock.calls[0][0])).toMatch(/FROM he_drive d/);
    execute.mockImplementation(async () => { throw Object.assign(new Error("x"), { code: "ER_NO_SUCH_TABLE" }); });
    expect((await outcomeReasonCounts(["R1"], "2026-10-01", "2026-10-07")).he).toEqual({ no_show: {}, declined: {} });
  });
});
