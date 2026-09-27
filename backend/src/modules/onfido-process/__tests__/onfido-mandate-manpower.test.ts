import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbExecute, lmsQuery } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  lmsQuery: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../../../db/lms-mysql.js", () => ({ lmsDb: { query: lmsQuery } }));

import { getOnfidoMandateManpower } from "../onfido-mandate-manpower.service";

describe("getOnfidoMandateManpower", () => {
  beforeEach(() => {
    dbExecute.mockReset();
    lmsQuery.mockReset();
  });

  it("approved HC is the mandate, active HC excludes anyone in an active NHT batch", async () => {
    dbExecute
      .mockResolvedValueOnce([[{ current_mandate: 201, buffer_pct: 10 }]]) // mandate config
      .mockResolvedValueOnce([
        [
          { id: "e1", employee_code: "MAS001" },
          { id: "e2", employee_code: "MAS002" },
          { id: "e3", employee_code: "MAS003" },
        ],
      ]); // active employees
    lmsQuery.mockResolvedValueOnce([[{ employee_code: "MAS002" }]]); // MAS002 is in an active NHT batch

    const result = await getOnfidoMandateManpower();

    expect(result).toEqual({
      costCenterCode: "BSS/BO/NOIDA-2/576",
      approvedHc: 201,
      activeHc: 2,
      inTrainingHc: 1,
      bufferPct: 10,
    });
  });

  it("reports no mandate row as null approved HC rather than zero", async () => {
    dbExecute.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[]]);
    lmsQuery.mockResolvedValueOnce([[]]);

    const result = await getOnfidoMandateManpower();

    expect(result.approvedHc).toBeNull();
    expect(result.bufferPct).toBeNull();
    expect(result.activeHc).toBe(0);
  });

  it("an LMS outage never breaks the count -- treats everyone as not-in-training", async () => {
    dbExecute
      .mockResolvedValueOnce([[{ current_mandate: 50, buffer_pct: 5 }]])
      .mockResolvedValueOnce([[{ id: "e1", employee_code: "MAS001" }]]);
    lmsQuery.mockRejectedValueOnce(new Error("LMS DB unreachable"));

    const result = await getOnfidoMandateManpower();

    expect(result.activeHc).toBe(1);
    expect(result.inTrainingHc).toBe(0);
  });
});
