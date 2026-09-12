import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every table the exit journey READS must exist in mas_hrms.
 *
 * WHY THIS GUARD IS NEW WHEN THREE SCHEMA RATCHETS ALREADY EXIST
 *
 * db/__tests__/schema-column-refs.test.ts has three ratchets and none of them can see this
 * class of defect:
 *
 *   - the column ratchet resolves alias.column against the snapshot, but brokenRefs()
 *     deliberately "ignores tables that are not in the snapshot" — a documented decision,
 *     because most unknown tables are CTEs or derived-table aliases and reporting them
 *     would drown the column signal. So `d.dept_name FROM departments d` is skipped
 *     entirely: the table is unknown, therefore the column is not judged.
 *   - the table ratchet (unknownWriteTargets) only inspects INSERT / UPDATE / DELETE
 *     targets. A LEFT JOIN is not a write.
 *   - the write-column ratchet only looks inside writes for the same reason.
 *
 * A read from a table that does not exist is therefore invisible to all three, and that gap
 * hid two live defects in this module for months:
 *
 *   1. manpower-risk.routes.ts's GET /api/manpower-risk/notice-period and exit.routes.ts's
 *      GET /api/exit/:id/full both did
 *          LEFT JOIN departments d ... LEFT JOIN designations des ...
 *      The canonical tables are department_master and designation_master; the SELECT lists
 *      already used the _master column names (dept_name, designation_name), so only the two
 *      table names were wrong. Both statements raised ER_NO_SUCH_TABLE (1146) on every call,
 *      so both endpoints returned HTTP 500 100% of the time. The Notice Period tab in the
 *      Exit Command Center swallows that with a .catch(console.error) and renders "No
 *      employees currently in notice period." — a broken query presenting as a real zero —
 *      and NoticePeriodDrawer, whose only data source is /:id/full, never rendered at all.
 *
 *   2. exit-intelligence.service.ts counted open disciplinary action from `pip_action_plan`.
 *      The only PIP tables in mas_hrms are pip_record and pip_checkpoint. That read goes
 *      through scalar(), which catches and returns its fallback, so pendingDisciplinary was
 *      permanently 0 and the regrettable-exit score had no disciplinary term at all.
 *
 * Both are one-word errors that a schema check catches instantly and that no amount of
 * behavioural testing would, because the failure mode is a swallowed exception that looks
 * like an honest empty result.
 *
 * NO BASELINE, ON PURPOSE
 *
 * The repo-wide ratchets need a baseline because they inherit hundreds of pre-existing
 * findings. This one is scoped to the exit journey and starts clean, so it asserts zero
 * rather than "no worse than before". Keeping it clean is the point; if a legitimate CTE or
 * cross-database read is added later, name it in ALLOWED_NON_TABLES with a reason.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND_SRC = resolve(HERE, "..", "..", "..");
const SNAPSHOT = resolve(BACKEND_SRC, "..", "sql", "schema-snapshot.json");

type Snapshot = { generatedFrom: string; tableCount: number; tables: Record<string, string[]> };

/**
 * Identifiers that follow FROM/JOIN but are not physical tables.
 *
 * Kept explicit rather than pattern-matched: "it looked like a CTE" is how a real typo gets
 * waved through. Empty today.
 */
const ALLOWED_NON_TABLES = new Set<string>([]);

/** Databases other than mas_hrms, whose tables the snapshot legitimately does not cover. */
const FOREIGN_SCHEMAS = new Set(["information_schema", "performance_schema", "mysql", "sys"]);

/**
 * Strip JS block and line comments before looking for SQL.
 *
 * Mirrors stripComments() in db/__tests__/schema-column-refs.ts and exists for the reason
 * documented there: a doc comment that quotes SQL in backticks is indistinguishable from a
 * template literal to a regex, so prose describing a defect gets scanned as the defect. This
 * file's own header names `departments` and `pip_action_plan` while explaining them, and the
 * comments now sitting above each fixed JOIN name the wrong table too — without this, the
 * guard would fail on its own documentation.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => {
      const i = line.indexOf("//");
      if (i === -1) return line;
      const before = line.slice(0, i);
      const quotes = (before.match(/["'`]/g) ?? []).length;
      return quotes % 2 === 0 ? before : line;
    })
    .join("\n");
}

/** Strip SQL line comments inside an already-extracted template literal. */
function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const i = line.indexOf("--");
      return i === -1 ? line : line.slice(0, i);
    })
    .join("\n");
}

const SQL_VERB_RE = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i;

/**
 * Optional `schema`. prefix, then the table name. A derived table is written
 * `FROM (SELECT ...) alias`, and `(` is not an identifier character, so those never match —
 * which is exactly why this can assert zero without a CTE allowlist.
 */
const READ_TABLE_RE =
  /\b(?:FROM|JOIN)\s+`?(?:([a-z_][a-z0-9_]*)`?\s*\.\s*`?)?([a-z_][a-z0-9_]*)`?/gi;

/**
 * Common-table expressions declared in the same statement.
 *
 * `WITH x AS ( ... ), y AS ( ... ) SELECT ... FROM x JOIN y` reads x and y through FROM/JOIN
 * exactly like a physical table, so without this they register as missing tables.
 * manpower-risk.routes.ts's mandate-vs-billed endpoint declares three (dominant_process,
 * billed, client_sibling) and tripped this guard on first run.
 *
 * Collected per literal and matched by name rather than kept in a hand-maintained allowlist:
 * an allowlist of "names that are fine" is indistinguishable from a list of typos somebody
 * gave up on, and it would need editing every time a query gains a CTE.
 *
 * A column alias is written `expr AS name`; a CTE is `name AS (`. The trailing paren is what
 * separates them, so this cannot swallow an aliased column.
 */
const CTE_RE = /(?:\bWITH\b(?:\s+RECURSIVE)?|,)\s*`?([a-z_][a-z0-9_]*)`?\s+AS\s*\(/gi;

export function readTablesIn(source: string): string[] {
  const out = new Set<string>();
  for (const literal of stripComments(source).match(/`[^`]*`/g) ?? []) {
    if (!SQL_VERB_RE.test(literal)) continue;
    const sql = stripSqlComments(literal);

    const ctes = new Set<string>();
    for (const m of sql.matchAll(CTE_RE)) {
      if (m[1]) ctes.add(m[1].toLowerCase());
    }

    for (const m of sql.matchAll(READ_TABLE_RE)) {
      const schema = m[1]?.toLowerCase();
      const table = m[2]?.toLowerCase();
      if (!table) continue;
      // A read from another database cannot be judged against this snapshot.
      if (schema && FOREIGN_SCHEMAS.has(schema)) continue;
      if (!schema && FOREIGN_SCHEMAS.has(table)) continue;
      if (!schema && ctes.has(table)) continue;
      out.add(table);
    }
  }
  return [...out];
}

function tsFilesUnder(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name);
    if (statSync(full).isDirectory()) {
      // The tests themselves quote broken SQL as fixtures on purpose.
      if (name === "__tests__" || name === "node_modules" || name === "dist") continue;
      tsFilesUnder(full, acc);
    } else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * The exit journey: the exit module itself, plus the notice-period endpoint that the Exit
 * Command Center's Notice Period tab depends on and which lives in another module.
 */
function journeyFiles(): string[] {
  return [
    ...tsFilesUnder(resolve(BACKEND_SRC, "modules", "exit")),
    resolve(BACKEND_SRC, "modules", "workforce-mandate", "manpower-risk.routes.ts"),
  ];
}

const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Snapshot;
const LIVE_TABLES = new Set(Object.keys(snapshot.tables));

describe("exit journey — every table read exists in mas_hrms", () => {
  it("reads the schema snapshot it judges against", () => {
    expect(snapshot.generatedFrom).toBe("mas_hrms");
    expect(LIVE_TABLES.size).toBe(snapshot.tableCount);
    // Spot-check both sides of the defect this guard was written for.
    expect(LIVE_TABLES.has("department_master")).toBe(true);
    expect(LIVE_TABLES.has("designation_master")).toBe(true);
    expect(LIVE_TABLES.has("pip_record")).toBe(true);
    expect(LIVE_TABLES.has("departments")).toBe(false);
    expect(LIVE_TABLES.has("designations")).toBe(false);
    expect(LIVE_TABLES.has("pip_action_plan")).toBe(false);
  });

  it("names no table the database does not have", () => {
    const offenders: string[] = [];
    for (const file of journeyFiles()) {
      const rel = relative(BACKEND_SRC, file).split(sep).join("/");
      for (const table of readTablesIn(readFileSync(file, "utf8"))) {
        if (LIVE_TABLES.has(table) || ALLOWED_NON_TABLES.has(table)) continue;
        offenders.push(`${rel}::${table}`);
      }
    }

    expect(
      offenders,
      `A query in the exit journey reads a table that does not exist in mas_hrms, so it ` +
        `raises ER_NO_SUCH_TABLE at runtime. Every such read in this module is wrapped in a ` +
        `.catch() or a scalar() fallback, so the endpoint returns 500 or a fabricated zero ` +
        `and the UI renders it as a real empty result.\n` +
        `Check backend/sql/schema-snapshot.json for the real table name.\n` +
        offenders.map((o) => `  - ${o}`).join("\n")
    ).toEqual([]);
  });
});

/**
 * Getting the table name right is only half of that fix. The predicate has to match the enum
 * the real table actually declares, and here the two disagreed in a way that would have
 * inverted the bug rather than fixed it.
 *
 * exit-intelligence.service.ts asked pip_action_plan for `status NOT IN ('closed','cancelled')`.
 * pip_record.status is ENUM('active','completed','extended','terminated') — neither 'closed'
 * nor 'cancelled' is a member — so a straight table rename would have matched EVERY row,
 * counting a PIP somebody completed two years ago as open discipline and flipping
 * regrettable_exit to false for anyone who was ever on one. 'active' and 'extended' are the
 * two non-terminal states, which is what the original condition was reaching for.
 */
describe("exit-intelligence open-PIP predicate matches pip_record's real enum", () => {
  // Comments stripped for the same reason the scanner strips them: the fix is documented in a
  // comment directly above the query, and that comment necessarily names the wrong table it
  // replaced. Asserting against raw text would make the explanation fail the test.
  const source = stripComments(
    readFileSync(resolve(BACKEND_SRC, "modules", "exit", "exit-intelligence.service.ts"), "utf8")
  );
  const PIP_ENUM_MEMBERS = ["active", "completed", "extended", "terminated"];

  it("queries pip_record, not the non-existent pip_action_plan", () => {
    expect(source).not.toMatch(/pip_action_plan/);
    expect(source).toMatch(/FROM pip_record/);
  });

  it("selects the two non-terminal states positively", () => {
    expect(source).toMatch(/status IN \('active','extended'\)/);
  });

  it("names no status outside the enum", () => {
    // Anything quoted next to `status` in this file must be a real member, or the condition
    // silently matches the wrong set — which is exactly how the original defect read.
    const pipClause = /FROM pip_record[^`]*?status\s+(?:NOT\s+)?IN\s*\(([^)]*)\)/i.exec(source);
    expect(pipClause, "expected an open-PIP predicate to be present").not.toBeNull();
    const named = [...pipClause![1].matchAll(/'([a-z_]+)'/gi)].map((m) => m[1].toLowerCase());
    expect(named.length).toBeGreaterThan(0);
    for (const s of named) expect(PIP_ENUM_MEMBERS).toContain(s);
  });
});

describe("readTablesIn scanner", () => {
  it("finds plain and aliased reads", () => {
    expect(readTablesIn("const q = `SELECT 1 FROM exit_request er`;")).toContain("exit_request");
    expect(readTablesIn("const q = `SELECT 1 FROM a LEFT JOIN employees e ON e.id = a.id`;"))
      .toContain("employees");
  });

  it("does not mistake a derived table's alias for a table", () => {
    const sql = "const q = `SELECT * FROM ( SELECT id FROM exit_request ) ranked`;";
    const found = readTablesIn(sql);
    expect(found).toContain("exit_request");
    expect(found).not.toContain("ranked");
  });

  it("does not mistake a CTE for a missing table", () => {
    const sql =
      "const q = `WITH billed AS ( SELECT id FROM cost_centre_master ), " +
      "sib AS ( SELECT id FROM billed ) SELECT 1 FROM billed JOIN sib ON 1=1`;";
    const found = readTablesIn(sql);
    expect(found).toContain("cost_centre_master");
    expect(found).not.toContain("billed");
    expect(found).not.toContain("sib");
  });

  it("still treats an aliased column as a column, not a CTE", () => {
    // `AS (` is what marks a CTE; `AS name` is a column alias and must not be collected.
    const sql = "const q = `SELECT a AS billed, b FROM exit_request JOIN billed ON 1=1`;";
    expect(readTablesIn(sql)).toContain("billed");
  });

  it("ignores prose in JS comments — including this file's own header", () => {
    expect(readTablesIn("// joins departments d\nconst x = 1;")).toEqual([]);
    expect(readTablesIn("/* LEFT JOIN designations des */\nconst x = 1;")).toEqual([]);
  });

  it("ignores a table named only inside a SQL line comment", () => {
    const sql = "const q = `SELECT 1\n -- was: JOIN departments d\n FROM exit_request`;";
    const found = readTablesIn(sql);
    expect(found).toContain("exit_request");
    expect(found).not.toContain("departments");
  });

  it("ignores template literals with no SQL verb", () => {
    expect(readTablesIn("const s = `come FROM somewhere nice`;")).toEqual([]);
  });

  it("skips reads against another database", () => {
    expect(readTablesIn("const q = `SELECT 1 FROM information_schema.tables t`;")).toEqual([]);
  });

  it("resolves a mas_hrms-qualified read to the bare table name", () => {
    expect(readTablesIn("const q = `SELECT 1 FROM mas_hrms.pip_record pr`;")).toContain("pip_record");
  });

  it("would have caught the original defect", () => {
    const sql = "const q = `SELECT d.dept_name FROM employees e LEFT JOIN departments d ON d.id = e.department_id`;";
    expect(readTablesIn(sql)).toContain("departments");
    expect(LIVE_TABLES.has("departments")).toBe(false);
  });
});
