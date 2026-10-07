import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Stateful fake of the stream row: every guarded UPDATE is evaluated against the CURRENT row, reads can be served from a stale snapshot.
type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  execute: vi.fn(),
  connExecute: vi.fn(),
  rollback: vi.fn(),
  commit: vi.fn(),
  readiness: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: h.execute,
    getConnection: vi.fn(async () => ({ execute: h.connExecute, beginTransaction: vi.fn(), commit: h.commit, rollback: h.rollback, release: vi.fn() })),
  },
}));
vi.mock("../he-readiness.service.js", () => ({ getRequisitionReadiness: h.readiness }));

import { autoCloseStreams, tryChangeStream, tryCreateStream, type StreamActor } from "../requisition-stream.service.js";
import { windowEnd } from "../requisition-stream.window.js";

const NOW = new Date("2026-10-07T05:30:00Z"); // 11:00 IST Wed 7 Oct
const hr: StreamActor = { userId: "u-2", isAdmin: false, scope: { all: true } };

let cur: Row; // the committed row
let days: Row[]; // committed exception rows
let snapshot: { row: Row; days: Row[] } | null; // what the next loadStream sees (null => current)
let events: unknown[][];
let drive: Row | null;

const base = (): Row => ({
  id: "s-1", requisition_id: "r-1", branch_name: "Noida", source_type: "meta_live", origin_id: "c-1", origin_label: "Campaign",
  open_from: "2026-10-09", open_days: 3, daily_invites: null, status: "open", closed_reason: null, created_by: "u-1", created_at: "2026-10-07 10:00:00", version: 0,
});
const take = () => ({ row: { ...cur }, days: days.map((d) => ({ ...d })) });

function route(sql: string, p: unknown[]): unknown[] {
  const s = sql.replace(/\s+/g, " ");
  const view = snapshot ?? { row: cur, days };
  if (s.includes("FROM requisition_stream_day")) return [view.days];
  if (s.startsWith("SELECT * FROM requisition_stream WHERE id")) return [[view.row]];
  if (s.includes("FROM job_requisition WHERE id")) return [[{ id: "r-1", branch_name: "Noida", approval_status: "approved", active_status: 1, requested_headcount: 5, fulfilled_headcount: 1 }]];
  if (s.includes("FROM meta_campaign")) return [[{ id: "c-1", campaign_name: "Noida drive", requisition_id: null }]];
  if (s.includes("FROM he_drive")) return [drive && drive.id === p[0] ? [drive] : []];
  return [[]];
}

/** Applies an UPDATE's WHERE (id, status, open_from, open_days[, version]) against the committed row. */
function connRoute(sql: string, p: unknown[]): unknown[] {
  const s = sql.replace(/\s+/g, " ");
  if (s.includes("FOR UPDATE")) return [[{ ...cur }]];
  if (s.startsWith("UPDATE requisition_stream SET status = ?")) {
    const [st, reason, od, id, oldSt, from, oldOd, ver] = p;
    const versionOk = p.length < 8 || Number(cur.version) === ver; // the pre-version guard had 7 params
    if (cur.id !== id || cur.status !== oldSt || cur.open_from !== from || Number(cur.open_days) !== oldOd || !versionOk) return [{ affectedRows: 0 }];
    cur = { ...cur, status: st, closed_reason: reason, open_days: od, version: s.includes("version = version + 1") ? Number(cur.version) + 1 : cur.version };
    return [{ affectedRows: 1 }];
  }
  if (s.startsWith("UPDATE requisition_stream SET status = 'closed'")) {
    const [reason, id, from, od, ver] = p;
    if (cur.id !== id || !["open", "paused"].includes(String(cur.status))) return [{ affectedRows: 0 }];
    if (p.length > 2 && (cur.open_from !== from || Number(cur.open_days) !== od || Number(cur.version) !== ver)) return [{ affectedRows: 0 }];
    cur = { ...cur, status: "closed", closed_reason: reason, version: Number(cur.version) + 1 };
    return [{ affectedRows: 1 }];
  }
  if (s.startsWith("DELETE FROM requisition_stream_day")) { days = days.filter((d) => d.stream_id !== p[0]); return [{ affectedRows: 1 }]; }
  if (s.startsWith("INSERT INTO requisition_stream_day")) {
    for (let i = 0; i < p.length; i += 3) days.push({ stream_id: p[i], day: p[i + 1], kind: p[i + 2] });
    return [{ affectedRows: p.length / 3 }];
  }
  if (s.startsWith("INSERT INTO requisition_stream_event")) events.push(p);
  return [{ affectedRows: 1 }];
}

beforeEach(() => {
  vi.clearAllMocks();
  cur = base(); days = []; snapshot = null; events = []; drive = null;
  h.execute.mockImplementation(async (sql: string, p: unknown[] = []) => route(sql, p));
  h.connExecute.mockImplementation(async (sql: string, p: unknown[] = []) => connRoute(sql, p));
  h.readiness.mockResolvedValue({ ok: true, problems: [] });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const windowOf = () => ({ openFrom: String(cur.open_from), openDays: Number(cur.open_days),
  add: days.filter((d) => d.kind === "add").map((d) => String(d.day)), skip: days.filter((d) => d.kind === "skip").map((d) => String(d.day)) });

describe("stream change version guard", () => {
  it("three edits from the same snapshot: exactly one applies", async () => {
    const s0 = take();
    snapshot = s0;
    const a = await tryChangeStream("s-1", { action: "add_day", day: "2026-10-11" }, hr, NOW);
    snapshot = s0;
    const b = await tryChangeStream("s-1", { action: "skip_day", day: "2026-10-10" }, hr, NOW);
    snapshot = s0;
    const c = await tryChangeStream("s-1", { action: "extend", days: 1 }, hr, NOW);
    expect([a.ok, b.ok, c.ok]).toEqual([true, false, false]);
    expect(b).toMatchObject({ reason: "changed_meanwhile", statusCode: 409 });
    expect(c).toMatchObject({ reason: "changed_meanwhile", statusCode: 409 });
    expect(events).toHaveLength(1);
    expect(days).toEqual([{ stream_id: "s-1", day: "2026-10-11", kind: "add" }]);
    expect(cur.open_days).toBe(4);
  });

  it("a stale edit cannot land after two edits that brought open_days back (A-B-A); day rows stay consistent with open_days", async () => {
    const s0 = take();
    snapshot = s0;
    const a = await tryChangeStream("s-1", { action: "add_day", day: "2026-10-11" }, hr, NOW); // 3 -> 4 days, add Sun 11
    snapshot = null;
    const b = await tryChangeStream("s-1", { action: "skip_day", day: "2026-10-10" }, hr, NOW); // read after A: 4 -> 3 days, skip Sat 10
    snapshot = s0;
    const c = await tryChangeStream("s-1", { action: "skip_day", day: "2026-10-09" }, hr, NOW); // stale (open_days 3 again)
    expect([a.ok, b.ok, c.ok]).toEqual([true, true, false]);
    expect(c).toMatchObject({ reason: "changed_meanwhile", statusCode: 409 });
    expect(events).toHaveLength(2);
    expect(cur.version).toBe(2);
    expect(days.map((d) => `${d.kind}:${d.day}`).sort()).toEqual(["add:2026-10-11", "skip:2026-10-10"]);
    // the stored exception rows reproduce the stored open_days and end date
    expect(windowEnd(windowOf())).toBe("2026-10-12");
    expect(cur.open_days).toBe(3);
  });

  it("locks the row and bumps the version in the guarded UPDATE", async () => {
    const r = await tryChangeStream("s-1", { action: "pause" }, hr, NOW);
    expect(r.ok).toBe(true);
    const sqls = h.connExecute.mock.calls.map((c) => String(c[0]).replace(/\s+/g, " "));
    const lock = sqls.findIndex((s) => /FROM requisition_stream WHERE id = \? FOR UPDATE/.test(s));
    const up = sqls.findIndex((s) => s.startsWith("UPDATE requisition_stream SET status = ?"));
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(up);
    expect(sqls[up]).toContain("version = version + 1");
    expect(sqls[up]).toContain("AND version = ?");
    expect(cur.version).toBe(1);
  });

  it("a version moved under the lock answers 409 without an UPDATE or event", async () => {
    snapshot = take();
    cur = { ...cur, version: 7 }; // another writer committed a change that left status/window equal
    const r = await tryChangeStream("s-1", { action: "pause" }, hr, NOW);
    expect(r).toMatchObject({ ok: false, reason: "changed_meanwhile", statusCode: 409 });
    expect(h.connExecute.mock.calls.some((c) => String(c[0]).startsWith("UPDATE"))).toBe(false);
    expect(events).toHaveLength(0);
    expect(h.rollback).toHaveBeenCalled();
  });
});

describe("auto-close guard", () => {
  const autoRow = (o: Row = {}) => ({ ...base(), jr_id: "r-1", approval_status: "approved", active_status: 1, requested_headcount: 5, fulfilled_headcount: 1, ...o });
  const selectReturns = (rows: Row[]) =>
    h.execute.mockImplementation(async (sql: string, p: unknown[] = []) => String(sql).includes("FROM requisition_stream s") ? [rows] : route(sql, p));

  it("window_ended guards open_from, open_days and version and bumps the version", async () => {
    selectReturns([autoRow()]); // Fri 9, Sat 10, Mon 12 => ended by the 13th
    const r = await autoCloseStreams("2026-10-13", false);
    expect(r).toEqual([{ streamId: "s-1", requisitionId: "r-1", reason: "window_ended" }]);
    const up = h.connExecute.mock.calls.find((c) => String(c[0]).startsWith("UPDATE requisition_stream SET status = 'closed'"))!;
    expect(String(up[0])).toContain("AND open_from = ? AND open_days = ? AND version = ?");
    expect(String(up[0])).toContain("version = version + 1");
    expect(up[1]).toEqual(["window_ended", "s-1", "2026-10-09", 3, 0]);
    expect(cur.version).toBe(1);
    expect(events).toHaveLength(1);
  });

  it("an extend landing between the read and the close keeps the stream open, with no event", async () => {
    selectReturns([autoRow()]); // read: 3 days, version 0
    cur = { ...cur, open_days: 5, version: 1 }; // extended meanwhile to Wed 14
    const r = await autoCloseStreams("2026-10-13", false);
    expect(r).toEqual([]);
    expect(cur.status).toBe("open");
    expect(events).toHaveLength(0);
    expect(h.rollback).toHaveBeenCalled();
  });

  it("a closing UPDATE that matches no row is skipped with no event row", async () => {
    selectReturns([autoRow({ id: "s-1" }), autoRow({ id: "s-2", fulfilled_headcount: 5 })]);
    h.connExecute.mockImplementation(async (sql: string, p: unknown[] = []) =>
      String(sql).startsWith("UPDATE requisition_stream SET status = 'closed'") ? [{ affectedRows: 0 }] : connRoute(sql, p));
    const r = await autoCloseStreams("2026-10-13", false);
    expect(r).toEqual([]);
    expect(events).toHaveLength(0);
    expect(h.commit).not.toHaveBeenCalled();
    expect(h.rollback).toHaveBeenCalledTimes(2);
  });

  it("requisition_filled guards the status only (the window does not matter)", async () => {
    selectReturns([autoRow({ fulfilled_headcount: 5 })]);
    cur = { ...cur, open_days: 9, version: 4 };
    const r = await autoCloseStreams("2026-10-08", false);
    expect(r).toEqual([{ streamId: "s-1", requisitionId: "r-1", reason: "requisition_filled" }]);
    const up = h.connExecute.mock.calls.find((c) => String(c[0]).startsWith("UPDATE requisition_stream SET status = 'closed'"))!;
    expect(up[1]).toEqual(["requisition_filled", "s-1"]);
  });
});

describe("meta_old origin drive is tied to the requisition", () => {
  const create = (o: Row = {}) => ({ requisitionId: "r-1", sourceType: "meta_old" as const, originId: "d-1", openFrom: "2026-10-09", openDays: 3, ...o });
  const inserts = () => h.connExecute.mock.calls.filter((c) => String(c[0]).startsWith("INSERT INTO requisition_stream ("));

  it("accepts a launch drive of the same requisition and branch", async () => {
    drive = { id: "d-1", requisition_id: "r-1", branch_name: "Noida", run_label: null, drive_date: "2026-09-20" };
    const r = await tryCreateStream(create(), hr, NOW);
    expect(r.ok).toBe(true);
    expect(inserts()).toHaveLength(1);
  });

  it("rejects a drive of another requisition with 409 and writes nothing", async () => {
    drive = { id: "d-1", requisition_id: "r-9", branch_name: "Noida", run_label: null, drive_date: "2026-09-20" };
    const r = await tryCreateStream(create(), hr, NOW);
    expect(r).toMatchObject({ ok: false, reason: "conflict", statusCode: 409, message: "That drive belongs to another requisition" });
    expect(inserts()).toHaveLength(0);
  });

  it("rejects a drive of the same requisition in another branch with 409", async () => {
    drive = { id: "d-1", requisition_id: "r-1", branch_name: "Pune", run_label: null, drive_date: "2026-09-20" };
    const r = await tryCreateStream(create(), hr, NOW);
    expect(r).toMatchObject({ ok: false, reason: "conflict", statusCode: 409, message: "That drive belongs to another branch" });
    expect(inserts()).toHaveLength(0);
  });

  it("an unlinked live campaign is still accepted (unchanged)", async () => {
    const r = await tryCreateStream({ ...create(), sourceType: "meta_live", originId: "c-1" }, hr, NOW);
    expect(r.ok).toBe(true);
  });
});
