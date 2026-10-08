import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: (...a: unknown[]) => get(...a) } }));

import { EMPLOYEE_PAGE_SIZE, MAX_EMPLOYEE_PAGES, fetchMaxEmployeeCodeNumber } from "../useNextEmployeeCode";

const pattern = { prefix: "ACQ", min_digits: 3, separator: "" };
const rows = (from: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({ employee_code: `ACQ${String(from + i).padStart(3, "0")}` }));

describe("fetchMaxEmployeeCodeNumber", () => {
  beforeEach(() => get.mockReset());

  it("never asks for more than the API's 200-row limit, and searches by prefix across all records", async () => {
    get.mockResolvedValueOnce({ data: rows(1, 5), total: 5 });
    await fetchMaxEmployeeCodeNumber(pattern);
    const url = String(get.mock.calls[0][0]);
    expect(url).toContain(`limit=${EMPLOYEE_PAGE_SIZE}`);
    expect(EMPLOYEE_PAGE_SIZE).toBeLessThanOrEqual(200);
    expect(url).toContain("search=ACQ");
    expect(url).toContain("recordStatus=all");
    expect(url).not.toContain("limit=1000");
  });

  it("pages until the last page and finds the max beyond the first page", async () => {
    get
      .mockResolvedValueOnce({ data: rows(1, 200), total: 250 })
      .mockResolvedValueOnce({ data: [...rows(201, 49), { employee_code: "MAS999999" }], total: 250 });
    await expect(fetchMaxEmployeeCodeNumber(pattern)).resolves.toBe(249);
    expect(get).toHaveBeenCalledTimes(2);
    expect(String(get.mock.calls[1][0])).toContain("page=2");
  });

  it("stops at the page cap", async () => {
    get.mockResolvedValue({ data: rows(1, 200), total: 1_000_000 });
    await fetchMaxEmployeeCodeNumber(pattern);
    expect(get).toHaveBeenCalledTimes(MAX_EMPLOYEE_PAGES);
  });
});
