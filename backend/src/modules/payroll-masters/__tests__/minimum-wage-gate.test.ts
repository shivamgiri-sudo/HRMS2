import { describe, it, expect, beforeEach, vi } from "vitest";

import { db } from "../../../db/mysql.js";
import {
  evaluateMinimumWageFloor,
  normalizeStateToCode,
  resolveStateForBranchName,
} from "../minimum-wage-gate.service.js";

/**
 * The minimum-wage gate: covers its three outcomes (below the floor / no floor
 * configured for the resolved state / at-or-above the floor) plus the state
 * normalisation and branch-name resolution it depends on.
 *
 * Mirrors salaryPackageColumns.contract.test.ts's mocking style: db.execute is the
 * global mock from tests/setup.ts, reprogrammed per test via mockImplementation
 * keyed on which table the SQL touches.
 */
const mockExecute = db.execute as unknown as ReturnType<typeof vi.fn>;

describe("normalizeStateToCode", () => {
  it("maps a full state name regardless of case", () => {
    expect(normalizeStateToCode("UTTAR PRADESH")).toBe("UP");
    expect(normalizeStateToCode("uttar pradesh")).toBe("UP");
  });

  it("folds punctuation before matching ('U.P.', 'Jammu & Kashmir')", () => {
    expect(normalizeStateToCode("U.P.")).toBe("UP");
    expect(normalizeStateToCode("Jammu & Kashmir")).toBe("JK");
  });

  it("accepts an already-valid 2-letter code unchanged", () => {
    expect(normalizeStateToCode("dl")).toBe("DL");
  });

  it("returns null for empty or unrecognised input rather than guessing", () => {
    expect(normalizeStateToCode(null)).toBeNull();
    expect(normalizeStateToCode("")).toBeNull();
    expect(normalizeStateToCode("Narnia")).toBeNull();
  });
});

describe("evaluateMinimumWageFloor", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("flags below_floor and reports the shortfall when the amount is under the configured rate", async () => {
    mockExecute.mockResolvedValue([[{ floor_monthly: 15028, row_count: 4 }], []]);
    const result = await evaluateMinimumWageFloor("Delhi", 12000);
    expect(result.status).toBe("below_floor");
    expect(result.provisional).toBe(true);
    expect(result.state_code).toBe("DL");
    expect(result.floor_monthly).toBe(15028);
    expect(result.shortfall).toBe(3028);
  });

  it("flags not_configured — not silently allowed — when the state has no active rows", async () => {
    mockExecute.mockResolvedValue([[{ floor_monthly: null, row_count: 0 }], []]);
    const result = await evaluateMinimumWageFloor("Gujarat", 20000);
    expect(result.status).toBe("not_configured");
    expect(result.provisional).toBe(true);
    expect(result.state_code).toBe("GJ");
    expect(result.floor_monthly).toBeNull();
  });

  it("flags state_unresolved without ever touching the database when the state cannot be normalised", async () => {
    const result = await evaluateMinimumWageFloor(null, 20000);
    expect(result.status).toBe("state_unresolved");
    expect(result.provisional).toBe(true);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("is not provisional when the amount clears the configured floor", async () => {
    mockExecute.mockResolvedValue([[{ floor_monthly: 15028, row_count: 4 }], []]);
    const result = await evaluateMinimumWageFloor("DL", 18000);
    expect(result.status).toBe("ok");
    expect(result.provisional).toBe(false);
    expect(result.floor_monthly).toBe(15028);
  });
});

describe("resolveStateForBranchName", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("resolves a single matching branch to its state", async () => {
    mockExecute.mockResolvedValue([[{ state: "Uttar Pradesh" }], []]);
    expect(await resolveStateForBranchName("Noida")).toBe("Uttar Pradesh");
  });

  it("refuses to guess when the name matches branches that disagree on state", async () => {
    // DISTINCT state for a name like "HEAD OFFICE" returning >1 row means the name is ambiguous.
    mockExecute.mockResolvedValue([[{ state: "Maharashtra" }, { state: "Uttar Pradesh" }], []]);
    expect(await resolveStateForBranchName("Head Office")).toBeNull();
  });

  it("returns null for an empty branch name without querying", async () => {
    expect(await resolveStateForBranchName("")).toBeNull();
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
