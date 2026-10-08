import { describe, it, expect } from 'vitest';
import {
  timeToMinutes, shrinkagePct, isOvernightShift, minutesSinceShiftStart, hasShiftEnded, canJudgeIncomplete,
} from '../roster-intelligence.calc.js';

const at = (d: string, h: number, m = 0) => { const [y, mo, da] = d.split('-').map(Number); return new Date(y, mo - 1, da, h, m); };

describe('timeToMinutes', () => {
  it('parses HH:MM:SS, HH:MM and DATETIME strings (was NaN for DATETIME)', () => {
    expect(timeToMinutes('09:30:00')).toBe(570);
    expect(timeToMinutes('09:30')).toBe(570);
    expect(timeToMinutes('2026-09-30 09:05:00')).toBe(545);
    expect(timeToMinutes('garbage')).toBe(0);
  });
});
describe('shrinkagePct', () => {
  it('handles zero planned and never goes negative/NaN', () => {
    expect(shrinkagePct(0, 0)).toBe(0);
    expect(shrinkagePct(10, 9)).toBe(10);
    expect(shrinkagePct(10, 12)).toBe(0);
  });
});
describe('shift timing', () => {
  it('detects overnight', () => {
    expect(isOvernightShift('22:00:00', '06:00:00')).toBe(true);
    expect(isOvernightShift('09:00:00', '18:00:00')).toBe(false);
  });
  it('elapsed minutes are date-aware (overnight after midnight)', () => {
    expect(minutesSinceShiftStart('2026-09-29', '22:00:00', at('2026-09-30', 1, 0))).toBe(180);
    expect(minutesSinceShiftStart('2026-09-30', '22:00:00', at('2026-09-30', 1, 0))).toBeLessThan(0);
  });
  it('shift end rolls to next day for overnight', () => {
    expect(hasShiftEnded('2026-09-29', '22:00:00', '06:00:00', at('2026-09-30', 1))).toBe(false);
    expect(hasShiftEnded('2026-09-29', '22:00:00', '06:00:00', at('2026-09-30', 6, 1))).toBe(true);
  });
  it('incomplete only judgeable after clock-out or shift end', () => {
    expect(canJudgeIncomplete(false, '2026-09-30', '09:00:00', '18:00:00', at('2026-09-30', 11))).toBe(false);
    expect(canJudgeIncomplete(true, '2026-09-30', '09:00:00', '18:00:00', at('2026-09-30', 11))).toBe(true);
    expect(canJudgeIncomplete(false, '2026-09-30', '09:00:00', '18:00:00', at('2026-09-30', 18, 5))).toBe(true);
  });
});
