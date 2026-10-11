import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ facts: [] as Record<string, unknown>[], reqs: [] as Record<string, unknown>[], plan: null as unknown, planDelay: 0 }));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: vi.fn(async (sql: string) => {
    if (sql.includes("FROM job_requisition")) return [h.reqs, []];
    if (sql.includes("he_drive d ON d.id = f.drive_id")) return [h.facts, []];
    if (sql.includes("he_model_param")) return [[], []];
    return [[], []];
  }) },
}));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../he-planner.service.js", () => ({ planHiring: vi.fn(async () => { if (h.planDelay) await new Promise((r) => setTimeout(r, h.planDelay)); return h.plan; }) }));
vi.mock("../walkin-booking.service.js", () => ({ dailyInviteTarget: vi.fn(async () => 400) }));

const NOW = new Date("2026-10-11T10:00:00Z"); // Sunday 15:30 IST
const fact = (o: Record<string, unknown>) => ({ state: "invited", slot_at: "2026-10-12 10:30:00", drive_date: "2026-10-12", branch_name: "NOIDA-2", requisition_id: "R1", walkin_count: 0, past_no_shows: 0, distance_km: null, shared_location: 0, replied_yes: 0, ...o });
const req = (o: Record<string, unknown> = {}) => ({ id: "R1", requisition_code: "NOIDA-Onfido-24", designation_name: "EXECUTIVE", process_name: "Onfido", branch_name: "NOIDA-2", requested_headcount: 25, fulfilled_headcount: 0, requisition_validity: "2026-10-23", ...o });
const plan = (o: Record<string, unknown> = {}) => ({ totals: { uniqueLeads: 1000, walkins: 80, callAttempts: 0, expectedJoined: 20 }, scope: "process", pool: { reachableNow: 0, suggested: 0, invitedOrConfirmed: 300, inPipeline: 400 }, ...o });

async function fresh() { vi.resetModules(); return (await import("../he-fulfilment.service.js")).getFulfilment; }

beforeEach(() => { h.facts = []; h.reqs = []; h.plan = plan(); h.planDelay = 0; });

describe("getFulfilment", () => {
  it("groups expected arrivals by next day, branch and hour; confirmed count as confirmed", async () => {
    h.facts = [fact({}), fact({ state: "confirmed" }), fact({ slot_at: "2026-10-12 14:00:00", branch_name: "NOIDA" })];
    const get = await fresh();
    const v = await get(NOW);
    expect(v.today.booked).toBe(0);
    expect(v.next?.date).toBe("2026-10-12");
    expect(v.next?.booked).toBe(3);
    expect(v.next?.confirmed).toBe(1);
    const noida2 = v.next!.branches.find((b) => b.branch === "NOIDA-2")!;
    expect(noida2.hours.map((x) => x.hour)).toEqual(["10:00"]);
    expect(noida2.hours[0].booked).toBe(2);
  });
  it("sizes a requisition: covered people vs the planner's requirement, with a per-day need within capacity = on track", async () => {
    h.reqs = [req()];
    const get = await fresh();
    const v = await get(NOW);
    const r = v.requisitions[0];
    expect(r).toMatchObject({ code: "NOIDA-Onfido-24", seatsOpen: 25, neededLeads: 1000, covered: 400, gap: 600, verdict: "on_track" });
    expect(r.perDayNeeded).toBe(Math.ceil(600 / r.daysLeft!));
  });
  it("at risk when the per-day need exceeds the daily capacity; covered when nothing is missing; past deadline when the end date has gone", async () => {
    h.reqs = [req({ requisition_validity: "2026-10-12" })];
    h.plan = plan({ totals: { uniqueLeads: 5000, walkins: 1, callAttempts: 0, expectedJoined: 1 } });
    let v = await (await fresh())(NOW);
    expect(v.requisitions[0].verdict).toBe("at_risk");
    h.plan = plan({ totals: { uniqueLeads: 300, walkins: 1, callAttempts: 0, expectedJoined: 1 } });
    v = await (await fresh())(NOW);
    expect(v.requisitions[0].verdict).toBe("covered");
    h.reqs = [req({ requisition_validity: "2026-10-01" })];
    v = await (await fresh())(NOW);
    expect(v.requisitions[0].verdict).toBe("past_deadline");
  });
  it("answers with the expected-arrivals blocks and computing=true while the sizing is still running, then serves the snapshot", async () => {
    vi.useFakeTimers();
    h.reqs = [req()]; h.planDelay = 60_000;
    const get = await fresh();
    const p = get(NOW);
    await vi.advanceTimersByTimeAsync(13_000);
    const early = await p;
    expect(early.computing).toBe(true);
    expect(early.requisitions).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    const later = await get(NOW);
    expect(later.computing).toBe(false);
    expect(later.requisitions).toHaveLength(1);
    vi.useRealTimers();
  });
});
