import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Legacy (db_bill-migrated) employees get a placeholder checklist row from
// createLegacyJoiningChecklists.ts, which satisfies this query's checklist
// EXISTS clause and made them show up as "pending" in the tracker even though
// their documents were verified offline pre-HRMS. Both halves of that fix must
// stay in place: the tracker excludes legacy_emp_id IS NOT NULL employees
// outright, and the checklist-creation script keeps employees.joining_document_status
// internally consistent by calling the canonical recalculation writer.
const trackerService = readFileSync(
  resolve(process.cwd(), "src/modules/ats/ats.joiningDocumentsTracker.service.ts"),
  "utf8"
);
const legacyChecklistScript = readFileSync(
  resolve(process.cwd(), "src/modules/migration/createLegacyJoiningChecklists.ts"),
  "utf8"
);

describe("Joining documents tracker — legacy employee exclusion", () => {
  it("excludes legacy_emp_id employees from the tracker query", () => {
    expect(trackerService).toContain("e.legacy_emp_id IS NULL");
  });

  it("keeps joining_document_status in sync when creating legacy placeholder checklists", () => {
    expect(legacyChecklistScript).toContain("recalculateDocumentProgress");
  });
});
