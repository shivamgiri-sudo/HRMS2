import { beforeEach, describe, expect, it, vi } from "vitest";

// The service imports both pools at module load; mock before importing the service.
const onfidoQuery = vi.fn();
const hrmsExecute = vi.fn();

vi.mock("../../../db/onfidoDb.js", () => ({
  getOnfidoPool: vi.fn().mockResolvedValue({ query: (...args: unknown[]) => onfidoQuery(...args) }),
}));

vi.mock("../../../db/mysql.js", () => ({
  db: { execute: (...args: unknown[]) => hrmsExecute(...args) },
}));

const { runNameMappingSeed } = await import("../onfido-name-mapping.service.js");

beforeEach(() => {
  onfidoQuery.mockReset();
  hrmsExecute.mockReset();
});

describe("runNameMappingSeed", () => {
  it("matches every raw name against active employees and upserts each result", async () => {
    // getDistinctOnfidoNames: one tl name, one am name
    onfidoQuery
      .mockResolvedValueOnce([[{ name: "Priya Sharma" }]]) // tl
      .mockResolvedValueOnce([[{ name: "Rahul Verma" }]]); // am

    // getEmployeeCandidates
    hrmsExecute.mockResolvedValueOnce([
      [
        { id: "emp-1", full_name: "Priya Sharma", employee_code: "MAS001" },
        { id: "emp-2", full_name: "Rahul Verma", employee_code: "MAS002" },
      ],
    ]);

    // upsertMapping's guard SELECT + INSERT, once per raw name (2 names => 4 calls after the candidates call)
    hrmsExecute
      .mockResolvedValueOnce([[]]) // guard SELECT for Priya Sharma/tl: no existing row
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // INSERT for Priya Sharma/tl
      .mockResolvedValueOnce([[]]) // guard SELECT for Rahul Verma/am: no existing row
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // INSERT for Rahul Verma/am

    const result = await runNameMappingSeed();

    expect(result.matched).toBe(2);
    expect(result.ambiguous).toBe(0);
    expect(result.unmatched).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it("counts ambiguous and unmatched names separately from matched ones, and still upserts each", async () => {
    onfidoQuery
      .mockResolvedValueOnce([[{ name: "Amit Kumar" }]]) // tl — ambiguous (2 employees share this name)
      .mockResolvedValueOnce([[{ name: "Nobody Real" }]]); // am — unmatched

    hrmsExecute.mockResolvedValueOnce([
      [
        { id: "emp-1", full_name: "Amit Kumar", employee_code: "MAS010" },
        { id: "emp-2", full_name: "Amit Kumar", employee_code: "MAS045" },
      ],
    ]);

    hrmsExecute
      .mockResolvedValueOnce([[]]) // guard SELECT for Amit Kumar/tl
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // INSERT for Amit Kumar/tl (ambiguous result)
      .mockResolvedValueOnce([[]]) // guard SELECT for Nobody Real/am
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // INSERT for Nobody Real/am (unmatched result)

    const result = await runNameMappingSeed();

    expect(result.matched).toBe(0);
    expect(result.ambiguous).toBe(1);
    expect(result.unmatched).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it("is idempotent: a name whose mapping row is already HR-verified is left untouched but still counted", async () => {
    onfidoQuery
      .mockResolvedValueOnce([[{ name: "Priya Sharma" }]])
      .mockResolvedValueOnce([[]]);

    hrmsExecute.mockResolvedValueOnce([
      [{ id: "emp-1", full_name: "Priya Sharma", employee_code: "MAS001" }],
    ]);

    // upsertMapping's guard SELECT finds an HR-verified row — no INSERT should follow.
    hrmsExecute.mockResolvedValueOnce([[{ verified_by_hr: 1 }]]);

    const result = await runNameMappingSeed();

    expect(result.matched).toBe(1);
    // Only 2 hrmsExecute calls total: getEmployeeCandidates + the guard SELECT.
    expect(hrmsExecute).toHaveBeenCalledTimes(2);
  });

  it("records a per-name error instead of throwing when upsertMapping fails for one name", async () => {
    onfidoQuery
      .mockResolvedValueOnce([[{ name: "Priya Sharma" }, { name: "Rahul Verma" }]])
      .mockResolvedValueOnce([[]]);

    hrmsExecute.mockResolvedValueOnce([
      [
        { id: "emp-1", full_name: "Priya Sharma", employee_code: "MAS001" },
        { id: "emp-2", full_name: "Rahul Verma", employee_code: "MAS002" },
      ],
    ]);

    hrmsExecute
      .mockResolvedValueOnce([[]]) // guard SELECT for Priya Sharma: ok
      .mockRejectedValueOnce(new Error("ER_LOCK_WAIT_TIMEOUT")) // INSERT for Priya Sharma fails
      .mockResolvedValueOnce([[]]) // guard SELECT for Rahul Verma: ok
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // INSERT for Rahul Verma: ok

    const result = await runNameMappingSeed();

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Priya Sharma");
    // The second name still gets processed even though the first failed.
    expect(result.matched).toBe(1);
  });
});
