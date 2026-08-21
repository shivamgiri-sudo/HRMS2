/**
 * Assignment Type Normalizer
 * Converts raw cell values from a roster spreadsheet into canonical AssignmentType values.
 * Builds on the shift parser from Task 2.
 */

import { parseShiftString, ShiftParserResult } from './shift-parser.service.js';

export type AssignmentType =
  | 'SHIFT'
  | 'WEEK_OFF'
  | 'LEAVE'
  | 'ABSENT'
  | 'HALF_DAY'
  | 'HOLIDAY'
  | 'TRAINING'
  | 'UNSCHEDULED'
  | 'UNASSIGNED'
  | 'NEEDS_MAPPING'
  | 'NO_CHANGE'
  | 'HARD_ERROR';

export interface NormalizerConfig {
  importMode: 'NEW' | 'UPDATE';
  hdMapsTo: 'HALF_DAY' | 'NEEDS_MAPPING';
  customAliases?: Record<string, AssignmentType>; // key is uppercase
}

export interface NormalizerResult {
  type: AssignmentType;
  shiftParseResult?: ShiftParserResult; // populated when type === 'SHIFT'
  warning?: string;
}

/** Keyword map: uppercase key → AssignmentType */
const KEYWORD_MAP: Record<string, AssignmentType> = {
  WO: 'WEEK_OFF',
  'W/O': 'WEEK_OFF',
  'WEEK OFF': 'WEEK_OFF',
  WEEK_OFF: 'WEEK_OFF',
  OFF: 'WEEK_OFF',
  LEAVE: 'LEAVE',
  L: 'LEAVE',
  // ABSENT, not LEAVE (corrected 2026-08-22, same day as introduced): LEAVE is cross-checked
  // against an approved leave_request (roster-leave-guard.service.ts / approvedLeaveLookup) and
  // warns when none exists. LWP/"Left" carry no approval — LWP is literally leave WITHOUT
  // pay/approval, and "Left" (confirmed 2026-08-21 against three real employee codes: all
  // active, zero exit records) is an unexplained absence, not a claimed leave. Routing both
  // through the leave check would raise a false "no approved leave request found" warning on
  // every row. ABSENT skips that check entirely, which is the correct behaviour for both.
  LWP: 'ABSENT', // Leave Without Pay — confirmed 2026-08-21/22 against a real WC roster (17 rows).
  LEFT: 'ABSENT', // confirmed 2026-08-22 — see note above; not an exit signal, just an absence.
  TRAINING: 'TRAINING',
  TRG: 'TRAINING',
  TRAIN: 'TRAINING',
  'PRACTICE QUEUE': 'TRAINING', // user-confirmed 2026-08-22: new-hire practice/OJT queue status,
  // seen on a real WC roster's day-one column for a batch of just-onboarded agents.

  HOLIDAY: 'HOLIDAY',
  H: 'HOLIDAY',
  'HALF DAY': 'HALF_DAY',
  HALF_DAY: 'HALF_DAY',
  UNSCHEDULED: 'UNSCHEDULED',
};

export function normalizeAssignment(
  rawValue: string | null | undefined,
  config: NormalizerConfig
): NormalizerResult {
  // Step 1: Check customAliases first (uppercase key lookup)
  if (rawValue != null) {
    const trimmed = rawValue.trim();
    const upper = trimmed.toUpperCase();
    if (config.customAliases && Object.prototype.hasOwnProperty.call(config.customAliases, upper)) {
      return { type: config.customAliases[upper] };
    }
  }

  // Step 2: Null / undefined / blank
  if (rawValue == null || rawValue.trim() === '') {
    return { type: config.importMode === 'NEW' ? 'UNASSIGNED' : 'NO_CHANGE' };
  }

  const trimmed = rawValue.trim();
  const upper = trimmed.toUpperCase();

  // Step 3: Literal zero
  if (trimmed === '0') {
    return { type: 'HARD_ERROR' };
  }

  // Step 4: Known status keywords (case-insensitive)
  if (upper === 'HD') {
    return { type: config.hdMapsTo };
  }

  if (Object.prototype.hasOwnProperty.call(KEYWORD_MAP, upper)) {
    return { type: KEYWORD_MAP[upper] };
  }

  // Step 5: Try shift string parser
  const shiftResult = parseShiftString(trimmed);
  if (shiftResult.success && shiftResult.parsed?.type === 'SHIFT') {
    return { type: 'SHIFT', shiftParseResult: shiftResult };
  }
  // ALIAS_LOOKUP falls through to step 6

  // Step 6: Unrecognized → NEEDS_MAPPING
  return { type: 'NEEDS_MAPPING' };
}
