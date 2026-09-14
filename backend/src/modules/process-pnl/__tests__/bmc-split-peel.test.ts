import { describe, expect, it } from "vitest";
import { allocatePoolAmount } from "../bpo-pnl.calculation.js";

/**
 * The double-count trap in peel-before-pooling.
 *
 * Support staff (`bmc_people`, 160 people and about Rs 39.5 lakh a month) are pooled per branch
 * and spread by the allocation driver. When finance records what someone actually splits across,
 * that person must be posted directly AND removed from the pool. Doing only the first counts
 * their salary twice — once directly, once as a share of the pool they are still in — and the
 * error is invisible because both figures look reasonable on their own.
 *
 * These tests model the arithmetic of getPeopleCosts' peel step directly. The invariant they
 * pin is the one that makes the change safe to ship: total people cost is identical whether or
 * not a split exists. Only where the money lands changes.
 */

interface Person { id: string; cost: number; branchId: string }

/** Mirrors the peel in getPeopleCosts: split people post direct, everyone else pools. */
function peel(
  people: Person[],
  splits: Map<string, { processId: string; pct: number }[]>,
) {
  const direct = new Map<string, number>();
  const pool = new Map<string, number>();
  const unbalanced: { id: string; percentTotal: number }[] = [];

  for (const person of people) {
    const split = splits.get(person.id);
    if (split && split.length > 0) {
      const outcome = allocatePoolAmount(
        person.cost,
        split.map((s) => ({ key: s.processId, weight: s.pct })),
        "manual_percentage",
      );
      let posted = 0;
      for (const [processId, amount] of outcome.amounts.entries()) {
        direct.set(processId, (direct.get(processId) ?? 0) + amount);
        posted += amount;
      }
      if (!outcome.balanced) unbalanced.push({ id: person.id, percentTotal: outcome.percentTotal ?? 0 });
      const remainder = person.cost - posted;
      if (Math.abs(remainder) > 0.005) {
        pool.set(person.branchId, (pool.get(person.branchId) ?? 0) + remainder);
      }
      continue;
    }
    pool.set(person.branchId, (pool.get(person.branchId) ?? 0) + person.cost);
  }

  const total = [...direct.values()].reduce((a, b) => a + b, 0)
    + [...pool.values()].reduce((a, b) => a + b, 0);
  return { direct, pool, unbalanced, total };
}

const PEOPLE: Person[] = [
  { id: "e1", cost: 45_000, branchId: "b1" },
  { id: "e2", cost: 62_500.37, branchId: "b1" },
  { id: "e3", cost: 38_250, branchId: "b2" },
];
const GROSS = PEOPLE.reduce((a, p) => a + p.cost, 0);

describe("bmc split — peel before pooling", () => {
  it("leaves total people cost identical when a split is introduced", async () => {
    const without = peel(PEOPLE, new Map());
    const with_ = peel(PEOPLE, new Map([
      ["e2", [{ processId: "p1", pct: 60 }, { processId: "p2", pct: 40 }]],
    ]));
    expect(without.total).toBeCloseTo(GROSS, 2);
    expect(
      with_.total,
      "a split must move cost between buckets, never create or destroy any",
    ).toBeCloseTo(GROSS, 2);
  });

  it("removes a split person from the branch pool entirely", async () => {
    const result = peel(PEOPLE, new Map([
      ["e2", [{ processId: "p1", pct: 60 }, { processId: "p2", pct: 40 }]],
    ]));
    // b1 held e1 + e2; after the peel it must hold e1 alone, or e2 is counted twice.
    expect(result.pool.get("b1")).toBeCloseTo(45_000, 2);
    expect(result.direct.get("p1")! + result.direct.get("p2")!).toBeCloseTo(62_500.37, 2);
  });

  it("stays exact on an amount that will not divide evenly", async () => {
    /*
     * allocatePoolAmount rounds each manual share independently rather than by largest
     * remainder — that is reserved for weighted/equal mode, which has a pool to reconcile
     * against. So three shares of 33.3333/33.3333/33.3334 on Rs 62,500.37 post Rs 62,500.38:
     * a paisa MORE than the person cost.
     *
     * That is why the peel books `cost - posted` rather than assuming the split consumed
     * exactly the salary. Here the remainder is negative one paisa and returns to the pool,
     * so the branch total absorbs the rounding and nothing is invented. Asserting that the
     * direct postings alone equal the cost would be asserting something untrue.
     */
    const result = peel(
      [{ id: "e2", cost: 62_500.37, branchId: "b1" }],
      new Map([["e2", [
        { processId: "p1", pct: 33.3333 },
        { processId: "p2", pct: 33.3333 },
        { processId: "p3", pct: 33.3334 },
      ]]]),
    );
    const posted = [...result.direct.values()].reduce((a, b) => a + b, 0);
    expect(posted).toBeCloseTo(62_500.38, 2);
    expect(result.pool.get("b1")).toBeCloseTo(-0.01, 2);
    expect(result.total, "the paisa must be absorbed, not created").toBeCloseTo(62_500.37, 2);
  });

  it("keeps the uncovered remainder in the pool and flags the imbalance", async () => {
    // A 90% split must not be silently inflated to 100. The missing tenth stays poolable and
    // the warning names the employee, because a quietly-renormalised split is unauditable.
    const result = peel(
      [{ id: "e2", cost: 100_000, branchId: "b1" }],
      new Map([["e2", [{ processId: "p1", pct: 90 }]]]),
    );
    expect(result.unbalanced).toEqual([{ id: "e2", percentTotal: 90 }]);
    expect(result.direct.get("p1")).toBeCloseTo(90_000, 2);
    expect(result.pool.get("b1"), "the uncovered 10% must survive, not vanish").toBeCloseTo(10_000, 2);
    expect(result.total).toBeCloseTo(100_000, 2);
  });
});
