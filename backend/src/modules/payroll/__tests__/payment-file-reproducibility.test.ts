/**
 * A generated bank payment file must be recorded, and a regeneration must be checkable against
 * what was already submitted.
 *
 * Before this, nothing anywhere recorded what a payment file contained — no name, no hash, no
 * total — so a regenerated NEFT export could not be shown to be identical to the one sent to the
 * bank, and a disputed duplicate payment had no evidence on either side. The readiness gate
 * reported PAYFILE_GENERATION_NOT_REPRODUCIBLE as a permanent SOURCE_MISSING for exactly that.
 *
 * The condition worth failing on is NOT "generated twice" — regenerating is legitimate. It is
 * "generated twice AND the content changed", which means two people hold different sets of
 * payment instructions for one run. Distinct hashes are that hazard's fingerprint.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

const ROUTES = stripComments(read("src/modules/payroll/payroll.routes.ts"));
const SERVICE = stripComments(read("src/modules/payroll/payroll-readiness-categories.service.ts"));
const MIGRATION = stripComments(read("sql/1215_payment_file_reproducibility.sql"));
const MANIFEST = read("src/db/runPendingMigrations.ts");

describe("the export records what it produced, before handing it over", () => {
  it("hashes the exact bytes that are sent", () => {
    // Hashing anything other than the sent payload would make the record unverifiable.
    expect(ROUTES).toMatch(/createHash\("sha256"\)\.update\(csv, "utf8"\)\.digest\("hex"\)/);
  });

  it("writes the record before res.send, not after", () => {
    const iInsert = ROUTES.indexOf("INSERT INTO payroll_register_export_log");
    const iSend = ROUTES.indexOf("res.send(csv)");
    expect(iInsert).toBeGreaterThan(-1);
    expect(iSend).toBeGreaterThan(iInsert);
  });

  it("records name, hash, total and what was excluded", () => {
    const stmt = ROUTES.slice(ROUTES.indexOf("INSERT INTO payroll_register_export_log"));
    for (const col of ["file_name", "content_sha256", "total_amount", "excluded_count", "excluded_amount"]) {
      expect(stmt.slice(0, 600)).toContain(col);
    }
  });

  it("recording an incomplete picture would be worse than none, so exclusions are recorded too", () => {
    // A log of only what was paid makes an under-inclusive file indistinguishable from a
    // complete one — which is the very confusion the export fix was about.
    const stmt = ROUTES.slice(ROUTES.indexOf("INSERT INTO payroll_register_export_log"), ROUTES.indexOf("res.setHeader(\"X-Payroll-File-Sha256\""));
    expect(stmt).toContain("unpayable.length");
    expect(stmt).toContain("excludedTotal");
  });

  it("is NOT wrapped in a try/catch — an untracked payment file must not be handed out", () => {
    const from = ROUTES.indexOf("INSERT INTO payroll_register_export_log");
    const window = ROUTES.slice(Math.max(0, from - 400), from);
    expect(window).not.toMatch(/try\s*\{[^}]*$/);
  });

  it("returns the hash to the caller so they can verify their copy", () => {
    expect(ROUTES).toContain("X-Payroll-File-Sha256");
  });

  it("reuses the existing export log rather than creating a rival table", () => {
    // A second payment-file log beside payroll_register_export_log would be the
    // two-rival-systems mistake this audit keeps finding elsewhere.
    expect(ROUTES).toContain("payroll_register_export_log");
    expect(ROUTES).not.toMatch(/INSERT INTO (payroll_payment_file|payment_file_history|payroll_bank_file_log)\b/);
  });
});

/**
 * Just this check's body — bounded at the NEXT runCheck, not at end-of-file.
 *
 * An earlier version of these tests sliced from the check's code to the end of the module, so an
 * assertion like /notApplicable\(/ was satisfied by some other check further down and could never
 * fail. A mutation run proved it: swapping this check's notApplicable for pass left all 17 green.
 * Bounding the slice is what makes the assertions actually about this check.
 */
const REPRO_CHECK = (() => {
  const start = SERVICE.indexOf('code: "PAYFILE_GENERATION_NOT_REPRODUCIBLE"');
  expect(start, "reproducibility check not found").toBeGreaterThan(-1);
  const next = SERVICE.indexOf("runCheck({", start + 10);
  return SERVICE.slice(start, next > start ? next : SERVICE.length);
})();

describe("the readiness gate is now a real check, not a permanent SOURCE_MISSING", () => {
  it("fails only when one run has two generations with DIFFERENT hashes", () => {
    expect(SERVICE).toContain("COUNT(DISTINCT content_sha256)");
    expect(SERVICE).toMatch(/HAVING COUNT\(DISTINCT content_sha256\) > 1/);
  });

  it("does not fail merely because a file was regenerated identically", () => {
    // Regeneration is legitimate; only divergence is the hazard.
    expect(REPRO_CHECK).toMatch(/every version hashes identically/);
  });

  it("reports NOT_APPLICABLE, not PASS, when no file has been generated yet", () => {
    // "Nothing to reproduce" is not the same as "verified reproducible".
    expect(REPRO_CHECK).toMatch(/notApplicable\(/);
    expect(REPRO_CHECK).toMatch(/No bank payment file has been generated for this run yet/);
  });

  it("degrades to SOURCE_MISSING — never CHECK_ERROR — while migration 1215 is unapplied", () => {
    // Verified live: the column does not exist yet, and the dry run reported SOURCE_MISSING with
    // checkErrors=0 rather than throwing.
    expect(REPRO_CHECK).toMatch(/columnExists\("payroll_register_export_log", "content_sha256"\)/);
    expect(REPRO_CHECK).toContain("1215_payment_file_reproducibility.sql");
  });
});

describe("migration 1215", () => {
  it("extends the existing table instead of adding one", () => {
    expect(MIGRATION).not.toMatch(/CREATE TABLE/i);
    expect(MIGRATION).toMatch(/ALTER TABLE payroll_register_export_log/);
  });

  it("adds every column NULLable, so the existing compliance writer keeps working", () => {
    for (const col of ["file_name", "content_sha256", "total_amount", "excluded_count", "excluded_amount"]) {
      expect(MIGRATION).toMatch(new RegExp(`ADD COLUMN ${col} [A-Z0-9(),]+ NULL`, "i"));
    }
    expect(MIGRATION).not.toMatch(/ADD COLUMN \w+ [A-Z0-9(),]+ NOT NULL/i);
  });

  it("does not reuse the syntax that silently failed on 398/402/404", () => {
    expect(MIGRATION).not.toMatch(/ADD COLUMN IF NOT EXISTS/i);
    expect(MIGRATION).not.toMatch(/CREATE INDEX IF NOT EXISTS/i);
  });

  it("guards every statement, so re-running is a no-op", () => {
    const guards = (MIGRATION.match(/PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;/g) ?? []).length;
    expect(guards).toBe(6);
  });

  it("is registered, or the runner never executes it", () => {
    expect(MANIFEST).toContain('"1215_payment_file_reproducibility.sql"');
  });
});

describe("the hash is a real integrity check, not a formality", () => {
  it("distinguishes files that differ by a single rupee", () => {
    const a = "Sr No,Code,Amount\n1,MAS001,1000.00\nTOTAL,,1000.00";
    const b = "Sr No,Code,Amount\n1,MAS001,1000.01\nTOTAL,,1000.01";
    const h = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
    expect(h(a)).not.toBe(h(b));
    expect(h(a)).toBe(h(a));
    expect(h(a)).toHaveLength(64); // matches CHAR(64) in the migration
  });
});
