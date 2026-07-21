const DUPLICATE_PUNCH_WINDOW_SECONDS = 120;

export type AggregatePunchAssessment = {
  effectivePunchIn: string | null;
  effectivePunchOut: string | null;
  effectivePunchCount: number;
  effectiveWorkingMinutes: number;
  elapsedSeconds: number;
  state: "NO_PUNCH" | "PUNCHED_IN" | "PUNCHED_OUT";
  reason: "no_punch" | "single_punch" | "duplicate_window" | "odd_punch_count" | "valid_out";
};

function toTime(value: string | null | undefined) {
  if (!value) return Number.NaN;
  return new Date(value.replace(" ", "T") + "+05:30").getTime();
}

export function assessAggregatePunches(input: {
  firstPunch: string | null | undefined;
  lastPunch: string | null | undefined;
  totalPunches: number | null | undefined;
  workingMinutes: number | null | undefined;
}): AggregatePunchAssessment {
  const firstPunch = input.firstPunch?.trim() || null;
  const lastPunch = input.lastPunch?.trim() || null;
  const totalPunches = Math.max(0, Math.floor(Number(input.totalPunches ?? 0) || 0));
  const workingMinutes = Math.max(0, Number(input.workingMinutes ?? 0) || 0);

  if (!firstPunch) {
    return {
      effectivePunchIn: null,
      effectivePunchOut: null,
      effectivePunchCount: 0,
      effectiveWorkingMinutes: 0,
      elapsedSeconds: 0,
      state: "NO_PUNCH",
      reason: "no_punch",
    };
  }

  if (!lastPunch || totalPunches <= 1) {
    return {
      effectivePunchIn: firstPunch,
      effectivePunchOut: null,
      effectivePunchCount: Math.max(totalPunches, 1),
      effectiveWorkingMinutes: 0,
      elapsedSeconds: 0,
      state: "PUNCHED_IN",
      reason: "single_punch",
    };
  }

  const startMs = toTime(firstPunch);
  const endMs = toTime(lastPunch);
  const elapsedSeconds = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs
    ? Math.round((endMs - startMs) / 1000)
    : 0;

  if (elapsedSeconds <= DUPLICATE_PUNCH_WINDOW_SECONDS) {
    return {
      effectivePunchIn: firstPunch,
      effectivePunchOut: null,
      effectivePunchCount: 1,
      effectiveWorkingMinutes: 0,
      elapsedSeconds,
      state: "PUNCHED_IN",
      reason: "duplicate_window",
    };
  }

  if (totalPunches % 2 === 1) {
    // Odd punch count means the last event was an IN swipe — employee is still
    // inside. Never treat this as a completed exit; doing so caused break-desk
    // to show "Shift Completed" mid-shift when the last NCOSEC swipe happened
    // to push the span past 9 h (e.g. cafeteria/door re-entry at end of day).
    return {
      effectivePunchIn: firstPunch,
      effectivePunchOut: null,
      effectivePunchCount: totalPunches,
      effectiveWorkingMinutes: 0,
      elapsedSeconds,
      state: "PUNCHED_IN",
      reason: "odd_punch_count",
    };
  }

  return {
    effectivePunchIn: firstPunch,
    effectivePunchOut: lastPunch,
    effectivePunchCount: totalPunches,
    effectiveWorkingMinutes: workingMinutes,
    elapsedSeconds,
    state: "PUNCHED_OUT",
    reason: "valid_out",
  };
}
