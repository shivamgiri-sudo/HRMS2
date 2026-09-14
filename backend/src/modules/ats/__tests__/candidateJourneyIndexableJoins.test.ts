/**
 * The candidate journey drawer must not full-scan `employees`.
 *
 * Opening it from /ats/offer-approvals took roughly ten seconds. Measured
 * against production on 2026-08-04, three of its thirteen queries were the whole
 * cost — stage history 8,087 ms, payroll validation 1,102 ms, interview rounds
 * 1,057 ms — and all three shared one shape:
 *
 *     LEFT JOIN employees e ON e.id = X OR e.user_id = X
 *
 * `employees` holds 58,626 rows and is indexed on both columns (PRIMARY and
 * idx_emp_user), but an OR across two columns disqualifies both: EXPLAIN
 * reported `type: ALL, rows: 57498, Range checked for each record`, once per
 * joined row. Split into two LEFT JOINs resolved by COALESCE, the same stage
 * history query returned in 12 ms — a thousandfold, with identical rows.
 *
 * This guards the shape, not the timing: a timing assertion here would need the
 * production database and would be flaky everywhere else. The OR-join is easy to
 * reintroduce because it reads as the more obvious way to write it.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  resolve(process.cwd(), "src/modules/ats/candidate-journey.service.ts"),
  "utf8",
);

/** `ON <alias>.<col> = <expr> OR ...` against the employees table. */
const OR_JOIN = /LEFT JOIN\s+employees\s+\w+\s+ON\b[^\n]*\bOR\b/gi;

describe("candidate journey joins stay indexable", () => {
  it("has no OR-join against employees", () => {
    const offenders = SOURCE.match(OR_JOIN) ?? [];
    expect(
      offenders,
      `OR-joins on employees force a full scan of 58k rows:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("resolves the two identity columns with separate joins", () => {
    // updated_by holds an employees.id from some writers and an auth user id
    // from others; both still have to be tried, just not in one ON clause.
    expect(SOURCE).toMatch(/LEFT JOIN employees e_user ON e_user\.user_id = s\.updated_by/);
    expect(SOURCE).toMatch(/LEFT JOIN employees e_id\s+ON e_id\.id = s\.updated_by/);
    expect(SOURCE).toMatch(/COALESCE\(e_user\.full_name, e_id\.full_name\) AS actor_name/);
  });

  it("keeps every source that resolved an actor name resolving one", () => {
    // Five queries named an actor before the rewrite. A join dropped in the
    // rewrite would silently blank the name rather than fail, so count them.
    const named = SOURCE.match(/AS actor_name/g) ?? [];
    expect(named.length).toBeGreaterThanOrEqual(5);
  });

  it("resolves an ambiguous id to the live employee, not the defunct seed row", () => {
    // The OR had no precedence — it FANNED OUT. 69 of 1,746 stage rows with an
    // actor match an employees.id and a different employee's user_id, so the
    // event appeared twice under two names and the dedupe below kept whichever
    // MySQL returned first. In every observed collision the id-match is the
    // inactive ADMIN001 seed row whose primary key equals the real person's
    // auth user id, and the user_id match is their live record (MAS47814).
    //
    // Verified against production over 41 candidates: with user_id first, the
    // rendered journey is byte-identical to the OR-join's — 0 differences on 98
    // named rows — while dropping the duplicate row. Reversing this changes
    // whose name appears on 69 events.
    for (const source of ["s.updated_by", "a.approver_id", "r.actioned_by"]) {
      const at = SOURCE.indexOf(`e_user.user_id = ${source}`);
      const idAt = SOURCE.indexOf(`e_id.id = ${source}`);
      expect(at, `no user_id join for ${source}`).toBeGreaterThan(-1);
      expect(idAt, `no id join for ${source}`).toBeGreaterThan(-1);
      expect(at, `${source}: user_id must be joined (and COALESCEd) first`).toBeLessThan(idAt);
    }
    expect(SOURCE).not.toMatch(/COALESCE\(e_id\.full_name, e_user\.full_name\)/);
  });
});
