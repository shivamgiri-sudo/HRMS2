// backend/src/modules/wfm/__tests__/consolidated-productivity-view.test.ts
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  AGGREGATION_RULE_LABELS,
  BREAK_CATEGORY_LABELS,
  EXPORT_MARKER_NOT_REPORTED,
  EXPORT_MARKER_UNAVAILABLE,
  METRIC_EXPORT_LABELS,
  VIEW_METRICS,
  assembleBranchProductivityView,
  assembleConsolidatedProductivityView,
  assembleDateRow,
  buildBranchExportPayload,
  buildExportPayload,
  deriveReviewState,
  indexDiallerSources,
  isCalendarDate,
  isEmployeeInScope,
  reconcileDisplayedView,
  renderMetricCellForExport,
  type ConsolidatedProductivityView,
  type ConsolidatedViewRequest,
  type ContributionEvidence,
  type DateEvidence,
  type DiallerSourceDescriptor,
  type MetricValueMap,
  type ProductivityMetric,
  type RequesterScope,
} from '../consolidated-productivity-view.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────────────────────

const ALL_METRICS: readonly ProductivityMetric[] = VIEW_METRICS;

/** An integrated ViciDial pull: declares every metric, including logout time. */
const vicidial: DiallerSourceDescriptor = {
  diallerSourceId: 'src-vicidial',
  diallerSourceName: 'ViciDial dialer_1',
  ingestionMode: 'integrated_pull',
  metricAvailability: ALL_METRICS,
};

/**
 * A manual upload to `apr_manual_upload`: criterion 17.4 — no talk, wait, dispo, pause or logout
 * column exists, so those five are absent from the declared Metric_Availability. This is the real
 * production case criterion 19.6 is written for.
 */
const manualUpload: DiallerSourceDescriptor = {
  diallerSourceId: 'src-manual',
  diallerSourceName: 'Branch manual upload',
  ingestionMode: 'manual_upload',
  metricAvailability: ['login_time', 'net_login', 'calls', 'aht', 'bio', 'lunch', 'qa', 'training'],
};

/** A source declaring NOTHING at all. Legal under criterion 16.1 and tested as an adversary. */
const declaresNothing: DiallerSourceDescriptor = {
  diallerSourceId: 'src-empty',
  diallerSourceName: 'Registered but declares no metrics',
  ingestionMode: 'integrated_pull',
  metricAvailability: [],
};

/** Declares every metric but reports none: every cell must be not_reported, never unavailable. */
const declaresAllReportsNone: DiallerSourceDescriptor = {
  diallerSourceId: 'src-silent',
  diallerSourceName: 'Declares all, reports none',
  ingestionMode: 'integrated_pull',
  metricAvailability: ALL_METRICS,
};

const unrestrictedScope: RequesterScope = { userId: 'usr-wfm-head', branchIds: 'all' };
const noidaScope: RequesterScope = { userId: 'usr-branch-wfm', branchIds: ['br-noida'] };

const contribution = (over: Partial<ContributionEvidence> = {}): ContributionEvidence => ({
  diallerSourceId: 'src-vicidial',
  interval: { startMinute: 540, endMinute: 1020 },
  magnitudeMinutes: 480,
  ...over,
});

const request = (over: Partial<ConsolidatedViewRequest> = {}): ConsolidatedViewRequest => ({
  requester: unrestrictedScope,
  employeeId: 'emp-1',
  employeeBranchId: 'br-noida',
  fromDate: '2026-07-01',
  toDate: '2026-07-31',
  evidence: [],
  diallerSources: [vicidial, manualUpload, declaresNothing, declaresAllReportsNone],
  ...over,
});

function presented(result: ReturnType<typeof assembleConsolidatedProductivityView>): ConsolidatedProductivityView {
  if (result.refused) throw new Error(`expected a presented view, got a refusal: ${result.code}`);
  return result;
}

// ── criterion 19.1: one row per date holding evidence, and no others ──────────────────────────

describe('criterion 19.1 — one row per calendar date holding any evidence', () => {
  it('emits a row for a date with dialler evidence and omits a date with none entirely', () => {
    const view = presented(
      assembleConsolidatedProductivityView(
        request({
          evidence: [
            { date: '2026-07-02', contributions: [contribution()] },
            // Present in the range, present in the input, but carrying nothing at all.
            { date: '2026-07-03' },
          ],
        }),
      ),
    );
    expect(view.rows.map((r) => r.date)).toEqual(['2026-07-02']);
    expect(view.droppedDates).toEqual([{ date: '2026-07-03', reason: 'no_evidence' }]);
  });

  it('emits rows in ascending date order whatever order the evidence arrives in', () => {
    const dates = ['2026-07-20', '2026-07-02', '2026-07-11'];
    const view = presented(
      assembleConsolidatedProductivityView(
        request({ evidence: dates.map((date) => ({ date, contributions: [contribution()] })) }),
      ),
    );
    expect(view.rows.map((r) => r.date)).toEqual(['2026-07-02', '2026-07-11', '2026-07-20']);
  });

  it('names why a row exists, so a biometric-only day is not mistaken for a dialler day', () => {
    const view = presented(
      assembleConsolidatedProductivityView(
        request({
          evidence: [
            {
              date: '2026-07-04',
              biometric: { biometricMinutes: 545, firstClockInTime: '09:02:11', lastClockOutTime: '18:07:40' },
              attendance: { resolvedAttendanceSource: 'biometric', classification: 'present' },
            },
          ],
        }),
      ),
    );
    expect(view.rows[0].evidenceKinds).toEqual(['biometric', 'attendance_record']);
    expect(view.rows[0].sources).toEqual([]);
  });

  it('drops an unparseable date and a date outside the requested range, reporting both', () => {
    const view = presented(
      assembleConsolidatedProductivityView(
        request({
          fromDate: '2026-07-01',
          toDate: '2026-07-05',
          evidence: [
            { date: '2026-02-30', contributions: [contribution()] },
            { date: '2026-06-30', contributions: [contribution()] },
            { date: '2026-07-03', contributions: [contribution()] },
          ],
        }),
      ),
    );
    expect(view.rows.map((r) => r.date)).toEqual(['2026-07-03']);
    expect(view.droppedDates).toEqual([
      { date: '2026-02-30', reason: 'invalid_date' },
      { date: '2026-06-30', reason: 'outside_requested_range' },
    ]);
  });

  it('merges two evidence entries for one date into one row rather than emitting two', () => {
    const view = presented(
      assembleConsolidatedProductivityView(
        request({
          evidence: [
            { date: '2026-07-06', contributions: [contribution()] },
            {
              date: '2026-07-06',
              contributions: [contribution({ diallerSourceId: 'src-manual', interval: null, magnitudeMinutes: 300 })],
              biometric: { biometricMinutes: 500 },
            },
          ],
        }),
      ),
    );
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0].sources.map((s) => s.diallerSourceId)).toEqual(['src-manual', 'src-vicidial']);
    expect(view.droppedDates).toEqual([{ date: '2026-07-06', reason: 'duplicate_date_merged' }]);
  });
});

describe('range handling', () => {
  it('a single-day range presents that day', () => {
    const view = presented(
      assembleConsolidatedProductivityView(
        request({
          fromDate: '2026-07-09',
          toDate: '2026-07-09',
          evidence: [
            { date: '2026-07-08', contributions: [contribution()] },
            { date: '2026-07-09', contributions: [contribution()] },
            { date: '2026-07-10', contributions: [contribution()] },
          ],
        }),
      ),
    );
    expect(view.rows.map((r) => r.date)).toEqual(['2026-07-09']);
    expect(view.rangeInverted).toBe(false);
  });

  it('an inverted range presents nothing and says so, rather than silently swapping the ends', () => {
    const view = presented(
      assembleConsolidatedProductivityView(
        request({
          fromDate: '2026-07-31',
          toDate: '2026-07-01',
          evidence: [{ date: '2026-07-15', contributions: [contribution()] }],
        }),
      ),
    );
    expect(view.rangeInverted).toBe(true);
    expect(view.rows).toEqual([]);
    expect(view.droppedDates).toEqual([{ date: '2026-07-15', reason: 'outside_requested_range' }]);
  });

  it('a range spanning a month boundary presents both months', () => {
    const view = presented(
      assembleConsolidatedProductivityView(
        request({
          fromDate: '2026-07-30',
          toDate: '2026-08-02',
          evidence: [
            { date: '2026-07-29', contributions: [contribution()] },
            { date: '2026-07-31', contributions: [contribution()] },
            { date: '2026-08-01', contributions: [contribution()] },
            { date: '2026-08-03', contributions: [contribution()] },
          ],
        }),
      ),
    );
    expect(view.rows.map((r) => r.date)).toEqual(['2026-07-31', '2026-08-01']);
  });

  it('rejects a non-calendar date, leap years included', () => {
    expect(isCalendarDate('2026-02-28')).toBe(true);
    expect(isCalendarDate('2026-02-29')).toBe(false);
    expect(isCalendarDate('2024-02-29')).toBe(true);
    expect(isCalendarDate('2026-13-01')).toBe(false);
    expect(isCalendarDate('2026-7-1')).toBe(false);
  });
});

// ── criteria 19.6 / 19.7: the tri-state ───────────────────────────────────────────────────────

describe('criteria 19.6, 19.7 — unavailable, not reported and a genuine zero are three states', () => {
  const registry = indexDiallerSources([vicidial, manualUpload, declaresNothing, declaresAllReportsNone]);

  it('a metric absent from the declared Metric_Availability is unavailable and carries NO value', () => {
    const row = assembleDateRow(
      {
        date: '2026-07-02',
        contributions: [
          contribution({
            diallerSourceId: 'src-manual',
            interval: null,
            magnitudeMinutes: 420,
            // A manual upload physically cannot supply these; criterion 19.6.
            metrics: { net_login: 420, calls: 51 },
          }),
        ],
      },
      registry,
    );
    const source = row!.sources[0];
    for (const metric of ['talk_time', 'wait_time', 'dispo_time', 'pause_time', 'logout_time'] as const) {
      expect(source.metrics[metric]).toEqual({ availability: 'unavailable' });
      // The arm has no `value` member at all, so there is no number to misread as zero.
      expect((source.metrics[metric] as { value?: number }).value).toBeUndefined();
    }
    expect(source.metrics.calls).toEqual({ availability: 'reported', value: 51 });
  });

  it('a source declaring NO metrics presents every metric as unavailable and nothing as a value', () => {
    const row = assembleDateRow(
      {
        date: '2026-07-02',
        contributions: [
          contribution({ diallerSourceId: 'src-empty', metrics: { talk_time: 120, calls: 9 } }),
        ],
      },
      registry,
    );
    const source = row!.sources[0];
    expect(source.declaredMetrics).toEqual([]);
    expect(source.presentedMetrics).toEqual([]);
    for (const metric of VIEW_METRICS) {
      expect(source.metrics[metric].availability).toBe('unavailable');
    }
  });

  it('a source declaring all metrics but reporting none presents not_reported, never unavailable', () => {
    const row = assembleDateRow(
      {
        date: '2026-07-02',
        contributions: [
          {
            diallerSourceId: 'src-silent',
            interval: null,
            magnitudeMinutes: Number.NaN,
            metrics: {},
          },
        ],
      },
      registry,
    );
    const source = row!.sources[0];
    expect(source.declaredMetrics).toEqual([...VIEW_METRICS]);
    expect(source.presentedMetrics).toEqual([]);
    for (const metric of VIEW_METRICS) {
      expect(source.metrics[metric].availability).toBe('not_reported');
    }
  });

  it('holds a reported zero, an unavailable and a not-reported for the SAME metric on the SAME date', () => {
    // talk_time: ViciDial reports a genuine 0, the manual upload cannot supply it at all, and the
    // silent source declares it but holds nothing. All three on one date, side by side.
    const row = assembleDateRow(
      {
        date: '2026-07-02',
        contributions: [
          contribution({ diallerSourceId: 'src-vicidial', metrics: { talk_time: 0 } }),
          contribution({ diallerSourceId: 'src-manual', interval: null, magnitudeMinutes: 300 }),
          contribution({ diallerSourceId: 'src-silent', metrics: {} }),
        ],
      },
      registry,
    );
    const byId = new Map(row!.sources.map((s) => [s.diallerSourceId, s]));
    expect(byId.get('src-vicidial')!.metrics.talk_time).toEqual({ availability: 'reported', value: 0 });
    expect(byId.get('src-manual')!.metrics.talk_time).toEqual({ availability: 'unavailable' });
    expect(byId.get('src-silent')!.metrics.talk_time).toEqual({ availability: 'not_reported' });

    // And the three states are pairwise distinguishable after export, too.
    const rendered = ['src-vicidial', 'src-manual', 'src-silent'].map((id) =>
      renderMetricCellForExport(byId.get(id)!.metrics.talk_time),
    );
    expect(rendered).toEqual([0, EXPORT_MARKER_UNAVAILABLE, EXPORT_MARKER_NOT_REPORTED]);
    expect(new Set(rendered).size).toBe(3);
  });

  it('an explicit null value is not reported, and a non-finite value never becomes a zero', () => {
    const row = assembleDateRow(
      {
        date: '2026-07-02',
        contributions: [
          contribution({
            metrics: { talk_time: null, wait_time: Number.NaN, dispo_time: Number.POSITIVE_INFINITY },
          }),
        ],
      },
      registry,
    );
    const source = row!.sources[0];
    expect(source.metrics.talk_time).toEqual({ availability: 'not_reported' });
    expect(source.metrics.wait_time).toEqual({ availability: 'not_reported' });
    expect(source.metrics.dispo_time).toEqual({ availability: 'not_reported' });
  });

  it('a contribution naming an unregistered Dialler_Source declares nothing rather than everything', () => {
    const row = assembleDateRow(
      { date: '2026-07-02', contributions: [contribution({ diallerSourceId: 'src-unknown' })] },
      registry,
    );
    const source = row!.sources[0];
    expect(source.diallerSourceRegistered).toBe(false);
    expect(source.presentedMetrics).toEqual([]);
    expect(source.metrics.net_login.availability).toBe('unavailable');
  });

  it('login and logout time come from the interval Requirement 18 aggregated, not a second number', () => {
    const row = assembleDateRow(
      { date: '2026-07-02', contributions: [contribution({ interval: { startMinute: 545, endMinute: 1035 } })] },
      registry,
    );
    const source = row!.sources[0];
    expect(source.metrics.login_time).toEqual({ availability: 'reported', value: 545 });
    expect(source.metrics.logout_time).toEqual({ availability: 'reported', value: 1035 });
  });
});

// ── criterion 19.2: the columns, including the five break categories ──────────────────────────

describe('criterion 19.2 — every named metric carries a cell, break categories spelled as stated', () => {
  it('presents login, logout, net login, talk, wait, dispo, pause, AHT, calls and the five breaks', () => {
    const registry = indexDiallerSources([vicidial]);
    const row = assembleDateRow(
      {
        date: '2026-07-02',
        contributions: [
          contribution({
            metrics: {
              net_login: 470,
              talk_time: 210,
              wait_time: 96,
              dispo_time: 44,
              pause_time: 18,
              aht: 312,
              calls: 88,
              bio: 12,
              lunch: 30,
              qa: 15,
              training: 0,
              dismx: 5,
            },
          }),
        ],
      },
      registry,
    );
    const source = row!.sources[0];
    expect(Object.keys(source.metrics).sort()).toEqual([...VIEW_METRICS].sort());
    expect(source.presentedMetrics).toEqual([...VIEW_METRICS]);
    expect(BREAK_CATEGORY_LABELS).toEqual({
      bio: 'BIO',
      lunch: 'LUNCH',
      qa: 'QA',
      training: 'TRAINING',
      dismx: 'DISMX',
    });
    // TRAINING was a genuine zero, not an absence.
    expect(source.metrics.training).toEqual({ availability: 'reported', value: 0 });
  });
});

// ── criteria 19.3 / 19.4 / 19.5 ───────────────────────────────────────────────────────────────

describe('criterion 19.3 — the canonical figure and the NAME of the rule that produced it', () => {
  const registry = indexDiallerSources([vicidial, manualUpload]);

  it('names the interval-union rule when every contribution supplies a usable interval', () => {
    const row = assembleDateRow(
      {
        date: '2026-07-02',
        contributions: [
          contribution({ interval: { startMinute: 540, endMinute: 900 }, magnitudeMinutes: 360 }),
          contribution({ interval: { startMinute: 840, endMinute: 1020 }, magnitudeMinutes: 180 }),
        ],
      },
      registry,
    );
    // 540..1020 merged = 480 minutes, NOT the 540-minute naive sum (criterion 18.3).
    expect(row!.canonicalProductiveMinutes).toBe(480);
    expect(row!.aggregationRule).toBe('interval_union');
    expect(row!.aggregationRuleLabel).toBe(AGGREGATION_RULE_LABELS.interval_union);
  });

  it('names the max-contribution rule as soon as one contribution supplies no interval', () => {
    const row = assembleDateRow(
      {
        date: '2026-07-02',
        contributions: [
          contribution({ interval: { startMinute: 540, endMinute: 900 }, magnitudeMinutes: 360 }),
          contribution({ diallerSourceId: 'src-manual', interval: null, magnitudeMinutes: 415 }),
        ],
      },
      registry,
    );
    expect(row!.canonicalProductiveMinutes).toBe(415);
    expect(row!.aggregationRule).toBe('max_contribution');
    expect(row!.excludedContributionCount).toBe(1);
  });

  it('a date with no dialler evidence carries an absent canonical figure, never a zero', () => {
    const row = assembleDateRow(
      { date: '2026-07-02', biometric: { biometricMinutes: 520 } },
      registry,
    );
    expect(row!.canonicalProductiveMinutes).toBeNull();
    expect(row!.aggregationRule).toBeNull();
    expect(row!.aggregationRuleLabel).toBeNull();
  });
});

describe('criterion 19.4 — biometric duration with the first and last punch', () => {
  const registry = indexDiallerSources([vicidial]);

  it('presents biometric_minutes with the first clock_in_time and the last clock_out_time', () => {
    const row = assembleDateRow(
      {
        date: '2026-07-02',
        biometric: {
          biometricMinutes: 545,
          firstClockInTime: '2026-07-02 09:02:11',
          lastClockOutTime: '2026-07-02 18:07:40',
          punchCount: 6,
        },
      },
      registry,
    );
    expect(row!.biometric.minutes).toEqual({ availability: 'reported', value: 545 });
    expect(row!.biometric.firstClockInTime).toBe('2026-07-02 09:02:11');
    expect(row!.biometric.lastClockOutTime).toBe('2026-07-02 18:07:40');
    expect(row!.biometric.punchCount).toBe(6);
  });

  it('dialler evidence with no biometric record reports the biometric duration as not reported', () => {
    const row = assembleDateRow({ date: '2026-07-02', contributions: [contribution()] }, registry);
    expect(row!.biometric.minutes).toEqual({ availability: 'not_reported' });
    expect(row!.biometric.firstClockInTime).toBeNull();
    expect(row!.biometric.lastClockOutTime).toBeNull();
    expect(row!.evidenceKinds).toEqual(['dialler_contribution']);
  });

  it('a genuine biometric zero stays a reported zero', () => {
    const row = assembleDateRow({ date: '2026-07-02', biometric: { biometricMinutes: 0, punchCount: 2 } }, registry);
    expect(row!.biometric.minutes).toEqual({ availability: 'reported', value: 0 });
  });
});

describe('criterion 19.5 — resolution, deciding rule, classification, variance and floor absence', () => {
  const registry = indexDiallerSources([vicidial]);

  it('presents all five, with the Variance_Record review state derived from its recorded outcomes', () => {
    const row = assembleDateRow(
      {
        date: '2026-07-02',
        contributions: [contribution()],
        attendance: {
          resolvedAttendanceSource: 'dialler',
          decidingAttendanceSourceRuleId: 'asr-cost-centre-576',
          classification: 'half_day',
        },
        variance: {
          varianceRecordId: 'var-1',
          queueState: 'queued_for_dual_review',
          status: 'notified',
          varianceRiskScore: 220,
          wfmOutcome: 'apr_disputed',
        },
        floorAbsence: { reason: 'productive_minutes_below_ceiling', varianceRecordId: 'var-1' },
      },
      registry,
    );
    expect(row!.attendance.resolvedAttendanceSource).toBe('dialler');
    expect(row!.attendance.decidingAttendanceSourceRuleId).toBe('asr-cost-centre-576');
    expect(row!.attendance.classification).toBe('half_day');
    expect(row!.attendance.variance).toEqual({
      varianceRecordId: 'var-1',
      queueState: 'queued_for_dual_review',
      status: 'notified',
      varianceRiskScore: 220,
      wfmOutcome: 'apr_disputed',
      managerOutcome: null,
      reviewState: 'awaiting_reporting_manager',
    });
    expect(row!.attendance.floorAbsence).toEqual({
      reason: 'productive_minutes_below_ceiling',
      varianceRecordId: 'var-1',
      reviewState: 'awaiting_reporting_manager',
    });
  });

  it('derives every review state from the queue state, the status and the recorded outcomes', () => {
    const base = { varianceRecordId: 'var-1', queueState: 'queued_for_dual_review' } as const;
    expect(deriveReviewState({ ...base, status: 'open' })).toBe('awaiting_both_reviewers');
    expect(deriveReviewState({ ...base, status: 'notified', managerOutcome: 'apr_accepted' })).toBe(
      'awaiting_wfm_reviewer',
    );
    expect(deriveReviewState({ ...base, status: 'notified', wfmOutcome: 'apr_accepted' })).toBe(
      'awaiting_reporting_manager',
    );
    expect(
      deriveReviewState({
        ...base,
        status: 'open',
        wfmOutcome: 'apr_accepted',
        managerOutcome: 'adjustment_requested',
      }),
    ).toBe('reviewed');
    expect(deriveReviewState({ ...base, status: 'reviewed' })).toBe('reviewed');
    expect(deriveReviewState({ ...base, status: 'contested' })).toBe('contested');
    expect(deriveReviewState({ ...base, status: 'no_issue' })).toBe('closed_legacy');
    expect(
      deriveReviewState({ varianceRecordId: 'var-1', queueState: 'recorded_not_queued', status: 'open' }),
    ).toBe('not_queued');
    // A legacy closure on a Recorded_Not_Queued record still reports the closure, not the queue.
    expect(
      deriveReviewState({
        varianceRecordId: 'var-1',
        queueState: 'recorded_not_queued',
        status: 'regularization_required',
      }),
    ).toBe('closed_legacy');
  });

  it('does not borrow an unrelated Variance_Record state for a floor absence occurrence', () => {
    const row = assembleDateRow(
      {
        date: '2026-07-02',
        contributions: [contribution()],
        variance: { varianceRecordId: 'var-other', queueState: 'queued_for_dual_review', status: 'reviewed' },
        floorAbsence: { reason: 'two_punch_full_span', varianceRecordId: 'var-floor' },
      },
      registry,
    );
    expect(row!.attendance.floorAbsence!.reviewState).toBe('not_recorded');
  });
});

// ── criterion 19.8: ingestion mode and upload attribution ─────────────────────────────────────

describe('criterion 19.8 — ingestion mode, and the Upload_Batch for a manual upload', () => {
  const registry = indexDiallerSources([vicidial, manualUpload]);

  it('an integrated pull carries its mode and no Upload_Batch', () => {
    const row = assembleDateRow({ date: '2026-07-02', contributions: [contribution()] }, registry);
    expect(row!.sources[0].ingestionMode).toBe('integrated_pull');
    expect(row!.sources[0].upload).toEqual({ kind: 'integrated_pull' });
  });

  it('a manual upload carries the Upload_Batch identifier and the uploading user', () => {
    const row = assembleDateRow(
      {
        date: '2026-07-02',
        contributions: [
          contribution({
            diallerSourceId: 'src-manual',
            interval: null,
            magnitudeMinutes: 400,
            uploadBatchId: 'ub-9911',
            uploadedByUserId: 'usr-branch-wfm',
          }),
        ],
      },
      registry,
    );
    expect(row!.sources[0].upload).toEqual({
      kind: 'manual_upload',
      uploadBatchId: 'ub-9911',
      uploadedByUserId: 'usr-branch-wfm',
    });
  });

  it('a manual_upload row missing its Upload_Batch id is surfaced, not rendered as a blank', () => {
    const row = assembleDateRow(
      {
        date: '2026-07-02',
        contributions: [
          contribution({
            diallerSourceId: 'src-manual',
            interval: null,
            magnitudeMinutes: 400,
            uploadBatchId: null,
            uploadedByUserId: 'usr-branch-wfm',
          }),
        ],
      },
      registry,
    );
    expect(row!.sources[0].upload).toEqual({
      kind: 'manual_upload_unattributed',
      uploadBatchId: null,
      uploadedByUserId: 'usr-branch-wfm',
      missingFields: ['upload_batch_id'],
    });
  });

  it('names both missing fields when neither attribution is present', () => {
    const row = assembleDateRow(
      {
        date: '2026-07-02',
        contributions: [
          contribution({ diallerSourceId: 'src-manual', interval: null, magnitudeMinutes: 400 }),
        ],
      },
      registry,
    );
    expect(row!.sources[0].upload).toMatchObject({
      kind: 'manual_upload_unattributed',
      missingFields: ['upload_batch_id', 'uploading_user'],
    });
  });
});

// ── criterion 19.10: the refusal ──────────────────────────────────────────────────────────────

describe('criterion 19.10 — an out-of-scope request returns no employee data and an audit payload', () => {
  const inScopeEvidence: DateEvidence[] = [
    {
      date: '2026-07-02',
      contributions: [contribution()],
      biometric: { biometricMinutes: 545, firstClockInTime: '09:02', lastClockOutTime: '18:07' },
      attendance: { classification: 'present', resolvedAttendanceSource: 'dialler' },
    },
  ];

  it('refuses an employee in another branch and records the attempt', () => {
    const result = assembleConsolidatedProductivityView(
      request({ requester: noidaScope, employeeBranchId: 'br-ahmedabad', evidence: inScopeEvidence }),
    );
    expect(result.refused).toBe(true);
    if (!result.refused) throw new Error('unreachable');
    expect(result.code).toBe('employee_outside_resolved_scope');
    expect(result.criteria).toContain('19.10');
    expect(result.audit).toEqual({
      actingUserId: 'usr-branch-wfm',
      requestedAction: 'consolidated_productivity_view',
      requestedEmployeeId: 'emp-1',
      requestedBranchId: 'br-ahmedabad',
      requestedProcessId: null,
      requestedFromDate: '2026-07-01',
      requestedToDate: '2026-07-31',
      refusalCode: 'employee_outside_resolved_scope',
      resolvedScopeBranchIds: ['br-noida'],
    });
    // No row, no date, no minute of employee data anywhere on the refusal.
    expect(JSON.stringify(result)).not.toContain('545');
    expect(Object.keys(result)).not.toContain('rows');
  });

  it('refuses when the employee branch cannot be resolved rather than waving the request through', () => {
    const result = assembleConsolidatedProductivityView(
      request({ requester: noidaScope, employeeBranchId: null, evidence: inScopeEvidence }),
    );
    expect(result.refused).toBe(true);
    if (!result.refused) throw new Error('unreachable');
    expect(result.code).toBe('employee_branch_unresolvable');
  });

  it('honours an employee allow-list narrower than the branch', () => {
    const scope: RequesterScope = {
      userId: 'usr-manager',
      branchIds: ['br-noida'],
      employeeIds: ['emp-2', 'emp-3'],
    };
    expect(isEmployeeInScope(scope, 'emp-2', 'br-noida')).toBe(true);
    expect(isEmployeeInScope(scope, 'emp-1', 'br-noida')).toBe(false);
    const result = assembleConsolidatedProductivityView(
      request({ requester: scope, evidence: inScopeEvidence }),
    );
    expect(result.refused).toBe(true);
  });

  it('presents the view for an in-scope employee', () => {
    const view = presented(
      assembleConsolidatedProductivityView(
        request({ requester: noidaScope, employeeBranchId: 'br-noida', evidence: inScopeEvidence }),
      ),
    );
    expect(view.rows).toHaveLength(1);
    expect(view.employeeId).toBe('emp-1');
  });
});

// ── criterion 19.11: branch-and-process mode ──────────────────────────────────────────────────

describe('criterion 19.11 — one row per employee for a stated date, same columns', () => {
  const employees = [
    {
      employeeId: 'emp-2',
      employeeCode: 'MAS002',
      employeeName: 'B',
      branchId: 'br-noida',
      processId: 'proc-ib',
      evidence: {
        date: '2026-07-02',
        contributions: [contribution({ diallerSourceId: 'src-manual', interval: null, magnitudeMinutes: 300 })],
      },
    },
    {
      employeeId: 'emp-1',
      employeeCode: 'MAS001',
      employeeName: 'A',
      branchId: 'br-noida',
      processId: 'proc-ib',
      evidence: { date: '2026-07-02', contributions: [contribution()] },
    },
  ];

  it('returns one row per in-scope employee, ascending by employee id, with the same columns', () => {
    const result = assembleBranchProductivityView({
      requester: noidaScope,
      branchId: 'br-noida',
      processId: 'proc-ib',
      date: '2026-07-02',
      employees,
      diallerSources: [vicidial, manualUpload],
    });
    expect(result.refused).toBe(false);
    if (result.refused) throw new Error('unreachable');
    expect(result.rows.map((r) => r.employeeId)).toEqual(['emp-1', 'emp-2']);
    // Same column set as the per-employee mode: every metric of criterion 19.2 carries a cell.
    for (const employeeRow of result.rows) {
      expect(Object.keys(employeeRow.row.sources[0].metrics).sort()).toEqual([...VIEW_METRICS].sort());
    }
  });

  it('refuses a branch outside the caller scope outright, returning no employee data', () => {
    const result = assembleBranchProductivityView({
      requester: noidaScope,
      branchId: 'br-ahmedabad',
      processId: null,
      date: '2026-07-02',
      employees,
      diallerSources: [vicidial, manualUpload],
    });
    expect(result.refused).toBe(true);
    if (!result.refused) throw new Error('unreachable');
    expect(result.code).toBe('branch_outside_resolved_scope');
    expect(result.audit.requestedBranchId).toBe('br-ahmedabad');
    expect(JSON.stringify(result)).not.toContain('emp-1');
  });

  it('omits an out-of-scope employee inside an in-scope branch and names only the identifier', () => {
    const result = assembleBranchProductivityView({
      requester: { userId: 'usr-manager', branchIds: ['br-noida'], employeeIds: ['emp-1'] },
      branchId: 'br-noida',
      processId: null,
      date: '2026-07-02',
      employees,
      diallerSources: [vicidial, manualUpload],
    });
    if (result.refused) throw new Error('unreachable');
    expect(result.rows.map((r) => r.employeeId)).toEqual(['emp-1']);
    expect(result.omittedOutOfScopeEmployeeIds).toEqual(['emp-2']);
  });

  it('omits an employee whose evidence holds nothing for the stated date', () => {
    const result = assembleBranchProductivityView({
      requester: noidaScope,
      branchId: 'br-noida',
      processId: null,
      date: '2026-07-02',
      employees: [
        { employeeId: 'emp-9', branchId: 'br-noida', evidence: { date: '2026-07-02' } },
        { employeeId: 'emp-8', branchId: 'br-noida', evidence: { date: '2026-07-03', contributions: [contribution()] } },
      ],
      diallerSources: [vicidial],
    });
    if (result.refused) throw new Error('unreachable');
    expect(result.rows).toEqual([]);
    expect(result.omittedWithoutEvidenceEmployeeIds).toEqual(['emp-8', 'emp-9']);
  });
});

// ── criterion 19.9: export ────────────────────────────────────────────────────────────────────

describe('criterion 19.9 — export rows carry the same rows, columns and unavailability markers', () => {
  const view = presented(
    assembleConsolidatedProductivityView(
      request({
        evidence: [
          {
            date: '2026-07-02',
            contributions: [
              contribution({ diallerSourceId: 'src-vicidial', metrics: { talk_time: 0 } }),
              contribution({
                diallerSourceId: 'src-manual',
                interval: null,
                magnitudeMinutes: 300,
                uploadBatchId: 'ub-1',
                uploadedByUserId: 'usr-branch-wfm',
              }),
              contribution({ diallerSourceId: 'src-silent', metrics: {} }),
            ],
            biometric: { biometricMinutes: 545, firstClockInTime: '09:02', lastClockOutTime: '18:07' },
            attendance: { classification: 'present', resolvedAttendanceSource: 'biometric' },
          },
          // A biometric-only day: one export line, no dialler columns to report.
          { date: '2026-07-03', biometric: { biometricMinutes: 480 } },
        ],
      }),
    ),
  );
  const payload = buildExportPayload(view);

  it('emits one line per (date, contributing Dialler_Source), and one for a source-free date', () => {
    expect(payload.rows).toHaveLength(4);
    expect(payload.rows.map((r) => r[0])).toEqual(['2026-07-02', '2026-07-02', '2026-07-02', '2026-07-03']);
    expect(payload.rows.every((r) => r.length === payload.headers.length)).toBe(true);
  });

  it('carries a column for every metric of criterion 19.2, break categories included', () => {
    for (const metric of VIEW_METRICS) {
      expect(payload.headers).toContain(METRIC_EXPORT_LABELS[metric]);
    }
    expect(payload.headers).toContain('BIO');
    expect(payload.headers).toContain('DISMX');
  });

  it('keeps unavailable, not reported and a genuine zero distinct in the exported cells', () => {
    const talkIndex = payload.headers.indexOf(METRIC_EXPORT_LABELS.talk_time);
    const sourceIndex = payload.headers.indexOf('Dialler Source');
    const cellFor = (sourceId: string): unknown =>
      payload.rows.find((r) => r[sourceIndex] === sourceId)![talkIndex];
    expect(cellFor('src-vicidial')).toBe(0);
    expect(cellFor('src-manual')).toBe(EXPORT_MARKER_UNAVAILABLE);
    expect(cellFor('src-silent')).toBe(EXPORT_MARKER_NOT_REPORTED);
  });

  it('carries the ingestion mode and the Upload_Batch columns the screen shows', () => {
    const modeIndex = payload.headers.indexOf('Ingestion Mode');
    const batchIndex = payload.headers.indexOf('Upload Batch');
    const sourceIndex = payload.headers.indexOf('Dialler Source');
    const manualRow = payload.rows.find((r) => r[sourceIndex] === 'src-manual')!;
    expect(manualRow[modeIndex]).toBe('manual_upload');
    expect(manualRow[batchIndex]).toBe('ub-1');
  });

  it('exports an absent canonical figure as the not-reported marker, never as a zero', () => {
    const canonicalIndex = payload.headers.indexOf('Canonical Productive Minutes');
    const biometricOnly = payload.rows.find((r) => r[0] === '2026-07-03')!;
    expect(biometricOnly[canonicalIndex]).toBe(EXPORT_MARKER_NOT_REPORTED);
  });

  it('the branch-mode export carries the same columns behind an employee column', () => {
    const branch = assembleBranchProductivityView({
      requester: noidaScope,
      branchId: 'br-noida',
      processId: null,
      date: '2026-07-02',
      employees: [
        { employeeId: 'emp-1', branchId: 'br-noida', evidence: { date: '2026-07-02', contributions: [contribution()] } },
      ],
      diallerSources: [vicidial],
    });
    if (branch.refused) throw new Error('unreachable');
    const branchPayload = buildBranchExportPayload(branch);
    expect(branchPayload.headers.slice(0, 3)).toEqual(['Employee', 'Employee Code', 'Employee Name']);
    expect(branchPayload.headers).toEqual(expect.arrayContaining([...payload.headers]));
    expect(branchPayload.rows[0][0]).toBe('emp-1');
  });
});

// ── Generators ────────────────────────────────────────────────────────────────────────────────

const metricArb: fc.Arbitrary<ProductivityMetric> = fc.constantFrom(...VIEW_METRICS);

const SOURCE_IDS = ['src-a', 'src-b', 'src-c'] as const;

const descriptorArb: fc.Arbitrary<DiallerSourceDescriptor> = fc
  .tuple(
    fc.constantFrom(...SOURCE_IDS),
    fc.constantFrom<'integrated_pull' | 'manual_upload'>('integrated_pull', 'manual_upload'),
    // Any subset of the declared vocabulary, the empty set included.
    fc.uniqueArray(metricArb, { maxLength: VIEW_METRICS.length }),
  )
  .map(([diallerSourceId, ingestionMode, metricAvailability]) => ({
    diallerSourceId,
    diallerSourceName: `${diallerSourceId} name`,
    ingestionMode,
    metricAvailability,
  }));

const metricsMapArb: fc.Arbitrary<MetricValueMap> = fc
  .array(
    fc.tuple(
      metricArb,
      // Real values, an explicit null, and junk that must never become a zero.
      fc.oneof(
        fc.integer({ min: -30, max: 900 }),
        fc.constant(null),
        fc.constant(Number.NaN),
        fc.constant(Number.POSITIVE_INFINITY),
      ),
    ),
    { maxLength: 6 },
  )
  .map((pairs) => Object.fromEntries(pairs) as MetricValueMap);

/**
 * A contribution whose magnitude is tied to its interval length where an interval exists, because
 * Net_Login and the session length are the same quantity in real data (canonical-productivity.ts).
 * A zero-length interval is generated deliberately: criterion 18.5 treats it as unusable, which
 * drops the whole date to Requirement 18's secondary rule.
 */
const contributionArb: fc.Arbitrary<ContributionEvidence> = fc
  .tuple(
    fc.constantFrom(...SOURCE_IDS, 'src-unregistered'),
    fc.option(
      fc
        .tuple(fc.integer({ min: 0, max: 1200 }), fc.integer({ min: 0, max: 300 }))
        .map(([startMinute, length]) => ({ startMinute, endMinute: startMinute + length })),
      { nil: null },
    ),
    fc.integer({ min: 0, max: 600 }),
    metricsMapArb,
    fc.option(fc.string({ minLength: 1, maxLength: 6 }), { nil: null }),
    fc.option(fc.string({ minLength: 1, maxLength: 6 }), { nil: null }),
  )
  .map(([diallerSourceId, interval, magnitude, metrics, uploadBatchId, uploadedByUserId]) => ({
    diallerSourceId,
    interval,
    magnitudeMinutes: interval === null ? magnitude : interval.endMinute - interval.startMinute,
    metrics,
    uploadBatchId,
    uploadedByUserId,
  }));

const DATES = [
  '2026-07-29',
  '2026-07-30',
  '2026-07-31',
  '2026-08-01',
  '2026-08-02',
  '2026-08-03',
  // Not a calendar date, and a date well outside any generated range.
  '2026-02-30',
  '2026-06-15',
] as const;

const evidenceArb: fc.Arbitrary<DateEvidence> = fc
  .tuple(
    fc.constantFrom(...DATES),
    fc.array(contributionArb, { maxLength: 4 }),
    fc.option(
      fc.record({
        biometricMinutes: fc.oneof(fc.integer({ min: 0, max: 1440 }), fc.constant(null)),
        firstClockInTime: fc.option(fc.constant('09:00:00'), { nil: null }),
        lastClockOutTime: fc.option(fc.constant('18:00:00'), { nil: null }),
      }),
      { nil: null },
    ),
  )
  .map(([date, contributions, biometric]) => ({ date, contributions, biometric }));

const rangeArb = fc.tuple(
  fc.constantFrom('2026-07-30', '2026-07-31', '2026-08-01'),
  // Includes ends that precede the start, so the inverted range is inside the generated space.
  fc.constantFrom('2026-07-29', '2026-08-01', '2026-08-02'),
);

// ── Property: criterion 19.13, declared-metric containment ────────────────────────────────────

describe('Property 24 — declared-metric containment (criteria 19.13, 19.6, 19.7)', () => {
  it('every presented metric is declared, and every cell is exactly one of the three states', () => {
    // Feature: payroll-attendance-source-rules, Property 24: Declared-metric containment
    // **Validates: Requirements 19.13, 19.6, 19.7**
    fc.assert(
      fc.property(
        fc.array(descriptorArb, { minLength: 1, maxLength: 3 }),
        fc.array(evidenceArb, { minLength: 1, maxLength: 4 }),
        (descriptors, evidence) => {
          const view = assembleConsolidatedProductivityView(
            request({ fromDate: '2026-07-29', toDate: '2026-08-03', evidence, diallerSources: descriptors }),
          );
          if (view.refused) throw new Error('unreachable: the requester scope is unrestricted');

          const registry = indexDiallerSources(descriptors);
          for (const row of view.rows) {
            for (const source of row.sources) {
              const declared = new Set(registry.get(source.diallerSourceId)?.metricAvailability ?? []);

              // Containment: nothing presented with a value was undeclared.
              for (const metric of source.presentedMetrics) {
                expect(declared.has(metric)).toBe(true);
                expect(source.declaredMetrics).toContain(metric);
              }
              for (const metric of source.declaredMetrics) {
                expect(declared.has(metric)).toBe(true);
              }

              for (const metric of VIEW_METRICS) {
                const cell = source.metrics[metric];
                // Exactly one of three states, and only the reported arm carries a number.
                expect(['unavailable', 'not_reported', 'reported']).toContain(cell.availability);
                if (cell.availability === 'reported') {
                  expect(Number.isFinite(cell.value)).toBe(true);
                  expect(declared.has(metric)).toBe(true);
                  expect(source.presentedMetrics).toContain(metric);
                } else {
                  expect((cell as { value?: number }).value).toBeUndefined();
                }
                // An undeclared metric can only ever be unavailable.
                if (!declared.has(metric)) {
                  expect(cell.availability).toBe('unavailable');
                }
              }
            }
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

/**
 * An INDEPENDENT statement of Requirement 18's aggregation, written from the criteria rather than
 * by calling the module under test, so the 19.12 property below is not the module agreeing with
 * itself. Criterion 18.6's secondary rule first (any contribution without a usable ordered
 * interval demotes the whole date), else criterion 18.4's union of intervals, capped at 1,440
 * (criterion 18.2).
 */
function referenceCanonical(
  contributions: readonly { interval: { startMinute: number; endMinute: number } | null; magnitudeMinutes: number }[],
): { minutes: number | null; rule: 'interval_union' | 'max_contribution' | null } {
  if (contributions.length === 0) return { minutes: null, rule: null };

  const unusable = contributions.some(
    (c) => c.interval === null || c.interval.endMinute <= c.interval.startMinute,
  );
  if (unusable) {
    const magnitudes = contributions.map((c) =>
      Number.isFinite(c.magnitudeMinutes) && c.magnitudeMinutes >= 0 ? c.magnitudeMinutes : 0,
    );
    return { minutes: Math.min(Math.max(...magnitudes), 1440), rule: 'max_contribution' };
  }

  // Count every covered minute exactly once, by marking a minute set rather than by merging, so
  // the reference shares no algorithm with the implementation.
  const covered = new Set<number>();
  for (const c of contributions) {
    for (let minute = c.interval!.startMinute; minute < c.interval!.endMinute; minute++) {
      covered.add(minute);
    }
  }
  return { minutes: Math.min(covered.size, 1440), rule: 'interval_union' };
}

// ── Property: criterion 19.12, display reconciliation ─────────────────────────────────────────

describe('Property 16 — display reconciliation under Requirement 18 (criterion 19.12)', () => {
  it('the displayed contributions re-derive the displayed canonical figure and the displayed rule', () => {
    // Feature: payroll-attendance-source-rules, Property 16: Aggregation traceability
    // **Validates: Requirements 19.12, 11.7**
    //
    // The reconciliation is Requirement 18's own rule re-applied — the union of session intervals
    // (18.4), or the maximum single contribution (18.6) as soon as one contribution supplies no
    // usable interval. NOT a plain sum: criterion 18.3 forbids that arithmetic outright.
    fc.assert(
      fc.property(
        fc.array(descriptorArb, { minLength: 1, maxLength: 3 }),
        fc.array(evidenceArb, { minLength: 1, maxLength: 5 }),
        (descriptors, evidence) => {
          const view = assembleConsolidatedProductivityView(
            request({ fromDate: '2026-07-29', toDate: '2026-08-03', evidence, diallerSources: descriptors }),
          );
          if (view.refused) throw new Error('unreachable: the requester scope is unrestricted');

          const reconciliation = reconcileDisplayedView(view.rows);
          expect(reconciliation.allDatesReconcile).toBe(true);
          expect(reconciliation.dates).toHaveLength(view.rows.length);

          for (const date of reconciliation.dates) {
            expect(date.displayedMinutes).toBe(date.rederivedMinutes);
            expect(date.displayedRule).toBe(date.rederivedRule);
            // criterion 18.2's daily bound, and 18.14's no-inflation bound, over what was shown.
            if (date.displayedMinutes !== null) {
              expect(date.displayedMinutes).toBeLessThanOrEqual(1440);
              expect(date.withinNoInflationBound).toBe(true);
            }
            // criteria 18.10, 19.3: absent is absent, and a rule name exists exactly when a
            // figure does.
            const row = view.rows.find((r) => r.date === date.date)!;
            expect(row.canonicalProductiveMinutes === null).toBe(row.aggregationRule === null);
            expect(row.canonicalProductiveMinutes === null).toBe(row.sources.length === 0);

            // The reconciliation target, stated independently of the module under test.
            const reference = referenceCanonical(row.sources.map((s) => s.contribution));
            expect(row.canonicalProductiveMinutes).toBe(reference.minutes);
            expect(row.aggregationRule).toBe(reference.rule);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

// ── Property: criterion 19.1, no row without evidence, and the range contains every row ───────

describe('Property — criterion 19.1: a date with no evidence is never emitted', () => {
  it('the emitted date set is exactly the in-range dates holding evidence', () => {
    // Feature: payroll-attendance-source-rules, Requirement 19 acceptance criterion 19.1
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.tuple(fc.constantFrom(...DATES), fc.boolean()),
          { selector: ([date]) => date, minLength: 1, maxLength: 8 },
        ),
        (entries) => {
          const evidence: DateEvidence[] = entries.map(([date, holdsEvidence]) =>
            holdsEvidence
              ? { date, contributions: [{ diallerSourceId: 'src-a', interval: null, magnitudeMinutes: 120 }] }
              : // Deliberately empty: no contributions, no biometric, no attendance, no variance.
                { date },
          );
          const view = assembleConsolidatedProductivityView(
            request({ fromDate: '2026-07-29', toDate: '2026-08-03', evidence, diallerSources: [descriptorOfA] }),
          );
          if (view.refused) throw new Error('unreachable: the requester scope is unrestricted');

          const expectedDates = entries
            .filter(([date, holds]) => holds && date >= '2026-07-29' && date <= '2026-08-03' && isCalendarDate(date))
            .map(([date]) => date)
            .sort();
          expect(view.rows.map((r) => r.date)).toEqual(expectedDates);
          // Every emitted row names at least one kind of evidence.
          for (const row of view.rows) expect(row.evidenceKinds.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 300 },
    );
  });
});

const descriptorOfA: DiallerSourceDescriptor = {
  diallerSourceId: 'src-a',
  diallerSourceName: 'A',
  ingestionMode: 'integrated_pull',
  metricAvailability: ['net_login'],
};

describe('Property — the emitted date set is always a subset of the requested range', () => {
  it('for any range, including an inverted one, no row falls outside it', () => {
    // Feature: payroll-attendance-source-rules, Requirement 19 acceptance criterion 19.1
    fc.assert(
      fc.property(
        rangeArb,
        fc.array(evidenceArb, { maxLength: 6 }),
        ([fromDate, toDate], evidence) => {
          const view = assembleConsolidatedProductivityView(
            request({ fromDate, toDate, evidence, diallerSources: [descriptorOfA] }),
          );
          if (view.refused) throw new Error('unreachable: the requester scope is unrestricted');

          for (const row of view.rows) {
            expect(isCalendarDate(row.date)).toBe(true);
            expect(row.date >= fromDate).toBe(true);
            expect(row.date <= toDate).toBe(true);
          }
          // An inverted range contains no dates, so it presents no rows.
          if (toDate < fromDate) {
            expect(view.rangeInverted).toBe(true);
            expect(view.rows).toEqual([]);
          }
          // One row per date at most (criterion 19.1).
          expect(new Set(view.rows.map((r) => r.date)).size).toBe(view.rows.length);
        },
      ),
      { numRuns: 300 },
    );
  });
});

// ── Property: criterion 19.10, a refusal leaks nothing ────────────────────────────────────────

describe('Property 25 — a scope refusal never leaks a field of employee data (criterion 19.10)', () => {
  it('for any evidence, an out-of-scope request returns none of it, in any field', () => {
    // Feature: payroll-attendance-source-rules, Property 25: Scope containment on every list
    // **Validates: Requirements 14.4, 19.10**
    //
    // Every piece of employee data generated here carries a sentinel — 'LEAK' in the strings and
    // a value at or above 90,000 in the numbers — so a leak through ANY field, however nested,
    // shows up in the serialised refusal. The requested employee identifier is deliberately NOT
    // sentinelled: it is the caller's own input echoed back for the audit row, not employee data.
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.constantFrom(...DATES),
            fc.integer({ min: 90000, max: 99999 }),
            fc.integer({ min: 90000, max: 99999 }),
          ),
          { minLength: 1, maxLength: 4 },
        ),
        fc.constantFrom('br-ahmedabad', 'br-mumbai'),
        (rows, outOfScopeBranch) => {
          const evidence: DateEvidence[] = rows.map(([date, minutes, biometricMinutes]) => ({
            date,
            contributions: [
              {
                diallerSourceId: 'src-a',
                interval: null,
                magnitudeMinutes: minutes,
                metrics: { net_login: minutes, talk_time: minutes },
                uploadBatchId: `LEAK-batch-${minutes}`,
                uploadedByUserId: `LEAK-user-${minutes}`,
                sourceRowRef: `LEAK-row-${minutes}`,
              },
            ],
            biometric: {
              biometricMinutes,
              firstClockInTime: `LEAK-in-${biometricMinutes}`,
              lastClockOutTime: `LEAK-out-${biometricMinutes}`,
            },
            attendance: {
              resolvedAttendanceSource: 'dialler',
              decidingAttendanceSourceRuleId: `LEAK-rule-${minutes}`,
              classification: 'half_day',
            },
            variance: {
              varianceRecordId: `LEAK-variance-${minutes}`,
              queueState: 'queued_for_dual_review',
              status: 'open',
              varianceRiskScore: biometricMinutes,
            },
            floorAbsence: { reason: 'two_punch_full_span', varianceRecordId: `LEAK-variance-${minutes}` },
          }));

          const result = assembleConsolidatedProductivityView(
            request({
              requester: noidaScope,
              employeeBranchId: outOfScopeBranch,
              evidence,
              diallerSources: [descriptorOfA],
            }),
          );

          expect(result.refused).toBe(true);
          if (!result.refused) throw new Error('unreachable');

          const serialised = JSON.stringify(result);
          expect(serialised).not.toContain('LEAK');
          for (const [, minutes, biometricMinutes] of rows) {
            expect(serialised).not.toContain(String(minutes));
            expect(serialised).not.toContain(String(biometricMinutes));
          }
          // Nor is there a field on the refusal through which any of it could have travelled.
          expect(Object.keys(result).sort()).toEqual(['audit', 'code', 'criteria', 'message', 'refused']);
          expect(Object.keys(result.audit)).not.toContain('rows');
          expect(result.audit.actingUserId).toBe('usr-branch-wfm');
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ── Property: determinism and order-independence ───────────────────────────────────────────────

describe('Property — the assembly is deterministic and order-independent', () => {
  it('the same evidence in any order returns a deeply equal view, twice', () => {
    // Feature: payroll-attendance-source-rules, Requirement 19 — totality over ordinary data
    fc.assert(
      fc.property(
        fc.array(descriptorArb, { minLength: 1, maxLength: 3 }),
        fc.uniqueArray(evidenceArb, { selector: (e) => e.date, minLength: 1, maxLength: 5 }),
        (descriptors, evidence) => {
          const build = (entries: readonly DateEvidence[]): unknown =>
            assembleConsolidatedProductivityView(
              request({
                fromDate: '2026-07-29',
                toDate: '2026-08-03',
                evidence: entries,
                diallerSources: descriptors,
              }),
            );
          const first = build(evidence);
          const again = build(evidence);
          const reversed = build([...evidence].reverse());
          expect(again).toEqual(first);
          expect(reversed).toEqual(first);
        },
      ),
      { numRuns: 200 },
    );
  });
});
