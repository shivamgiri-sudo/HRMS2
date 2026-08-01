/**
 * Every approval_status the code writes must be storable.
 *
 * 138_ats_complete_journey.sql and 141_branch_head_approval.sql both create
 * ats_branch_head_approval with CREATE TABLE IF NOT EXISTS, and they disagreed:
 * 138 declared ENUM('pending','approved','rejected','sent_back'), 141 declared
 * ENUM('approved','rejected'). Whichever ran first decided the shape, and
 * production got 141's.
 *
 * The consequence was not a narrow one. payroll-hr.service.ts inserts 'pending'
 * when Payroll HR sends a candidate to the branch head, inside the transaction
 * that also moves the candidate to current_stage='payroll_validated'. With
 * sql_mode STRICT the INSERT throws, the transaction rolls back, and the stage
 * change goes with it — so production held zero pending approvals AND zero
 * candidates at 'payroll_validated'. The branch head's queue filters on both,
 * so it was permanently empty and no branch head could approve anything;
 * employee creation then failed with "Branch Head approval pending".
 *
 * A type checker cannot see any of this: the value is a string in a SQL
 * literal and the column lives in a .sql file.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const SQL = path.resolve(__dirname, "..", "..", "sql");
const SRC = path.resolve(__dirname, "..");

const read = (p: string) => fs.readFileSync(p, "utf8");

/** Pull the ENUM member list for a column out of a CREATE TABLE statement. */
function enumMembers(sql: string, column: string): string[] | null {
  const re = new RegExp(`${column}\\s+ENUM\\s*\\(([^)]*)\\)`, "i");
  const m = sql.match(re);
  if (!m) return null;
  return m[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
}

describe("ats_branch_head_approval.approval_status", () => {
  const m138 = enumMembers(read(path.join(SQL, "138_ats_complete_journey.sql")), "approval_status");
  const m141 = enumMembers(read(path.join(SQL, "141_branch_head_approval.sql")), "approval_status");

  it("both migrations that create the table declare the same values", () => {
    expect(m138).not.toBeNull();
    expect(m141).not.toBeNull();
    expect([...m141!].sort()).toEqual([...m138!].sort());
  });

  it("accepts 'pending' — the state the whole queue is built on", () => {
    expect(m138).toContain("pending");
    expect(m141).toContain("pending");
  });

  it("a migration exists to widen an already-narrow production column", () => {
    // Fixing the CREATE statements alone changes nothing for a database that
    // already has the narrow column, which is the situation in production.
    const fix = read(path.join(SQL, "1054_branch_head_approval_pending_status.sql"));
    expect(fix).toMatch(/MODIFY COLUMN\s+approval_status/i);
    expect(fix).toMatch(/ENUM\(''pending''/);
    // Must be conditional: re-running it on a fixed database has to be a no-op.
    expect(fix).toMatch(/LOCATE\('pending', @col\)/);
  });

  it("every status the service writes is in the enum", () => {
    const svc = read(path.join(SRC, "modules", "ats", "payroll-hr.service.ts"));
    const written = new Set<string>();
    for (const m of svc.matchAll(/approval_status\s*=\s*'([a-z_]+)'/gi)) written.add(m[1]);
    for (const m of svc.matchAll(/,\s*'(pending|approved|rejected|sent_back)',\s*NOW\(\)/gi)) written.add(m[1]);
    expect(written.size).toBeGreaterThan(0);
    for (const v of written) expect(m138).toContain(v);
  });

  it("the branch head queue still filters on the status it was built for", () => {
    // If this filter is ever changed, the enum requirement above changes with
    // it — they are one decision, not two.
    const q = read(path.join(SRC, "modules", "ats", "branch-head-approval.service.ts"));
    expect(q).toMatch(/approval_status\s*=\s*'pending'/);
  });
});
