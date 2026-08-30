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

  const baseParams = {
    diallerSourceId: 'ds-1',
    branchId: 'branch-1',
    processId: 'process-1',
    dateFrom: '2026-07-01',
    dateTo: '2026-07-31',
    fileName: 'july.csv',
    contentDigest: 'a'.repeat(64),
    uploadedBy: 'user-1',
    mappingVersionUsed: 1,
  };

  it('writes the batch, the accepted rows, and the rejection rows, and returns the summary', async () => {
    executeMock
      .mockResolvedValueOnce([[]]) // retry-idempotency check: no existing batch for this digest
      .mockResolvedValueOnce([[{ id: 'camp-1', campaign_code: 'DEFAULT_ds-1' }]]) // resolveOrCreateDefaultCampaign
      .mockResolvedValueOnce([{}]) // INSERT apr_manual_upload (accepted rows chunk)
      .mockResolvedValueOnce([{}]) // INSERT productivity_upload_rejection (rejected rows chunk)
      .mockResolvedValueOnce([{}]); // INSERT productivity_upload_batch (written last, with real counts)

    const result = await commitUploadBatch({
      ...baseParams,
      acceptedRows: [
        { rowNumber: 2, employeeId: 'emp-1', employeeCode: 'MAS1', reportDate: '2026-07-15', loginMinutes: 420 },
      ],
      rejectedRows: [{ rowNumber: 3, employeeCode: 'MAS2', reason: 'duplicate' }],
    });

    expect(result.acceptedCount).toBe(1);
    expect(result.rejectedCount).toBe(1);
    expect(result.batchId).toBeTruthy();
    expect(result.batchReference).toBe(result.batchId);
    expect(result.writeErrors).toEqual([]);
  });

  it('short-circuits and returns the existing batch when the exact same file was already committed (retry idempotency)', async () => {
    executeMock.mockResolvedValueOnce([
      [{ id: 'batch-existing', batch_reference: 'batch-existing', accepted_row_count: 1, rejected_row_count: 0 }],
    ]);

    const result = await commitUploadBatch({
      ...baseParams,
      acceptedRows: [
        { rowNumber: 2, employeeId: 'emp-1', employeeCode: 'MAS1', reportDate: '2026-07-15', loginMinutes: 420 },
      ],
      rejectedRows: [],
    });

    expect(result).toEqual({
      batchId: 'batch-existing',
      batchReference: 'batch-existing',
      acceptedCount: 1,
      rejectedCount: 0,
      writeErrors: [],
    });
    expect(executeMock).toHaveBeenCalledTimes(1); // never reached campaign resolution or any write
  });

  it('marks the prior batch superseded when supersedesBatchId is given', async () => {
    executeMock
      .mockResolvedValueOnce([[]]) // retry-idempotency check
      .mockResolvedValueOnce([[{ id: 'camp-1', campaign_code: 'DEFAULT_ds-1' }]]) // resolveOrCreateDefaultCampaign
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE prior batch superseded — 1 row matched
      .mockResolvedValueOnce([{}]) // INSERT apr_manual_upload
      .mockResolvedValueOnce([{}]); // INSERT productivity_upload_batch (no rejected rows, so no rejection insert)

    const result = await commitUploadBatch({
      ...baseParams,
      fileName: 'july-corrected.csv',
      contentDigest: 'b'.repeat(64),
      supersedesBatchId: 'batch-old',
      acceptedRows: [
        { rowNumber: 2, employeeId: 'emp-1', employeeCode: 'MAS1', reportDate: '2026-07-15', loginMinutes: 420 },
      ],
      rejectedRows: [],
    });

    expect(result.writeErrors).toEqual([]);
    const updateCall = executeMock.mock.calls.find((c) =>
      String(c[0]).includes('UPDATE productivity_upload_batch'),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toContain('batch-old');
  });

  it('throws when supersedesBatchId does not name an existing Upload_Batch (criterion 17.7 safety)', async () => {
    executeMock
      .mockResolvedValueOnce([[]]) // retry-idempotency check
      .mockResolvedValueOnce([[{ id: 'camp-1', campaign_code: 'DEFAULT_ds-1' }]]) // resolveOrCreateDefaultCampaign
      .mockResolvedValueOnce([{ affectedRows: 0 }]) // UPDATE matched nothing
      .mockResolvedValueOnce([[]]); // existence check: batch truly doesn't exist

    await expect(
      commitUploadBatch({
        ...baseParams,
        supersedesBatchId: 'batch-does-not-exist',
        acceptedRows: [],
        rejectedRows: [],
      }),
    ).rejects.toThrow('supersedesBatchId batch-does-not-exist does not name an existing Upload_Batch');

    // Never reached the row-writing or final batch-insert phase
    expect(executeMock).toHaveBeenCalledTimes(4);
  });

  it('does not throw when supersedesBatchId names a batch that is already superseded (idempotent no-op)', async () => {
    executeMock
      .mockResolvedValueOnce([[]]) // retry-idempotency check
      .mockResolvedValueOnce([[{ id: 'camp-1', campaign_code: 'DEFAULT_ds-1' }]]) // resolveOrCreateDefaultCampaign
      .mockResolvedValueOnce([{ affectedRows: 0 }]) // UPDATE matched nothing (already superseded)
      .mockResolvedValueOnce([[{ id: 'batch-old' }]]) // existence check: it DOES exist
      .mockResolvedValueOnce([{}]); // INSERT productivity_upload_batch (no accepted/rejected rows)

    const result = await commitUploadBatch({
      ...baseParams,
      supersedesBatchId: 'batch-old',
      acceptedRows: [],
      rejectedRows: [],
    });

    expect(result.batchId).toBeTruthy();
  });

  it('records a write error and keeps going when one chunk fails, rather than throwing or silently reporting success', async () => {
    executeMock
      .mockResolvedValueOnce([[]]) // retry-idempotency check
      .mockResolvedValueOnce([[{ id: 'camp-1', campaign_code: 'DEFAULT_ds-1' }]]) // resolveOrCreateDefaultCampaign
      .mockRejectedValueOnce(new Error('ER_LOCK_WAIT_TIMEOUT')) // INSERT apr_manual_upload fails
      .mockResolvedValueOnce([{}]); // INSERT productivity_upload_batch still runs, with actualAccepted: 0

    const result = await commitUploadBatch({
      ...baseParams,
      acceptedRows: [
        { rowNumber: 2, employeeId: 'emp-1', employeeCode: 'MAS1', reportDate: '2026-07-15', loginMinutes: 420 },
      ],
      rejectedRows: [],
    });

    expect(result.acceptedCount).toBe(0); // the chunk that failed does not count as accepted
    expect(result.writeErrors).toHaveLength(1);
    expect(result.writeErrors[0]).toContain('ER_LOCK_WAIT_TIMEOUT');
  });
});
