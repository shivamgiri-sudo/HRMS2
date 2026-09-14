import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SQL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "sql");

/**
 * MySQL 8 applies the SERVER default collation (utf8mb4_0900_ai_ci) when DDL names a charset
 * but no collation. mas_hrms is overwhelmingly utf8mb4_unicode_ci — 757 tables against 44 —
 * so such a table cannot be text-joined to employees without ER_CANT_AGGREGATE_2COLLATIONS.
 *
 * That is not hypothetical: employee_reimbursement_claim was created this way and every
 * reimbursements endpoint 500'd from the day it shipped until migration 1038 converted it.
 * Migration 426 had the same defect and was corrected before it was ever applied.
 */
export function offendingCreateTables(sql: string): string[] {
  const out: string[] = [];
  const re = /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+`?(\w+)`?[\s\S]*?;/gi;
  for (const m of sql.matchAll(re)) {
    const body = m[0];
    if (
      /DEFAULT\s+CHARSET\s*=\s*utf8mb4/i.test(body) &&
      !/COLLATE\s*=?\s*utf8mb4_\w+/i.test(body)
    ) {
      out.push(m[1]);
    }
  }
  return out;
}

describe("collation drift", () => {
  it("detects DDL that sets a charset but no collation", () => {
    const bad = "CREATE TABLE x (id INT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;";
    expect(offendingCreateTables(bad)).toEqual(["x"]);
  });

  it("accepts DDL that pins the collation", () => {
    const good =
      "CREATE TABLE y (id INT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;";
    expect(offendingCreateTables(good)).toEqual([]);
  });

  it("accepts IF NOT EXISTS form with a collation", () => {
    const good =
      "CREATE TABLE IF NOT EXISTS z (id INT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;";
    expect(offendingCreateTables(good)).toEqual([]);
  });

  it("no migration numbered 1039 or higher creates a table without COLLATE", () => {
    const offenders: string[] = [];
    for (const f of readdirSync(SQL_DIR).filter((n) => /^\d{4}_.*\.sql$/.test(n))) {
      // Below 1039 is pre-existing debt: 44 tables already carry the wrong collation and are
      // converted individually when a real failure points at one (1038 did exactly that).
      // Rewriting them wholesale would take a metadata lock on each for no observed benefit.
      if (Number(f.slice(0, 4)) < 1039) continue;
      const found = offendingCreateTables(readFileSync(resolve(SQL_DIR, f), "utf8"));
      if (found.length) offenders.push(`${f}: ${found.join(", ")}`);
    }
    expect(
      offenders,
      `Add COLLATE=utf8mb4_unicode_ci to these CREATE TABLE statements:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
