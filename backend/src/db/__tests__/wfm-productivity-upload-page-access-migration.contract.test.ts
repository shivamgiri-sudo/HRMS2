// backend/src/db/__tests__/wfm-productivity-upload-page-access-migration.contract.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

import { ROLE_ALIASES } from '../../platform/policy/roles.js';

const SQL_DIR = join(__dirname, '../../../sql');

const GRANTED_ROLES = [
  'wfm', 'wfm_analyst', 'branch_head', 'hr', 'payroll_head', 'admin', 'super_admin',
];

function readMigration(file: string): string {
  return readFileSync(join(SQL_DIR, file), 'utf-8');
}

/**
 * The executable statements only. The path assertion below has to distinguish what the migration
 * WRITES from what its header comment merely discusses — that header explains why the old
 * '/wfm/productivity-upload' path was replaced, so a whole-file substring check would read the
 * explanation as the value and pass or fail for the wrong reason.
 */
function statementsOnly(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

describe('WFM_PRODUCTIVITY_UPLOAD page access migration (1639)', () => {
  // page_path must name a route the frontend router actually serves. WFM_PRODUCTIVITY_UPLOAD is a
  // section-level grant for a tab inside the existing /bulk-upload page (src/pages/BulkUploadHub.tsx),
  // not a page of its own — there is no /wfm/productivity-upload route, so registering that path
  // would hand a 404 to anything that reads page_path back. The page_code is unchanged: it stays
  // the separately grantable permission the tab is gated on.
  it('registers the page_catalog row against the real /bulk-upload route', () => {
    const sql = statementsOnly(readMigration('1639_wfm_productivity_upload_page_access.sql'));
    expect(sql).toContain("'WFM_PRODUCTIVITY_UPLOAD',");
    expect(sql).toContain("'/bulk-upload',");
    expect(sql).not.toContain("'/wfm/productivity-upload'");
  });

  it('grants every role the route admits view + create access', () => {
    const sql = readMigration('1639_wfm_productivity_upload_page_access.sql');
    for (const role of GRANTED_ROLES) {
      expect(sql).toContain(`SELECT '${role}'`);
    }
    expect(sql).toContain("SET can_view = 1, can_create = 1, active_status = 1");
  });

  // The grants and the route's requireRole list must describe the same set of people. They can
  // silently disagree in one specific way: requireRole() expands ROLE_ALIASES, so gating on 'wfm'
  // also admits 'wfm_analyst'. A role that can POST but holds no grant is invisible on the
  // access-control screen while being fully able to write attendance-feeding rows. This test
  // compares the two lists directly rather than restating six literals, so adding a role to
  // either side without the other fails here.
  it('grants exactly the roles the route admits, alias expansion included', () => {
    const sql = readMigration('1639_wfm_productivity_upload_page_access.sql');
    const routeSrc = readFileSync(
      join(__dirname, '../../modules/wfm/productivity-upload.routes.ts'),
      'utf-8',
    );
    const listMatch = routeSrc.match(/const UPLOAD_ROLES: string\[\] = \[([^\]]*)\]/);
    expect(listMatch, 'UPLOAD_ROLES list not found in productivity-upload.routes.ts').toBeTruthy();
    const routeRoles = [...listMatch![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
    expect(routeRoles.length).toBeGreaterThan(0);

    const admitted = new Set<string>(routeRoles);
    for (const role of routeRoles) {
      for (const alias of ROLE_ALIASES[role as keyof typeof ROLE_ALIASES] ?? []) {
        admitted.add(alias);
      }
    }

    const granted = new Set(
      [...sql.matchAll(/SELECT '([a-z_]+)'/g)].map((m) => m[1]!),
    );
    expect([...admitted].sort()).toEqual([...granted].sort());
  });

  it('is idempotent (ON DUPLICATE KEY UPDATE on page_catalog, NOT EXISTS guard on role_page_access)', () => {
    const sql = readMigration('1639_wfm_productivity_upload_page_access.sql');
    expect(sql).toContain('ON DUPLICATE KEY UPDATE');
    expect(sql).toContain('WHERE NOT EXISTS');
  });
});
