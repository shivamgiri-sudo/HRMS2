import { describe, it, expect, vi, beforeEach } from 'vitest';

const executeMock = vi.fn();
vi.mock('../../../db/mysql.js', () => ({
  db: { execute: (...args: unknown[]) => executeMock(...args) },
}));

import {
  resolveOrCreateDefaultCampaign,
  commitUploadBatch,
} from '../productivity-upload-commit.service.js';

describe('resolveOrCreateDefaultCampaign', () => {
  beforeEach(() => {
    executeMock.mockReset();
  });

  it('returns the existing default campaign when one already exists', async () => {
    executeMock.mockResolvedValueOnce([[{ id: 'camp-1', campaign_code: 'DEFAULT_ds-1' }]]);

    const result = await resolveOrCreateDefaultCampaign('ds-1');

    expect(result).toEqual({ campaignId: 'camp-1', campaignCode: 'DEFAULT_ds-1' });
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it('creates the default campaign when none exists yet, then re-selects it', async () => {
    executeMock
      .mockResolvedValueOnce([[]]) // no existing default campaign
      .mockResolvedValueOnce([[{ display_name: 'ViciDial Instance 1' }]]) // dialler_source lookup
      .mockResolvedValueOnce([{}]) // the INSERT
      .mockResolvedValueOnce([[{ id: 'camp-new', campaign_code: 'DEFAULT_ds-1' }]]); // re-select

    const result = await resolveOrCreateDefaultCampaign('ds-1');

    expect(result).toEqual({ campaignId: 'camp-new', campaignCode: 'DEFAULT_ds-1' });
    expect(executeMock).toHaveBeenCalledTimes(4);
  });
});

describe('commitUploadBatch', () => {
  beforeEach(() => {
    executeMock.mockReset();
  });

  it('writes the batch, the accepted rows, and the rejection rows, and returns the summary', async () => {
    executeMock
      .mockResolvedValueOnce([[{ id: 'camp-1', campaign_code: 'DEFAULT_ds-1' }]]) // resolveOrCreateDefaultCampaign
      .mockResolvedValueOnce([{}]) // INSERT productivity_upload_batch
      .mockResolvedValueOnce([{}]) // INSERT apr_manual_upload (accepted rows chunk)
      .mockResolvedValueOnce([{}]); // INSERT productivity_upload_rejection (rejected rows chunk)

    const result = await commitUploadBatch({
      diallerSourceId: 'ds-1',
      branchId: 'branch-1',
      processId: 'process-1',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      fileName: 'july.csv',
      contentDigest: 'a'.repeat(64),
      uploadedBy: 'user-1',
      mappingVersionUsed: 1,
      acceptedRows: [
        { rowNumber: 2, employeeId: 'emp-1', employeeCode: 'MAS1', reportDate: '2026-07-15', loginMinutes: 420 },
      ],
      rejectedRows: [{ rowNumber: 3, employeeCode: 'MAS2', reason: 'duplicate' }],
    });

    expect(result.acceptedCount).toBe(1);
    expect(result.rejectedCount).toBe(1);
    expect(result.batchId).toBeTruthy();
    expect(result.batchReference).toBe(result.batchId);
  });

  it('marks the prior batch superseded when supersedesBatchId is given', async () => {
    executeMock
      .mockResolvedValueOnce([[{ id: 'camp-1', campaign_code: 'DEFAULT_ds-1' }]])
      .mockResolvedValueOnce([{}]) // INSERT new batch
      .mockResolvedValueOnce([{}]) // UPDATE prior batch superseded
      .mockResolvedValueOnce([{}]); // INSERT apr_manual_upload

    await commitUploadBatch({
      diallerSourceId: 'ds-1',
      branchId: 'branch-1',
      processId: 'process-1',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      fileName: 'july-corrected.csv',
      contentDigest: 'b'.repeat(64),
      uploadedBy: 'user-1',
      mappingVersionUsed: 1,
      supersedesBatchId: 'batch-old',
      acceptedRows: [
        { rowNumber: 2, employeeId: 'emp-1', employeeCode: 'MAS1', reportDate: '2026-07-15', loginMinutes: 420 },
      ],
      rejectedRows: [],
    });

    const updateCall = executeMock.mock.calls.find((c) =>
      String(c[0]).includes('UPDATE productivity_upload_batch'),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toContain('batch-old');
  });
});
