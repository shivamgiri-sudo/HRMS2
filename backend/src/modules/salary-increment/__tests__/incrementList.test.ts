import { describe, it, expect, vi, beforeEach } from "vitest";

const execute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => execute(...a), getConnection: vi.fn() } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn() }));
vi.mock("../salaryIncrement.notifications.js", () => ({ notifySalaryIncrementLetter: vi.fn() }));

import { salaryIncrementService } from "../salaryIncrement.service.js";

beforeEach(() => {
  execute.mockReset();
  execute.mockResolvedValueOnce([[{ id: "r1" }]]).mockResolvedValueOnce([[{ n: 14467 }]]);
});

describe("increment request list is paged (14,467 imported requests froze the tab)", () => {
  it("returns one page and the total, with LIMIT/OFFSET in the query", async () => {
    const out = await salaryIncrementService.list({ page: 3, limit: 25 });
    expect(out.rows).toHaveLength(1);
    expect(out.total).toBe(14467);
    expect(out.page).toBe(3);
    expect(out.limit).toBe(25);
    const sql = String(execute.mock.calls[0][0]);
    expect(sql).toMatch(/LIMIT 25 OFFSET 50/);
    expect(String(execute.mock.calls[1][0])).toMatch(/COUNT\(\*\)/);
  });

  it("caps the page size at 200 and defaults to 25", async () => {
    await salaryIncrementService.list({ limit: 100000 });
    expect(String(execute.mock.calls[0][0])).toMatch(/LIMIT 200 OFFSET 0/);
    execute.mockReset();
    execute.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[{ n: 0 }]]);
    await salaryIncrementService.list({});
    expect(String(execute.mock.calls[0][0])).toMatch(/LIMIT 25 OFFSET 0/);
  });

  it("pending means everything still waiting for an approval step", async () => {
    await salaryIncrementService.list({ status: "pending" });
    const sql = String(execute.mock.calls[0][0]);
    expect(sql).toMatch(/status IN \('submitted','hr_validated','finance_validated'\)/);
  });

  it("searches by the typed employee code (prefix) or name", async () => {
    await salaryIncrementService.list({ search: "63694C" });
    expect(String(execute.mock.calls[0][0])).toMatch(/e\.employee_code LIKE \?/);
    expect(execute.mock.calls[0][1]).toEqual(["63694C%", "%63694C%"]);
  });

  it("ignores junk paging values", async () => {
    const out = await salaryIncrementService.list({ page: -4 as number, limit: Number.NaN });
    expect(out.page).toBe(1);
    expect(out.limit).toBe(25);
  });

  it("keeps the 14,467 legacy migration rows out of every working view", async () => {
    for (const status of [undefined, "pending", "implemented", "approved"]) {
      execute.mockReset();
      execute.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[{ n: 0 }]]);
      await salaryIncrementService.list({ status });
      expect(String(execute.mock.calls[0][0])).toMatch(/sir\.source = 'hrms'/);
    }
  });

  it("reaches them only through the explicit legacy filter", async () => {
    await salaryIncrementService.list({ status: "legacy" });
    const sql = String(execute.mock.calls[0][0]);
    expect(sql).toMatch(/sir\.source = 'legacy'/);
    expect(sql).not.toMatch(/sir\.source = 'hrms'/);
  });
});
