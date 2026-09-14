import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DOCUMENT_HELD_EXPR } from "../executors/identity.executor.js";
import { EXECUTOR_MAP } from "../executors/index.js";
import { REPORT_CATALOG } from "../report-catalog.js";

/**
 * missing-documents-report served the PENDING_DATA_BUILDER stub, then was marked `blocked`
 * because "no org-wide list of required documents exists". The second verdict was wrong:
 * document_type_master really is absent from mas_hrms, but onboarding_document_master is
 * present, active and populated, and is exactly that list. The earlier note checked
 * employee_joining_document_checklist (92 rows, 11 employees — correctly rejected) and stopped.
 *
 * Verified against live on 2026-08-09: 6 unconditionally mandatory requirements, 6,445 missing
 * rows across all 1,117 active employees. Per-document counts reconcile with the independent
 * per-mapping measurement — e.g. Photo shows 1,098 missing against exactly 19 employees holding
 * an avatar_url/photo_url.
 *
 * The risk this test exists to hold down is specific. The requirement list is DATA and the
 * storage mapping is CODE, so seeding a new mandatory row into onboarding_document_master
 * changes what the report demands without changing any code that knows where to look for it.
 * The executor deliberately treats an unmapped requirement as HELD rather than missing, so that
 * mistake cannot mark the entire workforce non-compliant — but silence is its own failure, and
 * this pins the mapping so the omission is visible.
 */

const ROOT = process.cwd();
const src = (p: string) => readFileSync(resolve(ROOT, "src/modules/reporting", p), "utf8");

/**
 * The mandatory, non-conditional rows of onboarding_document_master, read live 2026-08-09.
 * Hard-coded because the suite runs against a mocked db; if the master gains a mandatory row
 * this list and DOCUMENT_HELD_EXPR must both grow, which is the point.
 */
const MANDATORY_FROM_MASTER = [
  "aadhaar", "pan", "address_proof", "education_proof", "photo", "resume",
] as const;

describe("missing-documents-report", () => {
  it("is served by an executor rather than the pending-builder stub", () => {
    expect(Object.keys(EXECUTOR_MAP)).toContain("missing-documents-report");
    expect(EXECUTOR_MAP["missing-documents-report"]).toBeTypeOf("function");
  });

  it("is no longer advertised as blocked", () => {
    const entry = REPORT_CATALOG.find(r => r.code === "missing-documents-report");
    expect(entry, "the catalogue entry must survive — it is what the grid draws").toBeDefined();
    expect(entry!.availabilityStatus).not.toBe("blocked");
  });

  it("every mandatory requirement in the master has a storage mapping", () => {
    const unmapped = MANDATORY_FROM_MASTER.filter(d => !DOCUMENT_HELD_EXPR[d]);
    expect(
      unmapped,
      "these are mandatory per onboarding_document_master but the executor does not know where a " +
        "satisfied copy is recorded, so it will silently treat them as held:\n" + unmapped.join("\n"),
    ).toEqual([]);
  });

  it("photo resolves against the employee master, not employee_documents", () => {
    // Matching photos in employee_documents finds 1 employee org-wide — there is no photo
    // doc_category. Sourcing it there would report 1,116 of 1,117 falsely missing.
    expect(DOCUMENT_HELD_EXPR.photo).toMatch(/photo_url|avatar_url/);
    expect(DOCUMENT_HELD_EXPR.photo).not.toMatch(/held\./);
  });

  it("declares the three mandatory identity columns the audit requires", () => {
    const entry = REPORT_CATALOG.find(r => r.code === "missing-documents-report")!;
    const keys = entry.columns.map(c => c.key);
    for (const required of ["employee_code", "cost_centre_code", "cost_centre_name", "process_name"]) {
      expect(keys, `${required} is mandatory on every employee-grain report`).toContain(required);
    }
  });

  it("names onboarding_document_master as a source table", () => {
    const entry = REPORT_CATALOG.find(r => r.code === "missing-documents-report")!;
    expect(entry.sourceTables).toContain("onboarding_document_master");
  });

  it("only unconditional requirements are demanded", () => {
    // condition_rule holds predicates like {"required_when":"candidate_experienced"} that this
    // report cannot evaluate. Demanding them would manufacture false non-compliance.
    const body = src("executors/identity.executor.ts");
    expect(body).toMatch(/conditional_flag\s*=\s*0/);
    expect(body).toMatch(/mandatory_flag\s*=\s*1/);
    expect(body).toMatch(/active_flag\s*=\s*1/);
  });

  it("an unmapped requirement is treated as held, never as missing", () => {
    const body = src("executors/identity.executor.ts");
    // The ELSE arm of the CASE, and the ?? fallback, must both resolve to 1 (held).
    expect(body).toMatch(/ELSE 1 END/);
    expect(body).toMatch(/DOCUMENT_HELD_EXPR\[r\.name\] \?\? "1"/);
  });
});
