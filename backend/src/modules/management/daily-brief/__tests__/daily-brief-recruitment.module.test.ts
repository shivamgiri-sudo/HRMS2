import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../../db/mysql.js", () => ({
  db: { execute, query: execute, getConnection: vi.fn() },
}));

import { buildRecruitmentModule } from "../daily-brief-recruitment.module.js";

describe("daily-brief-recruitment: legacy-employee exclusion is actually applied", () => {
  beforeEach(() => {
    execute.mockReset();
    execute.mockResolvedValue([[{}]]);
  });

  it("every ats_candidate query includes the record_type = 'candidate' filter", async () => {
    await buildRecruitmentModule({ hrScope: true }, "2026-08-18");

    const atsCandidateCalls = execute.mock.calls.filter(([sql]: [string]) => sql.includes("ats_candidate"));
    expect(atsCandidateCalls.length).toBeGreaterThan(0);
    for (const [sql] of atsCandidateCalls) {
      expect(sql).toContain("record_type = 'candidate'");
    }
  });

  it("scopes by recruiter roster employee_id when a team scope is supplied", async () => {
    await buildRecruitmentModule({ teamEmployeeIds: ["e1", "e2"] }, "2026-08-18");

    const scoped = execute.mock.calls.filter(([sql]: [string]) => sql.includes("ats_recruiter_roster"));
    expect(scoped.length).toBeGreaterThan(0);
    for (const [, params] of scoped) {
      expect(params).toEqual(expect.arrayContaining(["e1", "e2"]));
    }
  });
});

describe("daily-brief-recruitment: scope gating", () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it("is NOT_APPLICABLE and runs no query when neither hrScope nor teamEmployeeIds is supplied", async () => {
    const result = await buildRecruitmentModule({}, "2026-08-18");

    expect(result.applicable).toBe(false);
    expect(result.candidatesMovedD1).toBeNull();
    expect(result.sourceHealth.every((h) => h.state === "NOT_APPLICABLE")).toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("daily-brief-recruitment: error handling", () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it("a thrown query error yields sourceHealth = ERROR, not a silent zero", async () => {
    execute.mockRejectedValue(new Error("ER_NO_SUCH_TABLE: simulated failure"));

    const result = await buildRecruitmentModule({ hrScope: true }, "2026-08-18");

    expect(result.candidatesMovedD1).toBeNull();
    expect(result.candidatesStuckBeyondThreshold).toBeNull();
    const stageHealth = result.sourceHealth.find((h) => h.module === "recruitment_stage_activity");
    expect(stageHealth?.state).toBe("ERROR");
    expect(stageHealth?.detail).toContain("simulated failure");
  });
});
