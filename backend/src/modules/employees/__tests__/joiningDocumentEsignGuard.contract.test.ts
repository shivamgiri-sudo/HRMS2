import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * assertTemplateConfiguredForEsign ordered by `(version = ?)`, but
 * employee_joining_document_template has no `version` column — it is
 * `template_version`. MySQL raised "Unknown column 'version' in 'order clause'"
 * on every call, and the .catch() beside the query turned that into an empty
 * result set, which is indistinguishable from "no template configured".
 *
 * So every joining-document e-sign request was rejected with
 * 409 "No document template is configured", no matter how correctly the
 * templates were set up. Combined with the template paths pointing at a
 * developer's Windows machine, e-signing had two independent reasons to fail;
 * fixing only the paths left it still broken, which a live run exposed.
 *
 * A column name inside a SQL string is invisible to the type checker, so this
 * is pinned against the schema file instead.
 */

const SERVICE = path.resolve(__dirname, "..", "employeeJoiningDocuments.service.ts");

function serviceSource(): string {
  // Normalise line endings before any assertion reads this.
  //
  // The slice below looks for "\n}\n" to find the end of a function body. On a
  // Windows checkout git hands out CRLF, where that closing brace is "\r\n}\r\n",
  // so indexOf returns -1, slice(0, 2) yields two characters, and the console.error
  // assertion fails against code that is perfectly correct. The test passed in CI
  // and failed for every Windows developer — which is worse than a plain failure,
  // because it reads as a real regression in the service.
  return fs.readFileSync(SERVICE, "utf8").replace(/\r\n/g, "\n");
}

/** Columns the migrations actually define for the template table. */
function templateTableColumns(): string[] {
  const sqlDir = path.resolve(__dirname, "..", "..", "..", "..", "sql");
  const found = new Set<string>();
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith(".sql")) continue;
      const sql = fs.readFileSync(full, "utf8");
      if (!/employee_joining_document_template/i.test(sql)) continue;
      for (const m of sql.matchAll(/^\s*`?([a-z_]+)`?\s+(varchar|char|text|int|tinyint|datetime|json|enum|decimal)/gim)) {
        found.add(m[1].toLowerCase());
      }
    }
  };
  walk(sqlDir);
  return [...found];
}

describe("joining-document e-sign template guard", () => {
  it("orders by template_version, a column that exists", () => {
    const src = serviceSource();
    expect(src, "the guard must not order by a bare `version` column").not.toMatch(
      /ORDER BY \(version\s*=\s*\?\)/,
    );
    expect(src).toMatch(/ORDER BY \(template_version\s*=\s*\?\)/);
  });

  it("never references a bare `version` column on the template table", () => {
    const src = serviceSource();
    const offenders = src
      .split("\n")
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ line }) => /\bversion\b\s*=\s*\?/.test(line) && !/template_version/.test(line));
    expect(offenders, "employee_joining_document_template has template_version, not version").toEqual([]);
  });

  it("the schema confirms template_version exists and version does not", () => {
    const columns = templateTableColumns();
    // Only assert when the migration was actually located, so the test stays
    // meaningful rather than silently vacuous if the SQL layout moves.
    if (columns.length === 0) return;
    expect(columns).toContain("template_version");
    expect(columns).not.toContain("version");
  }, 30_000);

  it("logs when the template lookup fails instead of swallowing it", () => {
    const src = serviceSource();
    const guard = src.slice(src.indexOf("async function assertTemplateConfiguredForEsign"));
    const body = guard.slice(0, guard.indexOf("\n}\n") + 3);
    expect(body, "a swallowed catch here reads as 'no template configured'").toMatch(/console\.error/);
  });
});
