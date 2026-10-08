import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Journal Task 6 — journal.service.ts's own header claims journal_entry_line has no INSERT path
 * other than journalService.post(), and no UPDATE/DELETE path at all (a wrong entry is
 * corrected with reverse()'s contra entry). MySQL TRIGGERs are unavailable in this environment
 * (same constraint imprest_transaction_ledger's own append-only rule documents and proves with
 * its own source scan, imprest-ledger.test.ts) — the schema cannot enforce this, so this test is
 * what makes the claim real instead of aspirational. Copies that test's exact shape rather than
 * inventing a new one.
 *
 * Scans the WHOLE backend/src tree, not just modules/finance — journal_entry_line is general
 * enough (Task 1's account_type covers bank/vendor/expense/payable accounts) that a future
 * writer could plausibly land in payroll, wfm, or anywhere else without this catching it if the
 * scan were scoped too narrowly.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === "__tests__") continue;
      walk(full, out);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("journal_entry_line has exactly one writer (Journal Task 6)", () => {
  const backendSrc = fileURLToPath(new URL("../../../", import.meta.url)); // backend/src
  const journalServicePath = path.join(backendSrc, "modules/finance/journal.service.ts");

  it("only journal.service.ts contains INSERT INTO journal_entry_line", () => {
    const offenders: string[] = [];
    for (const file of walk(backendSrc)) {
      if (path.resolve(file) === path.resolve(journalServicePath)) continue;
      const src = readFileSync(file, "utf8");
      if (/INSERT\s+INTO\s+journal_entry_line/i.test(src)) {
        offenders.push(path.relative(backendSrc, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no source file updates or deletes journal_entry_line — a correction is a contra entry, never an edit", () => {
    const offenders: string[] = [];
    for (const file of walk(backendSrc)) {
      const src = readFileSync(file, "utf8");
      if (/UPDATE\s+journal_entry_line/i.test(src)) offenders.push(`UPDATE in ${path.relative(backendSrc, file)}`);
      if (/DELETE\s+FROM\s+journal_entry_line/i.test(src)) offenders.push(`DELETE in ${path.relative(backendSrc, file)}`);
    }
    expect(offenders).toEqual([]);
  });

  it("journal.service.ts itself never UPDATEs or DELETEs journal_entry_line either — reverse() must post a new contra entry, not edit the original", () => {
    const src = readFileSync(journalServicePath, "utf8");
    expect(src).not.toMatch(/UPDATE\s+journal_entry_line/i);
    expect(src).not.toMatch(/DELETE\s+FROM\s+journal_entry_line/i);
    // journal_entry itself IS updated once, by design (reversed_by_entry_id) — that's the one
    // exception this test intentionally does not flag.
    expect(src).toContain("UPDATE journal_entry SET reversed_by_entry_id");
  });
});
