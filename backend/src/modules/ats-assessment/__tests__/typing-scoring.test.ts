import { describe, expect, it } from "vitest";
import {
  buildWordDiff,
  calculateLiveTypingMetrics,
  calculateTypingScore,
  canSubmitEarly,
  isPassageComplete,
  levenshteinDistance,
  selectBestTypingAttempt,
  TYPING_SCORE_VERSION,
} from "../typing-scoring.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function score(opts: {
  ref?: string;
  typed?: string;
  elapsed?: number;
  minNetWpm?: number;
  minAccuracy?: number;
}) {
  return calculateTypingScore({
    referenceText: opts.ref ?? "the quick brown fox jumps over the lazy dog",
    typedText: opts.typed ?? "",
    elapsedSeconds: opts.elapsed ?? 60,
    minNetWpm: opts.minNetWpm ?? 30,
    minAccuracy: opts.minAccuracy ?? 95,
  });
}

// ---------------------------------------------------------------------------
// 1. Score version tag
// ---------------------------------------------------------------------------

describe("score version", () => {
  it("every result carries the v2 version tag", () => {
    const result = score({ typed: "hello" });
    expect(result.scoreVersion).toBe(TYPING_SCORE_VERSION);
    expect(result.scoreVersion).toBe("typing-score-v2");
  });
});

// ---------------------------------------------------------------------------
// 2. Gross WPM — typed characters / 5 / elapsed minutes
// ---------------------------------------------------------------------------

describe("grossWpm", () => {
  it("exact boundary: 150 chars in 60 s = 30 WPM", () => {
    const result = calculateTypingScore({
      referenceText: "x".repeat(200),
      typedText: "x".repeat(150),
      elapsedSeconds: 60,
      minNetWpm: 30,
      minAccuracy: 95,
    });
    expect(result.grossWpm).toBe(30);
  });

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
});

// ---------------------------------------------------------------------------
// 3. Accuracy — over the portion actually attempted
// ---------------------------------------------------------------------------

describe("accuracy over attempted portion", () => {
  it("partial passage: accuracy is 100% when all typed chars are correct", () => {
    const result = calculateTypingScore({
      referenceText: "the quick brown fox jumps over the lazy dog",
      typedText: "the quick",
      elapsedSeconds: 60,
      minNetWpm: 10,
      minAccuracy: 95,
    });
    expect(result.accuracy).toBe(100);
  });

  it("untouched remainder does not inflate error count", () => {
    const result = calculateTypingScore({
      referenceText: "abcdefghij",
      typedText: "abc",
      elapsedSeconds: 60,
      minNetWpm: 1,
      minAccuracy: 50,
    });
    // accuracy = 3/3 = 100%, not 3/10
    expect(result.accuracy).toBe(100);
    expect(result.missingCharacters).toBe(7);
  });

  it("spelling substitution reduces accuracy — 'teh' for 'the'", () => {
    const result = calculateTypingScore({
      referenceText: "the",
      typedText: "teh",
      elapsedSeconds: 6,
      minNetWpm: 1,
      minAccuracy: 95,
    });
    expect(result.accuracy).toBeLessThan(100);
    expect(result.incorrectCharacters + result.missingCharacters + result.extraCharacters).toBeGreaterThan(0);
  });

  it("insertion: extra typed character reduces accuracy", () => {
    const result = calculateTypingScore({
      referenceText: "cat",
      typedText: "cart",
      elapsedSeconds: 6,
      minNetWpm: 1,
      minAccuracy: 95,
    });
    expect(result.accuracy).toBeLessThan(100);
  });

  it("deletion: skipped reference character counts as missing, typed portion accuracy stays 100%", () => {
    // "cat" is "cast" minus 's'. The 3 typed chars are all correct.
    // Accuracy = over portion attempted = 3/3 = 100% (spec: untouched chars affect speed, not accuracy).
    const result = calculateTypingScore({
      referenceText: "cast",
      typedText: "cat",
      elapsedSeconds: 6,
      minNetWpm: 1,
      minAccuracy: 95,
    });
    expect(result.accuracy).toBe(100);
    expect(result.missingCharacters).toBeGreaterThanOrEqual(1); // 's' never typed
    expect(result.correctCharacters).toBe(3);
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
});

// ---------------------------------------------------------------------------
// 4. Net WPM = max(0, typed − errors) / 5 / elapsed minutes
// ---------------------------------------------------------------------------

describe("netWpm", () => {
  it("equals grossWpm when all characters are correct", () => {
    const result = calculateTypingScore({
      referenceText: "x".repeat(150),
      typedText: "x".repeat(150),
      elapsedSeconds: 60,
      minNetWpm: 30,
      minAccuracy: 95,
    });
    expect(result.netWpm).toBe(result.grossWpm);
  });

  it("never goes below 0", () => {
    const result = calculateTypingScore({
      referenceText: "aaa",
      typedText: "zzz",
      elapsedSeconds: 6,
      minNetWpm: 5,
      minAccuracy: 50,
    });
    expect(result.netWpm).toBeGreaterThanOrEqual(0);
  });

  it("exact boundary: 30 correct chars, 0 errors, 60 s → netWpm = 6", () => {
    const result = calculateTypingScore({
      referenceText: "x".repeat(30),
      typedText: "x".repeat(30),
      elapsedSeconds: 60,
      minNetWpm: 5,
      minAccuracy: 95,
    });
    expect(result.netWpm).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// 5. Score = 60% accuracy + 40% normalised speed
// ---------------------------------------------------------------------------

describe("score formula", () => {
  it("perfect accuracy and at-benchmark speed → score = 100", () => {
    const result = calculateTypingScore({
      referenceText: "x".repeat(30),
      typedText: "x".repeat(30),
      elapsedSeconds: 60,
      minNetWpm: 6,
      minAccuracy: 95,
    });
    expect(result.accuracy).toBe(100);
    expect(result.score).toBe(100);
  });

  it("50% accuracy, speed above benchmark → score = 70", () => {
    // "aXcX" vs "abcd": c matches, a matches → 2/4 correct
    const result = calculateTypingScore({
      referenceText: "abcd",
      typedText: "aXcX",
      elapsedSeconds: 1,
      minNetWpm: 1,
      minAccuracy: 95,
    });
    expect(result.accuracy).toBe(50);
    // score = 0.6*50 + 0.4*100 = 70
    expect(result.score).toBe(70);
  });

  it("accuracy weight (60%) exceeds speed weight (40%)", () => {
    const highAccLowSpeed = calculateTypingScore({
      referenceText: "x".repeat(5),
      typedText: "x".repeat(5),
      elapsedSeconds: 300,
      minNetWpm: 50,
      minAccuracy: 95,
    });
    const lowAccHighSpeed = calculateTypingScore({
      referenceText: "x".repeat(100),
      typedText: "z".repeat(100),
      elapsedSeconds: 1,
      minNetWpm: 1,
      minAccuracy: 95,
    });
    expect(highAccLowSpeed.accuracy).toBe(100);
    expect(lowAccHighSpeed.accuracy).toBe(0);
    expect(highAccLowSpeed.score).toBeGreaterThan(lowAccHighSpeed.score);
  });
});

// ---------------------------------------------------------------------------
// 6. passedBenchmark: BOTH thresholds required independently
// ---------------------------------------------------------------------------

describe("passedBenchmark", () => {
  it("fails when only accuracy threshold is met (speed too low)", () => {
    const result = calculateTypingScore({
      referenceText: "x".repeat(60),
      typedText: "x".repeat(60),
      elapsedSeconds: 600, // netWpm = 60/5/10 = 1.2 < 30
      minNetWpm: 30,
      minAccuracy: 95,
    });
    expect(result.accuracy).toBe(100);
    expect(result.netWpm).toBeLessThan(30);
    expect(result.passedBenchmark).toBe(false);
  });

  it("fails when only speed threshold is met (accuracy too low)", () => {
    const result = calculateTypingScore({
      referenceText: "aaa",
      typedText: "zzz",
      elapsedSeconds: 1,
      minNetWpm: 1,
      minAccuracy: 95,
    });
    expect(result.accuracy).toBe(0);
    expect(result.passedBenchmark).toBe(false);
  });

  it("passes when both thresholds met exactly — boundary value", () => {
    const result = calculateTypingScore({
      referenceText: "x".repeat(300),
      typedText: "x".repeat(300),
      elapsedSeconds: 60,
      minNetWpm: 60,
      minAccuracy: 100,
    });
    expect(result.netWpm).toBeGreaterThanOrEqual(60);
    expect(result.accuracy).toBeGreaterThanOrEqual(100);
    expect(result.passedBenchmark).toBe(true);
  });

  it("standard accuracy threshold 95: perfect typing passes", () => {
    const result = calculateTypingScore({
      referenceText: "a".repeat(100),
      typedText: "a".repeat(100),
      elapsedSeconds: 60,
      minNetWpm: 1,
      minAccuracy: 95,
    });
    expect(result.passedBenchmark).toBe(true);
  });

  it("QA accuracy threshold 97: perfect typing passes", () => {
    const result = calculateTypingScore({
      referenceText: "a".repeat(100),
      typedText: "a".repeat(100),
      elapsedSeconds: 60,
      minNetWpm: 1,
      minAccuracy: 97,
    });
    expect(result.passedBenchmark).toBe(true);
  });

  it("document/data-entry accuracy threshold 98: perfect typing passes", () => {
    const result = calculateTypingScore({
      referenceText: "a".repeat(100),
      typedText: "a".repeat(100),
      elapsedSeconds: 60,
      minNetWpm: 1,
      minAccuracy: 98,
    });
    expect(result.passedBenchmark).toBe(true);
  });

  it("threshold rounding: netWpm exactly equals minNetWpm passes", () => {
    // 150 typed chars in 60 s → netWpm = 150/5/1 = 30
    const result = calculateTypingScore({
      referenceText: "x".repeat(150),
      typedText: "x".repeat(150),
      elapsedSeconds: 60,
      minNetWpm: 30,
      minAccuracy: 95,
    });
    expect(result.netWpm).toBe(30);
    expect(result.passedBenchmark).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Blank attempt
// ---------------------------------------------------------------------------

describe("blank attempt", () => {
  it("zero typed chars → accuracy = 0, netWpm = 0, score = 0, passedBenchmark = false", () => {
    const result = score({ typed: "", elapsed: 60 });
    expect(result.accuracy).toBe(0);
    expect(result.netWpm).toBe(0);
    expect(result.grossWpm).toBe(0);
    expect(result.score).toBe(0);
    expect(result.passedBenchmark).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. Complete attempt
// ---------------------------------------------------------------------------

describe("complete attempt", () => {
  it("full passage typed correctly → accuracy = 100, all diff items correct", () => {
    const ref = "hello world";
    const result = calculateTypingScore({
      referenceText: ref,
      typedText: ref,
      elapsedSeconds: 60,
      minNetWpm: 5,
      minAccuracy: 95,
    });
    expect(result.accuracy).toBe(100);
    expect(result.diff.every((d) => d.status === "correct")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. Network delay — grace must NOT reduce WPM
// ---------------------------------------------------------------------------

describe("network delay / grace", () => {
  it("capping elapsed at duration_limit gives higher WPM than uncapped", () => {
    const capped = calculateTypingScore({
      referenceText: "x".repeat(150),
      typedText: "x".repeat(150),
      elapsedSeconds: 180,
      minNetWpm: 30,
      minAccuracy: 95,
    });
    const uncapped = calculateTypingScore({
      referenceText: "x".repeat(150),
      typedText: "x".repeat(150),
      elapsedSeconds: 190,
      minNetWpm: 30,
      minAccuracy: 95,
    });
    expect(capped.grossWpm).toBeGreaterThan(uncapped.grossWpm);
  });
});

// ---------------------------------------------------------------------------
// 10. Expired attempt
// ---------------------------------------------------------------------------

describe("expired attempt", () => {
  it("elapsed is stored as full duration when timer expires", () => {
    const result = calculateTypingScore({
      referenceText: "x".repeat(300),
      typedText: "x".repeat(150),
      elapsedSeconds: 180,
      minNetWpm: 30,
      minAccuracy: 95,
    });
    expect(result.elapsedSeconds).toBe(180);
    expect(result.grossWpm).toBeCloseTo(150 / 5 / 3, 2);
  });
});

// ---------------------------------------------------------------------------
// 11. Early tiny-sample guard
// ---------------------------------------------------------------------------

describe("canSubmitEarly / early-submit guard", () => {
  const REF = "the quick brown fox jumps over the lazy dog";

  it("rejects blank typed text", () => {
    expect(canSubmitEarly(REF, "")).toBe(false);
  });

  it("rejects very short partial text (3 chars)", () => {
    expect(canSubmitEarly(REF, "the")).toBe(false);
  });

  it("allows a genuinely completed passage", () => {
    expect(canSubmitEarly(REF, REF)).toBe(true);
  });

  it("allows typed text that exceeds the passage length", () => {
    expect(canSubmitEarly(REF, REF + " extra")).toBe(true);
  });

  it("isPassageComplete: false when typed < refLen", () => {
    expect(isPassageComplete(REF, "the quick")).toBe(false);
  });

  it("isPassageComplete: true when typed >= refLen", () => {
    expect(isPassageComplete(REF, REF)).toBe(true);
  });

  it("isPassageComplete: true when typed exceeds refLen", () => {
    expect(isPassageComplete("abc", "abcdef")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 12. Retry — two failed attempts → best by score
//     One failed + one passed → passed wins regardless of score
// ---------------------------------------------------------------------------

describe("selectBestTypingAttempt", () => {
  it("two failed attempts → higher score selected", () => {
    const best = selectBestTypingAttempt([
      { attempt_no: 1, passed_benchmark: 0, score_percentage: 45 },
      { attempt_no: 2, passed_benchmark: 0, score_percentage: 62 },
    ]);
    expect(best?.attempt_no).toBe(2);
  });

  it("one failed + one passed → passed wins even with lower score", () => {
    const best = selectBestTypingAttempt([
      { attempt_no: 1, passed_benchmark: 0, score_percentage: 95 },
      { attempt_no: 2, passed_benchmark: 1, score_percentage: 70 },
    ]);
    expect(best?.attempt_no).toBe(2);
    expect(best?.passed_benchmark).toBe(1);
  });

  it("two passed attempts → higher score wins", () => {
    const best = selectBestTypingAttempt([
      { attempt_no: 1, passed_benchmark: 1, score_percentage: 80 },
      { attempt_no: 2, passed_benchmark: 1, score_percentage: 92 },
    ]);
    expect(best?.attempt_no).toBe(2);
  });

  it("tie on score and pass/fail → earlier attempt_no wins", () => {
    const best = selectBestTypingAttempt([
      { attempt_no: 2, passed_benchmark: 1, score_percentage: 85 },
      { attempt_no: 1, passed_benchmark: 1, score_percentage: 85 },
    ]);
    expect(best?.attempt_no).toBe(1);
  });

  it("returns undefined for empty list", () => {
    expect(selectBestTypingAttempt([])).toBeUndefined();
  });

  it("returns the only attempt when there is one", () => {
    expect(
      selectBestTypingAttempt([{ attempt_no: 1, passed_benchmark: 1, score_percentage: 77 }])?.attempt_no,
    ).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 13. Word diff — partial passage, insertion, deletion, substitution
// ---------------------------------------------------------------------------

describe("buildWordDiff", () => {
  it("exact match → all words correct", () => {
    const diff = buildWordDiff("one two three", "one two three");
    expect(diff.items.every((i) => i.status === "correct")).toBe(true);
    expect(diff.correctWords).toBe(3);
    expect(diff.incorrectWords).toBe(0);
  });

  it("keeps later words aligned after one inserted word", () => {
    const diff = buildWordDiff(
      "accurate data entry matters every day",
      "accurate extra data entry matters every day",
    );
    expect(diff.items.filter((item) => item.status === "extra")).toHaveLength(1);
    expect(diff.items.filter((item) => item.status === "correct")).toHaveLength(6);
  });

  it("deletion: missing word flagged as missing, rest aligned", () => {
    const diff = buildWordDiff("the quick brown fox", "the brown fox");
    const missing = diff.items.filter((i) => i.status === "missing");
    expect(missing).toHaveLength(1);
    expect(missing[0].expected).toBe("quick");
    expect(diff.correctWords).toBe(3);
  });

  it("substitution: single wrong word flagged as incorrect", () => {
    const diff = buildWordDiff("the quick brown fox", "the slow brown fox");
    const subs = diff.items.filter((i) => i.status === "incorrect");
    expect(subs).toHaveLength(1);
    expect(subs[0].expected).toBe("quick");
    expect(subs[0].typed).toBe("slow");
  });
});

// ---------------------------------------------------------------------------
// 14. Live metrics — no diff / expected fields leaked
// ---------------------------------------------------------------------------

describe("calculateLiveTypingMetrics", () => {
  it("returns grossWpm > 0 and estimatedAccuracy < 100 for a partial mis-typed passage", () => {
    const live = calculateLiveTypingMetrics({
      referenceText: "accurate data entry matters",
      typedText: "accurate date entry",
      elapsedSeconds: 30,
    });
    expect(live.grossWpm).toBeGreaterThan(0);
    expect(live.estimatedAccuracy).toBeLessThan(100);
  });

  it("never includes diff, expected, or reference fields", () => {
    const live = calculateLiveTypingMetrics({
      referenceText: "accurate data entry matters",
      typedText: "accurate date entry",
      elapsedSeconds: 30,
    });
    expect("diff" in live).toBe(false);
    expect("expected" in live).toBe(false);
    expect("reference" in live).toBe(false);
  });

  it("returns detailed word feedback only from final scoring", () => {
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

// ---------------------------------------------------------------------------
// 15. Timezone handling — elapsed seconds are numeric and timezone-agnostic
// ---------------------------------------------------------------------------

describe("timezone handling", () => {
  it("produces finite WPM/accuracy for all valid elapsed-second values", () => {
    for (const elapsed of [1, 30, 60, 180, 240, 3600]) {
      const result = calculateTypingScore({
        referenceText: "test passage",
        typedText: "test passage",
        elapsedSeconds: elapsed,
        minNetWpm: 1,
        minAccuracy: 90,
      });
      expect(Number.isFinite(result.grossWpm)).toBe(true);
      expect(Number.isFinite(result.netWpm)).toBe(true);
      expect(Number.isFinite(result.accuracy)).toBe(true);
    }
  });

  it("zero or negative elapsed is floored to 1 second (no division by zero)", () => {
    const result = calculateTypingScore({
      referenceText: "abc",
      typedText: "abc",
      elapsedSeconds: 0,
      minNetWpm: 1,
      minAccuracy: 90,
    });
    expect(result.elapsedSeconds).toBe(1);
    expect(Number.isFinite(result.grossWpm)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 16. Levenshtein distance
// ---------------------------------------------------------------------------

describe("levenshteinDistance", () => {
  it("identical strings → 0", () => {
    expect(levenshteinDistance("kitten", "kitten")).toBe(0);
  });

  it("empty vs non-empty → length of the non-empty string", () => {
    expect(levenshteinDistance("", "abc")).toBe(3);
    expect(levenshteinDistance("abc", "")).toBe(3);
  });

  it("kitten → sitting = 3", () => {
    expect(levenshteinDistance("kitten", "sitting")).toBe(3);
  });
});
