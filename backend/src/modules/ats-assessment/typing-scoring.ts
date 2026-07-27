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
  referenceCharactersEvaluated: number;
  completionPercentage: number;
}

export interface TypingScoreResult {
  scoringVersion: "typing-score-v2";
  elapsedSeconds: number;
  grossWpm: number;
  netWpm: number;
  accuracy: number;
  editDistance: number;
  typedCharacters: number;
  referenceCharacters: number;
  referenceCharactersEvaluated: number;
  completionPercentage: number;
  errorAdjustedCharacters: number;
  correctCharacters: number;
  incorrectCharacters: number;
  missingCharacters: number;
  extraCharacters: number;
  correctWords: number;
  incorrectWords: number;
  score: number;
  passedBenchmark: boolean;
  benchmark: { minNetWpm: number; minAccuracy: number };
  formula: {
    grossWpm: string;
    netWpm: string;
    accuracy: string;
    score: string;
  };
  diff: TypingDiffItem[];
}

type EditOperation = "match" | "substitute" | "delete" | "insert";

type CharacterAnalysis = {
  editDistance: number;
  correctCharacters: number;
  incorrectCharacters: number;
  missingCharacters: number;
  extraCharacters: number;
};

const round = (value: number, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const safeSeconds = (value: number) => Math.max(1, Number.isFinite(value) ? value : 1);
export const MAX_TYPING_SCORE_CHARACTERS = 2_500;

/**
 * Preserve exact typing semantics while removing browser/platform-only
 * differences that must not be scored as candidate mistakes.
 */
export function normalizeTypingText(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .normalize("NFC");
}

function buildEditMatrix<T>(expected: T[], actual: T[], equal: (a: T, b: T) => boolean) {
  const rows = expected.length + 1;
  const columns = actual.length + 1;
  const matrix = Array.from({ length: rows }, () => new Uint32Array(columns));

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
  matrix: ReadonlyArray<ArrayLike<number>>,
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
  const expected = Array.from(normalizeTypingText(a));
  const actual = Array.from(normalizeTypingText(b));
  const matrix = buildEditMatrix(expected, actual, (left, right) => left === right);
  return matrix[expected.length][actual.length];
}

export function buildWordDiff(reference: string, typed: string) {
  const expected = normalizeTypingText(reference).trim().split(/\s+/).filter(Boolean);
  const actual = normalizeTypingText(typed).trim().split(/\s+/).filter(Boolean);
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

function analyzeCharacters(referenceText: string, typedText: string): CharacterAnalysis {
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
 * Finds the reference prefix that the candidate actually attempted.
 *
 * A timed copy test must not count every untouched character at the end of a
 * passage as an accuracy error. That remainder is reflected through completion
 * and speed. Character accuracy is calculated only over the attempted span.
 *
 * The largest prefix is selected when two prefixes have the same edit distance,
 * which correctly treats an omitted character inside the attempted text as a
 * deletion rather than ending the attempted span early.
 */
export function resolveAttemptedReference(referenceText: string, typedText: string) {
  const reference = normalizeTypingText(referenceText);
  const typed = normalizeTypingText(typedText);
  const expected = Array.from(reference);
  const actual = Array.from(typed);

  if (!actual.length) {
    return {
      reference,
      typed,
      attemptedReference: "",
      referenceCharactersEvaluated: 0,
    };
  }

  let previous = new Uint32Array(actual.length + 1);
  for (let column = 0; column <= actual.length; column += 1) previous[column] = column;
  let bestPrefixLength = 0;
  let bestDistance = previous[actual.length];

  for (let row = 1; row <= expected.length; row += 1) {
    const current = new Uint32Array(actual.length + 1);
    current[0] = row;
    for (let column = 1; column <= actual.length; column += 1) {
      const substitutionCost = expected[row - 1] === actual[column - 1] ? 0 : 1;
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + substitutionCost,
      );
    }
    const distance = current[actual.length];
    if (distance < bestDistance || (distance === bestDistance && row > bestPrefixLength)) {
      bestDistance = distance;
      bestPrefixLength = row;
    }
    previous = current;
  }

  return {
    reference,
    typed,
    attemptedReference: expected.slice(0, bestPrefixLength).join(""),
    referenceCharactersEvaluated: bestPrefixLength,
  };
}

function analyzeAttempt(referenceText: string, typedText: string) {
  const resolved = resolveAttemptedReference(referenceText, typedText);
  const referenceCharacters = Array.from(resolved.reference).length;
  const typedCharacters = Array.from(resolved.typed).length;
  if (referenceCharacters > MAX_TYPING_SCORE_CHARACTERS || typedCharacters > MAX_TYPING_SCORE_CHARACTERS) {
    throw new RangeError(`Typing text exceeds the ${MAX_TYPING_SCORE_CHARACTERS}-character scoring limit`);
  }
  const characterAnalysis = typedCharacters
    ? analyzeCharacters(resolved.attemptedReference, resolved.typed)
    : {
        editDistance: 0,
        correctCharacters: 0,
        incorrectCharacters: 0,
        missingCharacters: 0,
        extraCharacters: 0,
      };
  const accuracyDenominator = Math.max(
    resolved.referenceCharactersEvaluated,
    typedCharacters,
    1,
  );
  const accuracy = typedCharacters === 0
    ? 0
    : Math.max(0, ((accuracyDenominator - characterAnalysis.editDistance) / accuracyDenominator) * 100);
  const completionPercentage = referenceCharacters
    ? Math.min(100, (resolved.referenceCharactersEvaluated / referenceCharacters) * 100)
    : typedCharacters === 0 ? 0 : 100;

  return {
    ...resolved,
    ...characterAnalysis,
    referenceCharacters,
    typedCharacters,
    accuracy,
    completionPercentage,
  };
}

/**
 * Aggregate-only values suitable for display while the candidate is typing.
 * It intentionally returns no character positions, word positions, expected
 * characters, or correction hints.
 */
export function calculateLiveTypingMetrics(input: {
  referenceText: string;
  typedText: string;
  elapsedSeconds: number;
}): LiveTypingMetrics {
  const elapsedSeconds = safeSeconds(input.elapsedSeconds);
  const minutes = elapsedSeconds / 60;
  const analysis = analyzeAttempt(input.referenceText, input.typedText);
  const grossWpm = (analysis.typedCharacters / 5) / minutes;

  return {
    elapsedSeconds,
    grossWpm: round(grossWpm),
    estimatedAccuracy: round(analysis.accuracy),
    typedCharacters: analysis.typedCharacters,
    referenceCharactersEvaluated: analysis.referenceCharactersEvaluated,
    completionPercentage: round(analysis.completionPercentage),
  };
}

export function calculateTypingScore(input: {
  referenceText: string;
  typedText: string;
  elapsedSeconds: number;
  minNetWpm: number;
  minAccuracy: number;
}): TypingScoreResult {
  const elapsedSeconds = safeSeconds(input.elapsedSeconds);
  const minutes = elapsedSeconds / 60;
  const analysis = analyzeAttempt(input.referenceText, input.typedText);

  const grossWpmRaw = (analysis.typedCharacters / 5) / minutes;
  const accuracyRaw = analysis.accuracy;
  // Convert character-level Levenshtein errors into standard five-character
  // word equivalents. The untouched suffix is not part of editDistance, so it
  // affects speed/completion without being double-counted as an accuracy error.
  const errorAdjustedCharactersRaw = Math.max(0, analysis.typedCharacters - analysis.editDistance);
  const netWpmRaw = (errorAdjustedCharactersRaw / 5) / minutes;
  const grossWpm = round(grossWpmRaw);
  const netWpm = round(netWpmRaw);
  const accuracy = round(accuracyRaw);
  const errorAdjustedCharacters = round(errorAdjustedCharactersRaw, 4);
  const wordDiff = buildWordDiff(analysis.attemptedReference, analysis.typed);
  const speedScore = Math.min(100, (netWpm / Math.max(1, input.minNetWpm)) * 100);
  const score = round((speedScore * 0.4) + (accuracy * 0.6));
  // Compare the same rounded values shown to the candidate. This prevents a
  // displayed 30.00 WPM or 95.00% result from failing due to hidden decimals.
  const passedBenchmark = netWpm >= input.minNetWpm && accuracy >= input.minAccuracy;

  return {
    scoringVersion: "typing-score-v2",
    elapsedSeconds,
    grossWpm,
    netWpm,
    accuracy,
    editDistance: analysis.editDistance,
    typedCharacters: analysis.typedCharacters,
    referenceCharacters: analysis.referenceCharacters,
    referenceCharactersEvaluated: analysis.referenceCharactersEvaluated,
    completionPercentage: round(analysis.completionPercentage),
    errorAdjustedCharacters,
    correctCharacters: analysis.correctCharacters,
    incorrectCharacters: analysis.incorrectCharacters,
    missingCharacters: analysis.missingCharacters,
    extraCharacters: analysis.extraCharacters,
    correctWords: wordDiff.correctWords,
    incorrectWords: wordDiff.incorrectWords,
    score,
    passedBenchmark,
    benchmark: {
      minNetWpm: input.minNetWpm,
      minAccuracy: input.minAccuracy,
    },
    formula: {
      grossWpm: "(typed characters / 5) / elapsed minutes",
      netWpm: "max(0, typed characters - Levenshtein errors) / 5 / elapsed minutes",
      accuracy: "(max(attempted reference characters, typed characters) - Levenshtein distance) / max(...) × 100",
      score: "40% speed score + 60% accuracy",
    },
    diff: wordDiff.items,
  };
}
