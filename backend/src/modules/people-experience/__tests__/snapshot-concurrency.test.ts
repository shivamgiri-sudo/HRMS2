import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ inflight: 0, max: 0, calls: [] as string[] }));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string) => {
      m.calls.push(sql);
      m.inflight++; m.max = Math.max(m.max, m.inflight);
      await new Promise((r) => setTimeout(r, 5));
      m.inflight--;
      if (/FROM employees e/.test(sql)) return [[{ id: "e1", full_name: "A" }], []];
      if (/AVG\(CAST/.test(sql)) return [[{ score: "4" }], []];
      return [[{ cnt: 2 }], []];
    }),
  },
}));
vi.mock("../../../shared/dbHelpers.js", () => ({
  tableExists: vi.fn(async () => true),
  scalar: vi.fn(async (sql: string) => {
    m.inflight++; m.max = Math.max(m.max, m.inflight);
    await new Promise((r) => setTimeout(r, 5));
    m.inflight--;
    return /INTERVAL 90 DAY\) AND LOWER/.test(sql) ? 1 : 2;
  }),
}));
vi.mock("../people-experience.scope.js", () => ({ buildEmployeeScopeCondition: () => ({ sql: "1=1", params: [] }) }));

import { scanPeopleExperience } from "../people-experience.service.js";

describe("people-experience snapshot", () => {
  beforeEach(() => { m.inflight = 0; m.max = 0; m.calls = []; });
  it("runs independent lookups concurrently and yields the same scores", async () => {
    const r = await scanPeopleExperience({} as never, {}, 10);
    expect(r.scanned).toBe(1);
    expect(m.max).toBeGreaterThanOrEqual(7);
    const s = r.results[0];
    // pulse 4/5 -> 80; recognition 2*10+2*5=30; participation 2*20+2*8=56;
    // attendance 100-(1/2)*100=50; support 100-24-50=26
    expect(s.component_scores).toMatchObject({ pulse: 80, recognition: 30, participation: 56, attendance: 50, support_friction: 26 });
  });
});
