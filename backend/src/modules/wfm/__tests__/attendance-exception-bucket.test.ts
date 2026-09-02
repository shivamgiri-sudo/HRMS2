import { describe, it, expect } from 'vitest';
import {
  classifyCosecMinutes,
  COSEC_DEFAULT_FULL_DAY_MINUTES,
} from '../attendance-engine.service.js';

/**
 * Per-employee COSEC exceptions (migration 1652).
 *
 * The regression these tests exist to catch is the one that matters most here: the exception is
 * supposed to change the classification for bucketed employees ONLY. classifyCosecMinutes is
 * called for the entire workforce, so a mistake in its new parameter silently re-grades every
 * employee's attendance — and attendance is pay.
 */
describe('classifyCosecMinutes — full-day threshold', () => {
  it('defaults to the 540-minute (9h) day every employee had before the exception existed', () => {
    expect(COSEC_DEFAULT_FULL_DAY_MINUTES).toBe(540);

    // Exactly at the boundary is present; one minute short is not.
    expect(classifyCosecMinutes(540, 240).status).toBe('present');
    expect(classifyCosecMinutes(539, 240).status).toBe('half_day');

    // An 8-hour day is NOT a full day for an unbucketed employee — this is the behaviour the
    // owner asked to change for a few people, and it must stay in force for everyone else.
    expect(classifyCosecMinutes(480, 240).status).toBe('half_day');
  });

  it('treats 480 minutes as a full day when the employee has an 8-hour override', () => {
    expect(classifyCosecMinutes(480, 240, 480).status).toBe('present');
    expect(classifyCosecMinutes(479, 240, 480).status).toBe('half_day');

    // lwp follows the status, so the pay consequence is carried too.
    expect(classifyCosecMinutes(480, 240, 480).lwpValue).toBe(0);
  });

  it('leaves the half-day floor and the absent floor untouched by the override', () => {
    // A short day is still a half day, and a day below the floor is still absent — the override
    // raises nobody from absent to present on its own.
    expect(classifyCosecMinutes(300, 240, 480).status).toBe('half_day');
    expect(classifyCosecMinutes(239, 240, 480).status).toBe('absent');
    expect(classifyCosecMinutes(0,   240, 480).status).toBe('absent');
    expect(classifyCosecMinutes(0,   240, 480).lwpValue).toBe(1);
  });

  it('cannot make a zero-minute day present, whatever the threshold', () => {
    // Guards the boundary the routes also enforce (MIN_FULL_DAY_MINUTES = 60): the single-punch
    // exception is the only route to a present day on no minutes, and it requires punch evidence.
    expect(classifyCosecMinutes(0, 240, 60).status).toBe('absent');
  });

  it('is unchanged for an explicitly-passed default, so a bucketed employee with no threshold matches everyone else', () => {
    // fullDayThresholdMinutes is NULL for an employee who only has the single-punch exception;
    // the engine then passes COSEC_DEFAULT_FULL_DAY_MINUTES explicitly rather than omitting it.
    for (const minutes of [0, 239, 240, 479, 480, 539, 540, 600]) {
      expect(classifyCosecMinutes(minutes, 240, COSEC_DEFAULT_FULL_DAY_MINUTES))
        .toEqual(classifyCosecMinutes(minutes, 240));
    }
  });
});
