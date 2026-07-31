/**
 * Payroll HR Validation must not depend on a company entity that does not exist.
 *
 * The whole workflow was dead, in three places at once, all verified against
 * production on 2026-07-31 and all traceable to the same missing entity:
 *
 *   1. The form's Company selector was fed by GET /api/org/companies, which has
 *      no route:
 *        {"success":false,"message":"Route not found: GET /api/org/companies"}
 *      so the dropdown was permanently empty. It sat first in the page's
 *      Promise.all, so a rejection there took every other master list with it.
 *
 *   2. The field was nevertheless marked required in the UI and required in the
 *      schema (company_id: z.string().uuid()), so the form always posted "" and
 *      every submission was rejected:
 *        400 {"validation":"uuid","code":"invalid_string","path":["company_id"]}
 *      Client-side validation never checked it, so the user filled the whole
 *      form and got a server error naming a field they could not fill.
 *
 *   3. Reading a saved record joined company_master, which does not exist:
 *        GET /api/ats/payroll-hr/validation/:candidateId
 *        -> 500 "Table 'mas_hrms.company_master' doesn't exist"
 *
 * There is no company entity to restore: company_master is referenced nowhere
 * else in the backend and no migration creates it, and all three rows in
 * ats_payroll_hr_validation have company_id NULL. The column is kept — dropping
 * it would be a destructive migration for no gain — but nothing requires it.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "..");
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const readRepo = (p: string) => readFileSync(resolve(repoRoot, p), "utf8");

const routes = read("src/modules/ats/payroll-hr.routes.ts");
const service = read("src/modules/ats/payroll-hr.service.ts");
const page = readRepo("src/pages/NativePayrollHRValidation.tsx");

describe("payroll HR validation — submitting does not require a company", () => {
  it("company_id is optional in the schema", () => {
    expect(routes).toMatch(/company_id:\s*optionalUuid/);
  });

  it("is not a bare required uuid, which no caller could satisfy", () => {
    expect(routes).not.toMatch(/company_id:\s*z\.string\(\)\.uuid\(\)\s*,/);
  });

  it("optionalUuid turns the empty string the form sends into undefined", () => {
    // The page spreads formData wholesale, so company_id: "" is always posted.
    // A plain .optional() would still reject "" — the preprocess is the point.
    expect(routes).toMatch(/const optionalUuid = z\.preprocess\(/);
    expect(routes).toMatch(/value === ''\s*\|\|\s*value === null\s*\?\s*undefined\s*:\s*value/);
    expect(page).toContain("...formData");
  });

  it("the insert stores NULL rather than an empty string", () => {
    expect(service).toContain("input.company_id ?? null");
  });
});

describe("payroll HR validation — reading a record does not join a missing table", () => {
  it("no join to company_master", () => {
    expect(service).not.toMatch(/JOIN\s+company_master/i);
  });

  it("and no column selected from it", () => {
    expect(service).not.toMatch(/comp\.company_name/);
  });

  it("company_master appears only in commentary, never in executable code", () => {
    // The comments explaining why the join is gone are worth keeping, so strip
    // comment lines before asserting. If someone reintroduces a real reference,
    // this fails before it can 500 in production again.
    const codeOnly = (source: string) =>
      source
        .split("\n")
        .filter((line) => !/^\s*(--|\/\/|\*|\/\*)/.test(line))
        .join("\n");

    expect(codeOnly(service)).not.toContain("company_master");
    expect(codeOnly(routes)).not.toContain("company_master");
  });
});

describe("payroll HR validation — the page does not offer an unfillable field", () => {
  it("does not call the routeless /api/org/companies", () => {
    const calls = [...page.matchAll(/hrmsApi\.get\('([^']+)'\)/g)].map((m) => m[1]);
    expect(calls).not.toContain("/api/org/companies");
  });

  it("renders no Company selector", () => {
    expect(page).not.toMatch(/Company \*/);
    expect(page).not.toMatch(/Select Company/);
  });

  it("still loads the master lists that do have routes", () => {
    for (const path of [
      "/api/org/designations",
      "/api/org/departments",
      "/api/org/processes",
      "/api/org/cost-centres",
    ]) {
      expect(page).toContain(path);
    }
  });
});
