import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Row = Record<string, unknown>;
interface Stmt { sql: string; params: unknown[] }
const h = vi.hoisted(() => ({
  stmts: [] as Array<{ sql: string; params: unknown[] }>,
  calls: [] as string[],
  execute: vi.fn(),
  connExecute: vi.fn(),
  beginTransaction: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
  readiness: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: h.execute,
    getConnection: vi.fn(async () => ({ execute: h.connExecute, beginTransaction: h.beginTransaction, commit: h.commit, rollback: h.rollback, release: h.release })),
  },
}));
vi.mock("../he-readiness.service.js", () => ({ getRequisitionReadiness: h.readiness }));

import {
  StreamError, autoCloseStreams, changeStream, createStream, getStream, listStreamEvents, listStreams, loadActiveStreams, tryChangeStream, tryCreateStream,
  type StreamActor,
} from "../requisition-stream.service.js";
import { WINDOW_MESSAGES } from "../requisition-stream.window.js";

const NOW = new Date("2026-10-07T05:30:00Z"); // 11:00 IST Wed 7 Oct
const admin: StreamActor = { userId: "u-1", isAdmin: true, scope: { all: true } };
const hr: StreamActor = { userId: "u-2", isAdmin: false, scope: { all: true } };
const problem = (code: string, severity: "blocking" | "warning" = "blocking") => ({ code, severity, message: code });

let stream: Row | null;
let days: Row[];
let requisition: Row | null;
let update0: boolean;
let eventFails: boolean;
let dupOnInsert: boolean;
let autoRows: Row[];

const baseStream = (o: Row = {}): Row => ({
  id: "s-1", requisition_id: "r-1", branch_name: "Noida", source_type: "meta_live", origin_id: "c-1", origin_label: "Campaign", open_from: "2026-10-09", open_days: 3,
  daily_invites: null, status: "open", closed_reason: null, created_by: "u-1", created_at: "2026-10-07 10:00:00", version: 0, ...o,
});

function route(sql: string, p: unknown[]): unknown[] {
  const s = sql.replace(/\s+/g, " ");
  if (s.includes("FROM requisition_stream_day")) return [days.filter((d) => stream && d.stream_id === stream.id)];
  if (s.startsWith("SELECT * FROM requisition_stream WHERE id")) return [stream && stream.id === p[0] ? [stream] : []];
  if (s.startsWith("SELECT branch_name FROM requisition_stream WHERE id")) return [stream ? [{ branch_name: stream.branch_name }] : []];
  if (s.includes("FROM job_requisition WHERE id")) return [requisition ? [requisition] : []];
  if (s.includes("FROM meta_campaign")) return [[{ id: "c-1", campaign_name: "Noida drive", requisition_id: "r-1" }]];
  if (s.includes("FROM requisition_stream s LEFT JOIN")) return [autoRows];
  if (s.includes("FROM requisition_stream WHERE requisition_id")) return [stream ? [stream] : []];
  return [[]];
}
function connRoute(sql: string, p: unknown[]): unknown[] {
  const s = sql.replace(/\s+/g, " ");
  h.stmts.push({ sql: s, params: p });
  if (s.includes("FOR UPDATE")) return [stream ? [{ version: stream.version }] : []];
  if (s.startsWith("UPDATE requisition_stream SET status = ?")) {
    if (update0) return [{ affectedRows: 0 }];
    if (stream && stream.id === p[3] && stream.status === p[4] && stream.open_from === p[5] && Number(stream.open_days) === p[6] && Number(stream.version) === p[7]) {
      stream = { ...stream, status: p[0], closed_reason: p[1], open_days: p[2], version: Number(stream.version) + 1 };
      return [{ affectedRows: 1 }];
    }
    return [{ affectedRows: 0 }];
  }
  if (s.startsWith("UPDATE requisition_stream SET status = 'closed'")) return [{ affectedRows: 1 }];
  if (s.startsWith("DELETE FROM requisition_stream_day")) { days = days.filter((d) => d.stream_id !== p[0]); return [{ affectedRows: 1 }]; }
  if (s.startsWith("INSERT INTO requisition_stream_day")) {
    for (let i = 0; i < p.length; i += 3) days.push({ stream_id: p[i], day: p[i + 1], kind: p[i + 2] });
    return [{ affectedRows: p.length / 3 }];
  }
  if (s.startsWith("INSERT INTO requisition_stream_event") && eventFails) throw new Error("event insert failed");
  if (s.startsWith("INSERT INTO requisition_stream (") && dupOnInsert) throw Object.assign(new Error("dup"), { code: "ER_DUP_ENTRY" });
  return [{ affectedRows: 1 }];
}

const writes = () => h.stmts.filter((s) => /^(INSERT|UPDATE|DELETE)/.test(s.sql));
const events = () => h.stmts.filter((s) => s.sql.startsWith("INSERT INTO requisition_stream_event"));
// event params: [stream_id, changed_by, action, old_open_from, old_open_days, new_open_days, old_status, new_status, day, reason]

beforeEach(() => {
  h.stmts.length = 0;
  vi.clearAllMocks();
  stream = baseStream();
  days = [];
  requisition = { id: "r-1", branch_name: "Noida", approval_status: "approved", active_status: 1, requested_headcount: 5, fulfilled_headcount: 1 };
  update0 = false; eventFails = false; dupOnInsert = false; autoRows = [];
  h.execute.mockImplementation(async (sql: string, p: unknown[] = []) => route(sql, p));
  h.connExecute.mockImplementation(async (sql: string, p: unknown[] = []) => connRoute(sql, p));
  h.readiness.mockResolvedValue({ requisitionId: "r-1", code: "R1", branch: "Noida", ok: true, problems: [] });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const create = (o: Record<string, unknown> = {}) => ({ requisitionId: "r-1", sourceType: "meta_live" as const, originId: "c-1", openFrom: "2026-10-09", openDays: 3, ...o });
const expectErr = async (p: Promise<unknown>, status: number, message: string) => {
  const e = await p.then(() => null, (x) => x);
  expect(e).toBeInstanceOf(StreamError);
  expect(e).toMatchObject({ statusCode: status, message });
  return e as StreamError;
};

describe("createStream", () => {
  it("creates an open stream in one transaction with branch from the requisition and one create event", async () => {
    const v = await createStream({ ...create({ open: true }), branchName: "Mumbai" } as never, hr, NOW);
    const ins = h.stmts.find((s) => s.sql.startsWith("INSERT INTO requisition_stream ("))!;
    expect(ins.params).toEqual([expect.any(String), "r-1", "Noida", "meta_live", "c-1", "Noida drive", "2026-10-09", 3, null, "open", "u-2"]);
    expect(events()).toHaveLength(1);
    expect(events()[0].params.slice(2)).toEqual(["create", null, null, 3, null, "open", null, null]);
    expect(h.beginTransaction).toHaveBeenCalledTimes(1);
    expect(h.commit).toHaveBeenCalledTimes(1);
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(v.status).toBe("open");
    expect(v.label).toBe("starts Fri 9 Oct, 3 days");
    expect(v.branchName).toBe("Noida");
  });

  it("creates a draft without a readiness read", async () => {
    const v = await createStream(create(), hr, NOW);
    expect(v.status).toBe("draft");
    expect(h.readiness).not.toHaveBeenCalled();
    expect(v.warnings).toEqual([]);
  });

  it("validates the inputs", async () => {
    await expectErr(createStream(create({ openFrom: "2026-10-06" }), hr, NOW), 400, "Start date cannot be before today");
    await expectErr(createStream(create({ openDays: 61 }), hr, NOW), 400, WINDOW_MESSAGES.invalid_days);
    await expectErr(createStream(create({ openDays: 0 }), hr, NOW), 400, WINDOW_MESSAGES.invalid_days);
    await expectErr(createStream(create({ dailyInvites: 501 }), hr, NOW), 400, "Daily invites must be a whole number from 1 to 500");
    await expectErr(createStream(create({ sourceType: "sms" }), hr, NOW), 400, "Source type must be meta_live, meta_old or he");
    await expectErr(createStream(create({ reason: "x".repeat(256) }), hr, NOW), 400, "Reason must be at most 255 characters");
    expect(h.stmts).toHaveLength(0);
  });

  it("rejects an unknown origin and a missing or out-of-scope requisition", async () => {
    await expectErr(createStream(create({ sourceType: "he", originId: "x" }), hr, NOW), 404, "Source not found");
    requisition = null;
    await expectErr(createStream(create(), hr, NOW), 404, "Requisition not found");
    requisition = { id: "r-1", branch_name: "Noida" };
    await expectErr(createStream(create(), { ...hr, scope: { all: false, branchName: "Pune" } }, NOW), 404, "Requisition not found");
  });

  it("rejects a campaign linked to another requisition", async () => {
    h.execute.mockImplementation(async (sql: string, p: unknown[] = []) => sql.includes("FROM meta_campaign") ? [[{ id: "c-1", campaign_name: "n", requisition_id: "r-9" }]] : route(sql, p));
    await expectErr(createStream(create(), hr, NOW), 409, "That campaign is linked to another requisition");
  });

  it("accepts a campaign whose primary is another requisition when this one is one of its links (WS3 A2)", async () => {
    h.execute.mockImplementation(async (sql: string, p: unknown[] = []) =>
      sql.includes("FROM meta_campaign_requisition") ? [[{ campaign_id: "c-1", requisition_id: "r-9", is_primary: 1, removed_at: null }, { campaign_id: "c-1", requisition_id: "r-1", is_primary: 0, removed_at: null }]]
        : sql.includes("FROM meta_campaign") ? [[{ id: "c-1", campaign_name: "n", requisition_id: "r-9" }]] : route(sql, p));
    const v = await createStream(create(), hr, NOW);
    expect(v.originLabel).toBe("n");
  });

  it("names a he stream Pool: ATS history and a re-run stream after its drive", async () => {
    const v = await createStream(create({ sourceType: "he", originId: "pool" }), hr, NOW);
    expect(v.originLabel).toBe("Pool: ATS history");
    h.execute.mockImplementation(async (sql: string, p: unknown[] = []) => sql.includes("FROM he_drive") ? [[{ id: "d-1", requisition_id: "r-1", branch_name: "Noida", run_label: null, drive_date: "2026-09-20" }]] : route(sql, p));
    const v2 = await createStream(create({ sourceType: "meta_old", originId: "d-1" }), hr, NOW);
    expect(v2.originLabel).toBe("Re-run 2026-09-20");
    expect(h.stmts.some((s) => s.sql.includes("source_kind"))).toBe(false); // that check is on db.execute
    expect(h.execute.mock.calls.some((c) => String(c[0]).includes("source_kind <> 'pool'"))).toBe(true);
  });

  it("answers the exact duplicate message and rolls back", async () => {
    dupOnInsert = true;
    await expectErr(createStream(create(), hr, NOW), 409, "A stream for this source already exists; reopen or extend it");
    expect(h.rollback).toHaveBeenCalled();
    expect(h.commit).not.toHaveBeenCalled();
  });

  it("blocks opening on a blocking problem, with no INSERT", async () => {
    h.readiness.mockResolvedValue({ ok: false, problems: [problem("no_branch_address")] });
    const e = await expectErr(createStream(create({ open: true }), hr, NOW), 409, "The requisition is not ready");
    expect(e.problems?.[0].code).toBe("no_branch_address");
    expect(writes()).toHaveLength(0);
    expect(h.readiness).toHaveBeenCalledWith("r-1", "meta_live");
  });

  it("lets an admin override a blocking problem, records it, and ignores override from a non-admin", async () => {
    h.readiness.mockResolvedValue({ ok: false, problems: [problem("no_branch_address")] });
    await createStream(create({ open: true, override: true, reason: "ok by HO" }), admin, NOW);
    expect(events()[0].params[9]).toBe("override: no_branch_address; ok by HO");
    await expectErr(createStream(create({ open: true, override: true }), hr, NOW), 409, "The requisition is not ready");
  });

  it("never overrides no_headcount", async () => {
    h.readiness.mockResolvedValue({ ok: false, problems: [problem("no_headcount"), problem("no_branch_address")] });
    await expectErr(createStream(create({ open: true, override: true }), admin, NOW), 409, "The requisition is not ready");
    expect(writes()).toHaveLength(0);
  });

  it("returns a result object instead of throwing", async () => {
    const r = await tryCreateStream(create({ openDays: 99 }), hr, NOW);
    expect(r).toMatchObject({ ok: false, reason: "invalid", statusCode: 400 });
    h.execute.mockRejectedValue(Object.assign(new Error("select * from secret"), { code: "ECONNRESET" }));
    const r2 = await tryCreateStream(create(), hr, NOW);
    expect(r2).toMatchObject({ ok: false, reason: "error", statusCode: 500 });
    expect(JSON.stringify([r2, (console.error as ReturnType<typeof vi.fn>).mock.calls])).not.toContain("secret");
  });
});

describe("changeStream", () => {
  it("extend writes one guarded UPDATE and one event", async () => {
    const r = await changeStream("s-1", { action: "extend", days: 2 }, hr, NOW);
    expect(r.changed).toBe(true);
    const up = h.stmts.find((s) => s.sql.startsWith("UPDATE requisition_stream SET status = ?"))!;
    expect(up.sql).toContain("WHERE id = ? AND status = ? AND open_from = ? AND open_days = ? AND version = ?");
    expect(up.params).toEqual(["open", null, 5, "s-1", "open", "2026-10-09", 3, 0]);
    expect(events()).toHaveLength(1);
    expect(events()[0].params.slice(1)).toEqual(["u-2", "extend", "2026-10-09", 3, 5, "open", "open", null, null]);
    expect(r.stream.openDays).toBe(5);
  });

  it("a guard that matches no row rolls back with 409 and writes no event", async () => {
    update0 = true;
    await expectErr(changeStream("s-1", { action: "extend", days: 2 }, hr, NOW), 409, "The stream changed meanwhile; reload and try again");
    expect(h.rollback).toHaveBeenCalled();
    expect(h.commit).not.toHaveBeenCalled();
    expect(events()).toHaveLength(0);
  });

  it("of two concurrent changes from the same state only one applies", async () => {
    const a = await tryChangeStream("s-1", { action: "extend", days: 2 }, hr, NOW);
    // the second caller read the stream before the first committed
    h.execute.mockImplementation(async (sql: string, p: unknown[] = []) => sql.startsWith("SELECT * FROM requisition_stream WHERE id") ? [[baseStream()]] : route(sql, p));
    const b = await tryChangeStream("s-1", { action: "extend", days: 4 }, hr, NOW);
    expect(a.ok).toBe(true);
    expect(b).toMatchObject({ ok: false, reason: "changed_meanwhile", statusCode: 409 });
    expect(stream?.open_days).toBe(5);
    expect(events()).toHaveLength(1);
  });

  it("a failed event insert rolls the change back", async () => {
    eventFails = true;
    const r = await tryChangeStream("s-1", { action: "pause" }, hr, NOW);
    expect(r).toMatchObject({ ok: false, reason: "error", statusCode: 500 });
    expect(h.rollback).toHaveBeenCalled();
    expect(h.commit).not.toHaveBeenCalled();
    expect(h.release).toHaveBeenCalledTimes(1);
  });

  it("add_day rewrites the exception rows and logs the day", async () => {
    await changeStream("s-1", { action: "add_day", day: "2026-10-11" }, hr, NOW);
    expect(h.stmts.filter((s) => s.sql.startsWith("DELETE FROM requisition_stream_day"))).toHaveLength(1);
    const ins = h.stmts.find((s) => s.sql.startsWith("INSERT INTO requisition_stream_day"))!;
    expect(ins.params).toEqual(["s-1", "2026-10-11", "add"]);
    expect(events()[0].params[8]).toBe("2026-10-11");
  });

  it("add_day of an already planned day changes nothing", async () => {
    const r = await changeStream("s-1", { action: "add_day", day: "2026-10-10" }, hr, NOW);
    expect(r.changed).toBe(false);
    expect(writes()).toHaveLength(0);
    expect(h.beginTransaction).not.toHaveBeenCalled();
  });

  it("validates window changes", async () => {
    await expectErr(changeStream("s-1", { action: "skip_day", day: "2026-10-20" }, hr, NOW), 400, "That day is not inside the window");
    await expectErr(changeStream("s-1", { action: "extend_to", toDate: "2026-10-06" }, hr, NOW), 400, "The new last day cannot be before today");
    await expectErr(changeStream("s-1", { action: "extend" }, hr, NOW), 400, WINDOW_MESSAGES.invalid_days);
  });

  it("enforces the transition table", async () => {
    stream = baseStream({ status: "closed", closed_reason: "manual" });
    await expectErr(changeStream("s-1", { action: "extend", days: 1 }, hr, NOW), 409, "Reopen the stream first");
    await expectErr(changeStream("s-1", { action: "pause" }, hr, NOW), 409, "Not allowed while the stream is closed");
    await expectErr(changeStream("s-1", { action: "close" }, hr, NOW), 409, "Not allowed while the stream is closed");
    stream = baseStream({ status: "open" });
    await expectErr(changeStream("s-1", { action: "reopen" }, hr, NOW), 409, "Not allowed while the stream is open");
    await expectErr(changeStream("s-1", { action: "open" }, hr, NOW), 409, "Not allowed while the stream is open");
    stream = baseStream({ status: "draft" });
    await expectErr(changeStream("s-1", { action: "pause" }, hr, NOW), 409, "Not allowed while the stream is draft");
    expect(writes()).toHaveLength(0);
  });

  it("close records the manual reason", async () => {
    await changeStream("s-1", { action: "close", reason: "enough" }, hr, NOW);
    const up = h.stmts.find((s) => s.sql.startsWith("UPDATE requisition_stream SET status = ?"))!;
    expect(up.params.slice(0, 2)).toEqual(["closed", "manual"]);
    expect(events()[0].params.slice(2)).toEqual(["close", "2026-10-09", 3, 3, "open", "closed", null, "enough"]);
  });

  it("opening re-checks readiness; paused to open is allowed", async () => {
    stream = baseStream({ status: "paused" });
    h.readiness.mockResolvedValue({ ok: false, problems: [problem("no_slot_window")] });
    const e = await expectErr(changeStream("s-1", { action: "open" }, hr, NOW), 409, "The requisition is not ready");
    expect(e.problems?.[0].code).toBe("no_slot_window");
    h.readiness.mockResolvedValue({ ok: true, problems: [] });
    expect((await changeStream("s-1", { action: "open" }, hr, NOW)).stream.status).toBe("open");
  });

  it("reopen refuses a filled requisition", async () => {
    stream = baseStream({ status: "closed", open_from: "2026-10-01", open_days: 2 });
    requisition = { approval_status: "approved", active_status: 1, requested_headcount: 5, fulfilled_headcount: 5 };
    await expectErr(changeStream("s-1", { action: "reopen", days: 3 }, admin, NOW), 409, "A filled or closed requisition cannot be reopened");
  });

  it("reopen of an ended window with days extends it and opens", async () => {
    stream = baseStream({ status: "closed", closed_reason: "window_ended", open_from: "2026-10-05", open_days: 2 }); // ended Tue 6 Oct
    await expectErr(changeStream("s-1", { action: "reopen" }, hr, NOW), 409, "Extend the window when reopening");
    const r = await changeStream("s-1", { action: "reopen", days: 3 }, hr, NOW);
    expect(r.stream.status).toBe("open");
    expect(r.stream.closedReason).toBeNull();
    expect(r.stream.openDays).toBe(5);
    expect(events()).toHaveLength(1);
    expect(events()[0].params.slice(2)).toEqual(["reopen", "2026-10-05", 2, 5, "closed", "open", null, null]);
    expect(h.readiness).toHaveBeenCalledWith("r-1", "meta_live");
  });

  it("an extension that still ends before today is not a reopen", async () => {
    stream = baseStream({ status: "closed", open_from: "2026-09-01", open_days: 2 });
    await expectErr(changeStream("s-1", { action: "reopen", days: 1 }, hr, NOW), 409, "Extend the window when reopening");
  });

  it("every successful change writes exactly one event row", async () => {
    const seq: Array<[Record<string, unknown>, Record<string, unknown>?]> = [
      [{ action: "pause" }], [{ action: "open" }], [{ action: "extend", days: 1 }], [{ action: "extend_to", toDate: "2026-10-16" }],
      [{ action: "skip_day", day: "2026-10-13" }], [{ action: "add_day", day: "2026-10-18" }], [{ action: "shorten", toDate: "2026-10-12" }], [{ action: "close" }],
    ];
    let ok = 0;
    for (const [c] of seq) {
      const before = events().length;
      const r = await tryChangeStream("s-1", c as never, hr, NOW);
      expect(r.ok).toBe(true);
      expect(events().length).toBe(before + 1);
      ok++;
    }
    expect(events()).toHaveLength(ok);
    expect(events().map((e) => e.params[2])).toEqual(seq.map(([c]) => c.action));
  });

  it("prunes exception days beyond a shortened end so an old add cannot resurface after shorten + extend", async () => {
    await changeStream("s-1", { action: "add_day", day: "2026-10-18" }, hr, NOW); // Sunday beyond the end 12 Oct
    expect(days).toEqual([{ stream_id: "s-1", day: "2026-10-18", kind: "add" }]);
    expect(stream?.open_days).toBe(9);
    const sh = await changeStream("s-1", { action: "shorten", toDate: "2026-10-12" }, hr, NOW);
    expect(sh.stream.add).toEqual([]);
    expect(days).toEqual([]); // deleted in the same transaction
    expect(stream?.open_days).toBe(3);
    const ex = await changeStream("s-1", { action: "extend", days: 6 }, hr, NOW);
    expect(ex.stream.add).toEqual([]);
    expect(ex.stream.window.to).toBe("2026-10-19"); // Sunday 18 is skipped (the stale add would have ended it on the 18th)
    expect(days).toEqual([]);
    expect(events()).toHaveLength(3);
  });

  it("prunes skip days beyond the end when a skip shortens the window", async () => {
    days = [{ stream_id: "s-1", day: "2026-10-20", kind: "skip" }];
    stream = baseStream({ open_days: 3 });
    const r = await changeStream("s-1", { action: "skip_day", day: "2026-10-12" }, hr, NOW);
    expect(r.stream.skip).toEqual([]);
    expect(days).toEqual([]);
    expect(r.stream.window.to).toBe("2026-10-10");
  });

  it("answers 404 outside the caller's branch", async () => {
    const pune: StreamActor = { userId: "u-3", isAdmin: false, scope: { all: false, branchName: "Pune" } };
    expect(await getStream("s-1", pune.scope, NOW)).toBeNull();
    expect(await listStreamEvents("s-1", pune.scope)).toBeNull();
    await expectErr(changeStream("s-1", { action: "pause" }, pune, NOW), 404, "Stream not found");
    const noun: StreamActor = { ...pune, scope: { all: false, branchName: null } };
    await expectErr(changeStream("s-1", { action: "pause" }, noun, NOW), 404, "Stream not found");
    expect(writes()).toHaveLength(0);
  });

  it("rejects an unknown action", async () => {
    await expectErr(changeStream("s-1", { action: "delete" } as never, hr, NOW), 400, "Unknown action");
  });
});

describe("reads", () => {
  it("shows readiness problems as warnings only for open or paused streams, one read per requisition", async () => {
    h.readiness.mockResolvedValue({ ok: false, problems: [problem("no_bmi_link", "warning"), problem("no_branch_address")] });
    stream = baseStream({ status: "open" });
    const list = await listStreams("r-1", { all: true }, NOW);
    expect(list[0].warnings.map((w) => w.code)).toEqual(["no_bmi_link", "no_branch_address"]);
    expect(h.readiness).toHaveBeenCalledTimes(1);
    stream = baseStream({ status: "draft" });
    h.readiness.mockClear();
    expect((await listStreams("r-1", { all: true }, NOW))[0].warnings).toEqual([]);
    expect(h.readiness).not.toHaveBeenCalled();
    stream = baseStream({ status: "paused", source_type: "he", origin_id: "pool" });
    expect((await listStreams("r-1", { all: true }, NOW))[0].warnings.map((w) => w.code)).toEqual(["no_branch_address"]);
  });

  it("maps events and active streams", async () => {
    h.execute.mockImplementation(async (sql: string, p: unknown[] = []) => sql.includes("FROM requisition_stream_event")
      ? [[{ id: "e-1", action: "extend", changed_by: "u-1", changed_at: "2026-10-07 11:00:00", old_open_from: "2026-10-09", old_open_days: 3, new_open_days: 5, old_status: "open", new_status: "open", day: null, reason: null }]]
      : route(sql, p));
    expect((await listStreamEvents("s-1", { all: true }))?.[0]).toMatchObject({ action: "extend", oldOpenDays: 3, newOpenDays: 5, changedBy: "u-1" });
    h.execute.mockImplementation(async (sql: string, p: unknown[] = []) => sql.includes("status IN ('open','paused')") ? [[baseStream()]] : route(sql, p));
    days = [{ stream_id: "s-1", day: "2026-10-11", kind: "add" }];
    const act = await loadActiveStreams({ requisitionId: "r-1" });
    expect(act[0].add).toEqual(["2026-10-11"]);
    expect(h.execute.mock.calls.some((c) => String(c[0]).includes("ORDER BY created_at, id"))).toBe(true);
  });
});

describe("autoCloseStreams", () => {
  const rowOf = (id: string, o: Row) => ({ ...baseStream({ id }), jr_id: "r-1", approval_status: "approved", active_status: 1, requested_headcount: 5, fulfilled_headcount: 1, ...o });
  beforeEach(() => {
    autoRows = [
      rowOf("s-a", { open_from: "2026-10-08", open_days: 5, status: "open" }), // ends Wed 14... overridden below
      rowOf("s-b", { status: "paused", fulfilled_headcount: 5 }),
      rowOf("s-c", { open_from: "2026-10-13", open_days: 3 }),
    ];
    autoRows[0] = rowOf("s-a", { open_from: "2026-10-09", open_days: 3, status: "open" }); // Fri, Sat, Mon 12
    stream = null;
  });

  it("closes ended and filled streams with one auto_close event each", async () => {
    const r = await autoCloseStreams("2026-10-13", false);
    expect(r).toEqual([
      { streamId: "s-a", requisitionId: "r-1", reason: "window_ended" },
      { streamId: "s-b", requisitionId: "r-1", reason: "requisition_filled" },
    ]);
    const ups = h.stmts.filter((s) => s.sql.startsWith("UPDATE requisition_stream SET status = 'closed'"));
    expect(ups.map((u) => u.params)).toEqual([["window_ended", "s-a", "2026-10-09", 3, 0], ["requisition_filled", "s-b"]]);
    expect(ups[0].sql).toContain("WHERE id = ? AND status IN ('open','paused')");
    expect(events().map((e) => [e.params[0], e.params[1], e.params[2], e.params[9]])).toEqual([["s-a", null, "auto_close", "window_ended"], ["s-b", null, "auto_close", "requisition_filled"]]);
    expect(h.execute.mock.calls.some((c) => String(c[0]).includes("COLLATE utf8mb4_unicode_ci"))).toBe(true);
  });

  it("reports requisition_closed first and treats a missing requisition as closed", async () => {
    autoRows = [rowOf("s-a", { active_status: 0, fulfilled_headcount: 5 }), rowOf("s-b", { jr_id: null, approval_status: null })];
    const r = await autoCloseStreams("2026-10-08", true);
    expect(r.map((x) => x.reason)).toEqual(["requisition_closed", "requisition_closed"]);
  });

  it("dry run returns the same streams and writes nothing", async () => {
    const r = await autoCloseStreams("2026-10-13", true);
    expect(r.map((x) => x.streamId)).toEqual(["s-a", "s-b"]);
    expect(writes()).toHaveLength(0);
    expect(h.beginTransaction).not.toHaveBeenCalled();
  });

  it("skips a stream another writer already closed and survives a failing one", async () => {
    let n = 0;
    h.connExecute.mockImplementation(async (sql: string, p: unknown[] = []) => {
      if (sql.startsWith("UPDATE requisition_stream SET status = 'closed'") && n++ === 0) throw new Error("boom");
      return connRoute(sql, p);
    });
    const r = await autoCloseStreams("2026-10-13", false);
    expect(r.map((x) => x.streamId)).toEqual(["s-b"]);
    expect(h.rollback).toHaveBeenCalled();
  });

  it("never throws when the selection fails", async () => {
    h.execute.mockRejectedValue(new Error("down"));
    await expect(autoCloseStreams("2026-10-13", false)).resolves.toEqual([]);
  });
});
