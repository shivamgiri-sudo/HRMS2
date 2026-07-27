from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label} mismatch: {count}")
    return text.replace(old, new, 1)


scoring = Path("backend/src/modules/ats-assessment/typing-scoring.ts")
text = scoring.read_text()
text = replace_once(
    text,
    "const safeSeconds = (value: number) => Math.max(1, Number.isFinite(value) ? value : 1);",
    """const safeSeconds = (value: number) => Math.max(1, Number.isFinite(value) ? value : 1);
export const MAX_TYPING_SCORE_CHARACTERS = 2_500;""",
    "scoring length constant",
)
text = replace_once(
    text,
    "  const matrix = Array.from({ length: rows }, () => new Array<number>(columns).fill(0));",
    "  const matrix = Array.from({ length: rows }, () => new Uint32Array(columns));",
    "typed edit matrix",
)
text = replace_once(
    text,
    "  matrix: number[][],",
    "  matrix: ReadonlyArray<ArrayLike<number>>,",
    "backtrack matrix type",
)
resolver_start = text.index("export function resolveAttemptedReference")
resolver_end = text.index("\nfunction analyzeAttempt", resolver_start)
resolver = '''export function resolveAttemptedReference(referenceText: string, typedText: string) {
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
'''
text = text[:resolver_start] + resolver + text[resolver_end:]
text = replace_once(
    text,
    """  const resolved = resolveAttemptedReference(referenceText, typedText);
  const referenceCharacters = Array.from(resolved.reference).length;
  const typedCharacters = Array.from(resolved.typed).length;""",
    """  const resolved = resolveAttemptedReference(referenceText, typedText);
  const referenceCharacters = Array.from(resolved.reference).length;
  const typedCharacters = Array.from(resolved.typed).length;
  if (referenceCharacters > MAX_TYPING_SCORE_CHARACTERS || typedCharacters > MAX_TYPING_SCORE_CHARACTERS) {
    throw new RangeError(`Typing text exceeds the ${MAX_TYPING_SCORE_CHARACTERS}-character scoring limit`);
  }""",
    "scoring length guard",
)
scoring.write_text(text)
