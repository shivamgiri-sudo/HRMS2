/**
 * Shortlist report: the read-only "who would HRMS shortlist, and why" evaluation.
 * Pure functions only — no database.
 */
import { describe, expect, it } from 'vitest';
import {
  evaluateLeadRow,
  filterEvaluations,
  indexRequisitions,
  summarise,
  toCsv,
} from '../src/modules/meta-campaign/shortlist-report.service.js';
import type { LeadRow, RequisitionInfo } from '../src/modules/meta-campaign/shortlist-report.service.js';

const req = (over: Partial<RequisitionInfo>): RequisitionInfo => ({
  id: 'r-noida',
  code: 'REQ-NOIDA-1',
  designation: 'Agent',
  branch: 'Noida',
  process: 'Sales',
  ageMin: 18,
  ageMax: 35,
  education: null,
  experienceMin: null,
  experienceMax: null,
  screeningConfig: null,
  approvalStatus: 'approved',
  activeStatus: 1,
  closedAt: null,
  requestedHeadcount: 10,
  fulfilledHeadcount: 2,
  ...over,
});

const index = indexRequisitions([
  req({}),
  req({ id: 'r-delhi', code: 'REQ-DELHI-1', branch: 'Delhi' }),
  req({ id: 'r-full', code: 'REQ-FULL', fulfilledHeadcount: 10 }),
]);

const payload = (fields: Array<[string, string]>) => ({
  id: 'meta-1',
  field_data: fields.map(([name, v]) => ({ name, values: [v] })),
});

const lead = (over: Partial<LeadRow> & { fields?: Array<[string, string]> }): LeadRow => ({
  id: 'L1',
  requisition_id: 'r-noida',
  raw_payload: JSON.stringify(payload(over.fields ?? [['full_name', 'Asha'], ['phone_number', '9876543210'], ['age', '25']])),
  parsed_name: 'Asha',
  parsed_phone: '9876543210',
  screening_result: 'pending',
  notification_sent_at: null,
  created_at: '2026-09-01T10:00:00Z',
  ...over,
});

describe('evaluateLeadRow', () => {
  it('shortlists a lead who meets the mapped requisition', () => {
    const e = evaluateLeadRow(lead({}), index);
    expect(e.proposedResult).toBe('qualified');
    expect(e.mappingSource).toBe('stored');
    expect(e.branch).toBe('Noida');
    expect(e.outreachEligible).toBe(true);
    expect(e.changed).toBe(true); // stored 'pending' would become 'qualified'
  });

  it('disqualifies with the reason when a criterion fails', () => {
    const e = evaluateLeadRow(lead({ fields: [['full_name', 'Ravi'], ['age', '16']] }), index);
    expect(e.proposedResult).toBe('disqualified');
    expect(e.reason).toContain('below minimum 18');
    expect(e.outreachEligible).toBe(false);
  });

  it('reports what could not be verified rather than guessing', () => {
    const e = evaluateLeadRow(lead({ fields: [['full_name', 'Asha']] }), index);
    expect(e.proposedResult).toBe('qualified');
    expect(e.skipped.join(' ')).toContain('age');
  });

  it('lets the form requisition code win over the stored link and flags the relink', () => {
    const e = evaluateLeadRow(
      lead({ requisition_id: 'r-noida', fields: [['full_name', 'Asha'], ['age', '25'], ['requisition_code', 'req-delhi-1']] }),
      index
    );
    expect(e.mappingSource).toBe('routing_code');
    expect(e.requisitionId).toBe('r-delhi');
    expect(e.relink).toBe(true);
  });

  it('does not flag a relink when the code matches the stored link', () => {
    const e = evaluateLeadRow(
      lead({ fields: [['full_name', 'Asha'], ['age', '25'], ['requisition_code', 'REQ-NOIDA-1']] }),
      index
    );
    expect(e.relink).toBe(false);
  });

  it('marks a lead with no requisition as unmapped, not disqualified', () => {
    const e = evaluateLeadRow(lead({ requisition_id: null }), index);
    expect(e.proposedResult).toBe('unmapped');
    expect(e.changed).toBe(false);
    expect(e.outreachEligible).toBe(false);
  });

  it('marks an unusable raw payload as no_data', () => {
    const e = evaluateLeadRow(lead({ raw_payload: JSON.stringify({ error: 'graph_fetch_failed' }) }), index);
    expect(e.proposedResult).toBe('no_data');
  });

  it('qualifies but does not make a lead outreach-eligible when the batch is full', () => {
    const e = evaluateLeadRow(lead({ requisition_id: 'r-full' }), index);
    expect(e.proposedResult).toBe('qualified');
    expect(e.closedReason).toContain('filled');
    expect(e.outreachEligible).toBe(false);
  });

  it('is not "changed" when the stored result already matches', () => {
    const e = evaluateLeadRow(lead({ screening_result: 'qualified' }), index);
    expect(e.changed).toBe(false);
  });
});

describe('summarise / filter', () => {
  const rows = [
    evaluateLeadRow(lead({ id: 'a' }), index),
    evaluateLeadRow(lead({ id: 'b', fields: [['age', '16']] }), index),
    evaluateLeadRow(lead({ id: 'c', requisition_id: null }), index),
    evaluateLeadRow(lead({ id: 'd', requisition_id: 'r-full' }), index),
    evaluateLeadRow(lead({ id: 'e', requisition_id: 'r-delhi' }), index),
  ];

  it('counts each outcome and the leads HRMS would actually contact', () => {
    const s = summarise(rows, index);
    expect(s.totalLeads).toBe(5);
    expect(s.proposed).toEqual({ qualified: 3, disqualified: 1, unmapped: 1, no_data: 0 });
    expect(s.outreachEligible).toBe(2);
    expect(s.qualifiedButBatchClosed).toBe(1);
    expect(s.topDisqualificationReasons[0]?.label).toContain('Age N below minimum N');
  });

  it('gives a per-requisition breakdown', () => {
    const noida = summarise(rows, index).byRequisition.find((r) => r.requisitionId === 'r-noida');
    expect(noida).toMatchObject({ total: 2, qualified: 1, disqualified: 1, outreachEligible: 1 });
  });

  it('scopes a branch caller to their own branch and drops unmapped leads', () => {
    const scoped = filterEvaluations(rows, { branchName: 'Noida' });
    expect(scoped.map((r) => r.leadId).sort()).toEqual(['a', 'b', 'd']);
  });

  it('filters by proposed result and outreach eligibility', () => {
    expect(filterEvaluations(rows, { proposed: 'disqualified' }).map((r) => r.leadId)).toEqual(['b']);
    expect(filterEvaluations(rows, { outreachEligibleOnly: true }).map((r) => r.leadId).sort()).toEqual(['a', 'e']);
  });
});

describe('toCsv', () => {
  it('neutralises spreadsheet formulas in candidate-authored fields', () => {
    const e = { ...evaluateLeadRow(lead({}), index), name: '=HYPERLINK("http://x","y")' };
    const csv = toCsv([e]);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(csv.split('\r\n')).toHaveLength(2);
  });
});
