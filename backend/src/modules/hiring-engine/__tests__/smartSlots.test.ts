process.env.TZ = "America/Los_Angeles";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chooseSlot, isFar, metaDay, slotLabels, type SlotPrefs } from "../he-smart-slots.js";

const NONE: SlotPrefs = { bestHourIst: null, etaMin: null, distanceKm: null };
const day = "2026-10-14";
const at = (t: string) => `${day} ${t}:00`;
const base = { nowIst: "2026-10-13 18:00:00", leadMinutes: 60, prefs: NONE };

describe("chooseSlot", () => {
  const four = ["10:00", "10:30", "11:00", "11:30"].map(at);
  it("spreads load to the emptiest slot", () => {
    expect(chooseSlot({ ...base, slots: four, capacity: 3, booked: { [at("10:00")]: 2, [at("10:30")]: 0, [at("11:00")]: 1, [at("11:30")]: 0 } })).toBe(at("10:30"));
  });
  it("null when every slot is full", () => {
    expect(chooseSlot({ ...base, slots: four, capacity: 1, booked: Object.fromEntries(four.map((s) => [s, 1])) })).toBeNull();
  });
  it("follows the best hour", () => {
    expect(chooseSlot({ ...base, slots: four, capacity: 3, booked: {}, prefs: { ...NONE, bestHourIst: 11 } })).toBe(at("11:00"));
  });
  it("best hour yields to spread when that slot is too loaded", () => {
    expect(chooseSlot({ ...base, slots: four, capacity: 3, booked: { [at("11:00")]: 2 }, prefs: { ...NONE, bestHourIst: 11 } })).toBe(at("11:30"));
  });
  it("far candidates get the latest slot of the later half", () => {
    const eight = ["10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30"].map(at);
    expect(chooseSlot({ ...base, slots: eight, capacity: 2, booked: {}, prefs: { ...NONE, etaMin: 75 } })).toBe(at("13:30"));
  });
  it("isFar prefers the ETA over the distance", () => {
    expect(isFar({ ...NONE, distanceKm: 20 })).toBe(true);
    expect(isFar({ ...NONE, distanceKm: 20, etaMin: 30 })).toBe(false);
    expect(isFar({ ...NONE, distanceKm: 10 })).toBe(false);
    expect(isFar({ ...NONE, distanceKm: 20 }, 25)).toBe(false);
    expect(isFar(NONE)).toBe(false);
  });
  it("never offers a slot inside the lead time", () => {
    const s = chooseSlot({ ...base, nowIst: "2026-10-14 09:30:00", slots: four, capacity: 3, booked: {} });
    expect(s! >= at("10:30")).toBe(true);
    expect(chooseSlot({ ...base, nowIst: "2026-10-14 17:45:00", slots: four, capacity: 3, booked: {} })).toBeNull();
  });
});

describe("metaDay", () => {
  it("skips Sunday and starts tomorrow IST", () => {
    expect(metaDay("2026-10-10 23:50:00", new Set())?.date).toBe("2026-10-12");
    expect(metaDay("2026-10-14 00:30:00", new Set())?.date).toBe("2026-10-15");
  });
  it("has 16 half-hour slots from 10:00 to 17:30", () => {
    const d = metaDay("2026-10-14 00:30:00", new Set())!;
    expect(d.slots).toHaveLength(16);
    expect(d.slots[0]).toBe("2026-10-15 10:00:00");
    expect(d.slots[15]).toBe("2026-10-15 17:30:00");
  });
  it("moves to the next day when every slot is booked", () => {
    const full = new Set(metaDay("2026-10-14 00:30:00", new Set())!.slots.map((s) => `${s.slice(0, 10)}|${s.slice(11, 16)}`));
    expect(metaDay("2026-10-14 00:30:00", full)?.date).toBe("2026-10-16");
  });
  it("null when 60 days are full", () => {
    const all = new Set<string>();
    for (let i = 1; i <= 70; i++) {
      const d = new Date(Date.UTC(2026, 9, 14 + i)).toISOString().slice(0, 10);
      for (let m = 600; m < 1080; m += 30) all.add(`${d}|${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
    }
    expect(metaDay("2026-10-14 00:30:00", all)).toBeNull();
  });
});

describe("slotLabels", () => {
  it("formats like the legacy labels", () => expect(slotLabels("2026-10-14", "13:30:00")).toEqual({ dateLabel: "Wed, 14 Oct 2026", timeLabel: "01:30 PM" }));
});

const h = vi.hoisted(() => ({
  calls: [] as Array<[string, unknown[]]>,
  metaPrefs: vi.fn(async () => ({ bestHourIst: 15, etaMin: null, distanceKm: null })),
  matchPrefs: vi.fn(async () => ({ bestHourIst: null, etaMin: null, distanceKm: 30 })),
}));
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
vi.mock("../../../db/mysql.js", () => {
  const exec = async (sql: string, params: unknown[] = []) => {
    const q = norm(sql);
    h.calls.push([q, params]);
    if (q.includes("FROM meta_lead_raw ml")) return [[{ interview_date: "2026-10-12", interview_time: "10:00:00" }]];
    if (q.startsWith("SELECT id, lead_id, drive_id FROM he_match")) return [[{ id: "m1", lead_id: "l1", drive_id: "d1" }]];
    if (q.startsWith("SELECT * FROM he_drive")) return [[{ id: "d1", status: "open", drive_date: "2026-10-12", slot_start: "10:00:00", slot_end: "14:00:00", slot_minutes: 30, slot_capacity: 2 }]];
    if (q.startsWith("SELECT slot_at, COUNT(*)")) return [[{ slot_at: "2026-10-12 13:30:00", n: 2 }]];
    return [{ affectedRows: 1 }];
  };
  const conn = { execute: exec, beginTransaction: async () => undefined, commit: async () => undefined, rollback: async () => undefined, release: () => undefined };
  return { db: { execute: exec, getConnection: async () => conn } };
});
vi.mock("../he-lead.service.js", () => ({ addEvent: vi.fn(async () => undefined) }));
vi.mock("../he-smart-slots.service.js", () => ({ readMetaLeadPrefs: h.metaPrefs, readMatchPrefs: h.matchPrefs }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

describe("wiring", () => {
  beforeEach(() => { h.calls.length = 0; h.metaPrefs.mockClear(); h.matchPrefs.mockClear(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-10T18:20:00Z")); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it("meta: same SELECT and UPDATE, time follows the best hour", async () => {
    vi.stubEnv("HE_SMART_SLOTS", "true");
    const { assignInterviewSlot } = await import("../../meta-campaign/interview-slot.service.js");
    const slot = await assignInterviewSlot("lead-1", "NOIDA");
    expect(slot).toEqual({ date: "2026-10-12", time: "15:00:00", dateLabel: "Mon, 12 Oct 2026", timeLabel: "03:00 PM" });
    expect(h.metaPrefs).toHaveBeenCalledWith("lead-1");
    expect(h.calls.map((c) => c[0])).toEqual([
      "SELECT ml.interview_date, ml.interview_time FROM meta_lead_raw ml LEFT JOIN job_requisition jr ON jr.id = ml.requisition_id WHERE jr.branch_name = ? AND ml.interview_date IS NOT NULL AND ml.interview_time IS NOT NULL",
      "UPDATE meta_lead_raw SET interview_date = ?, interview_time = ?, interview_slot_assigned_at = NOW() WHERE id = ?",
    ]);
    expect(h.calls[1][1]).toEqual(["2026-10-12", "15:00:00", "lead-1"]);
  });

  it("engine: far candidate gets a later-half slot with room", async () => {
    vi.stubEnv("HE_SMART_SLOTS", "true");
    const { reserveSlot } = await import("../he-drive.service.js");
    const slot = await reserveSlot("m1");
    expect(h.matchPrefs).toHaveBeenCalledWith("m1");
    expect(slot).not.toBe("2026-10-12 13:30:00"); // full
    expect(slot! >= "2026-10-12 12:00:00").toBe(true);
    expect(h.calls.find((c) => c[0].startsWith("UPDATE he_match"))![1]).toEqual([slot, "m1"]);
  });

  it("switch unset: prefs readers are never called", async () => {
    const { assignInterviewSlot } = await import("../../meta-campaign/interview-slot.service.js");
    const { reserveSlot } = await import("../he-drive.service.js");
    await assignInterviewSlot("lead-1", "NOIDA");
    await reserveSlot("m1");
    expect(h.metaPrefs).not.toHaveBeenCalled();
    expect(h.matchPrefs).not.toHaveBeenCalled();
  });
});
