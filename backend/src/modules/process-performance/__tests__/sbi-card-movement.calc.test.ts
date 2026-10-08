import { describe, it, expect } from "vitest";
import { movementOf, type SnapRow } from "../sbi-card-movement.calc.js";

const r = (accountNo: string, cd: number | null, due: number, flow = "NEW"): SnapRow => ({ accountNo, cd, due, flow });
const A = [r("LEFT", 3, 1000), r("BACK", 3, 2000), r("FWD", 2, 3000), r("PAID", 3, 4000), r("SAME", 3, 5000), r("BACK2", 2, 500)];
const B = [r("BACK", 2, 2000), r("FWD", 3, 3000), r("PAID", 3, 1500), r("SAME", 3, 5000), r("BACK2", 1, 400), r("NEW1", 3, 7000)];
const m = movementOf("2026-09-01", A, "2026-09-25", B);
const by = (k: string) => m.outcomes.find((o) => o.key === k)!;

describe("movement between two snapshots", () => {
  it("puts every opening account in exactly one outcome", () => {
    expect(m.outcomes.reduce((n, o) => n + o.accounts, 0)).toBe(m.opening.accounts);
    expect(m.outcomes.reduce((n, o) => n + o.exposure, 0)).toBeCloseTo(m.opening.exposure, 2);
    expect([by("left").accounts, by("rolledBack").accounts, by("rolledForward").accounts, by("stayedPaidDown").accounts, by("stayed").accounts]).toEqual([1, 2, 1, 1, 1]);
  });
  it("measures opening and closing books, what was paid down, and what is new", () => {
    expect([m.opening.accounts, m.opening.exposure, m.closing.accounts]).toEqual([6, 15500, 6]);
    expect(m.paidDownAmount).toBe(2500 + 100);          // PAID 4000 -> 1500, BACK2 500 -> 400 (BACK, FWD and SAME unchanged)
    expect(m.newInB).toEqual({ accounts: 1, exposure: 7000 });
  });
  it("reports shares of the opening book in accounts and in rupees", () => {
    expect(by("left")).toMatchObject({ pct: 16.7, exposure: 1000 });
    expect(by("left").exposurePct).toBeCloseTo(6.5, 1);
    expect(by("rolledBack")).toMatchObject({ pct: 33.3, exposure: 2500 });
  });
  it("builds the stage-to-stage matrix, with Left as a column", () => {
    const cd3 = m.matrix.find((x) => x.from === "CD3")!;
    expect(cd3.total).toBe(4);
    expect(cd3.to).toEqual({ CD2: 1, CD3: 2, Left: 1 });
    expect(m.matrix.find((x) => x.from === "CD2")!.to).toEqual({ CD1: 1, CD3: 1 });
    expect(m.byStage.find((x) => x.from === "CD3")!.pct).toMatchObject({ left: 25, rolledBack: 25, stayedPaidDown: 25, stayed: 25, rolledForward: 0 });
  });
  it("counts an account once when it is in both flows, preferring the NEW flow", () => {
    const x = movementOf("a", [r("X", 3, 100, "MANUAL"), r("X", 3, 900, "NEW")], "b", [r("X", 3, 900, "NEW"), r("X", 3, 5, "MANUAL")]);
    expect([x.opening.accounts, x.opening.exposure]).toEqual([1, 900]);   // the NEW row (900), not the MANUAL one (100)
    expect(x.outcomes.find((o) => o.key === "stayed")!.accounts).toBe(1);
  });
  it("does not call an unknown stage a roll, and is safe on empty snapshots", () => {
    const u = movementOf("a", [r("U", null, 100)], "b", [r("U", 3, 100)]);
    expect(u.outcomes.find((o) => o.key === "stayed")!.accounts).toBe(1);
    const e = movementOf("a", [], "b", []);
    expect([e.opening.accounts, e.outcomes.every((o) => o.pct === 0), e.matrix]).toEqual([0, true, []]);
  });
  it("treats a tiny fall in amount due as unchanged", () => {
    expect(movementOf("a", [r("T", 3, 100)], "b", [r("T", 3, 99.8)]).outcomes.find((o) => o.key === "stayed")!.accounts).toBe(1);
  });
});
