/**
 * An incentive batch must actually be creatable, and the BI tile that counts unclaimed incentive
 * must read columns that exist.
 *
 * createBatch() INSERTs into incentive_upload_batch (id, incentive_id, pay_month, uploaded_by,
 * remarks). `remarks` is not a column on that table — verified live 2026-08-14 — and the INSERT
 * is not wrapped in a catch, so POST /api/incentives/batches raises ER_BAD_FIELD_ERROR and no
 * batch can be created by any caller.
 *
 * That is very likely why the whole incentive pipeline reads as built-but-unused: all four
 * incentive tables hold 0 rows and salary_prep_line.incentive_total is 0.00 across all 80,469
 * payroll lines ever written, while db_bill paid Rs 12,91,754 of incentive in June 2026 alone.
 * The pipeline was not bypassed by preference — its front door throws.
 *
 * Separately, bi.service.ts's unclaimed-incentive tile queried two columns that do not exist
 * (batch_status, and disbursed_at which exists nowhere on the table) inside a .catch that
 * returned 0 — so the tile has always shown 0, which is indistinguishable from "nothing
 * unclaimed".
 *
 * Both were found by a PREPARE-based sweep of every SQL literal in backend/src against the live
 * schema — the only technique that catches a column existing on some table but not the one being
 * queried.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

const INCENTIVES = stripComments(read("src/modules/incentives/incentives.service.ts"));
const BI = stripComments(read("src/modules/business-intelligence/bi.service.ts"));
const MIGRATION = stripComments(read("sql/1216_incentive_upload_batch_remarks.sql"));
const MANIFEST = read("src/db/runPendingMigrations.ts");

describe("createBatch can insert every column it names", () => {
  it("still writes remarks, rather than silently discarding a caller's note", () => {
    // Dropping it from the INSERT would have been the smaller diff and the worse fix: the API
    // accepts remarks, the signature declares it, and getBatchById returns it via SELECT iub.*.
    expect(INCENTIVES).toMatch(/INSERT INTO incentive_upload_batch \(id, incentive_id, pay_month, uploaded_by, remarks\)/);
    expect(INCENTIVES).toMatch(/remarks\?: string \| null/);
  });

  it("has a migration creating the column that INSERT depends on", () => {
    expect(MIGRATION).toMatch(/ALTER TABLE incentive_upload_batch ADD COLUMN remarks TEXT NULL/);
  });

  it("adds it NULLable, so no existing row changes meaning", () => {
    expect(MIGRATION).not.toMatch(/remarks TEXT NOT NULL/);
    expect(MIGRATION).not.toMatch(/remarks TEXT[^,)]*DEFAULT/i);
  });

  it("does not reuse the syntax that silently failed on 398/402/404", () => {
    expect(MIGRATION).not.toMatch(/ADD COLUMN IF NOT EXISTS/i);
  });

  it("is guarded, so re-running is a no-op", () => {
    expect(MIGRATION).toContain("information_schema.COLUMNS");
    expect((MIGRATION.match(/PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;/g) ?? []).length).toBe(1);
  });

  it("is registered, or the runner never executes it", () => {
    expect(MANIFEST).toContain('"1216_incentive_upload_batch_remarks.sql"');
  });
});

describe("the unclaimed-incentive tile reads real columns", () => {
  it("no longer queries batch_status, which is not a column", () => {
    expect(BI).not.toMatch(/batch_status/);
  });

  it("no longer queries disbursed_at, which exists nowhere on the table", () => {
    const stmt = BI.slice(BI.indexOf("AS unclaimed FROM incentive_upload_batch") - 120, BI.indexOf("AS unclaimed FROM incentive_upload_batch") + 200);
    expect(stmt).not.toMatch(/disbursed_at/);
  });

  it("treats 'approved' as the unclaimed state", () => {
    // applyToRun moves a consumed batch to 'applied', so a batch still at 'approved' is money
    // authorised and not yet taken into a payroll run.
    expect(BI).toMatch(/FROM incentive_upload_batch WHERE status = 'approved'/);
  });

  it("still degrades to 0 rather than breaking the dashboard, but logs instead of swallowing", () => {
    // A silent catch is how the wrong column names survived; the tile may still fail soft, but
    // never invisibly.
    // Bounded at the NEXT db.execute, not by a fixed character count: an unbounded window runs
    // into the following statement's own .catch(() => ...) and the assertion then describes a
    // different tile entirely. (Caught by this test failing on exactly that.)
    const from = BI.indexOf("AS unclaimed FROM incentive_upload_batch");
    const next = BI.indexOf("db.execute", from);
    const block = BI.slice(from, next > from ? next : from + 400);
    expect(block).toMatch(/\[bi\] unclaimed-incentive tile failed/);
    expect(block).not.toMatch(/\.catch\(\(\) =>/);
  });
});
