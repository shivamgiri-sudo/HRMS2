/**
 * GET /my-pending-count 403'd for super_admin/admin on every single page load (it's rendered
 * unconditionally by PayrollPrepWidget.tsx on the dashboard/Work Inbox for every user),
 * reported live 2026-08-13. Fixed by adding both roles to the requireRole allowlist — see the
 * comment on the route itself for why no other logic needed to change (a super_admin has no
 * user_assignment_scope rows, so the existing empty-scope branch already returns count:0
 * correctly once let past the role check).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const routeFile = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../payroll-process-readiness.routes.ts'),
  'utf8',
);

describe('GET /my-pending-count — role allowlist includes super_admin and admin', () => {
  it('requireRole for my-pending-count includes super_admin and admin', () => {
    const match = routeFile.match(
      /"\/my-pending-count",\s*requireAuth,\s*requireRole\(([^)]*)\)/,
    );
    expect(match, 'could not find the my-pending-count route registration').not.toBeNull();
    const roleArgs = match![1];
    expect(roleArgs).toContain('"super_admin"');
    expect(roleArgs).toContain('"admin"');
    // The original operational roles must still be present — this is additive, not a
    // narrowing of who can see their own assigned-process readiness.
    expect(roleArgs).toContain('"wfm"');
    expect(roleArgs).toContain('"process_manager"');
    expect(roleArgs).toContain('"branch_head"');
    expect(roleArgs).toContain('"payroll_branch"');
  });
});
