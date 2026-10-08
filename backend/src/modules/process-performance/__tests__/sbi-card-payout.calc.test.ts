import { describe, it, expect } from "vitest";
import {
  computePayout, bandTest, bandIndex, levers, revenueOf, TARGET_INPUTS, PAYOUT_TARGETS, PAYOUT_MATRIX, MATRIX_ROW_LABELS, MATRIX_COL_LABELS, NORM_KICKER, RES_KICKER,
} from "../sbi-card-payout.calc.js";

/** The client's slab exactly as it arrived in the 7-Sep-2026 mail, one row per line: matrix row label, six payouts, then the two side tables. */
const EMAIL_ROWS = `
< 53% | 3.50 3.75 4.00 4.25 4.50 4.75 | <=18% 0.00 | <36% 0.00
53-55% | 4.00 4.25 4.50 4.75 5.00 5.25 | 18-19% 0.50 | 36-38% 0.25
55-57% | 4.50 4.75 5.00 5.25 5.50 5.75 | 19-20% 0.70 | 38-40% 0.50
57%-59% | 5.00 5.25 5.50 5.75 6.00 6.25 | 20-21% 0.90 | 40-43% 0.75
59%-61% | 5.50 5.75 6.00 6.25 6.50 6.75 | 21-22% 1.10 | 43-46% 1.00
61%-62% | 6.00 6.25 6.50 6.75 7.00 7.25 | 22-23% 1.10 | 46-49% 1.25
62%-63% | 6.50 6.75 7.00 7.25 7.50 7.75 | 23-24% 1.25 | >49% 1.50
63%-64% | 7.00 7.25 7.50 7.75 8.00 8.25 | >24% 1.40 |
>64% | 7.50 7.75 8.00 8.25 8.50 8.75 | |
`.trim().split("\n");

describe("slab transcription", () => {
  const parsed = EMAIL_ROWS.map((l) => l.split("|").map((x) => x.trim()));
  it("matches the client's matrix and row labels", () => {
    expect(parsed.map((p) => p[0]!.replace(/\s+/g, ""))).toEqual(MATRIX_ROW_LABELS.map((x) => x.replace(/\s+/g, "")));
    expect(parsed.map((p) => p[1]!.split(" ").map(Number))).toEqual(PAYOUT_MATRIX.map((r) => [...r]));
    expect(MATRIX_COL_LABELS).toEqual(["<22%", "22-24%", "24-26%", "26-27%", "27-28%", ">28%"]);
  });
  it("matches the Norm and Resolution kicker tables", () => {
    const norm = parsed.map((p) => p[2]!).filter(Boolean).map((c) => c.split(" "));
    expect(norm.map((c) => c[0])).toEqual([...NORM_KICKER.labels]);
    expect(norm.map((c) => Number(c[1]))).toEqual([...NORM_KICKER.pays]);
    const res = parsed.map((p) => p[3]!).filter(Boolean).map((c) => c.split(" "));
    expect(res.map((c) => c[0])).toEqual([...RES_KICKER.labels]);
    expect(res.map((c) => Number(c[1]))).toEqual([...RES_KICKER.pays]);
  });
  it("rises monotonically along every row and down every column of the matrix", () => {
    for (const row of PAYOUT_MATRIX) expect([...row]).toEqual([...row].sort((a, b) => a - b));
    for (let c = 0; c < 6; c++) { const col = PAYOUT_MATRIX.map((r) => r[c]!); expect(col).toEqual([...col].sort((a, b) => a - b)); }
  });
});

describe("band edges", () => {
  it("puts an edge value in the lower band, as the slab's explicit <=, > markers do", () => {
    const rows = MATRIX_ROW_LABELS.map(bandTest);
    expect(bandIndex(rows, 52.99)).toBe(0); expect(bandIndex(rows, 53)).toBe(1); expect(bandIndex(rows, 55)).toBe(1); expect(bandIndex(rows, 55.01)).toBe(2);
    expect(bandIndex(rows, 63)).toBe(6); expect(bandIndex(rows, 64)).toBe(7); expect(bandIndex(rows, 64.01)).toBe(8);
    const norm = NORM_KICKER.labels.map(bandTest);
    expect(bandIndex(norm, 18)).toBe(0); expect(bandIndex(norm, 18.01)).toBe(1); expect(bandIndex(norm, 24)).toBe(6); expect(bandIndex(norm, 24.01)).toBe(7);
    const res = RES_KICKER.labels.map(bandTest);
    expect(bandIndex(res, 35.99)).toBe(0); expect(bandIndex(res, 36)).toBe(1); expect(bandIndex(res, 49)).toBe(5); expect(bandIndex(res, 49.01)).toBe(6);
  });
  it("refuses a band it cannot read", () => expect(() => bandTest("about 50")).toThrow(/Unreadable/));
});

describe("payout rate", () => {
  it("at the client's targets (Resolution 35, NRB 28) pays the 62-63 row, 27-28 column: 7.50%", () => {
    const r = computePayout(TARGET_INPUTS);
    expect(PAYOUT_TARGETS.resolutionPct + PAYOUT_TARGETS.nrbPct).toBe(PAYOUT_TARGETS.totalPct);
    expect([r.totalPct, r.nrbPct]).toEqual([63, 28]);
    expect(r.matrixPct).toBe(7.5);
    expect([r.normKickerPct, r.resKickerPct]).toEqual([0, 0]);   // both kickers start just above the targets
    expect(r.ratePct).toBe(7.5);
  });
  it("pays the floor for nothing and the ceiling plus both kickers for the best case", () => {
    expect(computePayout({ resolutionPct: 0, normalisationPct: 0, rollbackPct: 0 }).ratePct).toBe(3.5);
    expect(computePayout({ resolutionPct: 55, normalisationPct: 30, rollbackPct: 10 }).ratePct).toBe(8.75 + 1.4 + 1.5);
  });
  it("adds the kickers on top of the matrix", () => {
    const r = computePayout({ resolutionPct: 36.5, normalisationPct: 19.5, rollbackPct: 9 });   // total 65 -> >64, NRB 28.5 -> >28
    expect([r.matrixPct, r.normKickerPct, r.resKickerPct, r.ratePct]).toEqual([8.75, 0.7, 0.25, 9.7]);
  });
  it("treats junk and out-of-range input as safe numbers", () => {
    const r = computePayout({ resolutionPct: Number.NaN, normalisationPct: -5, rollbackPct: 500 });
    expect(r.inputs).toEqual({ resolutionPct: 0, normalisationPct: 0, rollbackPct: 100 });
    expect(Number.isFinite(r.ratePct)).toBe(true);
  });
  it("values the next point of each outcome in rate and rupees", () => {
    const ls = levers(TARGET_INPUTS, 10_000_000);
    const by = Object.fromEntries(ls.map((l) => [l.lever, l]));
    // From the target (63 total, 28 NRB, NM 18, Res 35) one more point of:
    expect(by.resolution!.deltaPct).toBe(0.75);      // total 64 -> next matrix row (+0.50) and Resolution 36 -> first kicker (+0.25)
    expect(by.normalisation!.deltaPct).toBe(1.25);   // row +0.50, NRB 29 -> >28 column (+0.25), Norm 19 -> 18-19 kicker (+0.50)
    expect(by.rollback!.deltaPct).toBe(0.75);        // row +0.50, NRB 29 -> >28 column (+0.25), no kicker
    expect(ls.every((l) => l.deltaAmount === Math.round((l.deltaPct / 100) * 10_000_000))).toBe(true);
    expect(by.normalisation!.deltaAmount).toBe(125_000);
  });
  it("revenue is the rate on the amount collected", () => {
    expect(revenueOf(7.5, 35_000_000)).toBe(2_625_000);   // 7.5% of Rs 3.5 cr = Rs 26.25 lakh
    expect(revenueOf(7.5, 0)).toBe(0);
  });
});

import { outcomeToPercentages, pickOutcome, type OutcomeRow } from "../sbi-card-payout.calc.js";

const row = (o: Partial<OutcomeRow> = {}): OutcomeRow => ({
  date: "2026-09-28", segment: "CD3_HB", openingAccounts: 2353, openingAmount: 100_000_000, resolvedAccounts: 824, normalisedAccounts: 424, rollbackAccounts: 235,
  resolvedAmount: 36_000_000, normalisedAmount: 19_000_000, rollbackAmount: 9_000_000, resolutionPct: null, normalisationPct: null, rollbackPct: null, ...o,
});

describe("outcome figures to percentages", () => {
  it("derives from counts over the opening base", () => {
    const p = outcomeToPercentages(row());
    expect([p.basis, p.resolutionPct, p.normalisationPct, p.rollbackPct, p.complete]).toEqual(["accounts", 35.02, 18.02, 9.99, true]);
  });
  it("prefers the percentages SBI states, since that is what it pays on", () => {
    const p = outcomeToPercentages(row({ resolutionPct: 35, normalisationPct: 18, rollbackPct: 10 }));
    expect([p.basis, p.resolutionPct, p.normalisationPct, p.rollbackPct]).toEqual(["stated", 35, 18, 10]);
    expect(p.available).toEqual(["stated", "accounts", "amount"]);
  });
  it("honours a requested basis when it exists, and falls back when it does not", () => {
    expect(outcomeToPercentages(row({ resolutionPct: 35, normalisationPct: 18, rollbackPct: 10 }), "amount").basis).toBe("amount");
    expect(outcomeToPercentages(row({ openingAmount: null }), "amount").basis).toBe("accounts");
    expect(outcomeToPercentages(row({ resolvedAccounts: null, normalisedAccounts: null, rollbackAccounts: null, resolvedAmount: null, normalisedAmount: null, rollbackAmount: null })).basis).toBeNull();
  });
  it("reports an incomplete row instead of inventing the missing part", () => {
    const p = outcomeToPercentages(row({ rollbackAccounts: null }));
    expect([p.rollbackPct, p.complete]).toEqual([null, false]);
  });
});

describe("choosing the outcome row", () => {
  const rows = [row({ date: "2026-09-26" }), row({ date: "2026-09-28" }), row({ segment: "CD2_ALL", date: "2026-09-30" })];
  it("takes the freshest row of the CD3 HB segment even when another segment is newer", () => {
    const p = pickOutcome(rows);
    expect([p.row?.segment, p.row?.date, p.segments]).toEqual(["CD3_HB", "2026-09-28", ["CD2_ALL", "CD3_HB"]]);
  });
  it("honours an asked-for segment however it is spelled", () => expect(pickOutcome(rows, "cd2 all").row?.segment).toBe("CD2_ALL"));
  it("falls back to the only segment, then to the freshest, and to nothing", () => {
    expect(pickOutcome([row({ segment: "North HB" })]).row?.segment).toBe("North HB");
    expect(pickOutcome([row({ segment: "A", date: "2026-09-01" }), row({ segment: "B", date: "2026-09-05" })]).row?.segment).toBe("B");
    expect(pickOutcome([]).row).toBeNull();
  });
});

import { nextSteps } from "../sbi-card-payout.calc.js";

describe("next steps up the slab", () => {
  it("finds the smallest extra points that raise the rate, in accounts and rupees", () => {
    const steps = nextSteps(TARGET_INPUTS, 10_000_000, 2353);
    const by = Object.fromEntries(steps.map((s) => [s.lever, s]));
    // at target (Res 35, NM 18, RB 10) the total is exactly 63, the top of the 62-63 row: any extra 0.1 of Resolution crosses into 63-64
    expect(by.resolution!.addPoints).toBe(0.1);
    expect(by.resolution!.unlocks).toBe("matrix row 63%-64%");
    expect(by.normalisation!.addPoints).toBe(0.1);                 // 18.1 enters the 18-19 Norm kicker (+0.50) at once
    expect(by.normalisation!.unlocks).toMatch(/Norm kicker 18-19%/);
    expect(by.normalisation!.accountsNeeded).toBe(3);              // ceil(0.1% of 2353)
    expect(by.normalisation!.deltaAmount).toBe(Math.round((by.normalisation!.deltaPct / 100) * 10_000_000));
    expect(steps[0]!.addPoints).toBeLessThanOrEqual(steps[steps.length - 1]!.addPoints);   // smallest effort first
  });
  it("has no account counts without an opening book, and nothing to find at the ceiling", () => {
    expect(nextSteps(TARGET_INPUTS, 1_000_000, null).every((s) => s.accountsNeeded === null)).toBe(true);
    expect(nextSteps({ resolutionPct: 60, normalisationPct: 40, rollbackPct: 20 }, 1_000_000, 1000)).toEqual([]);
  });
});
