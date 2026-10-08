import { describe, it, expect } from 'vitest';
import { parseCtcInput } from '../ctc-parser';

describe('parseCtcInput', () => {
  // Confirmed live, 2026-09-11: multiple recruiters, multiple candidates, a bare
  // Number() on this field silently corrupted these two real-world entry habits.
  it('reads a comma-grouped amount instead of returning NaN', () => {
    expect(parseCtcInput('16,500')).toBe(16500);
  });

  it('reads Indian-style multi-comma grouping', () => {
    expect(parseCtcInput('1,98,000')).toBe(198000);
  });

  it('reads a period-grouped whole number (Excel/European paste) instead of truncating to a decimal', () => {
    expect(parseCtcInput('16.500')).toBe(16500);
  });

  it('still reads a plain unformatted number', () => {
    expect(parseCtcInput('16500')).toBe(16500);
  });

  it('strips a leading currency symbol', () => {
    expect(parseCtcInput('₹16,500')).toBe(16500);
  });

  it('does not mistake genuine paise (2 decimal digits) for thousands-grouping', () => {
    expect(parseCtcInput('16500.50')).toBe(16500.5);
  });

  it('returns null for empty or non-numeric input rather than NaN', () => {
    expect(parseCtcInput('')).toBeNull();
    expect(parseCtcInput('abc')).toBeNull();
    expect(parseCtcInput(null)).toBeNull();
    expect(parseCtcInput(undefined)).toBeNull();
  });

  it('passes a plain number straight through', () => {
    expect(parseCtcInput(16500)).toBe(16500);
  });
});
