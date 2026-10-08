//
// Requirement 9 of requirements.md ("Payroll Cut-Off Behaviour For Pending Reviews"), implemented
// as pure functions over already-fetched Variance_Records and already-resolved
// attendance_feature_config values. Same shape as attendance-source-rule-resolver.ts,
// canonical-productivity.ts, attendance-variance.ts and payable-days.ts: no database import, no
// db.execute, no new Date(), no randomUUID(). Every input arrives as an argument, including the
// list of open Pay_Months and every feature flag value, so each branch below is directly unit-
// and property-testable (design.md Testing Strategy).
//
// WHAT REQUIREMENT 9 IS ACTUALLY ABOUT
// One reporting manager on leave must not hold up a branch's salary. requirements.md criterion 9.8
// therefore ships `payroll_lock_on_unresolved_mismatch` at 0 and keeps criterion 9.6's blocking
// behaviour as a per-branch opt-in. That is the criterion this module exists to protect, so it is
// protected by the type system rather than by comment. Three structural guarantees:
//
//  1. THE DEFAULT CANNOT BLOCK. `PayrollCutOffDecision` is a discriminated union whose proceeding
//     arm carries `mayProceed: true` as a literal type, so no caller can read a false out of it.
//     The refusing arm is constructed by exactly one private function, refuseCutOff(), whose first
//     parameter is typed `lock: 1`. resolveFeatureFlag() returns `0 | 1` and answers absent,
//     empty and unrecognised values with the release default, which for this flag is 0 (criterion
//     9.8). On the `lock === 0` path the compiler has narrowed the value to 0 and refuseCutOff()
//     is therefore not callable at all. "Default does not block" is a compile error to violate,
//     not a convention to remember.
//
//  2. ONLY A QUEUED RECORD CAN BLOCK. refuseCutOff() takes a non-empty tuple of
//     `UnreviewedQueuedRecord`, an intersection type that pins `effectiveQueueState` to
//     'queued_for_dual_review' and `status` to an UnreviewedStatus. The only producer of that type
//     is the isUnreviewedQueued() type guard. A `recorded_not_queued` record cannot reach the
//     blocking count because it cannot be typed into the argument, and because the tuple is
//     non-empty a refusal always names a count of at least 1 (criterion 9.6's "SHALL name the
//     count").
//
//  3. DETECTION IS INDEPENDENT OF PRESENTATION (criterion 9.9). countRaisedAndRecorded() does not
//     take the `mismatch_workflow_enabled` flag as a parameter, so the raised and recorded counts
//     cannot vary with it; only the presentation split reads it. Enabling the flag later therefore
//     cannot require backfilling detection, because detection never consulted the flag.
//
// A FOURTH, LESS OBVIOUS SAFETY PROPERTY
// The presentation gate is applied before the cut-off decision, so a branch with
// `mismatch_workflow_enabled = 0` presents nothing, has no unreviewed queued record, and cannot be
// blocked even with `payroll_lock_on_unresolved_mismatch = 1`. Without that ordering the two flags
// combine into a permanent deadlock: nothing is presentable, so nothing can ever be reviewed, so
// cut-off is refused forever. Criterion 9.9 requires the presentation gate; criterion 9.6 blocks
// only on records that "remain unreviewed", and a record nobody was ever shown is not one.
//
// WHAT THIS MODULE DELIBERATELY DOES NOT DO
// It decides; it does not write. Criterion 9.1's Payable_Days derivation is payable-days.ts plus
// the payroll writer's sum, criterion 9.2's mark is a salary-line UPDATE, criterion 9.3's carry
// forward is queue state, and criterion 9.4's entry is an INSERT. This module returns the basis,
// the marks, the carried-forward set and the entry intent, and names each criterion it can only
// partially answer in the doc comment of the function that answers it. Criteria 9.7 and 9.8 are
// migration criteria (Requirement 15 sets the two flags on release) and cannot be implemented by a
// pure function at all; their two exact config keys and their release values are exported below as
// constants so the migration and the readers agree on the spelling.

import type { VarianceDecision } from './attendance-variance.js';
import type {
  DayClassification as PayableDayClassification,
  PayableDayResult,
} from './payable-days.js';

// ---------------------------------------------------------------------------------------------
// Compile-time assertions. `Assert<false>` is an error because false does not extend true; the
// tuple wrapping is what makes an accidental `never` fail rather than pass vacuously.
// ---------------------------------------------------------------------------------------------

type Assert<T extends true> = T;

// ---------------------------------------------------------------------------------------------
// Vocabulary. Fixed strings shared with the Variance_Review_Queue and the migration; criterion
// 7.11 names the Review_Outcome values and the queue states, and the record status enum is
// `payroll_attendance_conflict_review.status` extended with 'contested' by the same criterion.
// ---------------------------------------------------------------------------------------------

/** criterion 7.11. */
export type ReviewOutcome = 'apr_accepted' | 'apr_disputed' | 'adjustment_requested';

/** criterion 7.11: Queued_For_Dual_Review or Recorded_Not_Queued. */
export type QueueState = 'queued_for_dual_review' | 'recorded_not_queued';

/** `payroll_attendance_conflict_review.status` plus criterion 7.10's contested state. */
export type VarianceRecordStatus =
  | 'open'
  | 'notified'
  | 'reviewed'
  | 'contested'
  | 'no_issue'
  | 'regularization_required';

/**
 * UNREVIEWED, precisely: no reviewer has recorded a Review_Outcome yet. 'open' is a record nobody
 * has been notified about; 'notified' is a record a reviewer has been told about and has not acted
 * on. These are the two statuses criterion 9.6 blocks on and criterion 9.3 carries forward.
 */
export type UnreviewedStatus = 'open' | 'notified';

/**
 * REVIEWED, precisely: the complement. 'reviewed', 'no_issue' and 'regularization_required' are
 * the three terminal outcomes the existing table already records. 'contested' counts as reviewed
 * because criterion 7.10 reaches it only "when two reviewers record conflicting Review_Outcomes" —
 * two reviews happened. It is additionally reported as its own count by criterion 9.5, and it does
 * not block cut-off under 9.6, which blocks on records that "remain unreviewed". A contested
 * record awaits an Override_Approver, not a reviewer.
 */
export type ReviewedStatus = Exclude<VarianceRecordStatus, UnreviewedStatus>;

// The reviewed/unreviewed split is a real partition of the status space, checked by the compiler:
// total (every status is one or the other) and disjoint (none is both). If the status enum ever
// grows a seventh value, the first assertion fails and forces a decision about which side it falls
// on rather than letting it silently vanish from both counts.
type _StatusPartitionIsTotal = Assert<
  VarianceRecordStatus extends UnreviewedStatus | ReviewedStatus ? true : false
>;
type _StatusPartitionIsDisjoint = Assert<
  [Extract<UnreviewedStatus, ReviewedStatus>] extends [never] ? true : false
>;

/**
 * The Variance_Decisions that actually raise a Variance_Record, taken from
 * attendance-variance.ts's exported union rather than restated, so a new raising decision there is
 * automatically accepted here and a not-raised decision remains unrepresentable. Today:
 * 'raised_biometric_shortfall' (criterion 6.1) and 'raised_dialler_underclassified' (6.4).
 */
export type RaisedVarianceDecision = Extract<VarianceDecision, `raised_${string}`>;

// Sanity: the extraction must actually match something, or every record below would be
// unconstructable.
type _RaisedDecisionsExist = Assert<[RaisedVarianceDecision] extends [never] ? false : true>;

/**
 * What a day contributes to Payable_Days, reusing payable-days.ts's own field type rather than
 * restating `number | null`. null carries payable-days.ts's meaning unchanged: "not determined by
 * this day alone", the day being in review — which is why criterion 9.4's difference is not always
 * computable and is reported as such instead of being invented as 0.
 */
export type PayableDayValue = PayableDayResult['payableDayValue'];

// ---------------------------------------------------------------------------------------------
// attendance_feature_config. The two keys of criteria 9.7 and 9.8, spelled once.
// ---------------------------------------------------------------------------------------------

/** criterion 9.7. Migration sets this to 1 on release so the queue is active. */
export const FEATURE_FLAG_MISMATCH_WORKFLOW_ENABLED = 'mismatch_workflow_enabled';

/** criterion 9.8. Migration sets this to 0 on release; a branch may opt in to 9.6's blocking. */
export const FEATURE_FLAG_PAYROLL_LOCK_ON_UNRESOLVED_MISMATCH =
  'payroll_lock_on_unresolved_mismatch';

/** criterion 9.7's released value. */
export const RELEASE_DEFAULT_MISMATCH_WORKFLOW_ENABLED = 1 as const;

/**
 * criterion 9.8's released value, and the reason this module exists: absent, blank or unreadable
 * resolves to 0, so a missing row can never block a payroll run.
 */
export const RELEASE_DEFAULT_PAYROLL_LOCK_ON_UNRESOLVED_MISMATCH = 0 as const;

/**
 * A raw `attendance_feature_config.config_value` as the caller read it, or the resolved per-branch
 * override. Passed raw (not pre-coerced to boolean) so "absent" and "present but unreadable" stay
 * distinguishable, the same convention as AttendanceFeatureConfigValues in
 * attendance-rule-migration-proposal.ts.
 */
export type FeatureFlagValue = string | number | boolean | null | undefined;

export interface ResolvedFeatureFlag {
  readonly value: 0 | 1;
  readonly wasAbsent: boolean;
  readonly rejectedValue: FeatureFlagValue;
  readonly warning: string | null;
}

/**
 * Total: every input returns a defined 0 or 1. Absent (null / undefined / blank) applies the
 * release default silently. A present but unreadable value applies the release default, retains
 * the rejected value and warns, the same handling applyThreshold() gives a malformed threshold in
 * attendance-variance.ts. Nothing here throws, because a junk config row is ordinary data.
 */
export function resolveFeatureFlag(
  key: string,
  raw: FeatureFlagValue,
  releaseDefault: 0 | 1,
): ResolvedFeatureFlag {
  if (raw === null || raw === undefined) {
    return { value: releaseDefault, wasAbsent: true, rejectedValue: null, warning: null };
  }
  if (typeof raw === 'boolean') {
    return { value: raw ? 1 : 0, wasAbsent: false, rejectedValue: null, warning: null };
  }
  if (typeof raw === 'number') {
    if (raw === 0) return { value: 0, wasAbsent: false, rejectedValue: null, warning: null };
    if (raw === 1) return { value: 1, wasAbsent: false, rejectedValue: null, warning: null };
    return {
      value: releaseDefault,
      wasAbsent: false,
      rejectedValue: raw,
      warning: unreadableFlagWarning(key, raw, releaseDefault),
    };
  }
  const text = raw.trim().toLowerCase();
  if (text === '') {
    return { value: releaseDefault, wasAbsent: true, rejectedValue: null, warning: null };
  }
  if (text === '1' || text === 'true' || text === 'yes' || text === 'on') {
    return { value: 1, wasAbsent: false, rejectedValue: null, warning: null };
  }
  if (text === '0' || text === 'false' || text === 'no' || text === 'off') {
    return { value: 0, wasAbsent: false, rejectedValue: null, warning: null };
  }
  return {
    value: releaseDefault,
    wasAbsent: false,
    rejectedValue: raw,
    warning: unreadableFlagWarning(key, raw, releaseDefault),
  };
}

function unreadableFlagWarning(key: string, raw: FeatureFlagValue, applied: 0 | 1): string {
  return (
    `attendance_feature_config.${key} holds ${JSON.stringify(raw)}, which is not a readable ` +
    `0/1 flag value; applied the release default of ${applied}.`
  );
}

// ---------------------------------------------------------------------------------------------
// Pay_Month. 'YYYY-MM'.
// ---------------------------------------------------------------------------------------------

const PAY_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * @throws when the value is not 'YYYY-MM'. A malformed Pay_Month is a programmer error, not
 *   ordinary data, and the same guard buildAttendanceRuleMigrationProposal() applies: every
 *   comparison below (which month is closed, which is earliest open) is made against this value,
 *   so an unparseable one would silently target an arrear at the wrong month or report a branch as
 *   having no variances at all. Compare with the deliberately non-throwing cases in this module:
 *   an empty record set, an absent flag and an empty openPayMonths list all return defined results.
 */
function assertPayMonth(label: string, value: string): void {
  if (typeof value !== 'string' || !PAY_MONTH_PATTERN.test(value)) {
    throw new Error(
      `variance-payroll-cutoff: ${label} must be a Pay_Month of the form 'YYYY-MM' ` +
        `(received ${JSON.stringify(value)}).`,
    );
  }
}

/**
 * Chronological ordinal of a Pay_Month: months since year 0. Negative when a < b.
 *
 * WHY THIS IS SAFE AND NOT STRING LUCK. assertPayMonth() has already fixed the shape to exactly
 * four digits, a hyphen and a zero-padded month in 01..12, so year and month are read by position
 * and parsed as base-10 integers, and the returned ordinal is a strictly monotonic function of
 * (year, month). Lexicographic comparison would happen to agree for this validated subset, but
 * only because the fields are fixed-width and zero-padded; the arithmetic does not depend on that
 * coincidence, so '2026-09' vs '2026-10' and a year boundary such as '2026-12' vs '2027-01' are
 * decided by the month number, never by digit order. Both arguments are validated first, so
 * "earliest open" cannot be decided against a value like '2026-9'.
 *
 * @throws when either value is not 'YYYY-MM' (programmer error, see assertPayMonth).
 */
export function comparePayMonths(a: string, b: string): number {
  assertPayMonth('payMonth', a);
  assertPayMonth('payMonth', b);
  return payMonthOrdinal(a) - payMonthOrdinal(b);
}

function payMonthOrdinal(payMonth: string): number {
  const year = Number.parseInt(payMonth.slice(0, 4), 10);
  const month = Number.parseInt(payMonth.slice(5, 7), 10);
  return year * 12 + (month - 1);
}

/**
 * criterion 9.4's target month. Returns null for an empty list rather than throwing: "no
 * Pay_Month is open" is an ordinary state of the world (every month closed, the next not yet
 * opened) and the caller is told so explicitly.
 *
 * Duplicates in the list are harmless. Ordering of the input is irrelevant: the result is the
 * chronological minimum.
 *
 * @throws when any entry is not 'YYYY-MM' (programmer error, see assertPayMonth).
 */
export function earliestOpenPayMonth(openPayMonths: readonly string[]): string | null {
  let earliest: string | null = null;
  for (const candidate of openPayMonths) {
    assertPayMonth('openPayMonths entry', candidate);
    if (earliest === null || comparePayMonths(candidate, earliest) < 0) earliest = candidate;
  }
  return earliest;
}

// ---------------------------------------------------------------------------------------------
// The record this module reasons over.
// ---------------------------------------------------------------------------------------------

/**
 * One Variance_Record as the payroll reader holds it. `varianceDecision` is a
 * RaisedVarianceDecision, not a VarianceDecision: a Variance_Record exists only because criterion
 * 6.1 or 6.4 raised it, so "was this record raised?" is answered by the type and criterion 9.5's
 * raised count is the size of the supplied set rather than a filter over it.
 */
export interface PayrollVarianceRecord {
  readonly recordId: string;
  readonly employeeId: string;
  readonly branchId: string;
  /** 'YYYY-MM-DD'. The employee-date the variance was raised for. */
  readonly attendanceDate: string;
  /** 'YYYY-MM'. The Pay_Month that date falls in. */
  readonly payMonth: string;
  /** criterion 7.11's queue state as stored. The presentation gate of 9.9 is applied over it. */
  readonly queueState: QueueState;
  readonly status: VarianceRecordStatus;
  /** The recorded Review_Outcome, or null while unreviewed. Carried for reporting only. */
  readonly reviewOutcome?: ReviewOutcome | null;
  readonly varianceDecision: RaisedVarianceDecision;
  /** The salary line this employee-month pays on, when the caller knows it. Criterion 9.2. */
  readonly salaryLineId?: string | null;
}

/**
 * A record with criterion 9.9's presentation gate applied. `effectiveQueueState` is what the
 * Variance_Review_Queue actually presents; `queueState` remains the stored value, so a demotion is
 * visible rather than silent.
 */
export interface EffectiveVarianceRecord extends PayrollVarianceRecord {
  readonly effectiveQueueState: QueueState;
  readonly demotedByPresentationGate: boolean;
}

/** Structurally guaranteed to be presented for Dual_Review. See guarantee 2 in the file header. */
type QueuedRecord = EffectiveVarianceRecord & {
  readonly effectiveQueueState: 'queued_for_dual_review';
};

/** Structurally guaranteed to be both presented and not yet reviewed: the only thing 9.6 blocks on. */
type UnreviewedQueuedRecord = QueuedRecord & { readonly status: UnreviewedStatus };

function isUnreviewedStatus(status: VarianceRecordStatus): status is UnreviewedStatus {
  // Written as explicit disjuncts rather than an array lookup so the compiler checks the return
  // type against the union; the partition assertions above force this to be revisited if the
  // status enum grows.
  return status === 'open' || status === 'notified';
}

function isQueued(record: EffectiveVarianceRecord): record is QueuedRecord {
  return record.effectiveQueueState === 'queued_for_dual_review';
}

function isUnreviewedQueued(record: EffectiveVarianceRecord): record is UnreviewedQueuedRecord {
  return isQueued(record) && isUnreviewedStatus(record.status);
}

/**
 * Total order over records, so every array this module returns is sorted and the same records in a
 * different input order produce an identical result. recordId is last and is unique, so the order
 * is total rather than merely deterministic-if-lucky. Plain string comparison, not localeCompare:
 * the result must not depend on the process locale.
 */
function compareRecords(a: PayrollVarianceRecord, b: PayrollVarianceRecord): number {
  if (a.attendanceDate !== b.attendanceDate) return a.attendanceDate < b.attendanceDate ? -1 : 1;
  if (a.employeeId !== b.employeeId) return a.employeeId < b.employeeId ? -1 : 1;
  if (a.recordId === b.recordId) return 0;
  return a.recordId < b.recordId ? -1 : 1;
}

function compareStrings(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Identity of a record for duplicate detection. Field order is fixed, so two entries that describe
 * the same record produce the same key regardless of object literal key order.
 */
function recordIdentity(record: PayrollVarianceRecord): string {
  return JSON.stringify([
    record.recordId,
    record.employeeId,
    record.branchId,
    record.attendanceDate,
    record.payMonth,
    record.queueState,
    record.status,
    record.reviewOutcome ?? null,
    record.varianceDecision,
    record.salaryLineId ?? null,
  ]);
}

/**
 * Collapses exact duplicates (so passing the same list twice concatenated changes nothing) and
 * rejects two different records sharing one recordId.
 *
 * @throws when one recordId carries two different sets of field values. That is a programmer
 *   error: recordId is the queue's primary key, so the database cannot produce it, and silently
 *   picking one of the two would make the answer depend on input order — the exact property this
 *   module promises not to have.
 */
function dedupeRecords(records: readonly PayrollVarianceRecord[]): PayrollVarianceRecord[] {
  const byId = new Map<string, { record: PayrollVarianceRecord; identity: string }>();
  for (const record of records) {
    const identity = recordIdentity(record);
    const seen = byId.get(record.recordId);
    if (seen === undefined) {
      byId.set(record.recordId, { record, identity });
      continue;
    }
    if (seen.identity !== identity) {
      throw new Error(
        `variance-payroll-cutoff: two different Variance_Records were supplied under recordId ` +
          `${JSON.stringify(record.recordId)}. recordId is the queue's primary key, so the ` +
          `result would otherwise depend on input order.`,
      );
    }
  }
  return [...byId.values()].map((entry) => entry.record);
}

// ---------------------------------------------------------------------------------------------
// criterion 9.9: detection versus presentation.
// ---------------------------------------------------------------------------------------------

/**
 * The raised and recorded counts. Note the signature: no flag parameter. Criterion 9.9's promise
 * that "enabling the flag does not require backfilling detection" is this absence — raising and
 * recording cannot vary with a flag they cannot see. See guarantee 3 in the file header.
 */
function countRaisedAndRecorded(records: readonly PayrollVarianceRecord[]): {
  raised: number;
  recorded: number;
} {
  // Every supplied record was raised (RaisedVarianceDecision) and is recorded by virtue of being
  // readable, so the two counts are equal by construction. They are reported separately because
  // criterion 9.9 states both obligations, and a future reader should see that neither is a
  // filter over the other.
  return { raised: records.length, recorded: records.length };
}

/**
 * criterion 9.9's gate. With `mismatch_workflow_enabled` at 0 no record is presented for
 * Dual_Review; the stored queue state is retained on the record and the demotion is flagged.
 */
function applyPresentationGate(
  records: readonly PayrollVarianceRecord[],
  mismatchWorkflowEnabled: 0 | 1,
): EffectiveVarianceRecord[] {
  return records.map((record) => {
    const demoted =
      mismatchWorkflowEnabled === 0 && record.queueState === 'queued_for_dual_review';
    return {
      ...record,
      effectiveQueueState: demoted ? 'recorded_not_queued' : record.queueState,
      demotedByPresentationGate: demoted,
    };
  });
}

export interface PresentationInput {
  readonly records: readonly PayrollVarianceRecord[];
  /** Raw `attendance_feature_config.mismatch_workflow_enabled`. Absent applies 9.7's released 1. */
  readonly mismatchWorkflowEnabled?: FeatureFlagValue;
}

export interface PresentationResult {
  readonly mismatchWorkflowEnabled: 0 | 1;
  /** criterion 9.9: raised regardless of the flag. */
  readonly raisedCount: number;
  /** criterion 9.9: recorded regardless of the flag. */
  readonly recordedCount: number;
  readonly presentedForDualReview: readonly EffectiveVarianceRecord[];
  readonly notPresented: readonly EffectiveVarianceRecord[];
  /** How many stored `queued_for_dual_review` records the gate withheld. */
  readonly demotedByPresentationGate: number;
  /**
   * Literal false. Detection did not read the flag, so turning the flag on has nothing to
   * backfill — the records are already raised and recorded and simply become presentable.
   */
  readonly backfillRequiredOnEnable: false;
  readonly configurationWarnings: readonly string[];
}

/**
 * criterion 9.9. Splits a raised, recorded set into what is presented for Dual_Review and what is
 * not, without ever changing what was raised or recorded.
 *
 * PARTIALLY COVERED: the raising and the recording themselves are attendance-variance.ts's
 * decision and the queue writer's INSERT. This function reports that they are independent of the
 * flag and computes the presentation split; it does not perform the write.
 *
 * Total: an empty record set and an absent flag both return defined results.
 */
export function splitDetectionFromPresentation(input: PresentationInput): PresentationResult {
  const flag = resolveFeatureFlag(
    FEATURE_FLAG_MISMATCH_WORKFLOW_ENABLED,
    input.mismatchWorkflowEnabled,
    RELEASE_DEFAULT_MISMATCH_WORKFLOW_ENABLED,
  );
  const records = dedupeRecords(input.records);
  const counts = countRaisedAndRecorded(records);
  const effective = applyPresentationGate(records, flag.value).sort(compareRecords);

  const presented = effective.filter(isQueued);
  const notPresented = effective.filter((record) => !isQueued(record));

  return {
    mismatchWorkflowEnabled: flag.value,
    raisedCount: counts.raised,
    recordedCount: counts.recorded,
    presentedForDualReview: Object.freeze(presented),
    notPresented: Object.freeze(notPresented),
    demotedByPresentationGate: effective.filter((r) => r.demotedByPresentationGate).length,
    backfillRequiredOnEnable: false,
    configurationWarnings: Object.freeze(
      [flag.warning].filter((w): w is string => w !== null),
    ),
  };
}

// ---------------------------------------------------------------------------------------------
// criterion 9.5: the pre-close reconciliation view.
// ---------------------------------------------------------------------------------------------

export interface PreCloseReconciliationInput {
  /** 'YYYY-MM'. The Pay_Month about to reach Payroll_Cut_Off. */
  readonly payMonth: string;
  readonly branchId: string;
  /**
   * The branch's Variance_Records. Records for another branch or another Pay_Month are counted out
   * of scope rather than silently included, so passing a whole month's set for every branch is
   * safe.
   */
  readonly records: readonly PayrollVarianceRecord[];
  readonly mismatchWorkflowEnabled?: FeatureFlagValue;
}

/**
 * criterion 9.5's six counts, plus the scope and configuration facts a payroll head needs to trust
 * them.
 *
 * THE DEFINITIONS, STATED RATHER THAN IMPLIED:
 *  - `raised` — every Variance_Record in scope. A record exists only because it was raised
 *    (criteria 6.1, 6.4), which the RaisedVarianceDecision field type enforces, so this is the size
 *    of the in-scope set.
 *  - `queuedForDualReview` / `recordedNotQueued` — an exact partition of `raised` by effective
 *    queue state, so the two always sum to `raised`.
 *  - `reviewed` / `unreviewed` — an exact partition of `queuedForDualReview` only, by status. A
 *    `recorded_not_queued` record was never presented to anybody, so no review is outstanding on
 *    it and it is not "unreviewed" in the sense that gates anything; it is counted once, under
 *    `recordedNotQueued`. Adding it to `unreviewed` would report 14,891 July 2026 mismatch rows as
 *    pending reviews nobody was ever asked for.
 *  - `contested` — status 'contested' across the whole in-scope set (criterion 7.10). Not a
 *    seventh bucket: two reviewers already recorded outcomes and the record now awaits an
 *    Override_Approver. It is counted over the whole set rather than over the queued set because a
 *    real dispute must not vanish from the view when a branch turns `mismatch_workflow_enabled`
 *    off — which is exactly how a contested record can end up NOT queued, the 9.9 gate demoting a
 *    record that had already been reviewed twice. `contestedQueued` is the sub-count that is
 *    inside `reviewed`; `contested` is the total. A property test found this: the earlier claim
 *    that contested is always a sub-count of reviewed was false for precisely that case.
 */
export interface PreCloseReconciliation {
  readonly payMonth: string;
  readonly branchId: string;
  /** criterion 9.5's six counts, in the order the criterion lists them. */
  readonly raised: number;
  readonly queuedForDualReview: number;
  readonly recordedNotQueued: number;
  readonly reviewed: number;
  readonly unreviewed: number;
  readonly contested: number;
  /**
   * The part of `contested` that is currently presented, and therefore the part that sits inside
   * `reviewed`. contestedQueued <= reviewed holds for every input; contested <= raised holds for
   * every input; contested <= reviewed does NOT, see the note on `contested` above.
   */
  readonly contestedQueued: number;
  /** Sorted. The records behind `unreviewed`, so the view can name them. */
  readonly unreviewedRecordIds: readonly string[];
  /** Sorted. Distinct employees carrying at least one unreviewed record. */
  readonly unreviewedEmployeeIds: readonly string[];
  /** Supplied records belonging to another branch or another Pay_Month. */
  readonly outOfScopeRecordCount: number;
  readonly mismatchWorkflowEnabled: 0 | 1;
  readonly demotedByPresentationGate: number;
  readonly configurationWarnings: readonly string[];
}

/**
 * criterion 9.5. Builds the pre-close reconciliation view for one Pay_Month and branch.
 *
 * Total: an empty record set returns all-zero counts and empty arrays. Deterministic and
 * ordering-independent: every array is sorted and every count is set-based.
 *
 * @throws only for programmer errors — a malformed payMonth (see assertPayMonth) or two different
 *   records under one recordId (see dedupeRecords).
 */
export function buildPreCloseReconciliation(
  input: PreCloseReconciliationInput,
): PreCloseReconciliation {
  assertPayMonth('payMonth', input.payMonth);

  const flag = resolveFeatureFlag(
    FEATURE_FLAG_MISMATCH_WORKFLOW_ENABLED,
    input.mismatchWorkflowEnabled,
    RELEASE_DEFAULT_MISMATCH_WORKFLOW_ENABLED,
  );

  const deduped = dedupeRecords(input.records);
  for (const record of deduped) assertPayMonth('record.payMonth', record.payMonth);

  const inScope = deduped.filter(
    (record) => record.branchId === input.branchId && record.payMonth === input.payMonth,
  );
  const effective = applyPresentationGate(inScope, flag.value).sort(compareRecords);

  const queued = effective.filter(isQueued);
  const unreviewedQueued = queued.filter(isUnreviewedQueued);

  return {
    payMonth: input.payMonth,
    branchId: input.branchId,
    raised: effective.length,
    queuedForDualReview: queued.length,
    recordedNotQueued: effective.length - queued.length,
    // reviewed is the complement of unreviewed WITHIN queued, computed by subtraction so the two
    // cannot drift apart and the partition holds by arithmetic rather than by two filters that
    // might disagree.
    reviewed: queued.length - unreviewedQueued.length,
    unreviewed: unreviewedQueued.length,
    contested: effective.filter((record) => record.status === 'contested').length,
    contestedQueued: queued.filter((record) => record.status === 'contested').length,
    unreviewedRecordIds: Object.freeze(
      unreviewedQueued.map((record) => record.recordId).sort(compareStrings),
    ),
    unreviewedEmployeeIds: Object.freeze(
      [...new Set(unreviewedQueued.map((record) => record.employeeId))].sort(compareStrings),
    ),
    outOfScopeRecordCount: deduped.length - inScope.length,
    mismatchWorkflowEnabled: flag.value,
    demotedByPresentationGate: effective.filter((r) => r.demotedByPresentationGate).length,
    configurationWarnings: Object.freeze(
      [flag.warning].filter((w): w is string => w !== null),
    ),
  };
}

// ---------------------------------------------------------------------------------------------
// criteria 9.1, 9.2, 9.6: the cut-off decision.
// ---------------------------------------------------------------------------------------------

/**
 * criterion 9.2. One salary line marked paid with an unreviewed variance, carrying the count of
 * unreviewed dates on that line. A salary line is one employee's line in the run, so the marks are
 * grouped by employee.
 *
 * Built from the unreviewed QUEUED set only, consistently with criterion 9.5's definitions: a
 * `recorded_not_queued` record was never presented, so the line was not paid past a review anybody
 * was asked to do, and marking every such line would make the mark useless as a signal.
 */
export interface UnreviewedVarianceMark {
  readonly employeeId: string;
  readonly branchId: string;
  readonly payMonth: string;
  readonly salaryLineId: string | null;
  /** Literal true: this type exists only to record the mark, so there is no "unmarked" value. */
  readonly paidWithUnreviewedVariance: true;
  /** criterion 9.2's count of unreviewed dates on this line. Always at least 1. */
  readonly unreviewedDateCount: number;
  /** Sorted 'YYYY-MM-DD'. Distinct dates, so two records on one date count once. */
  readonly unreviewedDates: readonly string[];
  readonly varianceRecordIds: readonly string[];
}

export type CutOffDisposition =
  /** criteria 9.1, 9.2. The default, and the case with no unreviewed record at all. */
  | 'proceeds'
  /** criterion 9.6, and only reachable with the branch's lock flag resolved to 1. */
  | 'refused_unreviewed_queued_variances';

interface CutOffDecisionCommon {
  readonly payMonth: string;
  readonly branchId: string;
  readonly payrollLockOnUnresolvedMismatch: 0 | 1;
  readonly lockFlagWasAbsent: boolean;
  readonly reconciliation: PreCloseReconciliation;
  /** Human-readable, and for the refusal it names the count (criterion 9.6). */
  readonly reason: string;
  readonly configurationWarnings: readonly string[];
}

export interface CutOffProceeds extends CutOffDecisionCommon {
  readonly disposition: 'proceeds';
  /** Literal true. No caller can read a false out of the default arm. */
  readonly mayProceed: true;
  /**
   * criterion 9.1. Payable_Days are derived from the resolved Attendance_Source and the run
   * completes. This module states the basis; payable-days.ts classifies each day and the payroll
   * writer sums them.
   */
  readonly payableDaysBasis: 'resolved_attendance_source';
  /** criterion 9.2. One entry per affected salary line, sorted by employeeId. Possibly empty. */
  readonly salaryLineMarks: readonly UnreviewedVarianceMark[];
  /** Convenience: the number of unreviewed queued records the run is proceeding past. */
  readonly unreviewedQueuedCount: number;
}

export interface CutOffRefused extends CutOffDecisionCommon {
  readonly disposition: 'refused_unreviewed_queued_variances';
  readonly mayProceed: false;
  /** Literal 1: refusal is unreachable unless the branch opted in (criteria 9.6, 9.8). */
  readonly payrollLockOnUnresolvedMismatch: 1;
  /** criterion 9.6's named count. Structurally at least 1 — see guarantee 2 in the file header. */
  readonly unreviewedQueuedCount: number;
  readonly blockingRecordIds: readonly string[];
  readonly blockingEmployeeIds: readonly string[];
}

export type PayrollCutOffDecision = CutOffProceeds | CutOffRefused;

export interface PayrollCutOffDecisionInput {
  /** 'YYYY-MM'. The Pay_Month reaching Payroll_Cut_Off. */
  readonly payMonth: string;
  readonly branchId: string;
  readonly records: readonly PayrollVarianceRecord[];
  /**
   * The resolved per-branch value of `payroll_lock_on_unresolved_mismatch`. Absent, blank or
   * unreadable resolves to 0 (criterion 9.8), which is the default that does not block.
   */
  readonly payrollLockOnUnresolvedMismatch?: FeatureFlagValue;
  readonly mismatchWorkflowEnabled?: FeatureFlagValue;
}

/**
 * criteria 9.1, 9.2 and 9.6. Decides whether a branch may reach Payroll_Cut_Off for a Pay_Month.
 *
 * DEFAULT (flag 0, absent, blank or unreadable): cut-off PROCEEDS. Payable_Days derive from the
 * resolved Attendance_Source, the run completes (9.1), and each affected salary line is returned
 * marked paid-with-an-unreviewed-variance carrying the count of unreviewed dates on it (9.2).
 *
 * FLAG 1 FOR THE BRANCH: cut-off is REFUSED while queued records remain unreviewed, and the
 * refusal names the count (9.6). Only `queued_for_dual_review` records can block.
 *
 * PARTIALLY COVERED: the Payable_Days derivation of 9.1 and the salary-line UPDATE of 9.2 are the
 * payroll calculator's writes. This function returns the basis and the marks.
 *
 * Total: an empty record set, an absent flag and an unreadable flag all return defined decisions.
 * Ordering-independent: the decision and every array in it are set-based and sorted.
 *
 * @throws only for programmer errors — a malformed payMonth or a conflicting duplicate recordId.
 */
export function decidePayrollCutOff(input: PayrollCutOffDecisionInput): PayrollCutOffDecision {
  const reconciliation = buildPreCloseReconciliation({
    payMonth: input.payMonth,
    branchId: input.branchId,
    records: input.records,
    mismatchWorkflowEnabled: input.mismatchWorkflowEnabled,
  });

  const lock = resolveFeatureFlag(
    FEATURE_FLAG_PAYROLL_LOCK_ON_UNRESOLVED_MISMATCH,
    input.payrollLockOnUnresolvedMismatch,
    RELEASE_DEFAULT_PAYROLL_LOCK_ON_UNRESOLVED_MISMATCH,
  );

  const warnings = [...reconciliation.configurationWarnings];
  if (lock.warning !== null) warnings.push(lock.warning);

  // The blocking candidates. Recomputed here from the same in-scope, presentation-gated set the
  // reconciliation used, and typed UnreviewedQueuedRecord, which is the only type refuseCutOff()
  // accepts.
  const workflowFlagValue = reconciliation.mismatchWorkflowEnabled;
  const inScope = dedupeRecords(input.records).filter(
    (record) => record.branchId === input.branchId && record.payMonth === input.payMonth,
  );
  const blocking = applyPresentationGate(inScope, workflowFlagValue)
    .filter(isUnreviewedQueued)
    .sort(compareRecords);

  // criteria 9.1, 9.2, 9.8. The default path, taken before any count is consulted: with the flag
  // at 0 the number of unreviewed records is irrelevant to whether the run may proceed. After this
  // return the compiler has narrowed lock.value to 1, which is the only value refuseCutOff()
  // accepts, so no edit can make this path refuse without a type error.
  if (lock.value === 0) {
    return proceed(input, reconciliation, 0, lock.wasAbsent, blocking, warnings);
  }

  const nonEmptyBlocking = asNonEmpty(blocking);
  if (nonEmptyBlocking === null) {
    // Flag is on, nothing is outstanding: cut-off proceeds, with no marks to make.
    return proceed(input, reconciliation, 1, lock.wasAbsent, blocking, warnings);
  }
  return refuseCutOff(lock.value, input, reconciliation, lock.wasAbsent, nonEmptyBlocking, warnings);
}

function proceed(
  input: PayrollCutOffDecisionInput,
  reconciliation: PreCloseReconciliation,
  lockValue: 0 | 1,
  lockFlagWasAbsent: boolean,
  unreviewedQueued: readonly UnreviewedQueuedRecord[],
  warnings: readonly string[],
): CutOffProceeds {
  const marks = buildUnreviewedVarianceMarks(input.payMonth, input.branchId, unreviewedQueued);
  return {
    payMonth: input.payMonth,
    branchId: input.branchId,
    disposition: 'proceeds',
    mayProceed: true,
    payableDaysBasis: 'resolved_attendance_source',
    payrollLockOnUnresolvedMismatch: lockValue,
    lockFlagWasAbsent,
    salaryLineMarks: marks,
    unreviewedQueuedCount: unreviewedQueued.length,
    reconciliation,
    reason:
      unreviewedQueued.length === 0
        ? `No unreviewed Queued_For_Dual_Review Variance_Record remains for branch ` +
          `${input.branchId} in ${input.payMonth}; Payroll_Cut_Off proceeds.`
        : `${unreviewedQueued.length} unreviewed Queued_For_Dual_Review Variance_Record(s) ` +
          `remain for branch ${input.branchId} in ${input.payMonth}. ` +
          `attendance_feature_config.${FEATURE_FLAG_PAYROLL_LOCK_ON_UNRESOLVED_MISMATCH} is ` +
          `${lockValue} for this branch, so Payroll_Cut_Off proceeds (criterion 9.1): ` +
          `Payable_Days derive from the resolved Attendance_Source and ${marks.length} salary ` +
          `line(s) are marked paid with an unreviewed variance (criterion 9.2).`,
    configurationWarnings: Object.freeze([...warnings]),
  };
}

/**
 * criterion 9.6. The ONLY constructor of a refusing decision.
 *
 * Two things in this signature do the work the file header claims. `lock: 1` makes the refusal
 * uncallable on the default path, where the compiler has narrowed the value to 0. And the
 * non-empty tuple makes a refusal that names a count of zero unrepresentable, so "SHALL name the
 * count" cannot degrade into "SHALL name 0".
 */
function refuseCutOff(
  lock: 1,
  input: PayrollCutOffDecisionInput,
  reconciliation: PreCloseReconciliation,
  lockFlagWasAbsent: boolean,
  blocking: readonly [UnreviewedQueuedRecord, ...UnreviewedQueuedRecord[]],
  warnings: readonly string[],
): CutOffRefused {
  const count = blocking.length;
  return {
    payMonth: input.payMonth,
    branchId: input.branchId,
    disposition: 'refused_unreviewed_queued_variances',
    mayProceed: false,
    payrollLockOnUnresolvedMismatch: lock,
    lockFlagWasAbsent,
    unreviewedQueuedCount: count,
    blockingRecordIds: Object.freeze(blocking.map((r) => r.recordId).sort(compareStrings)),
    blockingEmployeeIds: Object.freeze(
      [...new Set(blocking.map((r) => r.employeeId))].sort(compareStrings),
    ),
    reconciliation,
    reason:
      `Payroll_Cut_Off refused for branch ${input.branchId} in ${input.payMonth}: ${count} ` +
      `Queued_For_Dual_Review Variance_Record(s) remain unreviewed. ` +
      `attendance_feature_config.${FEATURE_FLAG_PAYROLL_LOCK_ON_UNRESOLVED_MISMATCH} is 1 for ` +
      `this branch (criterion 9.6); the released default is ` +
      `${RELEASE_DEFAULT_PAYROLL_LOCK_ON_UNRESOLVED_MISMATCH}, which does not block (criterion 9.8).`,
    configurationWarnings: Object.freeze([...warnings]),
  };
}

/**
 * The single narrowing from "array" to "non-empty tuple". Contained here rather than spread over
 * the call sites, and returning null instead of throwing so an empty blocking set stays ordinary
 * data.
 */
function asNonEmpty<T>(items: readonly T[]): readonly [T, ...T[]] | null {
  if (items.length === 0) return null;
  return items as readonly [T, ...T[]];
}

/** criterion 9.2. One mark per employee (salary line), sorted, with distinct dates counted once. */
function buildUnreviewedVarianceMarks(
  payMonth: string,
  branchId: string,
  unreviewedQueued: readonly UnreviewedQueuedRecord[],
): readonly UnreviewedVarianceMark[] {
  const byEmployee = new Map<string, UnreviewedQueuedRecord[]>();
  for (const record of unreviewedQueued) {
    const bucket = byEmployee.get(record.employeeId);
    if (bucket === undefined) byEmployee.set(record.employeeId, [record]);
    else bucket.push(record);
  }

  const marks = [...byEmployee.entries()].map(([employeeId, records]) => {
    const dates = [...new Set(records.map((r) => r.attendanceDate))].sort(compareStrings);
    // If two records for one employee disagree about salaryLineId the mark cannot pick one, so it
    // reports null rather than whichever arrived first — an ordering-dependent answer would be
    // worse than an absent one, and the writer already knows the line.
    const lineIds = [...new Set(records.map((r) => r.salaryLineId ?? null))];
    const salaryLineId = lineIds.length === 1 ? lineIds[0]! : null;
    return {
      employeeId,
      branchId,
      payMonth,
      salaryLineId,
      paidWithUnreviewedVariance: true as const,
      unreviewedDateCount: dates.length,
      unreviewedDates: Object.freeze(dates),
      varianceRecordIds: Object.freeze(records.map((r) => r.recordId).sort(compareStrings)),
    };
  });

  return Object.freeze(marks.sort((a, b) => compareStrings(a.employeeId, b.employeeId)));
}

// ---------------------------------------------------------------------------------------------
// criterion 9.3: carry-forward.
// ---------------------------------------------------------------------------------------------

export interface CarriedForwardRecord {
  readonly record: EffectiveVarianceRecord;
  /** criterion 9.3: the Pay_Month the record is presented as carried forward FROM. */
  readonly carriedForwardFromPayMonth: string;
  /** Literal true: criterion 9.3 retains the record, so this type has no discarding value. */
  readonly retained: true;
}

export interface CarryForwardResult {
  readonly payMonth: string;
  readonly branchId: string;
  /** criterion 9.3. The unreviewed queued records that survive cut-off, sorted. */
  readonly carriedForward: readonly CarriedForwardRecord[];
  readonly carriedForwardCount: number;
  /**
   * Retained but NOT carried forward as a pending review: records that were never presented
   * (`recorded_not_queued`, including anything the 9.9 gate withheld). Reported so nothing is
   * silently dropped, and kept separate because criterion 9.3 carries forward what is unreviewed.
   */
  readonly retainedNotPresented: readonly EffectiveVarianceRecord[];
  /** Records already reviewed before cut-off, which nothing carries forward. */
  readonly closedAtCutOffCount: number;
  readonly configurationWarnings: readonly string[];
}

export interface CarryForwardInput {
  /** 'YYYY-MM'. The Pay_Month that reached Payroll_Cut_Off. */
  readonly payMonth: string;
  readonly branchId: string;
  readonly records: readonly PayrollVarianceRecord[];
  readonly mismatchWorkflowEnabled?: FeatureFlagValue;
}

/**
 * criterion 9.3. Which Variance_Records survive Payroll_Cut_Off and the Pay_Month each is
 * presented as carried forward from.
 *
 * PARTIALLY COVERED: retention and presentation are queue state, written by the queue. This
 * function decides which records those are.
 *
 * Total and ordering-independent. Throws only for the two programmer errors named above.
 */
export function deriveCarryForward(input: CarryForwardInput): CarryForwardResult {
  assertPayMonth('payMonth', input.payMonth);

  const flag = resolveFeatureFlag(
    FEATURE_FLAG_MISMATCH_WORKFLOW_ENABLED,
    input.mismatchWorkflowEnabled,
    RELEASE_DEFAULT_MISMATCH_WORKFLOW_ENABLED,
  );

  const deduped = dedupeRecords(input.records);
  for (const record of deduped) assertPayMonth('record.payMonth', record.payMonth);

  const inScope = deduped.filter(
    (record) => record.branchId === input.branchId && record.payMonth === input.payMonth,
  );
  const effective = applyPresentationGate(inScope, flag.value).sort(compareRecords);

  const carriedForward = effective.filter(isUnreviewedQueued).map((record) => ({
    record,
    carriedForwardFromPayMonth: input.payMonth,
    retained: true as const,
  }));
  const retainedNotPresented = effective.filter((record) => !isQueued(record));
  const closedAtCutOff = effective.filter(
    (record) => isQueued(record) && !isUnreviewedStatus(record.status),
  );

  return {
    payMonth: input.payMonth,
    branchId: input.branchId,
    carriedForward: Object.freeze(carriedForward),
    carriedForwardCount: carriedForward.length,
    retainedNotPresented: Object.freeze(retainedNotPresented),
    closedAtCutOffCount: closedAtCutOff.length,
    configurationWarnings: Object.freeze(
      [flag.warning].filter((w): w is string => w !== null),
    ),
  };
}

// ---------------------------------------------------------------------------------------------
// criteria 9.4 and 9.10: reviewing a record whose Pay_Month is already closed.
// ---------------------------------------------------------------------------------------------

/**
 * The review that happened, as a discriminated union so that "no adjustment approved" cannot carry
 * an adjusted Payable_Days value. Criterion 8.1 is why the second arm exists: an `apr_accepted` or
 * `apr_disputed` outcome leaves the classification and Payable_Days alone.
 */
export type ClosedMonthReviewOutcome =
  | {
      readonly kind: 'adjustment_approved';
      /** What the approved classification pays for that date. */
      readonly adjustedPayableDayValue: PayableDayValue;
      readonly adjustedClassification?: PayableDayClassification | null;
    }
  | {
      readonly kind: 'no_adjustment_approved';
      /** criteria 8.1, 9.10. 'adjustment_requested' appears here when the approval was refused. */
      readonly reviewOutcome: ReviewOutcome;
    };

export type ClosedMonthReviewDisposition =
  /** criterion 9.4: adjusted value exceeds what was paid. */
  | 'arrear_raised'
  /** criterion 9.4: adjusted value falls short of what was paid. */
  | 'recovery_raised'
  /** The approved adjustment does not move Payable_Days, so there is nothing to pay or recover. */
  | 'no_entry_no_difference'
  /** criterion 9.4 with no open Pay_Month to target. The difference is returned as pending. */
  | 'no_entry_no_open_pay_month'
  /** criteria 8.1, 9.10: no adjustment was approved. */
  | 'no_entry_no_adjustment_approved'
  /**
   * One of the two Payable_Days values is null — payable-days.ts's "not determined by this day
   * alone", i.e. the day is itself in review. A difference is not computable and none is invented.
   */
  | 'no_entry_difference_not_determinable';

export interface ArrearEntry {
  /** Sign of the difference: positive raises an arrear, negative a recovery. */
  readonly kind: 'arrear' | 'recovery';
  /** criterion 9.4: the earliest open Pay_Month. */
  readonly targetPayMonth: string;
  /** The closed Pay_Month the difference arose in. */
  readonly sourcePayMonth: string;
  readonly employeeId: string;
  readonly branchId: string;
  readonly attendanceDate: string;
  readonly varianceRecordId: string;
  /** adjustedPayableDayValue - paidPayableDayValue, in days. Never 0 on an entry. */
  readonly payableDayDifference: number;
  /** Magnitude in days, so a caller need not re-derive the sign. */
  readonly payableDayMagnitude: number;
}

/**
 * criterion 9.4 with no open Pay_Month. The difference is real and is returned so the caller can
 * raise it when a month opens; nothing is faked into a closed month.
 */
export interface PendingArrearIntent {
  readonly kind: 'arrear' | 'recovery';
  readonly sourcePayMonth: string;
  readonly employeeId: string;
  readonly varianceRecordId: string;
  readonly payableDayDifference: number;
  readonly reason: string;
}

/**
 * criterion 9.10, decision A3. The mark recorded under 9.2 is historical fact.
 *
 * `clearedByReview` and `retainedAsHistoricalFact` are literal types, so no review outcome
 * modelled here can produce a result that says the mark was removed. When the mark was never
 * recorded there is nothing to retain and `retainedAsHistoricalFact` is vacuously true;
 * `recordedAtCutOff` is the field that says whether a mark exists.
 */
export interface UnreviewedVarianceMarkDisposition {
  readonly recordedAtCutOff: boolean;
  readonly clearedByReview: false;
  readonly retainedAsHistoricalFact: true;
}

export interface ClosedMonthReviewInput {
  /** The record being reviewed. Its `payMonth` is the closed Pay_Month. */
  readonly record: PayrollVarianceRecord;
  /**
   * criterion 9.4's target candidates, 'YYYY-MM' each. Which months are open is state this module
   * does not hold, so the caller supplies it. Omitted or empty is a defined case, not an error.
   */
  readonly openPayMonths?: readonly string[];
  readonly outcome: ClosedMonthReviewOutcome;
  /**
   * What the closed run actually paid for that date — payable-days.ts's `payableDayValue`. null
   * means the day was in review and contributed nothing decidable.
   */
  readonly paidPayableDayValue: PayableDayValue;
  readonly paidClassification?: PayableDayClassification | null;
  /** criterion 9.2: was the salary line marked paid with an unreviewed variance at cut-off? */
  readonly unreviewedVarianceMarkRecordedAtCutOff: boolean;
}

export interface ClosedMonthReviewResult {
  readonly closedPayMonth: string;
  readonly disposition: ClosedMonthReviewDisposition;
  /**
   * Literal false on every path. Criterion 9.4 routes an approved adjustment to an arrear or
   * recovery in an open month and criterion 9.10 leaves the closed month's Payable_Days unchanged,
   * so no outcome modelled here can restate a closed run.
   */
  readonly closedMonthPayableDaysChanged: false;
  /** adjustedPayableDayValue - paidPayableDayValue, or null when not computable. */
  readonly payableDayDifference: number | null;
  readonly entry: ArrearEntry | null;
  readonly pendingEntry: PendingArrearIntent | null;
  /** criterion 9.10. */
  readonly unreviewedVarianceMark: UnreviewedVarianceMarkDisposition;
  /** Sorted, deduplicated, with the closed month itself removed. */
  readonly openPayMonthsConsidered: readonly string[];
  readonly earliestOpenPayMonth: string | null;
  readonly reason: string;
  readonly configurationWarnings: readonly string[];
}

/**
 * criteria 9.4 and 9.10. Reviews a Variance_Record whose Pay_Month has already reached
 * Payroll_Cut_Off.
 *
 * ADJUSTMENT APPROVED: raises an arrear (positive difference) or a recovery (negative difference)
 * for the difference, in the earliest open Pay_Month (9.4). No open Pay_Month returns the
 * difference as a pending intent instead of inventing a target.
 *
 * NO ADJUSTMENT APPROVED: the closed month's Payable_Days are unchanged and the 9.2 mark is
 * retained as historical fact (9.10, decision A3).
 *
 * PARTIALLY COVERED: the arrear/recovery row is an INSERT the payroll writer makes. This function
 * returns the entry, fully specified, and never writes.
 *
 * Total: an empty openPayMonths list, a null Payable_Days value on either side and a zero
 * difference all return defined results. Ordering-independent: openPayMonths is reduced to a
 * chronological minimum, so its order is irrelevant.
 *
 * @throws only for programmer errors — a malformed record.payMonth or a malformed entry in
 *   openPayMonths (see assertPayMonth).
 */
export function reviewClosedMonthRecord(input: ClosedMonthReviewInput): ClosedMonthReviewResult {
  const closedPayMonth = input.record.payMonth;
  assertPayMonth('record.payMonth', closedPayMonth);

  const warnings: string[] = [];
  const supplied = input.openPayMonths ?? [];
  for (const month of supplied) assertPayMonth('openPayMonths entry', month);

  // A Pay_Month that has reached cut-off is not open. If the caller lists it anyway that is a
  // contradiction in the inputs, not a reason to fail: the month is excluded from the candidates
  // and the caller is warned, which keeps the function total.
  const candidates = [...new Set(supplied)].filter((month) => month !== closedPayMonth);
  if (candidates.length !== new Set(supplied).size) {
    warnings.push(
      `openPayMonths listed ${closedPayMonth}, the Pay_Month that has reached Payroll_Cut_Off; ` +
        `it was excluded from the arrear target candidates (criterion 9.4 targets an OPEN month).`,
    );
  }
  const sortedCandidates = [...candidates].sort(comparePayMonths);
  const target = earliestOpenPayMonth(sortedCandidates);

  if (target !== null && comparePayMonths(target, closedPayMonth) < 0) {
    // Criterion 9.4 says "the earliest open Pay_Month" without qualification, so a month earlier
    // than the closed one is honoured rather than skipped — inventing an "after the closed month"
    // constraint the requirement does not state would silently retarget a real arrear. The
    // situation is unusual enough to warn about.
    warnings.push(
      `The earliest open Pay_Month ${target} precedes the closed Pay_Month ${closedPayMonth}. ` +
        `Criterion 9.4 names the earliest OPEN month, so it was used as supplied; confirm the ` +
        `open-month list is correct before posting.`,
    );
  }

  const mark: UnreviewedVarianceMarkDisposition = {
    recordedAtCutOff: input.unreviewedVarianceMarkRecordedAtCutOff,
    clearedByReview: false,
    retainedAsHistoricalFact: true,
  };

  const base = {
    closedPayMonth,
    closedMonthPayableDaysChanged: false as const,
    unreviewedVarianceMark: mark,
    openPayMonthsConsidered: Object.freeze(sortedCandidates),
    earliestOpenPayMonth: target,
    configurationWarnings: Object.freeze(warnings),
  };

  // criteria 8.1, 9.10: no adjustment approved. Payable_Days stand and the mark stands.
  if (input.outcome.kind === 'no_adjustment_approved') {
    return {
      ...base,
      disposition: 'no_entry_no_adjustment_approved',
      payableDayDifference: null,
      entry: null,
      pendingEntry: null,
      reason:
        `Review_Outcome ${input.outcome.reviewOutcome} recorded on Variance_Record ` +
        `${input.record.recordId} for closed Pay_Month ${closedPayMonth}. No adjustment was ` +
        `approved, so that Pay_Month's Payable_Days are unchanged (criterion 9.10) and the ` +
        `unreviewed-variance mark recorded at cut-off is retained as historical fact ` +
        `(criterion 9.10, decision A3).`,
    };
  }

  const paid = input.paidPayableDayValue;
  const adjusted = input.outcome.adjustedPayableDayValue;

  // payable-days.ts returns null for a day in review ("not determined by this day alone"), so a
  // difference against it is not computable. Reported as such; no zero is invented.
  if (paid === null || adjusted === null || !Number.isFinite(paid) || !Number.isFinite(adjusted)) {
    return {
      ...base,
      disposition: 'no_entry_difference_not_determinable',
      payableDayDifference: null,
      entry: null,
      pendingEntry: null,
      reason:
        `An adjustment was approved on Variance_Record ${input.record.recordId} for closed ` +
        `Pay_Month ${closedPayMonth}, but the Payable_Days difference is not computable ` +
        `(paid=${JSON.stringify(paid)}, adjusted=${JSON.stringify(adjusted)}). No arrear or ` +
        `recovery entry was raised and none was invented; the closed Pay_Month is unchanged.`,
    };
  }

  const difference = adjusted - paid;

  if (difference === 0) {
    return {
      ...base,
      disposition: 'no_entry_no_difference',
      payableDayDifference: 0,
      entry: null,
      pendingEntry: null,
      reason:
        `The approved adjustment on Variance_Record ${input.record.recordId} does not move ` +
        `Payable_Days for ${input.record.attendanceDate} (both ${paid} day(s)), so criterion ` +
        `9.4 raises no arrear or recovery entry.`,
    };
  }

  const kind: 'arrear' | 'recovery' = difference > 0 ? 'arrear' : 'recovery';

  if (target === null) {
    return {
      ...base,
      disposition: 'no_entry_no_open_pay_month',
      payableDayDifference: difference,
      entry: null,
      pendingEntry: {
        kind,
        sourcePayMonth: closedPayMonth,
        employeeId: input.record.employeeId,
        varianceRecordId: input.record.recordId,
        payableDayDifference: difference,
        reason:
          `No Pay_Month is open, so criterion 9.4 has no month to target. The ${kind} of ` +
          `${Math.abs(difference)} day(s) is returned as a pending intent and must be raised in ` +
          `the first Pay_Month that opens.`,
      },
      reason:
        `An adjustment approved on Variance_Record ${input.record.recordId} moves Payable_Days ` +
        `for closed Pay_Month ${closedPayMonth} by ${difference} day(s), but no Pay_Month is ` +
        `open. No entry was raised; the difference is returned as a pending ${kind}.`,
    };
  }

  return {
    ...base,
    disposition: kind === 'arrear' ? 'arrear_raised' : 'recovery_raised',
    payableDayDifference: difference,
    entry: {
      kind,
      targetPayMonth: target,
      sourcePayMonth: closedPayMonth,
      employeeId: input.record.employeeId,
      branchId: input.record.branchId,
      attendanceDate: input.record.attendanceDate,
      varianceRecordId: input.record.recordId,
      payableDayDifference: difference,
      payableDayMagnitude: Math.abs(difference),
    },
    pendingEntry: null,
    reason:
      `An adjustment approved on Variance_Record ${input.record.recordId} moves Payable_Days for ` +
      `${input.record.attendanceDate} from ${paid} to ${adjusted} day(s). Closed Pay_Month ` +
      `${closedPayMonth} is unchanged; a ${kind} of ${Math.abs(difference)} day(s) is raised in ` +
      `the earliest open Pay_Month ${target} (criterion 9.4).`,
  };
}
