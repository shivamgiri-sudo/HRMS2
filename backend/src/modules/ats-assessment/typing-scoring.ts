export type TypingDiffStatus = "correct" | "incorrect" | "missing" | "extra";

export interface TypingDiffItem {
  index: number;
  expected: string | null;
  typed: string | null;
  status: TypingDiffStatus;
}

export interface LiveTypingMetrics {
  elapsedSeconds: number;
  grossWpm: number;
  estimatedAccuracy: number;
  typedCharacters: number;
}

export interface TypingScoreResult {
  scoreVersion: "typing-score-v2";
  elapsedSeconds: number;
  grossWpm: number;
  netWpm: number;
  accuracy: number;
  editDistance: number;
  correctCharacters: number;
  incorrectCharacters: number;
  missingCharacters: number;
  extraCharacters: number;
  correctWords: number;
  incorrectWords: number;
  score: number;
  passedBenchmark: boolean;
  benchmark: { minNetWpm: number; minAccuracy: number };
  diff: TypingDiffItem[];
}

/** Stored in the DB score_version column so historical rows retain their v1 interpretation. */
export const TYPING_SCORE_VERSION = "typing-score-v2" as const;

type EditOperation = "match" | "substitute" | "delete" | "insert";

const round = (value: number, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const safeSeconds = (value: number) => Math.max(1, Number.isFinite(value) ? value : 1);

function buildEditMatrix<T>(expected: T[], actual: T[], equal: (a: T, b: T) => boolean) {
  const rows = expected.length + 1;
  const columns = actual.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array<number>(columns).fill(0));

  for (let row = 0; row < rows; row += 1) matrix[row][0] = row;
  for (let column = 0; column < columns; column += 1) matrix[0][column] = column;

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const substitutionCost = equal(expected[row - 1], actual[column - 1]) ? 0 : 1;
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + substitutionCost,
      );
    }
  }

  return matrix;
}

function backtrackOperations<T>(
  expected: T[],
  actual: T[],
  matrix: number[][],
  equal: (a: T, b: T) => boolean,
): Array<{ operation: EditOperation; expected: T | null; actual: T | null }> {
  const operations: Array<{ operation: EditOperation; expected: T | null; actual: T | null }> = [];
  let row = expected.length;
  let column = actual.length;

  while (row > 0 || column > 0) {
    if (
      row > 0
      && column > 0
      && equal(expected[row - 1], actual[column - 1])
      && matrix[row][column] === matrix[row - 1][column - 1]
    ) {
      operations.push({ operation: "match", expected: expected[row - 1], actual: actual[column - 1] });
      row -= 1;
      column -= 1;
      continue;
    }

    if (
      row > 0
      && column > 0
      && matrix[row][column] === matrix[row - 1][column - 1] + 1
    ) {
      operations.push({ operation: "substitute", expected: expected[row - 1], actual: actual[column - 1] });
      row -= 1;
      column -= 1;
      continue;
    }

    if (row > 0 && matrix[row][column] === matrix[row - 1][column] + 1) {
      operations.push({ operation: "delete", expected: expected[row - 1], actual: null });
      row -= 1;
      continue;
    }

    operations.push({ operation: "insert", expected: null, actual: actual[column - 1] });
    column -= 1;
  }

  return operations.reverse();
}

export function levenshteinDistance(a: string, b: string): number {
  const expected = Array.from(String(a ?? ""));
  const actual = Array.from(String(b ?? ""));
  const matrix = buildEditMatrix(expected, actual, (left, right) => left === right);
  return matrix[expected.length][actual.length];
}

export function buildWordDiff(reference: string, typed: string) {
  const expected = String(reference ?? "").trim().split(/\s+/).filter(Boolean);
  const actual = String(typed ?? "").trim().split(/\s+/).filter(Boolean);
  const matrix = buildEditMatrix(expected, actual, (left, right) => left === right);
  const operations = backtrackOperations(expected, actual, matrix, (left, right) => left === right);

  let correctWords = 0;
  let incorrectWords = 0;
  const items: TypingDiffItem[] = operations.map((entry, index) => {
    let status: TypingDiffStatus;
    if (entry.operation === "match") {
      status = "correct";
      correctWords += 1;
    } else if (entry.operation === "delete") {
      status = "missing";
      incorrectWords += 1;
    } else if (entry.operation === "insert") {
      status = "extra";
      incorrectWords += 1;
    } else {
      status = "incorrect";
      incorrectWords += 1;
    }

    return {
      index,
      expected: entry.expected,
      typed: entry.actual,
      status,
    };
  });

  return { items, correctWords, incorrectWords };
}

function analyzeCharacters(referenceText: string, typedText: string) {
  const expected = Array.from(referenceText);
  const actual = Array.from(typedText);
  const matrix = buildEditMatrix(expected, actual, (left, right) => left === right);
  const operations = backtrackOperations(expected, actual, matrix, (left, right) => left === right);

  let correctCharacters = 0;
  let incorrectCharacters = 0;
  let missingCharacters = 0;
  let extraCharacters = 0;

  for (const entry of operations) {
    if (entry.operation === "match") correctCharacters += 1;
    else if (entry.operation === "substitute") incorrectCharacters += 1;
    else if (entry.operation === "delete") missingCharacters += 1;
    else extraCharacters += 1;
  }

  return {
    editDistance: matrix[expected.length][actual.length],
    correctCharacters,
    incorrectCharacters,
    missingCharacters,
    extraCharacters,
  };
}

/**
 * Aggregate-only values suitable for display while the candidate is typing.
 * Intentionally returns no character positions, word positions, expected
 * characters, or correction hints.
 */
export function calculateLiveTypingMetrics(input: {
  referenceText: string;
  typedText: string;
  elapsedSeconds: number;
}): LiveTypingMetrics {
  const referenceText = String(input.referenceText ?? "");
  const typedText = String(input.typedText ?? "");
  const elapsedSeconds = safeSeconds(input.elapsedSeconds);
  const minutes = elapsedSeconds / 60;
  // Gross WPM = typed characters / 5 / elapsed minutes
  const grossWpm = (Array.from(typedText).length / 5) / minutes;
  const editDistance = levenshteinDistance(referenceText, typedText);
  const denominator = Math.max(Array.from(referenceText).length, Array.from(typedText).length, 1);
  const estimatedAccuracy = Math.max(0, ((denominator - editDistance) / denominator) * 100);

  return {
    elapsedSeconds,
    grossWpm: round(grossWpm),
    estimatedAccuracy: round(estimatedAccuracy),
    typedCharacters: Array.from(typedText).length,
  };
}

/** Minimum typed-character count to allow a manual early submission of a partial passage. */
const MIN_TYPED_FOR_MANUAL_SUBMIT = 20;

/**
 * Returns true when the candidate has typed at least as many characters as the
 * reference — they reached the end of the passage (possibly with errors).
 * A completed passage may always be submitted early.
 */
export function isPassageComplete(referenceText: string, typedText: string): boolean {
  const refLen = Array.from(String(referenceText ?? "")).length;
  const typedLen = Array.from(String(typedText ?? "")).length;
  return refLen > 0 && typedLen >= refLen;
}

/**
 * Returns true when a manual (early) submission should be accepted:
 * - Blank submissions are always rejected.
 * - A genuinely completed passage is always accepted.
 * - Partial passages must meet the minimum-sample threshold.
 */
export function canSubmitEarly(referenceText: string, typedText: string): boolean {
  const typedLen = Array.from(String(typedText ?? "")).length;
  if (typedLen === 0) return false;
  if (isPassageComplete(referenceText, typedText)) return true;
  return typedLen >= MIN_TYPED_FOR_MANUAL_SUBMIT;
}

export function calculateTypingScore(input: {
  referenceText: string;
  typedText: string;
  /** Elapsed typing seconds; must be capped at duration_limit before calling — not inflated by network grace. */
  elapsedSeconds: number;
  minNetWpm: number;
  minAccuracy: number;
}): TypingScoreResult {
  const referenceText = String(input.referenceText ?? "");
  const typedText = String(input.typedText ?? "");
  const elapsedSeconds = safeSeconds(input.elapsedSeconds);
  const minutes = elapsedSeconds / 60;
  const charAnalysis = analyzeCharacters(referenceText, typedText);
  const typedCharacterCount = Array.from(typedText).length;

  // Gross WPM = typed characters / 5 / elapsed minutes
  const grossWpm = (typedCharacterCount / 5) / minutes;

  // Net WPM = max(0, typed characters - errors) / 5 / elapsed minutes
  // Errors = characters typed incorrectly (substitutions + extras vs typed portion).
  // correctCharacters already excludes errors, so: errors = typed - correct.
  const errors = typedCharacterCount - charAnalysis.correctCharacters;
  const netWpm = Math.max(0, (typedCharacterCount - errors) / 5 / minutes);

  // Accuracy = Levenshtein accuracy over the portion actually attempted.
  // Untouched remainder is NOT counted as character errors — it reduces speed/completion instead.
  const accuracy = typedCharacterCount === 0
    ? 0
    : Math.max(0, (charAnalysis.correctCharacters / typedCharacterCount) * 100);

  const wordDiff = buildWordDiff(referenceText, typedText);

  // Speed score normalised against benchmark (capped at 100)
  const speedScore = Math.min(100, (netWpm / Math.max(1, input.minNetWpm)) * 100);

  // Score = 60% accuracy + 40% normalised speed
  const score = round((accuracy * 0.6) + (speedScore * 0.4));

  // Passing requires BOTH thresholds independently
  const passedBenchmark = netWpm >= input.minNetWpm && accuracy >= input.minAccuracy;

  return {
    scoreVersion: TYPING_SCORE_VERSION,
    elapsedSeconds,
    grossWpm: round(grossWpm),
    netWpm: round(netWpm),
    accuracy: round(accuracy),
    editDistance: charAnalysis.editDistance,
    correctCharacters: charAnalysis.correctCharacters,
    incorrectCharacters: charAnalysis.incorrectCharacters,
    missingCharacters: charAnalysis.missingCharacters,
    extraCharacters: charAnalysis.extraCharacters,
    correctWords: wordDiff.correctWords,
    incorrectWords: wordDiff.incorrectWords,
    score,
    passedBenchmark,
    benchmark: {
      minNetWpm: input.minNetWpm,
      minAccuracy: input.minAccuracy,
    },
    diff: wordDiff.items,
  };
}

/**
 * Select the best attempt from a list of scored attempts.
 * Priority: 1) passed outranks failed, 2) higher score, 3) earlier attempt_no.
 */
export function selectBestTypingAttempt<
  T extends { passed_benchmark: number | null; score_percentage: number | null; attempt_no: number },
>(attempts: T[]): T | undefined {
  if (!attempts.length) return undefined;
  return attempts.reduce((best, current) => {
    const bestPassed = Boolean(best.passed_benchmark);
    const curPassed = Boolean(current.passed_benchmark);
    if (curPassed && !bestPassed) return current;
    if (!curPassed && bestPassed) return best;
    const bestScore = Number(best.score_percentage ?? 0);
    const curScore = Number(current.score_percentage ?? 0);
    if (curScore > bestScore) return current;
    if (curScore < bestScore) return best;
    return current.attempt_no < best.attempt_no ? current : best;
  });
}
