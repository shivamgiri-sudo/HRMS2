/**
 * Blood group must survive the whole way to the employee ID card.
 *
 * The card reads employees.blood_group straight through
 * (EmployeeIDCard.tsx <- GET /api/employees/:id/stat-card), so a break anywhere upstream
 * shows up as a blank field on a printed card and nowhere else. Two independent breaks
 * were live on 2026-09-03, and this file pins the repair of both:
 *
 *   1. The candidate-to-employee conversion collected blood group into
 *      candidate_onboarding_profile (15,263 real values) and then never named the column
 *      in its INSERT, so every employee created through the current flow started blank.
 *   2. `blood_group` was absent from updateEmployeeSchema, making the employee's own
 *      PATCH /me the ONLY writer anywhere in the backend. 448 of 1,028 active employees
 *      had no usable value and HR had no field to fill it in.
 *
 * Source-text inspection for the SQL, real parsing for the schema.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { updateEmployeeSchema } from "../employee.validation.js";
import { normalizeBloodGroup } from "../bloodGroup.util.js";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const ORCHESTRATOR = "src/modules/employees/employee-creation-orchestrator.service.ts";
const ROUTES = "src/modules/employees/employee.routes.ts";

describe("the conversion carries blood group from the onboarding profile", () => {
  const orchestrator = read(ORCHESTRATOR);

  it("selects blood_group from candidate_onboarding_profile", () => {
    // ats_candidate has no blood_group column — the joined profile is the only source.
    expect(orchestrator).toMatch(/p\.blood_group/);
  });

  it("names blood_group in the INSERT, not just in the SELECT", () => {
    const insert = orchestrator.slice(orchestrator.indexOf("INSERT INTO employees"));
    expect(
      insert.slice(0, insert.indexOf("VALUES")),
      "collected at onboarding and dropped at conversion is exactly the defect this fixes",
    ).toMatch(/\bblood_group\b/);
  });

  it("normalises on the way in rather than storing the raw onboarding text", () => {
    expect(orchestrator).toMatch(/normalizeBloodGroup\(candRow\?\.blood_group\)/);
  });
});

describe("HR can set blood group; neither writer can store junk", () => {
  it("updateEmployeeSchema accepts a real group", () => {
    const parsed = updateEmployeeSchema.safeParse({ bloodGroup: "O+" });
    expect(parsed.success, "HR had no way to set this at all before").toBe(true);
  });

  it("updateEmployeeSchema accepts null, so HR can clear a wrong value", () => {
    expect(updateEmployeeSchema.safeParse({ bloodGroup: null }).success).toBe(true);
  });

  it("updateEmployeeSchema rejects the legacy free-text shapes", () => {
    // These are all real values from the live column before normalisation.
    for (const bad of ["NA", "B+ve", "O +", "A", "SAMBHLI"]) {
      expect(updateEmployeeSchema.safeParse({ bloodGroup: bad }).success, bad).toBe(false);
    }
  });

  it("PATCH /me normalises blood_group instead of writing the body through", () => {
    // Self-service is the older of the two writers and the one that produced the junk.
    expect(read(ROUTES)).toMatch(/field === "blood_group"\s*\?\s*normalizeBloodGroup/);
  });

  it("the normaliser and the schema agree on what is valid", () => {
    for (const good of ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]) {
      expect(updateEmployeeSchema.safeParse({ bloodGroup: good }).success, good).toBe(true);
      expect(normalizeBloodGroup(good)).toBe(good);
    }
  });
});
