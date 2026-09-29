import { describe, expect, it } from "vitest";
import { arrange, type PortfolioRow } from "../ProcessPortfolio";

const row = (o: Partial<PortfolioRow>): PortfolioRow => ({
  processId: "1", processName: "P", processCode: null, branchName: "NOIDA", headcount: 1, metrics: 10, pass: 1, fail: 1, none: 8, score: 50,
  newestDate: "2026-09-10", staleDays: 20, feedStopped: true, worst: null, ...o,
});

describe("process portfolio arrangement", () => {
  const rows = [
    row({ processId: "a", processName: "Alpha", score: 80, fail: 1, staleDays: 1, feedStopped: false }),
    row({ processId: "b", processName: "Bravo", score: 10, fail: 5, staleDays: 20 }),
    row({ processId: "c", processName: "Charlie", score: null, pass: 0, fail: 0, none: 10, staleDays: 5 }),
    row({ processId: "d", processName: "Delta", metrics: 0, score: null, pass: 0, fail: 0, none: 0 }),
  ];
  const ids = (r: PortfolioRow[]) => r.map((x) => x.processId).join("");

  it("drops processes with no metrics and sorts lowest health first, untargeted last", () => {
    expect(ids(arrange(rows, "", "all", "health"))).toBe("bac");
  });
  it("sorts by stalest feed, then name", () => {
    expect(ids(arrange(rows, "", "all", "stale"))).toBe("bca");
    expect(ids(arrange(rows, "", "all", "name"))).toBe("abc");
  });
  it("filters: below target, stopped feed, no targets, and text search", () => {
    expect(ids(arrange(rows, "", "below", "name"))).toBe("ab");
    expect(ids(arrange(rows, "", "stopped", "name"))).toBe("bc");
    expect(ids(arrange(rows, "", "notargets", "name"))).toBe("c");
    expect(ids(arrange(rows, "brav", "all", "name"))).toBe("b");
    expect(ids(arrange(rows, "noida", "all", "name"))).toBe("abc");
  });
});
