import { describe, expect, it } from 'vitest';
import { authorDecision, computeDecision, definitionVisibilitySql, sourceDecision, type StudioViewer } from '../kpi-studio.scope.js';

/**
 * Who may author or compute what. A formula decides what appears on somebody's appraisal and compute
 * overwrites stored scores, so "has the process_manager role" is not enough: it has to be THEIR process.
 */
const scoped: StudioViewer = { orgWide: false, processIds: new Set(['p1', 'p2']), fullBranchIds: new Set(['b1']) };
const org: StudioViewer = { orgWide: true, processIds: new Set(), fullBranchIds: new Set() };

describe('authorDecision', () => {
  it('organisation-wide viewers may author any scope, including company-wide', () => {
    expect(authorDecision({}, org).ok).toBe(true);
    expect(authorDecision({ process_id: 'zzz' }, org).ok).toBe(true);
  });
  it('a scoped viewer may author for their own process only', () => {
    expect(authorDecision({ process_id: 'p1' }, scoped).ok).toBe(true);
    const no = authorDecision({ process_id: 'other' }, scoped);
    expect(no.ok).toBe(false);
    expect(no.message).toMatch(/processes you manage/);
  });
  it('process wins over branch when both are given', () => {
    expect(authorDecision({ process_id: 'p1', branch_id: 'not-mine' }, scoped).ok).toBe(true);
  });
  it('an employee-level definition needs that employee to be in one of their processes', () => {
    expect(authorDecision({ employee_id: 'e1', employeeProcessId: 'p2' }, scoped).ok).toBe(true);
    expect(authorDecision({ employee_id: 'e1', employeeProcessId: 'other' }, scoped).ok).toBe(false);
    expect(authorDecision({ employee_id: 'e1', employeeProcessId: null }, scoped).ok).toBe(false);
  });
  it('branch-wide needs every process of that branch', () => {
    expect(authorDecision({ branch_id: 'b1' }, scoped).ok).toBe(true);
    expect(authorDecision({ branch_id: 'b2' }, scoped).message).toMatch(/every process in that branch/);
  });
  it('company-wide and designation-only definitions need organisation-wide access', () => {
    expect(authorDecision({}, scoped).message).toMatch(/organisation-wide/);
    expect(authorDecision({ designation_id: 'd1' }, scoped).ok).toBe(false);
  });
});

describe('computeDecision', () => {
  it('a scoped viewer must name one of their processes (or a branch they fully cover)', () => {
    expect(computeDecision({ process_id: 'p1' }, scoped).ok).toBe(true);
    expect(computeDecision({ branch_id: 'b1' }, scoped).ok).toBe(true);
    expect(computeDecision({}, scoped).message).toMatch(/Pick a process/);
    expect(computeDecision({ employee_ids: ['e1'] }, scoped).ok).toBe(false);
    expect(computeDecision({ process_id: 'other' }, scoped).ok).toBe(false);
  });
  it('organisation-wide viewers may compute everything', () => {
    expect(computeDecision({}, org).ok).toBe(true);
  });
});

describe('definitionVisibilitySql', () => {
  it('is unrestricted for organisation-wide viewers', () => {
    expect(definitionVisibilitySql(org)).toEqual({ sql: '1=1', params: [] });
  });
  it('shows own-process, own-people and inherited (branch / company) definitions', () => {
    const v = definitionVisibilitySql(scoped);
    expect(v.sql).toContain('d.process_id IN (?,?)');
    expect(v.sql).toContain('e.process_id IN (?,?)');
    expect(v.sql).toContain('d.process_id IS NULL AND d.employee_id IS NULL');
    expect(v.params).toEqual(['p1', 'p2', 'p1', 'p2']);
  });
  it('a viewer with no processes sees only inherited definitions', () => {
    const v = definitionVisibilitySql({ orgWide: false, processIds: new Set(), fullBranchIds: new Set() });
    expect(v.sql).toBe('(d.process_id IS NULL AND d.employee_id IS NULL)');
    expect(v.params).toEqual([]);
  });
});

describe('sourceDecision', () => {
  it("a scoped author may change a source tied to their own process only", () => {
    expect(sourceDecision('p1', scoped).ok).toBe(true);
    expect(sourceDecision('other', scoped).message).toMatch(/do not manage/);
  });
  it('a shared source (no process) needs organisation-wide access', () => {
    expect(sourceDecision(null, scoped).message).toMatch(/organisation-wide/);
    expect(sourceDecision(null, org).ok).toBe(true);
  });
});

