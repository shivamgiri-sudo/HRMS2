import { describe, expect, it } from "vitest";
import {
  buildWordDiff,
  calculateLiveTypingMetrics,
  calculateTypingScore,
} from "../typing-scoring.js";

describe("typing scoring", () => {
  it("returns perfect accuracy and aligned words for exact text", () => {
    const result = calculateTypingScore({
      referenceText: "one two three four five",
      typedText: "one two three four five",
      elapsedSeconds: 12,
      minNetWpm: 20,
      minAccuracy: 90,
    });
    expect(result.accuracy).toBe(100);
    expect(result.editDistance).toBe(0);
    expect(result.incorrectCharacters).toBe(0);
    expect(result.missingCharacters).toBe(0);
    expect(result.extraCharacters).toBe(0);
    expect(result.correctWords).toBe(5);
    expect(result.diff.every((item) => item.status === "correct")).toBe(true);
  });

  it("keeps later words aligned after one inserted word", () => {
    const diff = buildWordDiff(
      "accurate data entry matters every day",
      "accurate extra data entry matters every day",
    );
    expect(diff.items.filter((item) => item.status === "extra")).toHaveLength(1);
    expect(diff.items.filter((item) => item.status === "correct")).toHaveLength(6);
  });

  it("separates substituted, missing, and extra characters", () => {
    const result = calculateTypingScore({
      referenceText: "abc def",
      typedText: "abX deff",
      elapsedSeconds: 30,
      minNetWpm: 5,
      minAccuracy: 70,
    });
    expect(result.incorrectCharacters).toBeGreaterThanOrEqual(1);
    expect(result.extraCharacters).toBeGreaterThanOrEqual(1);
    expect(result.accuracy).toBeLessThan(100);
  });

  it("returns detailed word feedback only from final scoring", () => {
    const live = calculateLiveTypingMetrics({
      referenceText: "accurate data entry matters",
      typedText: "accurate date entry",
      elapsedSeconds: 30,
    });
    expect(live.grossWpm).toBeGreaterThan(0);
    expect(live.estimatedAccuracy).toBeLessThan(100);
    expect("diff" in live).toBe(false);
    expect("expected" in live).toBe(false);

    const final = calculateTypingScore({
      referenceText: "accurate data entry matters",
      typedText: "accurate date entry matters today",
      elapsedSeconds: 30,
      minNetWpm: 30,
      minAccuracy: 95,
    });
    expect(final.diff.some((item) => item.status === "incorrect")).toBe(true);
    expect(final.diff.some((item) => item.status === "extra")).toBe(true);
  });
});
