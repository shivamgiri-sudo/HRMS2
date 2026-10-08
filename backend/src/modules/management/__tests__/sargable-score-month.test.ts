import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));

const { pushScoreMonthCond } = await import("../management.service.js");

describe("pushScoreMonthCond", () => {
  it("valid month -> half-open range, two params", () => {
    const conds: string[] = ["e.active_status = 1"];
    const params: unknown[] = [];
    pushScoreMonthCond(conds, params, "2026-09");
    expect(conds).toEqual([
      "e.active_status = 1",
      "kda.score_date >= ? AND kda.score_date < DATE_ADD(?, INTERVAL 1 MONTH)",
    ]);
    expect(params).toEqual(["2026-09-01", "2026-09-01"]);
  });

  it("December rolls over through DATE_ADD, not string math", () => {
    const params: unknown[] = [];
    pushScoreMonthCond([], params, "2026-12");
    expect(params).toEqual(["2026-12-01", "2026-12-01"]);
  });

  it("invalid month keeps the original DATE_FORMAT predicate", () => {
    for (const bad of ["NaN-NaN", "2026-13", "2026-9", "x"]) {
      const conds: string[] = [];
      const params: unknown[] = [];
      pushScoreMonthCond(conds, params, bad);
      expect(conds).toEqual(["DATE_FORMAT(kda.score_date, '%Y-%m') = ?"]);
      expect(params).toEqual([bad]);
    }
  });
});

describe("team-overview route", () => {
  const routes = readFileSync(new URL("../management.routes.ts", import.meta.url), "utf8");
  const body = routes.slice(routes.indexOf('router.get("/team-overview"'), routes.indexOf('router.get("/agent-performance"'));
  it("uses a sargable current-month range and resolves payroll access in the same wave", () => {
    expect(body).not.toContain("DATE_FORMAT(kda.score_date");
    expect(body).toContain("kda.score_date >= DATE_FORMAT(CURDATE(),'%Y-%m-01')");
    expect(body).toContain("callerHasPayrollAccess(req.authUser!.id),\n  ]);");
  });
});
