import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * getFinalizedLineForMonth decides whether the running-salary card shows the
 * stored payslip figure or a live estimate recomputed from current attendance.
 * Its status list omitted 'finalized', and production has:
 *
 *   FINALIZED   51 runs   63,316 employee-months   -> fell through to LIVE
 *   approved    12 runs   12,880 employee-months   -> served STORED
 *   locked / disbursed / completed   0 rows        -> the list matched nothing else
 *
 * So the most settled months showed an estimate while the least settled showed
 * the authoritative figure — backwards, across five years of history.
 *
 * Asserted against the source text rather than by executing the query: the
 * function builds one SQL string with no seam to inject a fake connection, and
 * what matters here is the contents of that string.
 */

const SRC = readFileSync(
  resolve(__dirname, "..", "src/modules/payroll/running-salary.routes.ts"), "utf8");

/** The `AND spr.status IN (...)` list inside getFinalizedLineForMonth. */
function statusList(): string[] {
  const m = SRC.match(/AND spr\.status IN \(([^)]*)\)/);
  if (!m) throw new Error("status IN list not found");
  return m[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
}

/** The CLOSED_STATUSES set that drives is_finalized / is_draft. */
function closedStatuses(): string[] {
  const m = SRC.match(/CLOSED_STATUSES = new Set\(\[([^\]]*)\]\)/);
  if (!m) throw new Error("CLOSED_STATUSES set not found");
  return m[1].split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
}

/** The CASE ranking, as status -> rank. */
function ranking(): Record<string, number> {
  const block = SRC.match(/CASE spr\.status([\s\S]*?)END/);
  if (!block) throw new Error("ORDER BY CASE not found");
  const out: Record<string, number> = {};
  for (const [, status, rank] of block[1].matchAll(/WHEN\s+'([a-z_]+)'\s+THEN\s+(\d+)/g)) {
    out[status] = Number(rank);
  }
  return out;
}

describe("getFinalizedLineForMonth — which runs count as settled", () => {
  it("includes finalized, the status 51 of 67 production runs actually carry", () => {
    expect(statusList()).toContain("finalized");
  });

  it("keeps the statuses that were already there", () => {
    const list = statusList();
    for (const s of ["locked", "approved", "disbursed", "completed"]) {
      expect(list).toContain(s);
    }
  });

  it("matches case-insensitively against the stored 'FINALIZED'", () => {
    // salary_prep_run.status collates utf8mb4_unicode_ci, so the lowercase
    // literal matches. Upper-casing it here would be harmless but misleading —
    // pin the lowercase form the rest of the file uses.
    expect(statusList().filter((s) => s.toLowerCase() === "finalized")).toEqual(["finalized"]);
  });

  it("never reports an open month as settled", () => {
    // The query deliberately admits draft/processing runs (13a61794) so the card
    // shows the figure payroll actually computed instead of a second, different
    // estimate. The protection moved rather than disappeared: an open month is
    // returned but must carry is_finalized:false / is_draft:true, which is what
    // RunningMonthCard, PayslipViewer and Payroll.tsx branch on to label it
    // "Draft". Guard that, not the old exclusion.
    const closed = closedStatuses();
    for (const open of ["draft", "processing", "calculating", "calculated"]) {
      expect(closed).not.toContain(open);
    }
  });

  it("ranks every open status below every settled one", () => {
    // A month with both a settled line and a stale draft line must resolve to
    // the settled one — LIMIT 1 takes whichever the CASE ranks first.
    const rank = ranking();
    const closed = closedStatuses().map((s) => rank[s]).filter((n) => Number.isFinite(n));
    const open = ["draft", "processing", "calculating", "calculated"]
      .map((s) => rank[s]).filter((n) => Number.isFinite(n));
    expect(closed.length).toBeGreaterThan(0);
    expect(open.length).toBeGreaterThan(0);
    expect(Math.max(...closed)).toBeLessThan(Math.min(...open));
  });
});

describe("getFinalizedLineForMonth — which run wins when a month has several", () => {
  it("ranks finalized above approved", () => {
    // 2026-03 carries both an approved and a FINALIZED run. Adding 'finalized'
    // to the WHERE without ranking it would leave it in the ELSE branch, so the
    // less authoritative approved row would still be selected.
    const r = ranking();
    expect(r.finalized).toBeDefined();
    expect(r.finalized).toBeLessThan(r.approved);
  });

  it("keeps disbursed as the most authoritative — money has actually moved", () => {
    const r = ranking();
    expect(r.disbursed).toBe(Math.min(...Object.values(r)));
  });

  it("gives every listed status an explicit rank, so none fall into ELSE", () => {
    const r = ranking();
    for (const s of statusList()) {
      expect(r[s], `'${s}' is selectable but unranked — it would tie in the ELSE branch`).toBeDefined();
    }
  });

  it("assigns distinct ranks, so ordering is deterministic", () => {
    const ranks = Object.values(ranking());
    expect(new Set(ranks).size).toBe(ranks.length);
  });
});
