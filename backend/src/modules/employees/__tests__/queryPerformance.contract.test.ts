import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Query-shape contracts for the 2026-09 read-path optimisation pass. Each guards a rewrite that
 * keeps the result set identical while letting MySQL use an index (evidence: EXPLAIN on prod).
 */
const dir = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(resolve(dir, "..", f), "utf8");

describe("employees module query shapes", () => {
  it("stat-card month attendance uses a sargable record_date range, not YEAR()/MONTH()", () => {
    const src = read("employee.secure.routes.ts") + read("employee.routes.ts");
    expect(src).not.toMatch(/YEAR\(record_date\)\s*=\s*YEAR\((CURDATE|NOW)\(\)\)/);
    expect(src).toMatch(/record_date >= DATE_FORMAT\(CURDATE\(\), '%Y-%m-01'\)/);
  });

  it("email duplicate checks compare bare columns (columns are utf8mb4_unicode_ci)", () => {
    const src = read("employee.service.ts") + read("employee.routes.ts");
    expect(src).not.toMatch(/LOWER\(email\)\s*=\s*(\?|LOWER\(\?\))/);
    expect(src).not.toMatch(/LOWER\(official_email\)\s*=\s*\?/);
  });

  it("penny-drop bank lookup ranks only this candidate's onboarding bank rows", () => {
    const src = read("employee-creation-orchestrator.service.ts");
    const i = src.indexOf("FROM candidate_onboarding_bank_detail\n          WHERE candidate_id = ?");
    expect(i).toBeGreaterThan(0);
    expect(src.slice(i, i + 1400)).toMatch(/\[candidateId, candidateId\]/);
  });

  it("today-summary and directory-masters run their independent queries concurrently", () => {
    expect(read("employee.routes.ts")).toMatch(/const \[\[rows\], \[totalRow\]\] = await Promise\.all/);
    expect(read("employee.secure.routes.ts")).toMatch(/const \[\[processes\], \[branches\]\] = await Promise\.all/);
    expect(read("employee.secure.routes.ts")).toMatch(/await Promise\.all\(\[employeeScopeWhere\(userId\), getEmployeeForUser\(userId\)\]\)/);
  });

  it("secure /stats counts status groups from the covering index instead of one CASE pass over all rows", () => {
    const src = read("employee.secure.routes.ts");
    const i = src.indexOf('router.get("/stats"');
    const block = src.slice(i, src.indexOf('router.get("/directory-masters"'));
    expect(block).toMatch(/GROUP BY e\.active_status, e\.employment_status/);
    expect(block).toMatch(/new_joiners_90d/);
    expect(block).not.toMatch(/COUNT\(CASE WHEN/);
  });

  it("directory analytics aggregate by process_id before joining process_master, concurrently with the page", () => {
    const src = read("employee.service.ts");
    expect(src).toMatch(/const \[\[rows\], \[countRows\], statsResult, breakdownResult\] = await Promise\.all/);
    expect(src).toMatch(/GROUP BY e\.process_id\s+\) a\s+LEFT JOIN process_master pm ON pm\.id = a\.process_id/);
    expect(src).not.toMatch(/LEFT JOIN process_master pm ON pm\.id = e\.process_id\s+\$\{filterWhere\}/);
  });

  it("directory-masters counts (all in scope) minus (rejected by the status predicate), grouped before joining the master table", () => {
    const src = read("employee.secure.routes.ts");
    expect(src).toMatch(/FROM employees e \$\{hint\}/);
    expect(src).toMatch(/e\.active_status <> 1\s+AND e\.employment_status NOT IN \(\$\{DIRECTORY_LEAVER_STATUSES\}\)/);
    expect(src).toMatch(/HAVING SUM\(t_all\.c - COALESCE\(t_rej\.c, 0\)\) > 0/);
    // the old per-employee join + non-sargable OR predicate must be gone
    expect(src).not.toMatch(/JOIN process_master p ON p\.id = e\.process_id\s+WHERE \(\$\{activeEmployeeWhere\}\)/);
  });
});
