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
 * It intentionally returns no character positions, word positions, expected
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

export function calculateTypingScore(input: {
  referenceText: string;
  typedText: string;
  elapsedSeconds: number;
  minNetWpm: number;
  minAccuracy: number;
}): TypingScoreResult {
  const referenceText = String(input.referenceText ?? "");
  const typedText = String(input.typedText ?? "");
  const elapsedSeconds = safeSeconds(input.elapsedSeconds);
  const minutes = elapsedSeconds / 60;
  const characterAnalysis = analyzeCharacters(referenceText, typedText);
  const typedCharacterCount = Array.from(typedText).length;
  const referenceCharacterCount = Array.from(referenceText).length;

  const grossWpm = (typedCharacterCount / 5) / minutes;
  const penaltyWords = characterAnalysis.editDistance / 5;
  const netWpm = Math.max(0, grossWpm - (penaltyWords / minutes));
  const denominator = Math.max(referenceCharacterCount, typedCharacterCount, 1);
  const accuracy = Math.max(0, ((denominator - characterAnalysis.editDistance) / denominator) * 100);
  const wordDiff = buildWordDiff(referenceText, typedText);
  const speedScore = Math.min(100, (netWpm / Math.max(1, input.minNetWpm)) * 100);
  const score = round((speedScore * 0.4) + (accuracy * 0.6));

  return {
    elapsedSeconds,
    grossWpm: round(grossWpm),
    netWpm: round(netWpm),
    accuracy: round(accuracy),
    editDistance: characterAnalysis.editDistance,
    correctCharacters: characterAnalysis.correctCharacters,
    incorrectCharacters: characterAnalysis.incorrectCharacters,
    missingCharacters: characterAnalysis.missingCharacters,
    extraCharacters: characterAnalysis.extraCharacters,
    correctWords: wordDiff.correctWords,
    incorrectWords: wordDiff.incorrectWords,
    score,
    passedBenchmark: netWpm >= input.minNetWpm && accuracy >= input.minAccuracy,
    benchmark: {
      minNetWpm: input.minNetWpm,
      minAccuracy: input.minAccuracy,
    },
    diff: wordDiff.items,
  };
}
