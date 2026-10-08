import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The Joining Documents Tracker's query, pinned on three points.
 *
 * Branch RBAC: the page is mounted for admin, super_admin, hr, payroll_hr and
 * branch_head, but only branch_head was ever scoped — and by reading a branch id
 * off the actor's own employee row rather than off their role grant. Every hr and
 * payroll_hr therefore saw all 287 employees across all four branches. Scope now
 * comes from buildScopeWhereClause(), the codebase's one resolver, so
 * scope_type='all' still means org-wide and a user with no scope row resolves to
 * 1=0 instead of to everything.
 *
 * Performance: the population used to be three ORs in the WHERE, one of them a
 * correlated EXISTS. Nothing was indexable, so MySQL scanned all 59,356 employee
 * rows per call — 6.4s, twice per keystroke. It is now a joined candidate set
 * where each branch uses an index (~0.3s). This is a correctness guard as much as
 * a speed one: the search box was reported as "not working" when it was in fact
 * working slowly.
 *
 * Row inflation: the two milestone dates come from tables that hold more than one
 * row per employee. Joined, they would multiply the checklist rows and inflate
 * COUNT(c.id) — the document counter the whole page is built on.
 */
const service = readFileSync(
  resolve(process.cwd(), 'src/modules/ats/ats.joiningDocumentsTracker.service.ts'),
  'utf8',
);
const routes = readFileSync(
  resolve(process.cwd(), 'src/modules/ats/ats.joiningDocumentsTracker.routes.ts'),
  'utf8',
);

describe('joining documents tracker — branch RBAC', () => {
  it('resolves scope through buildScopeWhereClause', () => {
    expect(service).toContain('buildScopeWhereClause');
    // The old mechanism: read the actor's employee row, take its branch_id, and
    // apply it to branch_head alone.
    expect(service).not.toContain("roleKeys.includes('branch_head')");
    expect(service).not.toContain('getEmployeeForUser');
  });

  it('scopes the list query itself, not the rows after they are read', () => {
    const fn = service.slice(service.indexOf('export async function getJoiningDocumentsTracker'));
    const scopeAt = fn.indexOf('buildScopeWhereClause');
    const queryAt = fn.indexOf('const sql = `');
    expect(scopeAt).toBeGreaterThan(-1);
    expect(scopeAt).toBeLessThan(queryAt);
    expect(fn).toContain('whereClauses.push(`(${scope.sql})`)');
  });

  it('narrows every bulk endpoint to the caller scope before the handler runs', () => {
    for (const path of ['/bulk-remind', '/bulk-generate-checklist', '/bulk-assign', '/bulk-set-due-date', '/bulk-verify']) {
      const line = routes.split('\n').find((l) => l.includes(`post('${path}'`));
      expect(line, `${path} route not found`).toBeDefined();
      expect(line, `${path} is not scoped`).toContain('scopeBulkEmployeeIds');
    }
    // Single-id endpoint: no bulk middleware, so it checks inline.
    expect(routes).toContain('filterEmployeeIdsToScope(req.authUser!.id, [employee_id])');
  });

  it('keeps the scope role list and the router role list in step', () => {
    const declared = service.match(/TRACKER_SCOPE_ROLES = \[(.*?)\]/s)?.[1] ?? '';
    const mounted = routes.match(/requireRole\((.*?)\)/s)?.[1] ?? '';
    for (const role of ['admin', 'super_admin', 'hr', 'payroll_hr', 'branch_head']) {
      expect(declared, `${role} missing from TRACKER_SCOPE_ROLES`).toContain(`'${role}'`);
      expect(mounted, `${role} missing from requireRole`).toContain(`'${role}'`);
    }
  });
});

describe('joining documents tracker — query shape', () => {
  it('selects the population by join, not by an unindexable OR chain', () => {
    expect(service).toContain('TRACKER_POPULATION_JOIN');
    expect(service).toContain('${TRACKER_POPULATION_JOIN}');
    // The three shapes that made the old predicate unindexable.
    expect(service).not.toContain('OR EXISTS (SELECT 1 FROM employee_joining_document_checklist k');
    expect(service).not.toContain("LOWER(COALESCE(e.employment_status,'')) = 'preboarding'");
  });

  it('reads the milestone dates as scalar subqueries so the document count cannot inflate', () => {
    const sql = service.slice(service.indexOf('const sql = `'));
    expect(sql).toContain('AS onboarding_submitted_at');
    expect(sql).toContain('AS salary_assigned_at');
    // A join to either table would multiply the checklist rows behind COUNT(c.id).
    expect(sql).not.toMatch(/JOIN\s+ats_onboarding_bridge/);
    expect(sql).not.toMatch(/JOIN\s+salary_component_assignments/);
  });

  it('escapes LIKE wildcards in the search term', () => {
    const search = service.slice(service.indexOf('if (filters.search'));
    expect(search.slice(0, 500)).toContain('replace(/[\\\\%_]/g');
  });
});
