import { beforeEach, describe, expect, it, vi } from "vitest";

type Drive = { id: string; drive_date: string; status: string; slot_start: string; slot_end: string; slot_minutes: number; slot_capacity: number; auto_send: number };
const h = vi.hoisted(() => ({
  sqls: [] as string[],
  params: [] as unknown[][],
  connSqls: [] as string[],
  req: { approval_status: "approved", active_status: 1, closed_at: null, requested_headcount: 5, fulfilled_headcount: 0 } as Record<string, unknown> | null,
  drives: new Map<string, Drive>(),
  booked: {} as Record<string, number>,
  match: null as null | { id: string; state: string; drive_id: string | null; slot_at: string | null; token: string | null },
  events: [] as unknown[][],
  enforced: 0,
  holidays: [] as string[],
  txDrives: [] as string[],
}));

function sqlRouter(sql: string, p: unknown[] = [], inTx = false) {
  if (sql.includes("FROM leave_holiday_master")) return [h.holidays.map((d) => ({ d }))];
  if (sql.includes("FROM he_model_param")) return [[{ value: h.enforced }]];
  if (sql.includes("FROM job_requisition")) return [h.req ? [h.req] : []];
  if (sql.startsWith("INSERT INTO he_drive")) {
    const date = String(p[3]);
    if (!h.drives.has(date)) { h.drives.set(date, { id: String(p[0]), drive_date: date, status: "active", slot_start: "10:00:00", slot_end: "17:30:00", slot_minutes: 30, slot_capacity: 6, auto_send: 0 }); if (inTx) h.txDrives.push(date); }
    return [{ affectedRows: 1 }];
  }
  if (sql.includes("FROM he_drive WHERE requisition_id = ? AND branch_name = ? AND drive_date = ?")) {
    const d = h.drives.get(String(p[2]));
    return [d ? [{ id: d.id, status: d.status }] : []];
  }
  if (sql.includes("FROM he_drive WHERE id = ? FOR UPDATE")) return [[...h.drives.values()].filter((d) => d.id === p[0])];
  if (sql.includes("FROM he_match WHERE lead_id = ? AND requisition_id = ?")) return [h.match ? [h.match] : []];
  if (sql.includes("GROUP BY slot_at")) {
    const d = [...h.drives.values()].find((x) => x.id === p[0])!;
    return [Object.entries(h.booked).filter(([k]) => k.startsWith(d.drive_date)).map(([slot_at, n]) => ({ slot_at, n }))];
  }
  return [[]];
}

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, p: unknown[] = []) => { h.sqls.push(sql); h.params.push(p); return sqlRouter(sql, p); }),
    getConnection: vi.fn(async () => ({
      beginTransaction: vi.fn(async () => { h.connSqls.push("BEGIN"); h.txDrives = []; }),
      commit: vi.fn(async () => { h.connSqls.push("COMMIT"); h.txDrives = []; }),
      rollback: vi.fn(async () => { h.connSqls.push("ROLLBACK"); for (const d of h.txDrives) h.drives.delete(d); h.txDrives = []; }),
      release: vi.fn(),
      execute: vi.fn(async (sql: string, p: unknown[] = []) => { h.connSqls.push(sql); h.sqls.push(sql); h.params.push(p); return sqlRouter(sql, p, true); }),
    })),
  },
}));
vi.mock("../he-lead.service.js", () => ({ addEvent: vi.fn(async (...a: unknown[]) => { h.events.push(a); }) }));

import { bookLeadOnDrive, createDriveIfAbsent, resetInviteTargetCache, softSlotCapacity, targetDriveDates } from "../walkin-booking.service.js";

// Thu 2026-10-08 09:00 IST
const now = new Date("2026-10-08T03:30:00Z");
const args = { leadId: "L1", requisitionId: "R1", branchName: "NOIDA-2", preferredSlotAt: "2026-10-09 10:30:00", now, state: "invited" as const };

beforeEach(() => {
  h.sqls = []; h.params = []; h.connSqls = []; h.drives = new Map(); h.booked = {}; h.match = null; h.events = []; h.enforced = 0; h.holidays = []; h.txDrives = []; resetInviteTargetCache();
  delete process.env.REQ_END_DATE_ENFORCEMENT;
  h.req = { approval_status: "approved", active_status: 1, closed_at: null, requested_headcount: 5, fulfilled_headcount: 0 };
});

describe("targetDriveDates", () => {
  it("never Sunday; preferred first when it is a future working day", () => {
    expect(targetDriveDates(new Date("2026-10-10T06:30:00Z"), null)[0]).toBe("2026-10-12"); // Sat 12:00 IST → Mon
    expect(targetDriveDates(now, "2026-10-11 11:00:00")[0]).toBe("2026-10-12"); // preferred Sunday → Mon
    expect(targetDriveDates(now, "2026-10-09 11:00:00")).toEqual(["2026-10-09", "2026-10-10", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
    expect(targetDriveDates(now, "2026-10-01 11:00:00")[0]).toBe("2026-10-09"); // past preferred → next working day
  });
});

describe("createDriveIfAbsent", () => {
  it("SQL never updates an existing drive and creates it active with auto_send 0", async () => {
    h.drives.set("2026-10-09", { id: "HR1", drive_date: "2026-10-09", status: "draft", slot_start: "09:00:00", slot_end: "12:00:00", slot_minutes: 60, slot_capacity: 2, auto_send: 1 });
    const r = await createDriveIfAbsent({ requisitionId: "R1", branchName: "NOIDA-2", driveDate: "2026-10-09" });
    expect(r).toEqual({ id: "HR1", created: false, status: "draft" });
    const ins = h.sqls.find((s) => s.startsWith("INSERT INTO he_drive"))!;
    expect(ins).toContain("ON DUPLICATE KEY UPDATE id = id");
    expect(ins).toMatch(/'active', 0/);
    const c = await createDriveIfAbsent({ requisitionId: "R1", branchName: "NOIDA-2", driveDate: "2026-10-10" });
    expect(c.created).toBe(true);
    expect(c.status).toBe("active");
  });
});

describe("bookLeadOnDrive", () => {
  it("HR-made active drive is used untouched", async () => {
    h.drives.set("2026-10-09", { id: "HR1", drive_date: "2026-10-09", status: "active", slot_start: "10:00:00", slot_end: "17:30:00", slot_minutes: 30, slot_capacity: 6, auto_send: 1 });
    const r = await bookLeadOnDrive(args);
    expect(r).toMatchObject({ status: "booked", driveId: "HR1", slotAt: "2026-10-09 10:30:00", created: false });
    expect(h.sqls.some((s) => s.startsWith("UPDATE he_drive"))).toBe(false);
    expect(h.connSqls.indexOf("BEGIN")).toBeLessThan(h.connSqls.findIndex((s) => s.includes("FOR UPDATE")));
    expect(h.connSqls.at(-1)).toBe("COMMIT");
  });

  it("closed drive → next working day", async () => {
    h.drives.set("2026-10-09", { id: "D9", drive_date: "2026-10-09", status: "closed", slot_start: "10:00:00", slot_end: "17:30:00", slot_minutes: 30, slot_capacity: 6, auto_send: 0 });
    const r = await bookLeadOnDrive(args);
    expect(r).toMatchObject({ status: "booked", slotAt: "2026-10-10 10:30:00" });
  });

  it("preferred 10:30 full → nearest free slot the same day", async () => {
    h.booked["2026-10-09 10:30:00"] = 6;
    const r = await bookLeadOnDrive(args);
    expect(r).toMatchObject({ status: "booked", slotAt: "2026-10-09 10:00:00" });
    h.booked["2026-10-09 10:00:00"] = 6;
    const r2 = await bookLeadOnDrive(args);
    expect(r2).toMatchObject({ status: "booked", slotAt: "2026-10-09 11:00:00" });
  });

  it("whole day full → next day", async () => {
    for (let m = 600; m < 1050; m += 30) h.booked[`2026-10-09 ${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00`] = 6;
    const r = await bookLeadOnDrive(args);
    expect(r).toMatchObject({ status: "booked", slotAt: "2026-10-10 10:30:00" });
  });

  it("inserts a new invited match with a fresh token", async () => {
    const r = await bookLeadOnDrive(args);
    const ins = h.connSqls.find((s) => s.startsWith("INSERT INTO he_match"))!;
    expect(ins).toBeDefined();
    expect(r.status === "booked" && r.token).toMatch(/^[a-f0-9]{32}$/);
    const p = h.params[h.sqls.indexOf(ins)];
    expect(p).toContain("invited");
  });

  it("existing invited match moves to the new drive and keeps its token", async () => {
    h.match = { id: "M1", state: "invited", drive_id: "OLD", slot_at: "2026-10-05 11:00:00", token: "a".repeat(32) };
    const r = await bookLeadOnDrive(args);
    expect(r).toMatchObject({ status: "booked", matchId: "M1", token: "a".repeat(32), slotAt: "2026-10-09 10:30:00" });
    const upd = h.connSqls.find((s) => s.startsWith("UPDATE he_match SET drive_id"))!;
    expect(upd).toContain("token = COALESCE(token, ?)");
    expect(h.connSqls.some((s) => s.startsWith("INSERT INTO he_match"))).toBe(false);
  });

  it("arrived / selected match → returned as booked with its own slot, no write", async () => {
    h.match = { id: "M2", state: "arrived", drive_id: "D0", slot_at: "2026-10-07 11:00:00", token: "b".repeat(32) };
    const r = await bookLeadOnDrive(args);
    expect(r).toMatchObject({ status: "booked", matchId: "M2", driveId: "D0", slotAt: "2026-10-07 11:00:00", token: "b".repeat(32) });
    expect(h.sqls.some((s) => /^(INSERT|UPDATE)/.test(s))).toBe(false);
  });

  it("requisition closed → unavailable requisition_closed, no writes", async () => {
    h.req = { approval_status: "approved", active_status: 1, closed_at: null, requested_headcount: 2, fulfilled_headcount: 2 };
    expect(await bookLeadOnDrive(args)).toEqual({ status: "unavailable", reason: "requisition_closed" });
    h.req = { approval_status: "pending", active_status: 1, closed_at: null, requested_headcount: 2, fulfilled_headcount: 0 };
    expect(await bookLeadOnDrive(args)).toEqual({ status: "unavailable", reason: "requisition_closed" });
    expect(h.sqls.some((s) => /^(INSERT|UPDATE)/.test(s))).toBe(false);
  });

  it("no branch → unavailable no_branch", async () => {
    expect(await bookLeadOnDrive({ ...args, branchName: " " })).toEqual({ status: "unavailable", reason: "no_branch" });
  });

  it("every date closed → unavailable drive_closed; every date full → no_capacity", async () => {
    for (const d of targetDriveDates(now, args.preferredSlotAt)) h.drives.set(d, { id: `X${d}`, drive_date: d, status: "paused", slot_start: "10:00:00", slot_end: "10:30:00", slot_minutes: 30, slot_capacity: 1, auto_send: 0 });
    expect(await bookLeadOnDrive(args)).toEqual({ status: "unavailable", reason: "drive_closed" });
    for (const d of h.drives.values()) { d.status = "active"; h.booked[`${d.drive_date} 10:00:00`] = 1; }
    expect(await bookLeadOnDrive(args)).toEqual({ status: "unavailable", reason: "no_capacity" });
  });

  it("E10: with the end date enforced, nothing is booked after the requisition's end (unavailable requisition_ended)", async () => {
    process.env.REQ_END_DATE_ENFORCEMENT = "policy"; h.enforced = 1;
    h.req = { ...h.req!, requisition_validity: "2026-10-09" };
    for (let m = 600; m < 1050; m += 30) h.booked[`2026-10-09 ${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00`] = 6;
    expect(await bookLeadOnDrive(args)).toEqual({ status: "unavailable", reason: "requisition_ended" });
    expect([...h.drives.keys()].filter((d) => d > "2026-10-09")).toEqual([]);
    h.booked = {};
    expect(await bookLeadOnDrive(args)).toMatchObject({ status: "booked", slotAt: "2026-10-09 10:30:00" });
  });
  it("a requisition whose end date has passed is never booked, whatever the enforcement switch says", async () => {
    h.req = { ...h.req!, requisition_validity: "2026-10-01" };
    expect(await bookLeadOnDrive(args)).toEqual({ status: "unavailable", reason: "requisition_ended" });
  });
  it("the nearest working day takes the daily invitation target: a slot already at its seat count still books", async () => {
    h.enforced = 400; // policy.walkin_daily_invites (the router answers every he_model_param read with this value)
    h.booked["2026-10-09 10:30:00"] = 6; // 10:30 is the first slot at least an hour away in this test
    expect(await bookLeadOnDrive(args)).toMatchObject({ status: "booked", slotAt: "2026-10-09 10:30:00" });
  });
  it("a national holiday is skipped, like a Sunday", async () => {
    h.holidays = ["2026-10-09"];
    const r = await bookLeadOnDrive(args);
    expect(r).toMatchObject({ status: "booked" });
    expect((r as { slotAt: string }).slotAt.startsWith("2026-10-09")).toBe(false);
  });
  it("E10: a date that cannot take the booking leaves no new drive behind (only the first fitting date gets one)", async () => {
    const evening = new Date("2026-10-08T12:00:00Z"); // 17:30 IST: no slot left today
    const r = await bookLeadOnDrive({ ...args, now: evening, preferredSlotAt: "2026-10-08 17:00:00" });
    expect(r).toMatchObject({ status: "booked", slotAt: expect.stringMatching(/^2026-10-09/) });
    expect([...h.drives.keys()]).toEqual(["2026-10-09"]);
  });
});

describe("softSlotCapacity", () => {
  it("spreads the daily target over the day's slots and never goes below the seat count", () => {
    expect(softSlotCapacity(6, 16, 400)).toBe(25);
    expect(softSlotCapacity(6, 16, 50)).toBe(6);
    expect(softSlotCapacity(6, 16, 0)).toBe(6);
    expect(softSlotCapacity(6, 0, 400)).toBe(6);
  });
});
