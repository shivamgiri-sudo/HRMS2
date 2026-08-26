import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The page renders a fixed bucket list. The backend now emits a fifth bucket, In Training, and
 * a column the frontend does not know about is a column nobody sees — the count would vanish
 * from the table while still sitting inside the totals.
 */
const SRC = readFileSync(
  resolve(process.cwd(), "src/components/reports/views/AonAnalyticsView.tsx"), "utf8");

describe("AON view buckets", () => {
  it("renders all five buckets, In Training first", () => {
    const arr = /const BUCKETS\s*=\s*\[([^\]]*)\]/.exec(SRC)?.[1] ?? "";
    expect(arr).toContain('"In Training"');
    for (const b of ["0-30", "31-60", "61-90", "90+"]) expect(arr).toContain(`"${b}"`);
    expect(arr.indexOf('"In Training"')).toBeLessThan(arr.indexOf('"0-30"'));
  });

  it("gives In Training its own colour", () => {
    expect(SRC).toMatch(/"In Training":\s*\w/);
  });
});
