import { describe, it, expect } from 'vitest';
import { isOffRollType } from '../employee-code.service';

describe('isOffRollType', () => {
  // Confirmed live, 2026-09-09: Vijal Ramsingh Bhati's rehire (offer emp_type
  // "MGMT. TRAINEE") got MAS63510 instead of the historically-correct {n}C code,
  // because the exact-string check only matched bare "Trainee"/"OffRoll" -- the
  // real, dominant label for 13,833 existing employees is "MGMT. TRAINEE".
  it('recognizes "MGMT. TRAINEE", the real production label, not just bare "Trainee"', () => {
    expect(isOffRollType('MGMT. TRAINEE')).toBe(true);
  });

  it('still recognizes the original exact-match labels', () => {
    expect(isOffRollType('Trainee')).toBe(true);
    expect(isOffRollType('OffRoll')).toBe(true);
  });

  it('is case- and spacing-insensitive for OffRoll variants', () => {
    expect(isOffRollType('OFFROLL')).toBe(true);
    expect(isOffRollType('Off Roll')).toBe(true);
    expect(isOffRollType('off-roll')).toBe(true);
  });

  it('does not misclassify a genuinely on-roll type', () => {
    expect(isOffRollType('OnRoll')).toBe(false);
    expect(isOffRollType('ONROLL')).toBe(false);
  });

  it('leaves FIELD/ON SITE as on-roll, matching their existing 100% MAS-code history', () => {
    expect(isOffRollType('FIELD')).toBe(false);
    expect(isOffRollType('ON SITE')).toBe(false);
  });

  it('handles null/undefined/empty without throwing', () => {
    expect(isOffRollType(null)).toBe(false);
    expect(isOffRollType(undefined)).toBe(false);
    expect(isOffRollType('')).toBe(false);
  });
});
