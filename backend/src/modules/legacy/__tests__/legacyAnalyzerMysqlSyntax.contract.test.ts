/**
 * legacy-analyzer.service.ts scans db_bill, which is MySQL 5.5.44 — but its two queries
 * used the mssql (SQL Server) driver API (`pool.request().query(...)`, `.input(...)`,
 * `sys.tables`/`sys.partitions`/`STATS_DATE`) against `getLegacyPool()`, a mysql2 Pool.
 * `mysql2` pools have no `.request()` method, so every call threw. `// @ts-nocheck` at
 * the top of the file is why TypeScript never caught the mismatch.
 *
 * Source-text inspection, matching this repo's established contract-test style — the
 * goal is to catch the mssql-only API coming back, not to open a live connection.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const rawSource = readFileSync(
  resolve(process.cwd(), "src/modules/legacy/legacy-analyzer.service.ts"),
  "utf8",
);

/** Strip comments so a mention in prose (explaining what was removed) doesn't count. */
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const source = stripComments(rawSource);

describe("legacy-analyzer.service.ts uses mysql2 syntax, not mssql", () => {
  it("does not call .request( — an mssql-only Pool method mysql2 does not have", () => {
    expect(source).not.toMatch(/\.request\(/);
  });

  it("does not call .input( — mssql's named-parameter binding, not mysql2's", () => {
    expect(source).not.toMatch(/\.input\(/);
  });

  it("does not reference SQL Server system catalogs (sys.tables / sys.partitions / STATS_DATE)", () => {
    expect(source).not.toMatch(/sys\.tables|sys\.partitions|sys\.indexes|STATS_DATE/);
  });

  it("uses pool.execute( for both metadata queries, mysql2's real API", () => {
    const count = (source.match(/pool\.execute\(/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });
});
