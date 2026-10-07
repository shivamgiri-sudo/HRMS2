import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Quality insights / dashboard reads that are independent of each other are
 * issued together instead of serially (each serial statement is a network round
 * trip to the audit DB). Output must stay identical.
 */
const { execute, state } = vi.hoisted(() => ({
  execute: vi.fn(),
  state: { inflight: 0, maxInflight: 0 },
}));

vi.mock("../../../db/shivamgiriDb.js", () => ({
  getShivamgiriPool: () => ({ execute }),
}));

function tracked(rows: (sql: string) => unknown[]) {
  return async (sql: string) => {
    state.inflight += 1;
    state.maxInflight = Math.max(state.maxInflight, state.inflight);
    await new Promise((r) => setTimeout(r, 5));
    state.inflight -= 1;
    return [rows(String(sql))];
  };
}

beforeEach(() => {
  state.inflight = 0;
  state.maxInflight = 0;
  execute.mockReset();
});

describe("generateInsights", () => {
  it("fires its five reads concurrently and assembles insights in the original order", async () => {
    execute.mockImplementation(
      tracked((sql) => {
        if (/as today_avg/.test(sql))
          return [
            { today_avg: 60, yesterday_avg: 80, week_avg: 70, month_avg: 70 },
          ];
        if (/poor_calls/.test(sql))
          return [{ User: "A", poor_calls: 4, display_name: "Agent A" }];
        if (/top_count/.test(sql)) return [{ top_count: 3, top_avg: 95 }];
        if (/bottom_count/.test(sql))
          return [{ bottom_count: 2, bottom_avg: 40 }];
        if (/HOUR\(CallDate\) as hour/.test(sql))
          return [{ hour: 14, avg_score: "55.5", call_volume: 20 }];
        return [];
      }),
    );
    const { generateInsights } = await import("../quality-insights.service.js");
    const out = await generateInsights("2026-09-01", "2026-09-29");
    expect(state.maxInflight).toBe(5);
    expect(out.map((i) => i.title)).toEqual([
      "Quality Declining",
      "Agents Need Immediate Support",
      "Performance Gap Opportunity",
      "Weakest Hour Identified",
    ]);
  });
});

describe("quality-dashboard routes", () => {
  const src = readFileSync(
    new URL("../quality-dashboard.routes.ts", import.meta.url),
    "utf8",
  );
  const section = (start: string, end: string) =>
    src.slice(src.indexOf(start), src.indexOf(end));

  it("/summary starts the freshness stamp together with the aggregate", () => {
    const body = section('router.get("/summary"', 'router.get("/trend"');
    expect(body).toContain("await Promise.all([rowsP, freshP])");
    expect(body).not.toMatch(
      /await pool\.execute<RowDataPacket\[\]>\(\s*`SELECT MAX\(CallDate\)/,
    );
  });

  it("/sales-intelligence and /sales-funnel run their statements via Promise.all", () => {
    const si = section(
      'router.get("/sales-intelligence"',
      'router.get("/objections"',
    );
    expect(si).toContain("Promise.all([");
    const sf = section('router.get("/sales-funnel"', 'router.get("/heatmap"');
    expect(sf).toContain(
      "[[sales], [rejection], [reasons]] = await Promise.all([",
    );
  });
});
