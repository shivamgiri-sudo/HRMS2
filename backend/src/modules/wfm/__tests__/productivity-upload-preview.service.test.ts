import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolveEmployeeIdByCodeMock = vi.fn();
const isDuplicateContributionMock = vi.fn();
vi.mock('../productivity-upload-validation.service.js', () => ({
  resolveEmployeeIdByCode: (...args: unknown[]) => resolveEmployeeIdByCodeMock(...args),
  isDuplicateContribution: (...args: unknown[]) => isDuplicateContributionMock(...args),
}));

import { buildUploadPreview } from '../productivity-upload-preview.service.js';

const mapping = {
  'Emp Code': 'employee_code',
  'Report Date': 'report_date',
  'Login Minutes': 'login_minutes',
};

describe('buildUploadPreview', () => {
  beforeEach(() => {
    resolveEmployeeIdByCodeMock.mockReset();
    isDuplicateContributionMock.mockReset();
  });

  it('returns a mappingError and processes no rows when the mapping is missing a mandatory field', async () => {
    const result = await buildUploadPreview(
      [{ rowNumber: 2, data: { 'Emp Code': 'MAS1', 'Login Minutes': '420' } }],
      { 'Emp Code': 'employee_code', 'Login Minutes': 'login_minutes' },
      'ds-1',
    );
    expect(result.mappingError).toEqual({ missingFields: ['report_date'] });
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([]);
    expect(resolveEmployeeIdByCodeMock).not.toHaveBeenCalled();
  });

  it('rejects a row that fails parsing, naming the parse reason, without a DB call', async () => {
    const result = await buildUploadPreview(
      [{ rowNumber: 2, data: { 'Emp Code': 'MAS1', 'Report Date': '2026-07-15', 'Login Minutes': 'bad' } }],
      mapping,
      'ds-1',
    );
    expect(result.rejected).toEqual([
      { rowNumber: 2, employeeCode: 'MAS1', reason: 'login_minutes is not a valid number: "bad"' },
    ]);
    expect(resolveEmployeeIdByCodeMock).not.toHaveBeenCalled();
  });

  it('rejects a row whose employee code does not resolve (criterion 17.5)', async () => {
    resolveEmployeeIdByCodeMock.mockResolvedValueOnce(null);

    const result = await buildUploadPreview(
      [{ rowNumber: 2, data: { 'Emp Code': 'NO-SUCH', 'Report Date': '2026-07-15', 'Login Minutes': '420' } }],
      mapping,
      'ds-1',
    );
    expect(result.rejected).toEqual([
      { rowNumber: 2, employeeCode: 'NO-SUCH', reason: 'employee code NO-SUCH does not resolve to any employee' },
    ]);
    expect(isDuplicateContributionMock).not.toHaveBeenCalled();
  });

  it('rejects a duplicate submission, naming the prior batch (criterion 17.6)', async () => {
    resolveEmployeeIdByCodeMock.mockResolvedValueOnce('emp-1');
    isDuplicateContributionMock.mockResolvedValueOnce({ isDuplicate: true, priorBatchId: 'batch-prior' });

    const result = await buildUploadPreview(
      [{ rowNumber: 2, data: { 'Emp Code': 'MAS1', 'Report Date': '2026-07-15', 'Login Minutes': '420' } }],
      mapping,
      'ds-1',
    );
    expect(result.rejected).toEqual([
      { rowNumber: 2, employeeCode: 'MAS1', reason: 'duplicate submission: already accepted in batch batch-prior' },
    ]);
  });

  it('accepts a well-formed, resolvable, non-duplicate row', async () => {
    resolveEmployeeIdByCodeMock.mockResolvedValueOnce('emp-1');
    isDuplicateContributionMock.mockResolvedValueOnce({ isDuplicate: false, priorBatchId: null });

    const result = await buildUploadPreview(
      [{ rowNumber: 2, data: { 'Emp Code': 'MAS1', 'Report Date': '2026-07-15', 'Login Minutes': '420' } }],
      mapping,
      'ds-1',
    );
    expect(result.accepted).toEqual([
      { rowNumber: 2, employeeId: 'emp-1', employeeCode: 'MAS1', reportDate: '2026-07-15', loginMinutes: 420 },
    ]);
    expect(result.rejected).toEqual([]);
    expect(isDuplicateContributionMock).toHaveBeenCalledWith('ds-1', 'emp-1', '2026-07-15');
  });

  it('processes independent rows independently — one bad row does not stop the rest', async () => {
    resolveEmployeeIdByCodeMock.mockResolvedValueOnce('emp-2');
    isDuplicateContributionMock.mockResolvedValueOnce({ isDuplicate: false, priorBatchId: null });

    const result = await buildUploadPreview(
      [
        { rowNumber: 2, data: { 'Emp Code': '', 'Report Date': '2026-07-15', 'Login Minutes': '420' } },
        { rowNumber: 3, data: { 'Emp Code': 'MAS2', 'Report Date': '2026-07-15', 'Login Minutes': '300' } },
      ],
      mapping,
      'ds-1',
    );
    expect(result.rejected).toHaveLength(1);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].employeeCode).toBe('MAS2');
  });
});
