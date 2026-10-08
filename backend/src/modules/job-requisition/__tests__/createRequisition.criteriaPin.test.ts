import { beforeEach, describe, expect, it, vi } from "vitest";

// Pin (selection criteria S5, before the version hook): the INSERT the requisition form's create path issues for the
// criteria columns. The hook may add statements after it; this INSERT must not change.
const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../../workflow/workflow.service.js", () => ({ workflowService: {} }));

import { jobRequisitionService as svc } from "../job-requisition.service.js";

beforeEach(() => {
  dbExecute.mockReset();
  dbExecute.mockImplementation(async () => [[{ id: "r1", seq: 1, n: 0 }], []]);
});
const inserts = () => dbExecute.mock.calls.filter((c) => String(c[0]).trim().startsWith("INSERT INTO job_requisition ("));

describe("createRequisition criteria columns (pin)", () => {
  it("one INSERT with the criteria values in their columns", async () => {
    await svc.createRequisition({
      designation_name: "CSE", branch_name: "NOIDA-2", process_name: "Onfido", requested_headcount: 10,
      experience_min_years: 1, experience_max_years: 3, education_requirement: "Graduate", skills_required: "Excel", job_description: "KYC",
      shift_requirement: "Night", rotational_shift: false, night_shift_required: true,
      meta_target_age_min: 18, meta_target_age_max: 35, meta_target_locations: ["Noida"], meta_target_radius_km: 15,
      meta_screening_config: { auto_notify: true, x: 1 } as never,
    } as never, "u1", "User One");
    expect(inserts()).toHaveLength(1);
    const [sql, params] = inserts()[0];
    expect(String(sql).replace(/\s+/g, " ")).toMatchSnapshot();
    expect((params as unknown[]).slice(2)).toMatchSnapshot();
  });
});
