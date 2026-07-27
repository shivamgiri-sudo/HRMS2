import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const moduleRoot = path.resolve(__dirname, "..");

function source(filename: string) {
  return fs.readFileSync(path.join(moduleRoot, filename), "utf8");
}

describe("typing scoring integration contracts", () => {
  it("uses server-authoritative elapsed time without counting network grace", () => {
    const service = source("assessment.service.ts");
    expect(service).toContain("const elapsed = Math.min(actualElapsed, durationLimitSeconds)");
    expect(service).not.toContain(
      "Math.min(actualElapsed, Number(typing.duration_limit_seconds) + TYPING_GRACE_SECONDS)",
    );
  });

  it("blocks early incomplete samples but permits timer-end partial attempts", () => {
    const service = source("assessment.service.ts");
    expect(service).toContain("TYPING_SAMPLE_INCOMPLETE");
    expect(service).toContain(
      "actualElapsed < durationLimitSeconds - 2 && scored.completionPercentage < 100",
    );
  });

  it("requires enough overall assessment time before starting typing", () => {
    const service = source("assessment.service.ts");
    expect(service).toContain("INSUFFICIENT_TIME_FOR_TYPING");
    expect(service).toContain(
      "assessmentSecondsRemaining < definition.typing.durationSeconds + 5",
    );
  });

  it("selects a passed attempt before comparing ranking score", () => {
    const service = source("assessment.service.ts");
    const expectedOrder =
      "ORDER BY passed_benchmark DESC, score_percentage DESC, accuracy_percentage DESC, net_wpm DESC, attempt_no ASC";
    expect(service.split(expectedOrder).length - 1).toBeGreaterThanOrEqual(2);
    expect(service).not.toContain("ORDER BY score_percentage DESC, attempt_no ASC");
  });

  it("uses one coherent best attempt in recruiter summaries", () => {
    const service = source("assessment.service.ts");
    expect(service).toContain("LEFT JOIN ats_typing_test_attempt best_typing");
    expect(service).toContain("best_typing.net_wpm AS best_net_wpm");
    expect(service).toContain("best_typing.accuracy_percentage AS best_accuracy");
    expect(service).not.toContain("SELECT MAX(net_wpm)");
    expect(service).not.toContain("SELECT MAX(accuracy_percentage)");
  });

  it("uses 95, 97 and 98 percent accuracy benchmarks by work risk", () => {
    const catalog = source("assessment.catalog.ts");
    expect(catalog).toContain(
      'minAccuracy: process === "document" ? 98 : role === "quality_auditor" ? 97 : 95',
    );
    expect(catalog).not.toContain('minAccuracy: role === "executive" ? 92 : 95');
  });

  it("prevents passage-bank records from weakening template policy", () => {
    const bank = source("question-bank.service.ts");
    expect(bank).toContain("mergeTypingDefinition(baseTemplate.typing, passageResult.typing)");
    expect(bank).toContain("Math.max(policy.minAccuracy, requestedAccuracy)");
    expect(bank).toContain("character_count BETWEEN 150 AND 2500");
    expect(bank).not.toContain("p.minAccuracyBenchmark ?? 92");
  });

  it("keeps browser live accuracy aligned with attempted-text scoring", () => {
    const page = source("assessment.page.ts");
    expect(page).toContain("function attemptedTypingMetrics(reference,typed)");
    expect(page).toContain("attempted.accuracy.toFixed(1)");
    expect(page).toContain("attempted-text estimated accuracy");
    expect(page).not.toContain(
      "const distance=levenshtein(typingState.passage,text)",
    );
  });

  it("persists scoring version and completion evidence", () => {
    const service = source("assessment.service.ts");
    expect(service).toContain("completionPercentage: scored.completionPercentage");
    expect(service).toContain("scoringVersion: scored.scoringVersion");
    expect(service).toContain("completionPercentage: result ? Number(result.completionPercentage ?? 0) : null");
  });

  it("bounds submitted text and scoring memory", () => {
    const scoring = source("typing-scoring.ts");
    const service = source("assessment.service.ts");
    expect(scoring).toContain("MAX_TYPING_SCORE_CHARACTERS = 2_500");
    expect(scoring).toContain("new Uint32Array(columns)");
    expect(scoring).toContain("let previous = new Uint32Array(actual.length + 1)");
    expect(service).toContain("MAX_TYPING_TEXT_LENGTH = MAX_TYPING_SCORE_CHARACTERS");
  });

  it("documents the approved formulas", () => {
    const readme = source("README.md");
    expect(readme).toContain(
      "net WPM = max(0, typed characters - Levenshtein errors) / 5 / elapsed minutes",
    );
    expect(readme).toContain("60% accuracy / 40% speed ranking score");
  });
});
