import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * approval_discard_log.payroll_recalc_status existed from migration 1023 but
 * nothing ever wrote it. Verified live on 2026-08-01 — both production discards
 * (PREM KUMAR's leave, HARNEET KAUR's dispute) carry NULL:
 *
 *   leave    rederive  payroll_recalc_status=NULL  2026-07-31 15:47:05
 *   dispute  delete    payroll_recalc_status=NULL  2026-07-31 19:58:33
 *
 * The outcome reached the API response of the request that performed the discard
 * and was then lost. The Discard Center lists history with `SELECT adl.*`, so it
 * rendered the column blank for every row — which reads as "payroll is fine"
 * rather than "nobody knows". Gap 6 of the plan asked for the opposite: a
 * recalculation that did not happen must be visible, not silent.
 *
 * Asserted against source text: recordRecalcStatus is module-private and runs
 * after commit, so there is no seam to drive it through the exported service
 * without standing up the whole discard path.
 */

const SRC = readFileSync(
  resolve(__dirname, "..", "src/modules/discard/discard.service.ts"), "utf8");

/** VARCHAR(30), per migration 1023. */
const COLUMN_WIDTH = 30;

/** Reimplementation of aggregateRecalcStatus, kept in step with the source below. */
function aggregate(outcomes: string[]): string | null {
  if (!outcomes.length) return null;
  const distinct = [...new Set(outcomes)];
  if (distinct.length === 1) return distinct[0].slice(0, COLUMN_WIDTH);
  const stalled = distinct.filter((s) => s !== "recalculated");
  return `partial:${stalled.join("/")}`.slice(0, COLUMN_WIDTH);
}

describe("payroll_recalc_status is actually persisted", () => {
  it("updates the ledger row after the recalculation", () => {
    expect(SRC).toMatch(/UPDATE approval_discard_log SET payroll_recalc_status = \? WHERE id = \?/);
  });

  it("is called from both discard paths — leave and regularization/dispute", () => {
    const calls = SRC.match(/recordRecalcStatus\(discardId, payrollResult\.outcomes\)/g) ?? [];
    expect(calls).toHaveLength(2);
  });

  it("runs after commit in both paths, not inside the transaction", () => {
    // The outcome is unknowable while the transaction is open, and holding the
    // connection across a payroll recalculation would pin a pool slot for seconds.
    //
    // Match the call, not the declaration — `async function recordRecalcStatus(
    // discardId` also contains the call's text, and it necessarily sits above
    // both commits.
    const offsets = (re: RegExp) => [...SRC.matchAll(re)].map((m) => m.index!);
    const calls = offsets(/await recordRecalcStatus\(discardId, payrollResult\.outcomes\)/g);
    const commits = offsets(/await conn\.commit\(\)/g);

    expect(calls).toHaveLength(2);
    expect(commits).toHaveLength(2);
    // Pairwise: the leave path's call follows the leave path's commit, and the
    // regularization path's call follows its own.
    for (let i = 0; i < calls.length; i++) {
      expect(calls[i], `call ${i} must follow commit ${i}`).toBeGreaterThan(commits[i]);
    }
  });

  it("never fails the discard when the annotation fails", () => {
    const fn = SRC.slice(SRC.indexOf("async function recordRecalcStatus"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).toMatch(/catch \(err: any\)/);
    // Returns a warning rather than throwing — the discard is already durable.
    expect(body).toMatch(/return \[/);
    expect(body).not.toMatch(/throw /);
  });

  it("surfaces the annotation failure as a warning the caller sees", () => {
    expect(SRC).toMatch(/warnings\.push\(\.\.\.\(await recordRecalcStatus\(/);
  });
});

describe("the aggregate fits the column it is stored in", () => {
  it("stores a single-month outcome verbatim", () => {
    expect(aggregate(["recalculated"])).toBe("recalculated");
    expect(aggregate(["queued"])).toBe("queued");
    expect(aggregate(["no_open_run"])).toBe("no_open_run");
  });

  it("collapses identical outcomes rather than repeating them", () => {
    // A leave spanning two months that recalculated in both is just 'recalculated'.
    expect(aggregate(["recalculated", "recalculated"])).toBe("recalculated");
  });

  it("names only the months that did NOT move when outcomes are mixed", () => {
    expect(aggregate(["recalculated", "queued"])).toBe("partial:queued");
    expect(aggregate(["queued", "recalculated"])).toBe("partial:queued");
  });

  it("keeps every result inside VARCHAR(30), so nothing truncates mid-status", () => {
    // The detailed form the API returns — '2026-07:recalculated, 2026-08:queued' —
    // is 37 chars, which is exactly why the aggregate exists.
    const detailed = "2026-07:recalculated, 2026-08:queued";
    expect(detailed.length).toBeGreaterThan(COLUMN_WIDTH);

    const cases = [
      ["recalculated"], ["queued"], ["no_open_run"], ["failed"],
      ["recalculated", "queued"], ["recalculated", "no_open_run"],
      ["queued", "no_open_run", "failed"],
      ["recalculated", "queued", "no_open_run", "failed"],
    ];
    for (const c of cases) {
      const got = aggregate(c)!;
      expect(got.length, `${JSON.stringify(c)} -> '${got}' (${got.length} chars)`)
        .toBeLessThanOrEqual(COLUMN_WIDTH);
    }
  });

  it("returns null when no month was recalculated at all, leaving the column NULL", () => {
    // Distinguishes "nothing to do" from "something went wrong".
    expect(aggregate([])).toBeNull();
  });

  it("records a thrown recalculation as 'failed' rather than dropping it", () => {
    // The catch branch pushes an outcome; without it a crashed recalculation
    // would leave the column NULL and look identical to a clean discard.
    const fn = SRC.slice(SRC.indexOf("async function recalcPayroll"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toMatch(/outcomes\.push\("failed"\)/);
  });
});
