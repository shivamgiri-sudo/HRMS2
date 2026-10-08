import { describe, it, expect, vi, beforeEach } from "vitest";

const execute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }));

import { employeeFulltextAvailable, resetEmployeeFulltextCache } from "../employee-search-index.js";

beforeEach(() => { execute.mockReset(); resetEmployeeFulltextCache(); });

describe("employeeFulltextAvailable", () => {
  it("is true when ft_emp_search exists, and the answer is cached", async () => {
    execute.mockResolvedValue([[{ 1: 1 }]]);
    expect(await employeeFulltextAvailable()).toBe(true);
    expect(await employeeFulltextAvailable()).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(String(execute.mock.calls[0][0])).toMatch(/ft_emp_search/);
  });

  it("is false when the index is missing (production on 2026-10-05), so callers use LIKE not MATCH", async () => {
    execute.mockResolvedValue([[]]);
    expect(await employeeFulltextAvailable()).toBe(false);
  });

  it("is false when the check itself fails, never throws", async () => {
    execute.mockRejectedValue(new Error("boom"));
    expect(await employeeFulltextAvailable()).toBe(false);
  });
});
