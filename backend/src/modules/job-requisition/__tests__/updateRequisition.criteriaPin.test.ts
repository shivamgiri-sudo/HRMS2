import { beforeEach, describe, expect, it, vi } from "vitest";

// Pin (S1, selection criteria): how the legacy PATCH writes the criteria columns, and that an approved
// or closed requisition still refuses them. S5 adds a separate criteria path; this one must not move.
const { dbExecute, current } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  current: { status: "draft" as string },
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../../workflow/workflow.service.js", () => ({ workflowService: {} }));

import { jobRequisitionService as svc } from "../job-requisition.service.js";

beforeEach(() => {
  dbExecute.mockReset();
  dbExecute.mockImplementation(async () => [[{ id: "r1", approval_status: current.status }], []]);
  vi.spyOn(svc, "getRequisition").mockImplementation(async () => ({ id: "r1", requisition_code: "REQ-1", approval_status: current.status } as never));
});
const updates = () => dbExecute.mock.calls.filter((c) => String(c[0]).startsWith("UPDATE job_requisition"));

const criteria = {
  experience_min_years: 1,
  experience_max_years: 3,
  education_requirement: "Graduate",
  skills_required: "Excel",
  job_description: "Inbound support",
  shift_requirement: "Night 9pm-6am",
  rotational_shift: false,
  night_shift_required: true,
  meta_screening_config: { auto_notify: true, x: "kept" },
};

describe("updateRequisition criteria columns (pin)", () => {
  it("draft: one UPDATE with the criteria columns in allowedFields order, booleans as 1/0, config as JSON", async () => {
    current.status = "draft";
    await svc.updateRequisition("r1", criteria as never, "u1");
    expect(updates()).toHaveLength(1);
    const [sql, params] = updates()[0];
    expect(sql).toBe(
      "UPDATE job_requisition SET experience_min_years = ?, experience_max_years = ?, education_requirement = ?, skills_required = ?, " +
        "job_description = ?, shift_requirement = ?, rotational_shift = ?, night_shift_required = ?, meta_screening_config = ?, updated_at = NOW() WHERE id = ?",
    );
    expect(params).toEqual([1, 3, "Graduate", "Excel", "Inbound support", "Night 9pm-6am", 0, 1, JSON.stringify({ auto_notify: true, x: "kept" }), "r1"]);
  });

  it("draft: null clears a criteria column", async () => {
    current.status = "draft";
    await svc.updateRequisition("r1", { education_requirement: null, shift_requirement: null } as never, "u1");
    expect(updates()[0][1]).toEqual([null, null, "r1"]);
  });

  it.each(["approved", "closed"])("%s: every criteria field still 409s and nothing is written", async (status) => {
    current.status = status;
    for (const [k, v] of Object.entries(criteria)) {
      await expect(svc.updateRequisition("r1", { [k]: v } as never, "u1")).rejects.toMatchObject({ statusCode: 409 });
    }
    expect(updates()).toHaveLength(0);
  });
});
