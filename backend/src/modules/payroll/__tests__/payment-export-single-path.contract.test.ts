import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Section 6 — no reachable payment export may bypass canonical readiness.
 *
 * There were two exporters that could produce a real bank payment file, and they enforced
 * different things. The canonical one (payroll.routes.ts /runs/:id/neft-export) requires a closed
 * run, validation, FINANCE SIGN-OFF, reconciliation of its payable population against bank
 * readiness, and records a SHA-256 of the exact bytes handed over plus an export-log row.
 *
 * disbursal.routes.ts /runs/:runId/bank-export required none of that. It checked the run existed
 * and that the account and IFSC parsed, then wrote a bank file — no sign-off, no reconciliation,
 * no hash, no scope check. Two payment paths with different gates is the defect; the file formats
 * were never the point.
 *
 * Retired rather than re-gated because it had never produced a file: salary_run_disbursal, the
 * table it INNER JOINs, holds 0 rows across 0 runs (verified live 2026-08-17). Building a second
 * fully-gated exporter to preserve output nobody has ever generated would create a second thing
 * to keep in step with the first — which is how they diverged in the first place.
 *
 * This test exists so a future change cannot quietly restore a second money path.
 */
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const DISBURSAL = read("src/modules/payroll/disbursal.routes.ts");
const CANONICAL = read("src/modules/payroll/payroll.routes.ts");

describe("only one exporter may produce a payment file", () => {
  it("the secondary bank-export no longer builds a file", () => {
    const code = stripComments(DISBURSAL);
    // File-wide: nothing in this router may stream a download any more. These two headers are what
    // turn a response into a payment file, and the surviving record/upload routes never set them.
    // (salary_run_disbursal itself is NOT asserted away — the disbursal record and upload routes
    // legitimately read and write that table; only file generation was withdrawn.)
    expect(code).not.toMatch(/text\/csv/i);
    expect(code).not.toMatch(/Content-Disposition/i);

    // And specifically: the bank-export handler must not have been left in place below the
    // retirement. Express matches the first registration, so a leftover duplicate would be dead
    // today and live again the moment someone deleted the stub above it.
    const registrations = code.match(/"\/runs\/:runId\/bank-export"/g) ?? [];
    expect(registrations).toHaveLength(1);
  });

  it("it answers with a clear retirement, not a silent 404", () => {
    // It always 404'd because its source table is empty, which reads as "no data for this run"
    // rather than "this path is withdrawn". A caller must be told where the real one is.
    expect(DISBURSAL).toContain("BANK_EXPORT_RETIRED");
    expect(DISBURSAL).toContain("410");
    expect(DISBURSAL).toContain("neft-export");
  });

  it("the disbursal record and upload routes are preserved", () => {
    // Section 6 requires historical disbursal viewing/upload to survive the retirement.
    expect(DISBURSAL).toContain('"/runs/:runId/disbursal"');
    expect(DISBURSAL).toContain('"/runs/:runId/disbursal-upload"');
  });
});

describe("the surviving exporter still carries every gate", () => {
  const block = (() => {
    const at = CANONICAL.indexOf('"/runs/:id/neft-export"');
    return CANONICAL.slice(at, CANONICAL.indexOf("router.", at + 50));
  })();
  // Ordering is asserted on code only. The export-log table is named in an explanatory comment
  // above the write, which would otherwise read as "logged before hashing".
  const blockCode = stripComments(block);

  it("requires org-wide scope, so a branch-scoped caller cannot pull a payment file", () => {
    expect(block).toContain("hasOrgWideScope");
  });

  it("requires a closed, validated run", () => {
    expect(block).toContain("isRunClosed");
    expect(block).toContain("validation_status");
  });

  it("requires Finance sign-off", () => {
    expect(block).toContain("finance_approved_by");
    expect(block).toContain("FINANCE_SIGNOFF_MISSING");
  });

  it("reconciles its payable population against bank readiness before releasing anything", () => {
    expect(block).toContain("buildBankReadinessReport");
    expect(block).toContain("PAYMENT_POPULATION_MISMATCH");
  });

  it("records the content hash and an export-log row BEFORE handing the file over", () => {
    const hashAt = blockCode.indexOf("createHash");
    const logAt = blockCode.indexOf("payroll_register_export_log");
    const sendAt = blockCode.search(/res\.(send|end)\(/);
    expect(hashAt).toBeGreaterThan(-1);
    expect(logAt).toBeGreaterThan(hashAt);
    if (sendAt > -1) expect(logAt).toBeLessThan(sendAt);
  });
});
