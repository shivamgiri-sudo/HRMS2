// backend/src/db/__tests__/productivity-upload-batch-migration.contract.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SQL_DIR = join(__dirname, '../../../sql');

function readMigration(file: string): string {
  return readFileSync(join(SQL_DIR, file), 'utf-8');
}

// Strips SQL line comments before checking for the ABSENCE of a pattern -- this migration's own
// ROLLBACK comment legitimately says "DROP TABLE", which a naive whole-file regex would
// false-positive against (this exact bug recurred three times in Phase 2; see
// canonical-productivity-store-migration.contract.test.ts for the established fix).
function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
}

describe('productivity upload batch migration (1638)', () => {
  it('declares productivity_upload_batch with the row-count accounting columns (criterion 17.11)', () => {
    const sql = readMigration('1638_productivity_upload_batch.sql');
    expect(sql).toContain('submitted_row_count   INT UNSIGNED NOT NULL DEFAULT 0,');
    expect(sql).toContain('accepted_row_count    INT UNSIGNED NOT NULL DEFAULT 0,');
    expect(sql).toContain('rejected_row_count    INT UNSIGNED NOT NULL DEFAULT 0,');
  });

  it('declares the supersession columns (criterion 17.7)', () => {
    const sql = readMigration('1638_productivity_upload_batch.sql');
    expect(sql).toContain('supersedes_batch_id   CHAR(36)     NULL,');
    expect(sql).toContain('superseded_by_batch_id CHAR(36)    NULL,');
  });

  it('declares productivity_upload_rejection with one reason per row, keyed to the batch', () => {
    const sql = readMigration('1638_productivity_upload_batch.sql');
    expect(sql).toContain('reason         VARCHAR(500) NOT NULL,');
    expect(sql).toContain('KEY idx_pur_batch (batch_id)');
  });

  it('declares COLLATE=utf8mb4_unicode_ci and ENGINE=InnoDB on both tables', () => {
    const sql = readMigration('1638_productivity_upload_batch.sql');
    expect((sql.match(/COLLATE=utf8mb4_unicode_ci/g) || []).length).toBe(2);
    expect((sql.match(/ENGINE=InnoDB/g) || []).length).toBe(2);
  });

  it('declares no FOREIGN KEY anywhere', () => {
    const sql = readMigration('1638_productivity_upload_batch.sql');
    expect(stripSqlComments(sql)).not.toMatch(/FOREIGN KEY\s*\(/i);
  });

  it('declares batch_reference as unique', () => {
    const sql = readMigration('1638_productivity_upload_batch.sql');
    expect(sql).toContain('UNIQUE KEY uq_pub_batch_reference (batch_reference)');
  });
});
