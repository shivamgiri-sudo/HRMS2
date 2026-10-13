import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], day: {} as Record<string, unknown>, fail: false }));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: vi.fn(async (sql: string) => {
    if (h.fail) throw new Error("boom");
    if (sql.includes("GROUP BY source_type")) return [h.rows, []];
    return [[h.day], []];
  }) },
}));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
import { getPipelineView } from "../qualified-followup.pipeline-view.js";

beforeEach(() => { h.fail = false; h.rows = []; h.day = {}; });

describe("getPipelineView", () => {
  it("returns the three drives in order, zero-filled, with the next window", async () => {
    h.rows = [{ source_type: "meta_old", enrolled: "1837", emailed: "512", whatsapped: "0", called: "0", engaged: "10", confirmed: "9", arrived: "0", stopped: "28", w_email: "1321", w_wa: "1837", w_call: "1837", last_email: "2026-10-10 19:58:59", last_wa: null }];
    h.day = { emails: "895", whatsapps: "83", call_results: "0", replies: "12", confirmations: "3" };
    const v = await getPipelineView(new Date("2026-10-11T10:00:00Z")); // Sunday
    expect(v.sources.map((s) => s.sourceType)).toEqual(["meta_live", "meta_old", "he"]);
    expect(v.sources[1]).toMatchObject({ enrolled: 1837, emailed: 512, whatsapped: 0, waiting: { email: 1321, whatsapp: 1837, call: 1837 }, lastEmailAt: "2026-10-10 19:58" });
    expect(v.sources[0].enrolled).toBe(0);
    expect(v.last24h).toEqual({ emails: 895, whatsapps: 83, callResults: 0, replies: 12, confirmations: 3 });
    expect(v.windowOpen).toBe(true); // Sunday 15:30 IST: Sunday is a send day
    expect(new Date(v.nextWindowOpen).getTime()).toBeGreaterThan(Date.parse("2026-10-11T10:00:00Z"));
  });
  it("a failed read leaves empty blocks instead of throwing", async () => {
    h.fail = true;
    const v = await getPipelineView(new Date("2026-10-13T06:00:00Z"));
    expect(v.sources).toHaveLength(3);
    expect(v.last24h.emails).toBe(0);
    expect(v.windowOpen).toBe(true);
  });
});
