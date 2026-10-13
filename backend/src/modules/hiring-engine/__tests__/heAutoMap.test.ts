import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ on: true, view: null as unknown, streams: [] as Array<{ status: string }>, create: vi.fn(), plan: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(async () => [h.on ? [] : [{ value: 0 }], []]) } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../he-fulfilment.service.js", () => ({ getFulfilment: vi.fn(async () => h.view) }));
vi.mock("../he-plan.service.js", () => ({ nextWorkingDay: () => "2026-10-13" }));
vi.mock("../he-stream-plan.service.js", () => ({ planStreamsForDay: (...a: unknown[]) => h.plan(...a) }));
vi.mock("../requisition-stream.service.js", () => ({ loadStreamsOfType: vi.fn(async () => h.streams), tryCreateStream: (...a: unknown[]) => h.create(...a) }));
import { autoMapPoolStreams } from "../he-auto-map.service.js";

const NOW = new Date("2026-10-11T18:00:00Z");
const row = (o: Record<string, unknown>) => ({ id: "R1", code: "NOIDA-Onfido-22", sequence: 1, verdict: "at_risk", seatsOpen: 29, daysLeft: 5, perDayNeeded: 612, ...o });
beforeEach(() => { h.on = true; h.streams = []; h.view = { computing: false, requisitions: [row({})] }; h.create.mockReset().mockResolvedValue({ ok: true, stream: {} }); h.plan.mockReset().mockResolvedValue({}); });

describe("autoMapPoolStreams", () => {
  it("opens a pool stream for the requisition at the front of its sequence, sized to the need and capped at 500, then lines up the next day", async () => {
    const r = await autoMapPoolStreams(NOW);
    expect(r.created).toEqual(["NOIDA-Onfido-22"]);
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ requisitionId: "R1", sourceType: "he", originId: "pool", openDays: 5, dailyInvites: 500, open: true }), expect.anything(), NOW);
    expect(h.plan).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-10-13", requisitionId: "R1", dryRun: false }));
  });
  it("leaves queued, past-deadline and already-mapped requisitions alone", async () => {
    h.view = { computing: false, requisitions: [row({ id: "R2", code: "NOIDA-Onfido-23", sequence: 2, verdict: "queued" }), row({ id: "R0", code: "NOIDA-Onfido-17", sequence: 0, verdict: "past_deadline" }), row({})] };
    h.streams = [{ status: "open" }];
    const r = await autoMapPoolStreams(NOW);
    expect(r.created).toEqual([]);
    expect(r.kept).toEqual(["NOIDA-Onfido-22"]);
    expect(h.create).not.toHaveBeenCalled();
  });
  it("does not map a requisition that is already covered, and waits while sizing is computed", async () => {
    h.view = { computing: false, requisitions: [row({ verdict: "covered" })] };
    expect((await autoMapPoolStreams(NOW)).skipped).toEqual([{ code: "NOIDA-Onfido-22", reason: "already_covered" }]);
    h.view = { computing: true, requisitions: [] };
    expect((await autoMapPoolStreams(NOW)).skipped).toEqual([{ code: "*", reason: "sizing_not_ready" }]);
  });
  it("uses the minimum daily size when the need is small, and respects the switch", async () => {
    h.view = { computing: false, requisitions: [row({ perDayNeeded: 10, daysLeft: null })] };
    await autoMapPoolStreams(NOW);
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ dailyInvites: 50, openDays: 14 }), expect.anything(), NOW);
    h.on = false; h.create.mockClear();
    expect((await autoMapPoolStreams(NOW)).off).toBe(true);
    expect(h.create).not.toHaveBeenCalled();
  });
});
