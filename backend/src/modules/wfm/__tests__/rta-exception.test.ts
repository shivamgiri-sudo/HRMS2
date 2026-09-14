import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock('../../../db/mysql.js', () => ({
  db: {
    execute: mocks.execute,
  },
}));

import { rtaExceptionService } from '../rta-exception.service.js';

describe('rta-exception service', () => {
  beforeEach(() => {
    mocks.execute.mockReset();
  });

  describe('listExceptions', () => {
    it('returns all exceptions when no filters', async () => {
      const mockRows = [
        {
          id: 1,
          alert_id: 'alert-1',
          employee_id: 'emp-1',
          exception_date: '2024-01-01',
          exception_type: 'LATE',
          exception_state: 'OPEN',
          disposition_type: null,
          disposition_owner_id: null,
          disposition_comment: null,
          disposition_at: null,
          regularization_id: null,
          roster_amendment_id: null,
          created_at: '2024-01-01T10:00:00Z',
          updated_at: null,
        },
      ];

      mocks.execute.mockResolvedValue([mockRows, []]);

      const result = await rtaExceptionService.listExceptions({});

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 1,
        alertId: 'alert-1',
        employeeId: 'emp-1',
        exceptionDate: '2024-01-01',
        exceptionType: 'LATE',
        exceptionState: 'OPEN',
        dispositionType: null,
        dispositionOwnerId: null,
        dispositionComment: null,
        dispositionAt: null,
        regularizationId: null,
        rosterAmendmentId: null,
        createdAt: '2024-01-01T10:00:00Z',
      });

      expect(mocks.execute).toHaveBeenCalledTimes(1);
      const [query] = mocks.execute.mock.calls[0];
      expect(query).toContain('SELECT e.* FROM wfm_rta_exception e');
      expect(query).toContain('ORDER BY e.created_at DESC');
    });

    it('filters by date', async () => {
      mocks.execute.mockResolvedValue([[], []]);

      await rtaExceptionService.listExceptions({ date: '2024-01-01' });

      const [query, params] = mocks.execute.mock.calls[0];
      expect(query).toContain('AND e.exception_date = ?');
      expect(params).toContain('2024-01-01');
    });

    it('filters by state', async () => {
      mocks.execute.mockResolvedValue([[], []]);

      await rtaExceptionService.listExceptions({ state: 'ACKNOWLEDGED' });

      const [query, params] = mocks.execute.mock.calls[0];
      expect(query).toContain('AND e.exception_state = ?');
      expect(params).toContain('ACKNOWLEDGED');
    });

    it('filters by employeeId', async () => {
      mocks.execute.mockResolvedValue([[], []]);

      await rtaExceptionService.listExceptions({ employeeId: 'emp-1' });

      const [query, params] = mocks.execute.mock.calls[0];
      expect(query).toContain('AND e.employee_id = ?');
      expect(params).toContain('emp-1');
    });
  });

  describe('createException', () => {
    it('inserts and returns new exception', async () => {
      const mockInsertResult = { insertId: 1 };
      const mockRow = {
        id: 1,
        alert_id: 'alert-1',
        employee_id: 'emp-1',
        exception_date: '2024-01-01',
        exception_type: 'LATE',
        exception_state: 'OPEN',
        disposition_type: null,
        disposition_owner_id: null,
        disposition_comment: null,
        disposition_at: null,
        regularization_id: null,
        roster_amendment_id: null,
        created_at: '2024-01-01T10:00:00Z',
        updated_at: null,
      };

      mocks.execute
        .mockResolvedValueOnce([mockInsertResult, []])
        .mockResolvedValueOnce([[mockRow], []]);

      const result = await rtaExceptionService.createException({
        alertId: 'alert-1',
        employeeId: 'emp-1',
        exceptionDate: '2024-01-01',
        exceptionType: 'LATE',
        comment: 'Late due to traffic',
      });

      expect(result).toEqual({
        id: 1,
        alertId: 'alert-1',
        employeeId: 'emp-1',
        exceptionDate: '2024-01-01',
        exceptionType: 'LATE',
        exceptionState: 'OPEN',
        dispositionType: null,
        dispositionOwnerId: null,
        dispositionComment: null,
        dispositionAt: null,
        regularizationId: null,
        rosterAmendmentId: null,
        createdAt: '2024-01-01T10:00:00Z',
      });

      expect(mocks.execute).toHaveBeenCalledTimes(2);
      const [insertQuery, insertParams] = mocks.execute.mock.calls[0];
      expect(insertQuery).toContain('INSERT INTO wfm_rta_exception');
      expect(insertParams[0]).toBe('alert-1');
      expect(insertParams[1]).toBe('emp-1');
      expect(insertParams[4]).toBe('Late due to traffic');
    });
  });

  describe('updateDisposition', () => {
    it('sets disposition fields', async () => {
      const mockRow = {
        id: 1,
        alert_id: 'alert-1',
        employee_id: 'emp-1',
        exception_date: '2024-01-01',
        exception_type: 'LATE',
        exception_state: 'OPEN',
        disposition_type: 'CONTACTED_EMPLOYEE',
        disposition_owner_id: 'owner-1',
        disposition_comment: 'Contacted employee',
        disposition_at: '2024-01-02T10:00:00Z',
        regularization_id: 'reg-1',
        roster_amendment_id: null,
        created_at: '2024-01-01T10:00:00Z',
        updated_at: '2024-01-02T10:00:00Z',
      };

      mocks.execute
        .mockResolvedValueOnce([[], []]) // update response
        .mockResolvedValueOnce([[mockRow], []]); // fetch response

      const result = await rtaExceptionService.updateDisposition(1, {
        dispositionType: 'CONTACTED_EMPLOYEE',
        comment: 'Contacted employee',
        regularizationId: 'reg-1',
        ownerId: 'owner-1',
      });

      expect(result).toEqual({
        id: 1,
        alertId: 'alert-1',
        employeeId: 'emp-1',
        exceptionDate: '2024-01-01',
        exceptionType: 'LATE',
        exceptionState: 'OPEN',
        dispositionType: 'CONTACTED_EMPLOYEE',
        dispositionOwnerId: 'owner-1',
        dispositionComment: 'Contacted employee',
        dispositionAt: '2024-01-02T10:00:00Z',
        regularizationId: 'reg-1',
        rosterAmendmentId: null,
        createdAt: '2024-01-01T10:00:00Z',
      });

      expect(mocks.execute).toHaveBeenCalledTimes(2);
    });
  });

  describe('updateState', () => {
    it('transitions OPEN → ACKNOWLEDGED', async () => {
      const mockCurrentRow = {
        id: 1,
        alert_id: 'alert-1',
        employee_id: 'emp-1',
        exception_date: '2024-01-01',
        exception_type: 'LATE',
        exception_state: 'OPEN',
        disposition_type: null,
        disposition_owner_id: null,
        disposition_comment: null,
        disposition_at: null,
        regularization_id: null,
        roster_amendment_id: null,
        created_at: '2024-01-01T10:00:00Z',
        updated_at: null,
      };

      const mockUpdatedRow = {
        ...mockCurrentRow,
        exception_state: 'ACKNOWLEDGED',
        updated_at: '2024-01-02T10:00:00Z',
      };

      mocks.execute
        .mockResolvedValueOnce([[mockCurrentRow], []]) // fetch current
        .mockResolvedValueOnce([[], []]) // update
        .mockResolvedValueOnce([[mockUpdatedRow], []]); // fetch updated

      const result = await rtaExceptionService.updateState(1, 'ACKNOWLEDGED');

      expect(result.exceptionState).toBe('ACKNOWLEDGED');
      expect(mocks.execute).toHaveBeenCalledTimes(3);
    });

    it('throws 400 for invalid transition (RESOLVED → ACKNOWLEDGED)', async () => {
      const mockCurrentRow = {
        id: 1,
        alert_id: 'alert-1',
        employee_id: 'emp-1',
        exception_date: '2024-01-01',
        exception_type: 'LATE',
        exception_state: 'RESOLVED',
        disposition_type: null,
        disposition_owner_id: null,
        disposition_comment: null,
        disposition_at: null,
        regularization_id: null,
        roster_amendment_id: null,
        created_at: '2024-01-01T10:00:00Z',
        updated_at: null,
      };

      mocks.execute.mockResolvedValueOnce([[mockCurrentRow], []]);

      try {
        await rtaExceptionService.updateState(1, 'ACKNOWLEDGED');
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).toBe('Cannot transition from RESOLVED to ACKNOWLEDGED');
        expect(error.statusCode).toBe(400);
      }
    });

    it('allows any state → ESCALATED', async () => {
      const mockCurrentRow = {
        id: 1,
        alert_id: 'alert-1',
        employee_id: 'emp-1',
        exception_date: '2024-01-01',
        exception_type: 'LATE',
        exception_state: 'ACTIONED',
        disposition_type: null,
        disposition_owner_id: null,
        disposition_comment: null,
        disposition_at: null,
        regularization_id: null,
        roster_amendment_id: null,
        created_at: '2024-01-01T10:00:00Z',
        updated_at: null,
      };

      const mockUpdatedRow = {
        ...mockCurrentRow,
        exception_state: 'ESCALATED',
        updated_at: '2024-01-02T10:00:00Z',
      };

      mocks.execute
        .mockResolvedValueOnce([[mockCurrentRow], []]) // fetch current
        .mockResolvedValueOnce([[], []]) // update
        .mockResolvedValueOnce([[mockUpdatedRow], []]); // fetch updated

      const result = await rtaExceptionService.updateState(1, 'ESCALATED');

      expect(result.exceptionState).toBe('ESCALATED');
      expect(mocks.execute).toHaveBeenCalledTimes(3);
    });
  });
});
