import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("../src/db/mysql.js", () => ({
  db: { execute },
}));

vi.mock("../src/modules/ats/ats.service.js", () => ({
  atsService: {
    getCandidate: vi.fn().mockResolvedValue({
      id: "cand-1",
      active_status: 1,
      current_stage: "Selected",
    }),
  },
}));

import { convertCandidateToEmployee } from "../src/modules/ats/ats.convert.service.js";

describe("convertCandidateToEmployee", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is idempotent when offer approval already created the employee", async () => {
    execute.mockResolvedValueOnce([[{
      employee_id: "emp-1",
      employee_code: "MAS47815",
      request_status: "approved",
    }]]);

    await expect(convertCandidateToEmployee("cand-1", "user-1")).resolves.toEqual({
      employee_id: "emp-1",
      employee_code: "MAS47815",
    });
  });

  it("does not create a parallel employee before offer approval", async () => {
    execute.mockResolvedValueOnce([[{
      employee_id: null,
      employee_code: null,
      request_status: "profile_submitted",
    }]]);

    await expect(convertCandidateToEmployee("cand-1", "user-1")).rejects.toMatchObject({
      statusCode: 409,
      code: "OFFER_APPROVAL_REQUIRED",
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
