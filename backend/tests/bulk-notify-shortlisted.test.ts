/**
 * Bulk-notify target selection: which shortlisted leads a bulk WhatsApp run would message.
 * Pure function only — no database, no send.
 */
import { describe, expect, it } from 'vitest';
import type { ShortlistEvaluation } from '../src/modules/meta-campaign/shortlist-report.service.js';
import { pickTargets } from '../scripts/bulk-notify-shortlisted.js';

const evaluation = (over: Partial<ShortlistEvaluation>): ShortlistEvaluation => ({
  leadId: 'L1',
  name: 'Asha',
  phone: '9876543210',
  createdAt: '2026-09-01T10:00:00Z',
  currentResult: 'pending',
  notified: false,
  mappingSource: 'stored',
  campaignName: null,
  requisitionId: 'r-noida',
  requisitionCode: 'REQ-NOIDA-1',
  designation: 'Agent',
  branch: 'Noida',
  proposedResult: 'qualified',
  reason: null,
  skipped: [],
  closedReason: null,
  outreachEligible: true,
  changed: true,
  relink: false,
  ...over,
});

describe('pickTargets', () => {
  const rows = [
    evaluation({ leadId: 'a' }),
    evaluation({ leadId: 'b', notified: true }),
    evaluation({ leadId: 'c', proposedResult: 'disqualified', outreachEligible: false }),
    evaluation({ leadId: 'd', closedReason: 'all seats in this batch are filled', outreachEligible: false }),
    evaluation({ leadId: 'e', requisitionId: 'r-delhi', requisitionCode: 'REQ-DELHI-1' }),
  ];

  it('only targets qualified leads in an open batch that have not been notified', () => {
    expect(pickTargets(rows).map((r) => r.leadId).sort()).toEqual(['a', 'e']);
  });

  it('never re-notifies an already-notified lead unless forced', () => {
    expect(pickTargets(rows).map((r) => r.leadId)).not.toContain('b');
    expect(pickTargets(rows, { force: true }).map((r) => r.leadId)).toEqual(expect.arrayContaining(['a', 'b', 'e']));
  });

  it('excludes a disqualified lead and a lead whose batch is full', () => {
    const ids = pickTargets(rows).map((r) => r.leadId);
    expect(ids).not.toContain('c');
    expect(ids).not.toContain('d');
  });

  it('narrows to the requested requisition codes only', () => {
    expect(pickTargets(rows, { requisitionCodes: ['REQ-DELHI-1'] }).map((r) => r.leadId)).toEqual(['e']);
  });
});
