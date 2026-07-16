import { describe, expect, it } from 'vitest';
import { calculateTypingScore } from './typing-scoring.js';

describe('typing scoring', () => {
  it('returns perfect accuracy for exact text', () => {
    const result = calculateTypingScore({
      referenceText: 'one two three four five',
      typedText: 'one two three four five',
      elapsedSeconds: 12,
      minNetWpm: 20,
      minAccuracy: 90,
    });
    expect(result.accuracy).toBe(100);
    expect(result.incorrectCharacters).toBe(0);
    expect(result.correctWords).toBe(5);
    expect(result.diff.every((item) => item.status === 'correct')).toBe(true);
  });

  it('reveals missing, extra, and incorrect words only in the final diff payload', () => {
    const result = calculateTypingScore({
      referenceText: 'accurate data entry matters',
      typedText: 'accurate date entry matters today',
      elapsedSeconds: 30,
      minNetWpm: 30,
      minAccuracy: 95,
    });
    expect(result.diff.some((item) => item.status === 'incorrect')).toBe(true);
    expect(result.diff.some((item) => item.status === 'extra')).toBe(true);
    expect(result.accuracy).toBeLessThan(100);
  });
});
