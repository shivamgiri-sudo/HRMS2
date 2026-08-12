import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * The last four files in the write-column ratchet, each writing columns that do
 * not exist.
 *
 *   lms-integration/lms-employee-mapper.ts upserted lms_employee_mapping naming
 *   lms_employee_id, hrms_employee_id, hrms_mobile, hrms_personal_email and
 *   hrms_official_email. The table has lms_learner_id, employee_id and a single
 *   email column, and no mobile at all. This module is orphaned - nothing in the
 *   tree imports it, the live mapper is modules/lms/lms-employee-mapper.ts - but
 *   the statement is wrong either way.
 *
 *   migration/createLegacyJoiningChecklists.ts wrote template_name and
 *   description to employee_joining_document_template, whose columns are
 *   document_name and document_code with no description, and verification_type,
 *   is_required and notes to employee_joining_document_checklist, whose columns
 *   are verification_status, mandatory and hr_remarks. Both inserts also omitted
 *   NOT NULL columns entirely - document_code and document_category on the
 *   template; document_code, owner_type and action_type on the checklist - so
 *   neither could have worked under any spelling. It is reachable through
 *   migration.routes.ts, and its per-employee catch recorded every failure as a
 *   silent skip.
 *
 *   bulk-upload/roster-assignment-bulk.service.ts wrote notes, created_by and
 *   updated_by to wfm_roster_assignment, which has none of them, so every bulk
 *   roster upload failed outright.
 *
 *   both bulk services closed a batch with imported_by and imported_at on
 *   upload_batch. Neither exists, so a finished upload was never marked
 *   imported and imported_rows was never set.
 *
 * Verified against production 8.0.42 on TEMPORARY copies of all five tables: 11
 * checks, every old statement failing with ER_BAD_FIELD_ERROR and every new one
 * succeeding and reading back correctly.
 */
const ROOT = path.resolve(__dirname, "../..");

/** Old names appear in these files' own comments; match live code only. */
function liveCode(rel: string): string {
  return fs
    .readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
}

describe("lms_employee_mapping upsert", () => {
  const FILE = "modules/lms-integration/lms-employee-mapper.ts";

  it("names no column the table lacks", () => {
    const code = liveCode(FILE);
    for (const col of ["hrms_mobile", "hrms_personal_email", "hrms_official_email"]) {
      expect(code).not.toContain(col);
    }
    // final_hrms_employee_id is a real column on lms_mapping_audit, so this is
    // scoped to the mapping statement rather than matched as a substring
    expect(code).not.toMatch(/INSERT INTO lms_employee_mapping[\s\S]{0,200}[^_]hrms_employee_id/);
    // lms_employee_id is a real column on lms_mapping_audit, so it is only wrong
    // in the mapping statement
    expect(code).not.toMatch(/INSERT INTO lms_employee_mapping[\s\S]{0,200}lms_employee_id/);
  });

  it("writes the columns that do exist", () => {
    const code = liveCode(FILE);
    expect(code).toMatch(/INSERT INTO lms_employee_mapping[\s\S]{0,200}employee_id, lms_learner_id/);
    expect(code).toMatch(/INSERT INTO lms_employee_mapping[\s\S]{0,200}\bemail\b/);
  });

  it("keeps the audit write, whose table and columns are real", () => {
    expect(liveCode(FILE)).toMatch(/INSERT INTO lms_mapping_audit/);
  });
});

describe("legacy joining checklist migration", () => {
  const FILE = "modules/migration/createLegacyJoiningChecklists.ts";

  it("uses document_name and document_code on the template", () => {
    const code = liveCode(FILE);
    expect(code).not.toContain("template_name");
    expect(code).not.toMatch(/INSERT INTO employee_joining_document_template[\s\S]{0,200}description/);
    expect(code).toMatch(/INSERT INTO employee_joining_document_template[\s\S]{0,200}document_code, document_name, document_category/);
  });

  it("uses mandatory, verification_status and hr_remarks on the checklist", () => {
    const code = liveCode(FILE);
    for (const col of ["verification_type", "is_required"]) expect(code).not.toContain(col);
    expect(code).toMatch(/INSERT INTO employee_joining_document_checklist[\s\S]{0,320}mandatory/);
    expect(code).toMatch(/INSERT INTO employee_joining_document_checklist[\s\S]{0,320}verification_status, hr_remarks/);
  });

  it("supplies the NOT NULL columns it used to omit", () => {
    const code = liveCode(FILE);
    expect(code).toMatch(/INSERT INTO employee_joining_document_checklist[\s\S]{0,320}owner_type, action_type/);
  });
});

describe("bulk upload writes", () => {
  const ROSTER = "modules/bulk-upload/roster-assignment-bulk.service.ts";
  const SHIFT = "modules/bulk-upload/shift-roster-bulk.service.ts";

  it("roster assignments carry no created_by, updated_by or notes column", () => {
    const code = liveCode(ROSTER);
    expect(code).not.toMatch(/INSERT INTO wfm_roster_assignment[\s\S]{0,400}created_by/);
    expect(code).not.toMatch(/INSERT INTO wfm_roster_assignment[\s\S]{0,400}\bnotes\b/);
  });

  it("the uploader's note is kept in system_decision_reason rather than dropped", () => {
    expect(liveCode(ROSTER)).toMatch(/system_decision_reason/);
  });

  it("both services close a batch without imported_by or imported_at", () => {
    for (const f of [ROSTER, SHIFT]) {
      const code = liveCode(f);
      expect(code).not.toContain("imported_by");
      expect(code).not.toContain("imported_at");
      expect(code).toMatch(/UPDATE upload_batch SET batch_status=\?, imported_rows=\?, updated_at=NOW\(\)/);
    }
  });
});
