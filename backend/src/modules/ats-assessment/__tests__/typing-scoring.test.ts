import { describe, expect, it } from "vitest";
import {
  buildWordDiff,
  calculateLiveTypingMetrics,
  calculateTypingScore,
  normalizeTypingText,
  resolveAttemptedReference,
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
    expect(result.scoringVersion).toBe("typing-score-v2");
    expect(result.accuracy).toBe(100);
    expect(result.editDistance).toBe(0);
    expect(result.incorrectCharacters).toBe(0);
    expect(result.missingCharacters).toBe(0);
    expect(result.extraCharacters).toBe(0);
    expect(result.correctWords).toBe(5);
    expect(result.completionPercentage).toBe(100);
    expect(result.diff.every((item) => item.status === "correct")).toBe(true);
  });

  it("does not count the untouched passage remainder as accuracy errors", () => {
    const reference = "accurate data entry matters every day";
    const typed = "accurate data entry";
    const result = calculateTypingScore({
      referenceText: reference,
      typedText: typed,
      elapsedSeconds: 30,
      minNetWpm: 20,
      minAccuracy: 95,
    });

    expect(result.accuracy).toBe(100);
    expect(result.missingCharacters).toBe(0);
    expect(result.referenceCharactersEvaluated).toBe(Array.from(typed).length);
    expect(result.referenceCharactersEvaluated).toBeLessThan(result.referenceCharacters);
    expect(result.completionPercentage).toBeLessThan(100);
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

  it("prefers the longer attempted prefix when a deleted character creates a tie", () => {
    const resolved = resolveAttemptedReference("abc", "ac");
    expect(resolved.attemptedReference).toBe("abc");

    const result = calculateTypingScore({
      referenceText: "abc",
      typedText: "ac",
      elapsedSeconds: 12,
      minNetWpm: 1,
      minAccuracy: 60,
    });
    expect(result.missingCharacters).toBe(1);
    expect(result.accuracy).toBe(66.67);
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
    expect(result.netWpm).toBeLessThanOrEqual(result.grossWpm);
  });

  it("uses attempted-text accuracy for live metrics instead of the full passage", () => {
    const live = calculateLiveTypingMetrics({
      referenceText: "accurate data entry matters every day",
      typedText: "accurate data entry",
      elapsedSeconds: 30,
    });
    expect(live.grossWpm).toBeGreaterThan(0);
    expect(live.estimatedAccuracy).toBe(100);
    expect(live.completionPercentage).toBeLessThan(100);
    expect("diff" in live).toBe(false);
    expect("expected" in live).toBe(false);
  });

  it("returns zero accuracy for an empty attempt", () => {
    const result = calculateTypingScore({
      referenceText: "accurate data entry",
      typedText: "",
      elapsedSeconds: 30,
      minNetWpm: 30,
      minAccuracy: 95,
    });
    expect(result.grossWpm).toBe(0);
    expect(result.netWpm).toBe(0);
    expect(result.accuracy).toBe(0);
    expect(result.passedBenchmark).toBe(false);
  });

  it("uses 60 percent accuracy and 40 percent speed in the ranking score", () => {
    const result = calculateTypingScore({
      referenceText: "abcdefghij",
      typedText: "abcdefghiX",
      elapsedSeconds: 6,
      minNetWpm: 18,
      minAccuracy: 80,
    });
    const expectedSpeedScore = Math.min(100, (result.netWpm / 18) * 100);
    expect(result.score).toBeCloseTo((expectedSpeedScore * 0.4) + (result.accuracy * 0.6), 2);
  });

  it("normalizes only platform line endings, non-breaking spaces, and Unicode composition", () => {
    expect(normalizeTypingText("A\r\nB\u00a0é")).toBe("A\nB é");
    expect(normalizeTypingText("e\u0301")).toBe("é");
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
