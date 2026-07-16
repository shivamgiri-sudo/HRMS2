export type TypingDiffStatus = 'correct' | 'incorrect' | 'missing' | 'extra';

export interface TypingDiffItem {
  index: number;
  expected: string | null;
  typed: string | null;
  status: TypingDiffStatus;
}

export interface TypingScoreResult {
  elapsedSeconds: number;
  grossWpm: number;
  netWpm: number;
  accuracy: number;
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

const round = (value: number, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export function levenshteinDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }
  return previous[b.length];
}

export function buildWordDiff(reference: string, typed: string) {
  const expected = reference.trim().split(/\s+/).filter(Boolean);
  const actual = typed.trim().split(/\s+/).filter(Boolean);
  const length = Math.max(expected.length, actual.length);
  const items: TypingDiffItem[] = [];
  let correctWords = 0;
  let incorrectWords = 0;

  for (let index = 0; index < length; index += 1) {
    const expectedWord = expected[index] ?? null;
    const typedWord = actual[index] ?? null;
    let status: TypingDiffStatus;
    if (expectedWord == null) status = 'extra';
    else if (typedWord == null) status = 'missing';
    else if (expectedWord === typedWord) {
      status = 'correct';
      correctWords += 1;
    } else status = 'incorrect';

    if (status !== 'correct') incorrectWords += 1;
    items.push({ index, expected: expectedWord, typed: typedWord, status });
  }
  return { items, correctWords, incorrectWords };
}

export function calculateTypingScore(input: {
  referenceText: string;
  typedText: string;
  elapsedSeconds: number;
  minNetWpm: number;
  minAccuracy: number;
}): TypingScoreResult {
  const referenceText = String(input.referenceText ?? '');
  const typedText = String(input.typedText ?? '');
  const elapsedSeconds = Math.max(1, Number(input.elapsedSeconds || 1));
  const minutes = elapsedSeconds / 60;
  const grossWpm = typedText.trim() ? typedText.trim().split(/\s+/).length / minutes : 0;
  const editDistance = levenshteinDistance(referenceText, typedText);
  const denominator = Math.max(referenceText.length, typedText.length, 1);
  const accuracy = Math.max(0, ((denominator - editDistance) / denominator) * 100);
  const netWpm = Math.max(0, grossWpm - (editDistance / 5) / minutes);
  const missingCharacters = Math.max(0, referenceText.length - typedText.length);
  const extraCharacters = Math.max(0, typedText.length - referenceText.length);
  const incorrectCharacters = Math.max(0, editDistance - missingCharacters - extraCharacters);
  const correctCharacters = Math.max(0, denominator - editDistance);
  const diff = buildWordDiff(referenceText, typedText);
  const speedScore = Math.min(100, (netWpm / Math.max(1, input.minNetWpm)) * 100);
  const score = round((speedScore * 0.4) + (accuracy * 0.6));

  return {
    elapsedSeconds,
    grossWpm: round(grossWpm),
    netWpm: round(netWpm),
    accuracy: round(accuracy),
    correctCharacters,
    incorrectCharacters,
    missingCharacters,
    extraCharacters,
    correctWords: diff.correctWords,
    incorrectWords: diff.incorrectWords,
    score,
    passedBenchmark: netWpm >= input.minNetWpm && accuracy >= input.minAccuracy,
    benchmark: { minNetWpm: input.minNetWpm, minAccuracy: input.minAccuracy },
    diff: diff.items,
  };
}
