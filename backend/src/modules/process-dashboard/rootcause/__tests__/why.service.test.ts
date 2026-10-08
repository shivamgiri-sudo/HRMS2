import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../db/mysql.js", () => ({ db: { execute: vi.fn().mockResolvedValue([[], []]) } }));
const hoisted = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("../../pd.dataset.js", async (orig) => {
  const actual = await orig<typeof import("../../pd.dataset.js")>();
  return { ...actual, getFreshness: async () => ({ lastDataAt: null, latestDate: "2026-04-14" }), loadDataset: async () => ({ rows: hoisted.rows, qa: [], truncated: false, badValues: {} }) };
});

import { getWhy } from "../why.service.js";
import type { NormRow } from "../../pd.metrics.js";
import type { Loaded } from "../../pd.dataset.js";

const row = (date: string, agent: string, tl: string, lob: string, calls: number, talkPerCall: number): NormRow => ({ date, agent_code: agent, agent_name: `Agent ${agent}`, tl_name: tl, lob, hour: null,
  calls, login_sec: 28800, talk_sec: calls * talkPerCall, wait_sec: 9000, dispo_sec: calls * 30, break_sec: null, connected: null, ptp: null, sales_count: Math.round(calls / 10), amount: null, handled: null, offered: null, abandoned: null });
// Baseline week 2026-04-01..07 and current week 2026-04-08..14. TL_B's Outbound agents double their talk time per call; everything else is flat.
const data: NormRow[] = [];
for (let d = 1; d <= 14; d++) {
  const date = `2026-04-${String(d).padStart(2, "0")}`; const cur = d >= 8;
  for (const [agent, tl, lob] of [["E1", "TL_A", "Inbound"], ["E2", "TL_A", "Inbound"], ["E3", "TL_B", "Outbound"], ["E4", "TL_B", "Outbound"], ["E5", "TL_B", "Inbound"]] as const)
    data.push(row(date, agent, tl, lob, 100, tl === "TL_B" && lob === "Outbound" && cur ? 480 : 240));
}
hoisted.rows = data;
const loaded = { cfg: { processId: "p1", updatedAt: "t1", category: "sales" }, resolved: { mapped: new Set(["agent_code", "date", "tl_name", "lob", "calls", "login_sec", "talk_sec", "wait_sec", "dispo_sec", "sales_count"]) } } as unknown as Loaded;
const q = { metric: "aht", from: "2026-04-08", to: "2026-04-14", compareFrom: "2026-04-01", compareTo: "2026-04-07" };

describe("getWhy", () => {
  it("names the engineered driver: TL_B's AHT doubling, with an exact sum", async () => {
    const r = await getWhy(loaded, { ...q, by: "tl" });
    expect(r.sumCheck.ok).toBe(true);
    expect(r.segments[0].key).toBe("TL_B");
    expect(r.total.a).toBeCloseTo(270, 6);            // (240+30) per call everywhere
    expect(r.total.b).toBeCloseTo(366, 6);            // (3*270 + 2*510) / 5
    const tlA = r.segments.find((s) => s.key === "TL_A")!; expect(tlA.contribution).toBeCloseTo(0, 6);
    expect(r.explanation.join(" ")).toMatch(/TL_B/);
    expect(r.explanation.join(" ")).toMatch(/Outbound/);
  });
  it("by agent: E3 and E4 are the top drivers and sum exactly", async () => {
    const r = await getWhy(loaded, { ...q, by: "agent" });
    expect(r.sumCheck.ok).toBe(true);
    expect(r.segments.slice(0, 2).map((s) => s.key).sort()).toEqual(["E3", "E4"]);
  });
  it("additive metric: calls contribution equals per-segment delta", async () => {
    const r = await getWhy(loaded, { ...q, metric: "calls", by: "lob" });
    expect(r.total.delta).toBe(0); expect(r.sumCheck.ok).toBe(true);
  });
  it("rejects unknown metric, dimension and unmapped hour", async () => {
    await expect(getWhy(loaded, { ...q, metric: "nope" })).rejects.toMatchObject({ code: "BAD_METRIC" });
    await expect(getWhy(loaded, { ...q, by: "zzz" })).rejects.toMatchObject({ code: "BAD_DIMENSION" });
    await expect(getWhy(loaded, { ...q, by: "hour" })).rejects.toMatchObject({ code: "DIMENSION_UNAVAILABLE" });
    await expect(getWhy(loaded, { ...q, metric: "connect_rate" })).rejects.toMatchObject({ code: "METRIC_UNAVAILABLE" });
    await expect(getWhy(loaded, { ...q, compareFrom: "2026-04-01", compareTo: "" })).rejects.toMatchObject({ code: "BAD_DATE" });
  });
  it("defaults the baseline to the previous period", async () => {
    const r = await getWhy(loaded, { metric: "aht", from: "2026-04-08", to: "2026-04-14", by: "tl" });
    expect(r.periods.baseline).toEqual({ from: "2026-04-01", to: "2026-04-07" });
  });
});
