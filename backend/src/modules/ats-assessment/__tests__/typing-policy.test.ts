import { describe, expect, it } from "vitest";
import {
  mergeTypingDefinition,
  typingBenchmarksFor,
  type TypingDefinition,
} from "../assessment.catalog.js";

function typing(overrides: Partial<TypingDefinition> = {}): TypingDefinition {
  return {
    required: true,
    durationSeconds: 180,
    minNetWpm: 30,
    minAccuracy: 95,
    maxAttempts: 2,
    passage: "A sufficiently long fixed typing passage used only for policy unit tests.",
    ...overrides,
  };
}

describe("typing benchmark policy", () => {
  it("uses the standard 95 percent data-entry accuracy floor", () => {
    expect(typingBenchmarksFor("backoffice", "executive")).toEqual({
      minNetWpm: 30,
      minAccuracy: 95,
    });
  });

  it("uses 97 percent for quality auditors and 98 percent for document work", () => {
    expect(typingBenchmarksFor("backoffice", "quality_auditor").minAccuracy).toBe(97);
    expect(typingBenchmarksFor("document", "executive").minAccuracy).toBe(98);
    expect(typingBenchmarksFor("document", "quality_auditor").minAccuracy).toBe(98);
  });

  it("allows a passage to raise but never lower the assigned policy", () => {
    const base = typing({ minNetWpm: 35, minAccuracy: 98, maxAttempts: 2 });
    const weakPassage = typing({ minNetWpm: 20, minAccuracy: 92, maxAttempts: 5 });
    const merged = mergeTypingDefinition(base, weakPassage);

    expect(merged.minNetWpm).toBe(35);
    expect(merged.minAccuracy).toBe(98);
    expect(merged.maxAttempts).toBe(2);
    expect(merged.passage).toBe(weakPassage.passage);
  });

  it("retains a stricter passage benchmark", () => {
    const base = typing({ minNetWpm: 30, minAccuracy: 95 });
    const strictPassage = typing({ minNetWpm: 40, minAccuracy: 99 });
    const merged = mergeTypingDefinition(base, strictPassage);

    expect(merged.minNetWpm).toBe(40);
    expect(merged.minAccuracy).toBe(99);
  });
});
