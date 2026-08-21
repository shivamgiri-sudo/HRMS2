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
  LWP: 'LEAVE', // Leave Without Pay — standard roster shorthand, confirmed 2026-08-21 against a
  // real WC roster (17 rows). Absence is absence for roster purposes; the unpaid distinction is
  // a payroll-side concern, not something the roster assignment type needs to carry.
  TRAINING: 'TRAINING',
  TRG: 'TRAINING',
  TRAIN: 'TRAINING',
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
