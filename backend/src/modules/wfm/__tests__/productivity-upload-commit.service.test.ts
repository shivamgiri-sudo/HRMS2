import { describe, it, expect, vi, beforeEach } from 'vitest';

const executeMock = vi.fn();
vi.mock('../../../db/mysql.js', () => ({
  db: { execute: (...args: unknown[]) => executeMock(...args) },
}));

import {
  resolveOrCreateDefaultCampaign,
  commitUploadBatch,
  DuplicateUploadBatchError,
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

  it('rejects a resubmission of the exact same file and scope when no supersedesBatchId is given (duplicate-submission guard)', async () => {
    executeMock.mockResolvedValueOnce([
      [{ id: 'batch-existing', batch_reference: 'UPL-2026-07-0012', accepted_row_count: 1, rejected_row_count: 0 }],
    ]);

    const call = commitUploadBatch({
      ...baseParams,
      acceptedRows: [
        { rowNumber: 2, employeeId: 'emp-1', employeeCode: 'MAS1', reportDate: '2026-07-15', loginMinutes: 420 },
      ],
      rejectedRows: [],
    });

    await expect(call).rejects.toBeInstanceOf(DuplicateUploadBatchError);
    await expect(call).rejects.toThrow(/batch-existing.*already exists.*supersedesBatchId set to batch-existing/s);
    // The message must name the SAME id in both places (the id the caller can actually pass
    // back as supersedesBatchId), not a human-readable batch_reference in one spot and the raw
    // id in the other — a Minor finding from a round-4 review.
    await expect(call).rejects.not.toThrow(/UPL-2026-07-0012/);
    await call.catch((err) => {
      expect((err as DuplicateUploadBatchError).priorBatchId).toBe('batch-existing');
    });

    // Never reached campaign resolution or any write — rejecting is the whole point: it must
    // not risk double-writing apr_manual_upload rows that may have already landed.
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it('does not run the duplicate-submission guard at all when supersedesBatchId is given (an explicit re-upload is not a retry)', async () => {
    // This is the exact scenario a third review round found broken: a deliberate,
    // byte-identical re-upload (same digest) declaring supersedesBatchId must never be
    // intercepted by the duplicate-submission guard above. The guard's SELECT must not even
    // run — proven here by there being no leading "no existing batch" mock to consume before
    // the scope-check SELECT.
    executeMock
      .mockResolvedValueOnce([[{ id: 'camp-1', campaign_code: 'DEFAULT_ds-1' }]]) // resolveOrCreateDefaultCampaign
      .mockResolvedValueOnce([[{ // scope-check SELECT: prior batch, same scope, not yet superseded
        id: 'batch-old', dialler_source_id: baseParams.diallerSourceId, branch_id: baseParams.branchId,
        process_id: baseParams.processId, date_from: baseParams.dateFrom, date_to: baseParams.dateTo,
        status: 'accepted',
      }]])
      .mockResolvedValueOnce([{}]) // UPDATE prior batch superseded
      .mockResolvedValueOnce([{}]) // INSERT apr_manual_upload
      .mockResolvedValueOnce([{}]); // INSERT productivity_upload_batch (no rejected rows, so no rejection insert)

    const result = await commitUploadBatch({
      ...baseParams,
      fileName: 'july-corrected.csv',
      contentDigest: baseParams.contentDigest, // deliberately identical digest to the "prior" file
      supersedesBatchId: 'batch-old',
      acceptedRows: [
        { rowNumber: 2, employeeId: 'emp-1', employeeCode: 'MAS1', reportDate: '2026-07-15', loginMinutes: 420 },
      ],
      rejectedRows: [],
    });

    expect(result.writeErrors).toEqual([]);
    const guardCall = executeMock.mock.calls.find((c) =>
      String(c[0]).includes('SELECT') && String(c[0]).includes('content_digest = ?'),
    );
    expect(guardCall).toBeUndefined(); // the duplicate-submission guard's SELECT never ran
    const updateCall = executeMock.mock.calls.find((c) =>
      String(c[0]).includes('UPDATE productivity_upload_batch'),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toContain('batch-old');
  });

  it('throws when supersedesBatchId names a batch for a different scope, and does not supersede it (round-4 finding)', async () => {
    // A round-4 review found the previous version of this check verified only that the target
    // batch EXISTS, not that it belongs to the SAME dialler_source/branch/process/date range as
    // this submission. Pasting the wrong id (e.g. off the Upload_Batch history screen, which
    // legitimately lists many batches per branch per criterion 17.13) would wrongly supersede an
    // unrelated batch's rows out of Canonical_Productive_Minutes while this submission's own
    // rows land undetected. This must be refused before any write.
    executeMock
      .mockResolvedValueOnce([[{ id: 'camp-1', campaign_code: 'DEFAULT_ds-1' }]]) // resolveOrCreateDefaultCampaign
      .mockResolvedValueOnce([[{ // scope-check SELECT: prior batch exists, but for a DIFFERENT branch
        id: 'batch-other-branch', dialler_source_id: baseParams.diallerSourceId, branch_id: 'branch-999',
        process_id: baseParams.processId, date_from: baseParams.dateFrom, date_to: baseParams.dateTo,
        status: 'accepted',
      }]]);

    await expect(
      commitUploadBatch({
        ...baseParams,
        supersedesBatchId: 'batch-other-branch',
        acceptedRows: [],
        rejectedRows: [],
      }),
    ).rejects.toThrow(/batch-other-branch names an Upload_Batch for a different .* refusing to supersede across scopes/);

    // No UPDATE was ever attempted, and no write followed.
    const updateCall = executeMock.mock.calls.find((c) =>
      String(c[0]).includes('UPDATE productivity_upload_batch'),
    );
    expect(updateCall).toBeUndefined();
    expect(executeMock).toHaveBeenCalledTimes(2); // campaign resolution, then the scope-check SELECT
  });

  it('throws when supersedesBatchId does not name an existing Upload_Batch (criterion 17.7 safety)', async () => {
    executeMock
      .mockResolvedValueOnce([[{ id: 'camp-1', campaign_code: 'DEFAULT_ds-1' }]]) // resolveOrCreateDefaultCampaign
      .mockResolvedValueOnce([[]]); // scope-check SELECT: batch truly doesn't exist

    await expect(
      commitUploadBatch({
        ...baseParams,
        supersedesBatchId: 'batch-does-not-exist',
        acceptedRows: [],
        rejectedRows: [],
      }),
    ).rejects.toThrow('supersedesBatchId batch-does-not-exist does not name an existing Upload_Batch');

    // Never reached the row-writing or final batch-insert phase
    expect(executeMock).toHaveBeenCalledTimes(2);
  });

  it('does not throw when supersedesBatchId names a same-scope batch that is already superseded (idempotent no-op)', async () => {
    executeMock
      .mockResolvedValueOnce([[{ id: 'camp-1', campaign_code: 'DEFAULT_ds-1' }]]) // resolveOrCreateDefaultCampaign
      .mockResolvedValueOnce([[{ // scope-check SELECT: same scope, already superseded by something else
        id: 'batch-old', dialler_source_id: baseParams.diallerSourceId, branch_id: baseParams.branchId,
        process_id: baseParams.processId, date_from: baseParams.dateFrom, date_to: baseParams.dateTo,
        status: 'superseded',
      }]])
      .mockResolvedValueOnce([{}]); // INSERT productivity_upload_batch (no accepted/rejected rows, no UPDATE — already superseded)

    const result = await commitUploadBatch({
      ...baseParams,
      supersedesBatchId: 'batch-old',
      acceptedRows: [],
      rejectedRows: [],
    });

    expect(result.batchId).toBeTruthy();
    const updateCall = executeMock.mock.calls.find((c) =>
      String(c[0]).includes('UPDATE productivity_upload_batch'),
    );
    expect(updateCall).toBeUndefined(); // no redundant UPDATE against an already-superseded row
  });

  it('recovers a fully-failed prior batch when retried WITH supersedesBatchId (the exact recovery path the guard exists to preserve)', async () => {
    // Proves the guard's claimed property "cannot permanently strand a failed upload" actually
    // works end to end, not only as a code comment — this exact claim was wrong in three
    // consecutive prior review rounds.
    executeMock
      .mockResolvedValueOnce([[{ id: 'camp-1', campaign_code: 'DEFAULT_ds-1' }]]) // resolveOrCreateDefaultCampaign
      .mockResolvedValueOnce([[{ // scope-check SELECT: the previously fully-failed batch
        id: 'batch-failed', dialler_source_id: baseParams.diallerSourceId, branch_id: baseParams.branchId,
        process_id: baseParams.processId, date_from: baseParams.dateFrom, date_to: baseParams.dateTo,
        status: 'rejected', // status the function itself writes when actualAccepted === 0
      }]])
      .mockResolvedValueOnce([{}]) // UPDATE prior batch superseded
      .mockResolvedValueOnce([{}]) // INSERT apr_manual_upload — this time it lands
      .mockResolvedValueOnce([{}]); // INSERT productivity_upload_batch

    const result = await commitUploadBatch({
      ...baseParams,
      supersedesBatchId: 'batch-failed',
      acceptedRows: [
        { rowNumber: 2, employeeId: 'emp-1', employeeCode: 'MAS1', reportDate: '2026-07-15', loginMinutes: 420 },
      ],
      rejectedRows: [],
    });

    expect(result.acceptedCount).toBe(1);
    expect(result.writeErrors).toEqual([]);
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
    // The affected row range is named (that is what the uploader can act on), but the raw driver
    // message is NOT — it carries schema internals verbatim and this response goes straight to a
    // client, routing around errorHandler.ts, which exists to stop exactly that leaking.
    expect(result.writeErrors[0]).toContain('rows 2-2');
    expect(result.writeErrors[0]).not.toContain('ER_LOCK_WAIT_TIMEOUT');

    // The persisted status must reflect that NOTHING landed — not 'accepted' just because a
    // writeError happened to exist. This is the exact bug a second review round caught: an
    // earlier fix computed `writeErrors.length > 0 || actualAccepted > 0`, which is backwards.
    const batchInsertCall = executeMock.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO productivity_upload_batch'),
    );
    expect(batchInsertCall).toBeDefined();
    expect(batchInsertCall![1]).toContain('rejected'); // the status value bound into that INSERT
    expect(batchInsertCall![1]).not.toContain('accepted');
  });

  it('the duplicate-submission guard matches on scope + content digest only, regardless of what a prior batch actually landed', async () => {
    // A mock cannot itself validate SQL semantics, so this asserts on the actual SQL text and
    // bound params of the guard's SELECT rather than only on mocked behavior. Deliberately no
    // accepted_row_count/rejected_row_count predicate: an earlier version of this guard tried to
    // distinguish "prior batch fully succeeded" from "prior batch partially failed" by matching
    // on those counts, and each variant of that idea reintroduced a bug (see the function's own
    // comment). The current guard does not attempt that distinction at all — it matches on scope
    // and content only, and pushes the decision to the caller via the thrown error.
    executeMock
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ id: 'camp-1', campaign_code: 'DEFAULT_ds-1' }]])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{}]);

    await commitUploadBatch({
      ...baseParams,
      acceptedRows: [
        { rowNumber: 2, employeeId: 'emp-1', employeeCode: 'MAS1', reportDate: '2026-07-15', loginMinutes: 420 },
      ],
      rejectedRows: [],
    });

    const guardCall = executeMock.mock.calls[0];
    expect(String(guardCall[0])).toContain("status <> 'superseded'");
    expect(String(guardCall[0])).not.toContain('accepted_row_count + rejected_row_count');
    // Deliberately NOT keyed on date_from/date_to. It was, and that made the whole guard
    // bypassable by retyping one form field: the byte-identical file resubmitted under a
    // one-day-wider declared window produced a different key, the guard stayed silent, and every
    // row landed twice in apr_manual_upload, which has no unique key to stop it.
    expect(String(guardCall[0])).not.toContain('date_from');
    expect(String(guardCall[0])).not.toContain('date_to');
    expect(guardCall[1]).toEqual([
      baseParams.diallerSourceId, baseParams.branchId, baseParams.processId,
      baseParams.contentDigest,
    ]);
  });

  it('the duplicate guard still fires when only the declared date window differs (the bypass it used to have)', async () => {
    // Same bytes, same dialler_source/branch/process, a window declared one day wider. The prior
    // batch row that comes back from the guard SELECT is what a real MySQL would return for the
    // narrowed key, and the guard must reject rather than write a second copy of every row.
    executeMock.mockResolvedValueOnce([[
      { id: 'batch-prior', batch_reference: 'batch-prior', accepted_row_count: 1, rejected_row_count: 0 },
    ]]);

    await expect(commitUploadBatch({
      ...baseParams,
      dateFrom: '2026-06-30', // widened by a day; digest and scope unchanged
      acceptedRows: [
        { rowNumber: 2, employeeId: 'emp-1', employeeCode: 'MAS1', reportDate: '2026-07-15', loginMinutes: 420 },
      ],
      rejectedRows: [],
    })).rejects.toBeInstanceOf(DuplicateUploadBatchError);

    // Nothing beyond the guard SELECT ran — no campaign resolution, no INSERT of any kind.
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it('does not silently return stale success: a duplicate resubmission after a genuine prior failure is rejected too, not short-circuited into a fake success', async () => {
    // This is the double-write scenario a third review round found: a prior attempt landed 1 of
    // 2 accepted rows before failing. Retrying without supersedesBatchId must not re-insert the
    // row that already landed, and must not report fake success either — it must reject, so the
    // caller makes an explicit choice (supersedesBatchId) rather than the code guessing.
    executeMock.mockResolvedValueOnce([
      [{ id: 'batch-partial', batch_reference: 'batch-partial', accepted_row_count: 1, rejected_row_count: 0 }],
    ]);

    const call = commitUploadBatch({
      ...baseParams,
      acceptedRows: [
        { rowNumber: 2, employeeId: 'emp-1', employeeCode: 'MAS1', reportDate: '2026-07-15', loginMinutes: 420 },
        { rowNumber: 3, employeeId: 'emp-2', employeeCode: 'MAS2', reportDate: '2026-07-15', loginMinutes: 400 },
      ],
      rejectedRows: [],
    });

    await expect(call).rejects.toBeInstanceOf(DuplicateUploadBatchError);
    await expect(call).rejects.toThrow(/batch-partial/);
    expect(executeMock).toHaveBeenCalledTimes(1); // no write of any kind was attempted
  });

  it('supersedes the prior batch only AFTER this batch\'s rows have actually landed', async () => {
    executeMock
      .mockResolvedValueOnce([[{ id: 'camp-1', campaign_code: 'DEFAULT_ds-1' }]]) // campaign (guard skipped: supersedesBatchId given)
      .mockResolvedValueOnce([[{
        id: 'batch-old', dialler_source_id: 'ds-1', branch_id: 'branch-1', process_id: 'process-1',
        date_from: '2026-07-01', date_to: '2026-07-31', status: 'accepted',
      }]]) // scope-check SELECT
      .mockResolvedValueOnce([{}]) // INSERT apr_manual_upload
      .mockResolvedValueOnce([{}]) // UPDATE ... superseded
      .mockResolvedValueOnce([{}]); // INSERT productivity_upload_batch

    await commitUploadBatch({
      ...baseParams,
      supersedesBatchId: 'batch-old',
      acceptedRows: [
        { rowNumber: 2, employeeId: 'emp-1', employeeCode: 'MAS1', reportDate: '2026-07-15', loginMinutes: 420 },
      ],
      rejectedRows: [],
    });

    const sqlByCall = executeMock.mock.calls.map((c) => String(c[0]));
    const aprInsertAt = sqlByCall.findIndex((s) => s.includes('INSERT INTO apr_manual_upload'));
    const supersedeAt = sqlByCall.findIndex((s) => s.includes("SET status = 'superseded'"));
    expect(aprInsertAt).toBeGreaterThanOrEqual(0);
    expect(supersedeAt).toBeGreaterThan(aprInsertAt);
  });

  it('does NOT supersede the prior batch when nothing landed — a failed re-upload must not retire good data', async () => {
    // The supersede UPDATE used to run before the row writes, so a re-upload whose every row was
    // rejected still retired the prior batch. Criterion 17.7 excludes a superseded batch's rows
    // from Canonical_Productive_Minutes, so real prior data was replaced by nothing while the
    // caller was told the request succeeded.
    executeMock
      .mockResolvedValueOnce([[{ id: 'camp-1', campaign_code: 'DEFAULT_ds-1' }]])
      .mockResolvedValueOnce([[{
        id: 'batch-old', dialler_source_id: 'ds-1', branch_id: 'branch-1', process_id: 'process-1',
        date_from: '2026-07-01', date_to: '2026-07-31', status: 'accepted',
      }]])
      .mockResolvedValueOnce([{}])  // INSERT productivity_upload_rejection
      .mockResolvedValueOnce([{}]); // INSERT productivity_upload_batch

    const result = await commitUploadBatch({
      ...baseParams,
      supersedesBatchId: 'batch-old',
      acceptedRows: [],
      rejectedRows: [{ rowNumber: 2, employeeCode: 'MAS1', reason: 'employee code MAS1 does not resolve to any employee' }],
    });

    const superseded = executeMock.mock.calls.some((c) => String(c[0]).includes("SET status = 'superseded'"));
    expect(superseded).toBe(false);
    expect(result.writeErrors.join(' ')).toContain('left live');
  });

  it('reports a failed batch-row INSERT as a write error instead of throwing after the rows already landed', async () => {
    // Throwing here reports a total failure to a caller whose rows ARE already in
    // apr_manual_upload; the caller retries and double-writes, because the duplicate guard cannot
    // see a batch row that was never created.
    executeMock
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ id: 'camp-1', campaign_code: 'DEFAULT_ds-1' }]])
      .mockResolvedValueOnce([{}]) // INSERT apr_manual_upload succeeds
      .mockRejectedValueOnce(new Error('ER_DATA_TOO_LONG')); // INSERT productivity_upload_batch fails

    const result = await commitUploadBatch({
      ...baseParams,
      acceptedRows: [
        { rowNumber: 2, employeeId: 'emp-1', employeeCode: 'MAS1', reportDate: '2026-07-15', loginMinutes: 420 },
      ],
      rejectedRows: [],
    });

    expect(result.acceptedCount).toBe(1);
    expect(result.writeErrors).toHaveLength(1);
    expect(result.writeErrors[0]).toContain('Do NOT re-upload');
    expect(result.writeErrors[0]).not.toContain('ER_DATA_TOO_LONG');
  });

  it('truncates over-length rejection values rather than losing the whole rejection chunk', async () => {
    // productivity_upload_rejection.employee_code is VARCHAR(50) and reason VARCHAR(500) (1638).
    // A misdelimited file puts a whole line into one cell; under strict mode that is
    // ER_DATA_TOO_LONG, which fails the chunk that exists to explain what went wrong.
    executeMock
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ id: 'camp-1', campaign_code: 'DEFAULT_ds-1' }]])
      .mockResolvedValueOnce([{}])  // rejection chunk
      .mockResolvedValueOnce([{}]); // batch row

    await commitUploadBatch({
      ...baseParams,
      acceptedRows: [],
      rejectedRows: [{ rowNumber: 2, employeeCode: 'X'.repeat(400), reason: 'Y'.repeat(900) }],
    });

    const rejectionCall = executeMock.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO productivity_upload_rejection'),
    );
    expect(rejectionCall).toBeDefined();
    const params = rejectionCall![1] as unknown[];
    expect(String(params[3])).toHaveLength(50);
    expect(String(params[4])).toHaveLength(500);
  });

  it('names an error rather than throwing a TypeError when the default campaign cannot be re-selected', async () => {
    executeMock
      .mockResolvedValueOnce([[]])  // no existing campaign
      .mockResolvedValueOnce([[]])  // dialler_source lookup finds nothing
      .mockResolvedValueOnce([{}])  // INSERT
      .mockResolvedValueOnce([[]]); // re-select returns nothing

    await expect(resolveOrCreateDefaultCampaign('ds-1')).rejects.toThrow(
      /could not be resolved after its INSERT/,
    );
  });
});
