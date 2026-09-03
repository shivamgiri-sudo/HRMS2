/**
 * The cost centre chosen at onboarding must reach the employee record.
 *
 * Onboarding makes "Cost Centre" a REQUIRED field on the employment offer and stores the
 * chosen cost_centre_master.id on ats_employment_offer.cost_centre, mirrored to
 * ats_payroll_hr_validation.cost_centre_id. Neither ever reached `employees`: the
 * orchestrator's INSERT named branch_id, process_id, department_id and designation_id off
 * the same `offer` object and simply never mentioned cost_centre_id.
 *
 * Nor did any other creation path — bulk upload, createEmployee, and both sync handlers all
 * omitted it — leaving updateEmployee (the manual Edit Employee dialog) as the column's only
 * writer anywhere in the backend. Measured live on 2026-08-15: 185 active employees who
 * joined on or after 2026-07-20 had cost_centre_id NULL, and every one of the 198 in the
 * 0-30 day tenure bucket was unassigned. Coverage looked healthy for 2024 and 2025 joiners
 * (3,425/3,425 and 2,928/2,928) only because legacy sync populated it, and that is off.
 *
 * Source-text inspection, matching this repo's established contract-test style.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const ORCHESTRATOR = "src/modules/employees/employee-creation-orchestrator.service.ts";
const EMPLOYEE_SERVICE = "src/modules/employees/employee.service.ts";

/**
 * Strip comments so a column only DISCUSSED in prose never counts as written.
 *
 * SQL line comments are stripped alongside the TypeScript ones. Both INSERTs below carry
 * `--` prose INSIDE the column list explaining why a column is there, and without this the
 * splitter turned each such block into comma-separated "columns" while swallowing the real
 * column name next to it — reporting createEmployee as 18 columns / 17 values against a
 * statement that is correctly balanced, so the count assertions were red on healthy code
 * and could not have caught the mismatch they exist to catch. Anchored to the start of a
 * line so TypeScript's `--` decrement operator is never mistaken for a comment.
 */
const stripComments = (s: string): string =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*--.*$/gm, "");

/**
 * The column list and the VALUES list of the first `INSERT INTO employees` in `src`.
 *
 * Returned as trimmed item arrays rather than raw text so the counts can be compared.
 *
 * Both the extraction and the split track parenthesis depth. createEmployee's VALUES list
 * supplies cost_center_code as `(SELECT cost_centre_code FROM cost_centre_master ...)`, and
 * a non-greedy `\(([\s\S]*?)\)` ends the list at that subquery's OWN closing paren —
 * truncating 18 values to 17 and failing a statement that balances perfectly. Depth-aware
 * splitting also keeps such a subquery as ONE value even when it later grows a comma.
 */
function readParenGroup(src: string, openIdx: number): { body: string; end: number } {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return { body: src.slice(openIdx + 1, i), end: i };
  }
  throw new Error("unbalanced parentheses in INSERT INTO employees");
}

/** Split on commas that sit at depth 0, so a nested call or subquery stays one item. */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out.map(x => x.trim()).filter(Boolean);
}

function employeeInsert(src: string): { columns: string[]; values: string[] } {
  const at = src.indexOf("INSERT INTO employees");
  expect(at, "no INSERT INTO employees found").toBeGreaterThanOrEqual(0);

  const cols = readParenGroup(src, src.indexOf("(", at));
  const valuesAt = src.indexOf("VALUES", cols.end);
  expect(valuesAt, "INSERT INTO employees has no VALUES list").toBeGreaterThanOrEqual(0);
  const vals = readParenGroup(src, src.indexOf("(", valuesAt));

  return { columns: splitTopLevel(cols.body), values: splitTopLevel(vals.body) };
}

describe("cost centre is written when an employee is created", () => {
  const orchestrator = stripComments(read(ORCHESTRATOR));
  const employeeService = stripComments(read(EMPLOYEE_SERVICE));

  it("the candidate-to-employee conversion INSERTs cost_centre_id", () => {
    const { columns } = employeeInsert(orchestrator);
    expect(
      columns,
      "the offer's required cost centre is captured and then dropped: onboarding stores it " +
        "on ats_employment_offer.cost_centre but the employee row is created without it",
    ).toContain("cost_centre_id");
  });

  it("the conversion INSERT has one value per column", () => {
    // The failure mode of adding a column here is silent and total: a mismatch makes every
    // candidate conversion throw, so the count is pinned rather than assumed.
    const { columns, values } = employeeInsert(orchestrator);
    expect(
      values.length,
      `INSERT INTO employees names ${columns.length} columns but supplies ${values.length} values`,
    ).toBe(columns.length);
  });

  it("the conversion resolves the cost centre against cost_centre_master before inserting", () => {
    // ats_employment_offer.cost_centre is VARCHAR(100) with NO foreign key;
    // employees.cost_centre_id is CHAR(36) WITH one. Passing an unmatched value straight
    // through would raise ER_NO_REFERENCED_ROW and roll back the whole conversion, turning a
    // blank field into a candidate who cannot be onboarded at all.
    expect(
      orchestrator,
      "the raw offer value must be resolved against cost_centre_master, not inserted directly",
    ).toMatch(/FROM\s+cost_centre_master/);
  });

  it("an unresolvable cost centre leaves the employee unassigned instead of failing", () => {
    // Fail-open is correct HERE specifically: the alternative blocks a real joiner over a
    // reference-data gap. It must stay visible, hence the warning.
    expect(orchestrator).toMatch(/costCentreId\s*=\s*\(ccRows\[0\][\s\S]{0,80}\?\?\s*null/);
    expect(
      orchestrator,
      "a silently unassigned cost centre is how 185 employees ended up NULL — warn on it",
    ).toMatch(/result\.warnings\.push\(\s*[\s\S]{0,40}cost centre/i);
  });

  it("createEmployee INSERTs cost_centre_id, matching updateEmployee which already accepts it", () => {
    const { columns, values } = employeeInsert(employeeService);
    expect(
      columns,
      "updateEmployee sets cost_centre_id, so createEmployee omitting it means the same " +
        "field succeeds or is dropped depending only on which screen created the row",
    ).toContain("cost_centre_id");
    expect(values.length, "createEmployee column/value count mismatch").toBe(columns.length);
  });

  it("updateEmployee still writes the column it always did", () => {
    // Guards against a refactor that moves the write to create and drops it from update.
    expect(employeeService).toMatch(/sets\.push\("cost_centre_id = \?"\)/);
  });
});
