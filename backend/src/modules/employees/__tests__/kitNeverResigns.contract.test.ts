/**
 * A kit must never include a document that already holds a signature.
 *
 * Including one would send it for signing a second time — a second billed
 * provider call — and the resulting kit signature would be written over a valid
 * existing one.
 *
 * Checking `status` alone does not catch this. A real production row reads
 * status='draft_generated' while carrying signature_mode='aadhaar_esign_verified'
 * and a 79,582-byte signed artefact on disk. The columns disagree; only the
 * artefact is authoritative, so the signed-file check has to be present
 * independently of the status checks.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ASSEMBLY = fs.readFileSync(
  path.resolve(__dirname, "..", "joiningKitAssembly.service.ts"), "utf8");
const DISPATCH = fs.readFileSync(
  path.resolve(__dirname, "..", "joiningKitDispatch.service.ts"), "utf8");

describe("a kit never re-signs an already-signed document", () => {
  it("eligibility excludes documents holding a signed artefact", () => {
    expect(ASSEMBLY).toMatch(/NOT EXISTS\s*\(/);
    expect(ASSEMBLY).toMatch(/file_role IN \('signed', 'kit_signed'\)/);
  });

  it("the signed-file check ignores soft-deleted files", () => {
    // A superseded file must not keep a document out of the kit forever.
    expect(ASSEMBLY).toMatch(/sf\.deleted_at IS NULL/);
  });

  it("excludes terminal states on BOTH status columns", () => {
    // status and fill_status disagree on real rows, so one check is not enough.
    const occurrences = ASSEMBLY.match(/NOT IN \(\$\{TERMINAL_SQL\}\)/g) ?? [];
    expect(occurrences.length).toBe(2);
    expect(ASSEMBLY).toMatch(/COALESCE\(c\.status, ''\) NOT IN/);
    expect(ASSEMBLY).toMatch(/COALESCE\(c\.fill_status, ''\) NOT IN/);
  });

  it("binds the terminal statuses twice, matching the two placeholder groups", () => {
    // One spread would silently shift every later parameter.
    expect(ASSEMBLY).toContain("...TERMINAL_STATUSES, ...TERMINAL_STATUSES");
  });

  it("the terminal set matches the checklist helper", () => {
    for (const s of ["verified", "completed", "esign_completed", "signed_verified", "wet_signed_uploaded"]) {
      expect(ASSEMBLY).toContain(`"${s}"`);
    }
  });

  it("the hr_fill guard checks kit members, not a parallel document-code query", () => {
    // The parallel query caused this bug class twice: EPF forms blocking kits
    // they were not in, then already-signed documents doing the same.
    expect(DISPATCH).toContain("const members = await kitEligibleDocuments(employeeId);");
    expect(DISPATCH).toMatch(/WHERE id IN \(\$\{memberIds\.map/);
  });

  it("the guard cannot emit an empty IN () list", () => {
    expect(DISPATCH).toMatch(/memberIds\.length\s*\n?\s*\?/);
  });
});
