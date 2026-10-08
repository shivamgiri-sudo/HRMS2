import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { CANDIDATE_ANALYTICS_COLUMNS } from "../atsFullParity.service.js";

/**
 * The ATS Command Center's payload is a column projection, and this is what keeps it honest.
 *
 * commandCenterData() selects CANDIDATE_ANALYTICS_COLUMNS instead of `c.*` — 42 columns
 * instead of 165. Measured against production 2026-08-26 that is 4,319ms/8.95MB instead of
 * 13,538ms/36.3MB for the same 8,229 rows. The saving is only safe while the list still covers
 * every column the derived-field helpers read: a column that is selected away does not throw,
 * it arrives as `undefined`, and the `_*` field computed from it silently changes for every
 * row. Every tile, chart and table on ten tabs is computed from those `_*` fields.
 *
 * So rather than trusting the list to be maintained by hand, this re-derives the requirement
 * from the source of the helpers themselves. Add `row.foo` to hardRejectReason() next year and
 * this test fails until `foo` is either projected or declared absent below.
 */

const SERVICE = "src/modules/ats-full-parity/atsFullParity.service.ts";

/**
 * Helpers that receive a RAW ats_candidate row (as opposed to an already-enriched one) and so
 * constrain what the projection must contain.
 */
const RAW_ROW_HELPERS = [
  "enrichCandidate",
  "parseCandidateDate",
  "roundSuccessCount",
  "hardRejectReason",
  "candidateQualityScore",
  "handlingQualityScore",
  "reusableReason",
];

/**
 * Names that look like columns but must NOT be added to the projection.
 *
 * `final_remarks` does not exist on ats_candidate — confirmed against production 2026-08-26,
 * information_schema returns no such column, and `SELECT c.final_remarks` fails with
 * ER_BAD_FIELD_ERROR. hardRejectReason() has always read it, always got `undefined`, and
 * always joined the literal string "undefined" into its haystack. That is inert only because
 * none of its twelve patterns occur in the word "undefined" — it is a latent bug, not a
 * working feature, and it is recorded here rather than quietly deleted so that removing the
 * read stays a deliberate decision with the evidence attached.
 *
 * `candidate_id` is a SQL alias the projection already emits via COALESCE, not a column.
 *
 * `resolved_process_name` and `resolved_branch_name` are likewise aliases, emitted by the
 * LEFT JOINs onto process_master and branch_master. They exist because applied_for_process and
 * applied_for_branch hold a master UUID on some rows and free text on others, so six raw
 * `04f20ddc-67ba-11f1-…` values were being shown to users as process names. Adding them to
 * CANDIDATE_ANALYTICS_COLUMNS would emit `c.resolved_process_name` and fail with
 * ER_BAD_FIELD_ERROR — they are joined columns, not columns of `c`.
 */
const NOT_COLUMNS = new Set([
  "final_remarks",
  "candidate_id",
  "resolved_process_name",
  "resolved_branch_name",
]);

function helperBody(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) return "";
  const next = src.indexOf("\nfunction ", start + 1);
  return src.slice(start, next === -1 ? src.length : next);
}

describe("command-center column projection covers every column the helpers read", () => {
  const src = readFileSync(resolve(process.cwd(), SERVICE), "utf8");
  const projected = new Set<string>(CANDIDATE_ANALYTICS_COLUMNS);

  const referenced = new Set<string>();
  for (const fn of RAW_ROW_HELPERS) {
    const body = helperBody(src, fn);
    expect(body, `${fn}() must exist — this test is derived from its source`).toBeTruthy();
    for (const m of body.matchAll(/\brow\.([a-z_][a-z0-9_]*)/g)) {
      // `_`-prefixed reads are derived fields written by enrichCandidate, not table columns.
      if (!m[1].startsWith("_")) referenced.add(m[1]);
    }
  }

  it("finds the column reads it is meant to be checking", () => {
    // Guards the regex itself: if a refactor renamed the parameter, every assertion below
    // would pass vacuously against an empty set.
    expect(referenced.size).toBeGreaterThan(30);
    expect(referenced).toContain("walkin_end_stage");
    expect(referenced).toContain("sla_breached");
  });

  it("projects every column the derived-field helpers read", () => {
    const missing = [...referenced].filter((c) => !projected.has(c) && !NOT_COLUMNS.has(c));
    expect(
      missing,
      `CANDIDATE_ANALYTICS_COLUMNS is missing ${missing.join(", ")}. commandCenterData() would ` +
        "select these away, the helper would read undefined, and the derived _* field would " +
        "change silently for every row on every tab. Add them to the list.",
    ).toEqual([]);
  });

  it("keeps the columns the tabs render directly, which no helper reads", () => {
    // RejectionsTab renders rejection_voc; the filter predicates match on recruiter_id.
    // Neither is reachable from the helper scan above, so they are asserted explicitly.
    expect(projected).toContain("rejection_voc");
    expect(projected).toContain("recruiter_id");
  });

  it("does not project a column that does not exist on the table", () => {
    for (const absent of NOT_COLUMNS) {
      expect(
        projected.has(absent),
        `${absent} is not a real ats_candidate column — projecting it makes the query fail ` +
          "with ER_BAD_FIELD_ERROR, taking the whole dashboard down.",
      ).toBe(false);
    }
  });

  it("selects the projection, not c.*, in commandCenterData", () => {
    const start = src.indexOf("async commandCenterData(");
    expect(start, "commandCenterData() must exist").toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf("\n  async ", start + 1));
    expect(body).toContain("candidateSelectAnalytics");
    expect(body, "c.* here would undo the whole change").not.toMatch(/candidateSelect\(/);
  });

  it("leaves webData on the full column set", () => {
    // /submissions feeds UnifiedPerformanceCommandCenter, whose search filters on
    // Object.values(row); narrowing webData's columns would silently narrow that search.
    const start = src.indexOf("async webData(");
    const body = src.slice(start, src.indexOf("\n  async ", start + 1));
    expect(body).toContain("await candidateSelect(");
    expect(body).not.toContain("candidateSelectAnalytics");
  });
});
