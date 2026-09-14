import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * The approval chain on /payroll/approval-status names three people. Two of the three are easy
 * to get wrong, and both mistakes look like working code:
 *
 *  1. ats_payroll_hr_validation.payroll_hr_id READS like the Payroll HR, and the module's own
 *     detail queries join it that way — but three separate writers reset it to whoever last
 *     touched the row (payroll-hr.service's ON DUPLICATE KEY UPDATE, joining-control-room's
 *     UPDATE), so on 22 of 23 live records it holds the BRANCH HEAD who approved. The row then
 *     names the same person as both Payroll HR and Branch Head. The stable source is
 *     ats_employment_offer.created_by, written once at offer creation.
 *
 *  2. employees.user_id is NOT unique — 7 user_ids map to more than one employees row live — so
 *     resolving any actor with a plain `LEFT JOIN employees ON user_id = ...` duplicates queue
 *     rows. Every user_id-keyed lookup here has to go through a LIMIT 1 subquery.
 */

const SERVICE = fs.readFileSync(
  path.join(__dirname, "..", "payroll-head-review.service.ts"),
  "utf8",
);

/** The getQueue() list statement only — the detail/journey queries have different rules. */
const RAW_QUEUE_SQL = SERVICE.split("SELECT r.id AS review_id")[1].split("LIMIT 500")[0];
/** Comments explain which columns are wrong to use, so they must not count as usage. */
const QUEUE_SQL = RAW_QUEUE_SQL
  .split(/\r?\n/)
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");
/** The top-level join chain: everything after FROM. Scalar subqueries live in the SELECT list. */
const QUEUE_JOINS = QUEUE_SQL.split("FROM employee_payroll_head_review")[1] ?? "";

describe("approval chain actors", () => {
  it("names the Payroll HR from the offer creator, never from payroll_hr_id", () => {
    expect(QUEUE_SQL).toContain("AS phr_by");
    expect(QUEUE_SQL).toContain("ats_employment_offer");
    expect(QUEUE_SQL).toContain("o.created_by");
    // payroll_hr_id must not feed any column of the queue row.
    expect(QUEUE_SQL).not.toContain("payroll_hr_id");
  });

  it("resolves every user_id-keyed actor through a LIMIT 1 subquery, not a bare join", () => {
    // A user_id join in the top-level chain multiplies queue rows. Inside the SELECT list it is
    // fine, because those subqueries are all bounded — assert that too rather than trusting it.
    const topLevelUserIdJoins = QUEUE_JOINS.match(/JOIN\s+employees\s+\w+\s+ON\s+\w+\.user_id\s*=/gi) ?? [];
    expect(topLevelUserIdJoins).toHaveLength(0);

    const selectList = QUEUE_SQL.split("FROM employee_payroll_head_review")[0];
    for (const frag of selectList.split("(SELECT").slice(1)) {
      if (/employees\s+\w+\s+ON\s+\w+\.user_id/i.test(frag)) {
        expect(frag.slice(0, frag.indexOf(") AS"))).toMatch(/LIMIT 1/i);
      }
    }
  });

  it("keeps the three stage columns the row renders", () => {
    for (const col of ["AS phr_status", "AS phr_at", "AS phr_by", "AS bh_status", "AS bh_at",
                       "AS bh_by", "AS ph_by", "AS stage1_minutes", "AS stage2_minutes"]) {
      expect(QUEUE_SQL).toContain(col);
    }
  });

  it("joins the Branch Head approval on payroll_validation_id, not candidate_id", () => {
    // ats_branch_head_approval.candidate_id is populated on 3 of 31 live rows; joining on it
    // silently renders every Branch Head node as "Not recorded".
    expect(QUEUE_SQL).toContain("b2.payroll_validation_id = v.id");
    expect(QUEUE_SQL).not.toMatch(/ats_branch_head_approval\s+\w+\s+ON\s+\w+\.candidate_id/i);
  });
});
