// backend/src/db/__tests__/wfm-productivity-upload-page-access-migration.contract.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SQL_DIR = join(__dirname, '../../../sql');

function readMigration(file: string): string {
  return readFileSync(join(SQL_DIR, file), 'utf-8');
}

describe('WFM_PRODUCTIVITY_UPLOAD page access migration (1639)', () => {
  it('registers the page_catalog row with the correct path', () => {
    const sql = readMigration('1639_wfm_productivity_upload_page_access.sql');
    expect(sql).toContain("'WFM_PRODUCTIVITY_UPLOAD',");
    expect(sql).toContain("'/wfm/productivity-upload',");
  });

  it('grants all six roles view + create access', () => {
    const sql = readMigration('1639_wfm_productivity_upload_page_access.sql');
    for (const role of ['wfm', 'branch_head', 'hr', 'payroll_head', 'admin', 'super_admin']) {
      expect(sql).toContain(`SELECT '${role}'`);
    }
    expect(sql).toContain("SET can_view = 1, can_create = 1, active_status = 1");
  });

  it('is idempotent (ON DUPLICATE KEY UPDATE on page_catalog, NOT EXISTS guard on role_page_access)', () => {
    const sql = readMigration('1639_wfm_productivity_upload_page_access.sql');
    expect(sql).toContain('ON DUPLICATE KEY UPDATE');
    expect(sql).toContain('WHERE NOT EXISTS');
  });
});
