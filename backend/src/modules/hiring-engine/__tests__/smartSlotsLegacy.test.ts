process.env.TZ = "UTC";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Snapshot of today's slot allocators (Meta rolling slots and the engine's reserveSlot) before HE_SMART_SLOTS exists. Never edit. */
const h = vi.hoisted(() => ({ calls: [] as Array<[string, unknown[]]> }));
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

vi.mock("../../../db/mysql.js", () => {
  const exec = async (sql: string, params: unknown[] = []) => {
    const q = norm(sql);
    h.calls.push([q, params]);
    if (q.includes("FROM meta_lead_raw ml")) return [[{ interview_date: "2026-10-12", interview_time: "10:00:00" }]];
    if (q.startsWith("SELECT id, lead_id, drive_id FROM he_match")) return [[{ id: "m1", lead_id: "l1", drive_id: "d1" }]];
    if (q.startsWith("SELECT * FROM he_drive")) return [[{ id: "d1", status: "open", drive_date: "2026-10-12", slot_start: "10:00:00", slot_end: "12:00:00", slot_minutes: 30, slot_capacity: 2 }]];
    if (q.startsWith("SELECT slot_at, COUNT(*)")) return [[{ slot_at: "2026-10-12 10:00:00", n: 2 }]];
    return [{ affectedRows: 1 }];
  };
  const conn = {
    execute: exec,
    beginTransaction: async () => { h.calls.push(["BEGIN", []]); },
    commit: async () => { h.calls.push(["COMMIT", []]); },
    rollback: async () => { h.calls.push(["ROLLBACK", []]); },
    release: () => undefined,
  };
  return { db: { execute: exec, getConnection: async () => conn } };
});
vi.mock("../he-lead.service.js", () => ({ addEvent: vi.fn(async (...a: unknown[]) => { h.calls.push(["addEvent", a]); }) }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

beforeEach(() => { h.calls.length = 0; vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-10T18:20:00Z")); });
afterEach(() => { vi.useRealTimers(); });

describe("today's slot allocators", () => {
  it("assignInterviewSlot walks past the booked 10:00", async () => {
    const { assignInterviewSlot } = await import("../../meta-campaign/interview-slot.service.js");
    const slot = await assignInterviewSlot("lead-1", "NOIDA");
    expect({ slot, calls: h.calls }).toMatchSnapshot();
  });
  it("reserveSlot picks the first free slot with room", async () => {
    const { reserveSlot } = await import("../he-drive.service.js");
    const slot = await reserveSlot("m1");
    expect({ slot, calls: h.calls }).toMatchSnapshot();
  });
});
