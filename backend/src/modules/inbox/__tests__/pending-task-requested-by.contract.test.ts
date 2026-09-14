/**
 * Regression cover for "who raised this query is missing" — reported live 2026-08-13
 * from the Work Inbox detail panel for a Mira complaint. `getMyPending()`'s work_item
 * query only ever joined employees on assigned_to_user_id (who a task is assigned TO),
 * never on created_by (who raised it). For role-assigned items — every Mira complaint,
 * since they go to assigned_to_role='super_admin' with no specific assignee — that left
 * the requester's identity permanently unresolved, even though work_item.created_by was
 * being written correctly all along (verified live: DHARMENDRA's own complaint had
 * created_by = his employees.user_id).
 *
 * This is a source-inspection test, matching the existing pattern
 * (process-readiness-super-admin-access.contract.test.ts) rather than a full mocked
 * functional test, because getMyPending() makes ~10 sequential db.execute calls and a
 * source-text assertion is the more stable regression guard against a query text edit
 * losing the join again.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const serviceFile = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../inbox.service.ts'),
  'utf8',
);

describe('getMyPending — work_item rows resolve who raised the item, not just who it is assigned to', () => {
  it('joins employees on created_by and selects requested_by_name/code', () => {
    expect(serviceFile).toContain('LEFT JOIN employees req ON req.user_id = wi.created_by');
    expect(serviceFile).toContain('req.full_name AS requested_by_name');
    expect(serviceFile).toContain('req.employee_code AS requested_by_code');
  });

  it('maps requested_by_name/code onto the work_item PendingTask, not just employee_name', () => {
    // The mapping block for the work_item source (the one carrying due_at) must read
    // both new columns off the row, or the query change is inert.
    const workItemMapBlock = serviceFile.slice(serviceFile.indexOf('// work_item rows.'));
    expect(workItemMapBlock).toContain('requested_by_name: row.requested_by_name ? String(row.requested_by_name) : undefined');
    expect(workItemMapBlock).toContain('requested_by_code: row.requested_by_code ? String(row.requested_by_code) : undefined');
  });

  it('PendingTask interface declares the new fields', () => {
    expect(serviceFile).toMatch(/requested_by_name\?:\s*string/);
    expect(serviceFile).toMatch(/requested_by_code\?:\s*string/);
  });
});
