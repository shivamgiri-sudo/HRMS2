/**
 * The db_bill statutory sync must not create NEW unprotected plaintext PAN.
 *
 * syncEmployeeStatutoryData (reachable in production via
 * POST /api/migration/sync-statutory-from-db-bill, admin/super_admin) fills
 * employees.pan_number wherever it is empty. employees is the one table whose ciphertext
 * IS fully backfilled — 23,341 rows, all key version 1, measured live 2026-08-11 — so a
 * writer that fills only the plaintext column silently degrades that coverage every time
 * it runs. This is the same defect the two legacy sync handlers were fixed for; this route
 * was missed because it is a migration module rather than a worker.
 *
 * The plaintext write deliberately STAYS. The duplicate-employee guard in
 * employee-creation-orchestrator.service.ts still reads e.pan_number by equality, so
 * removing it would break that guard. Order is backfill -> migrate readers -> retire
 * plaintext; this is the stop-the-rot step only.
 *
 * Structural rather than behavioural: the function opens a legacy pool, matches on
 * EmpCode across two databases and writes a dynamically built UPDATE, so standing it up
 * proves less about this property than reading it does — the same reasoning the two
 * sibling contract tests in this directory give.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(__dirname, "../syncStatutoryDataFromDbBill.ts"), "utf8");
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** The block that decides and writes the PAN, isolated from the other statutory fields. */
function panBlock(): string {
  const at = code.indexOf("updateData.pan_number = pan");
  expect(at, "PAN write not found — has the sync been restructured?").toBeGreaterThan(-1);
  // Back up to the enclosing `if`, forward far enough to cover the ciphertext writes.
  const start = code.lastIndexOf("if (", at);
  return code.slice(start, at + 500);
}

describe("db_bill statutory sync — PAN ciphertext dual-write", () => {
  it("writes pan_number_encrypted alongside the plaintext", () => {
    expect(panBlock()).toContain("updateData.pan_number_encrypted");
  });

  it("writes pan_blind_index alongside the plaintext", () => {
    // employees.pan_blind_index is populated on 0 of 53,449 rows and is the missing half
    // of the lookup path that has to exist before the plaintext can ever be retired.
    expect(panBlock()).toContain("updateData.pan_blind_index");
  });

  it("routes both through the shared guarded helpers, never the raw crypto", () => {
    // encryptField / blindIndex called directly would bypass the dev-key refusals and
    // write ciphertext production can never decrypt, with nothing looking broken.
    expect(code).toContain("encryptPanForSync");
    expect(code).toContain("blindIndexPan");
    expect(code).not.toMatch(/\bencryptField\s*\(/);
    expect(code).not.toMatch(/(?<!blindIndexPan.{0,200})\bblindIndex\s*\(/s);
  });

  it("derives all three columns from the SAME normalised value", () => {
    // The plaintext stored here is `pan` — already trimmed and upper-cased. The ciphertext
    // and blind index must come from that identical variable, not from legacy.PanNo, or a
    // row written here would sit in a different index space from the same row written by
    // scripts/statutory-identifier-encrypt-backfill.ts.
    const block = panBlock();
    expect(block).toMatch(/updateData\.pan_number_encrypted\s*=\s*encryptPanForSync\(\s*pan\b/);
    expect(block).toMatch(/updateData\.pan_blind_index\s*=\s*blindIndexPan\(\s*pan\b/);
    expect(block).not.toMatch(/encryptPanForSync\(\s*legacy\./);
    expect(block).not.toMatch(/blindIndexPan\(\s*legacy\./);
  });

  it("still writes the plaintext, because the duplicate guard reads it by equality", () => {
    expect(panBlock()).toContain("updateData.pan_number = pan");
  });

  it("adds the ciphertext columns to fieldsToUpdate, or the UPDATE would never carry them", () => {
    // The statement is built from fieldsToUpdate; a value in updateData that is not listed
    // there is silently dropped.
    const block = panBlock();
    expect(block).toContain("'pan_number_encrypted'");
    expect(block).toContain("'pan_blind_index'");
  });
});
