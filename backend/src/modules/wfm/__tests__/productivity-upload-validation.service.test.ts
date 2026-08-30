import { describe, it, expect, vi, beforeEach } from 'vitest';

const executeMock = vi.fn();
vi.mock('../../../db/mysql.js', () => ({
  db: { execute: (...args: unknown[]) => executeMock(...args) },
}));

import {
  resolveEmployeeIdByCode,
  isDuplicateContribution,
} from '../productivity-upload-validation.service.js';

describe('productivity-upload-validation.service', () => {
  beforeEach(() => {
    executeMock.mockReset();
  });

  it('resolveEmployeeIdByCode returns null when the code resolves to no employee (criterion 17.5; 56 of 727 apr.UserID values do today)', async () => {
    executeMock.mockResolvedValueOnce([[]]);

    const result = await resolveEmployeeIdByCode('NO-SUCH-CODE');

    expect(result).toBeNull();
  });

  it('resolveEmployeeIdByCode returns the employee id when the code resolves', async () => {
    executeMock.mockResolvedValueOnce([[{ id: 'emp-1' }]]);

    const result = await resolveEmployeeIdByCode('MAS12345');

    expect(result).toBe('emp-1');
  });

  it('isDuplicateContribution returns false when no accepted, non-superseded row exists for this (source, employee, date)', async () => {
    executeMock.mockResolvedValueOnce([[]]);

    const result = await isDuplicateContribution('ds-1', 'emp-1', '2026-07-15');

    expect(result).toEqual({ isDuplicate: false, priorBatchId: null });
  });

  it('isDuplicateContribution returns true and names the prior batch when one exists (criterion 17.6)', async () => {
    executeMock.mockResolvedValueOnce([[{ upload_batch_id: 'batch-prior' }]]);

    const result = await isDuplicateContribution('ds-1', 'emp-1', '2026-07-15');

    expect(result).toEqual({ isDuplicate: true, priorBatchId: 'batch-prior' });
  });
});
