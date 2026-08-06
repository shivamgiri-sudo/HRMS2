import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getAccessMe: vi.fn() }));
vi.mock('../../access/access.service.js', () => ({ getAccessMe: mocks.getAccessMe }));

import { answerHowToQuestion } from '../ai-howto.service.js';
import { HOWTO_CATALOG } from '../ai-howto-catalog.js';
import { getRolePageCodes } from '../../../shared/rbacPageMatrix.js';

function pagesFor(pageCodes: string[]) {
  return pageCodes.map((page_code) => ({ page_code, can_view: true, can_create: false, can_edit: false, can_delete: false, can_export: false }));
}

beforeEach(() => {
  mocks.getAccessMe.mockReset();
  mocks.getAccessMe.mockResolvedValue({ pages: [] });
});

describe('answerHowToQuestion', () => {
  it('does not fire on questions without a how-to prefix', async () => {
    const result = await answerHowToQuestion('what is my leave balance', 'user-1', ['employee']);
    expect(result.handled).toBe(false);
  });

  it('does not fire on a how-to prefix that matches no catalog entry', async () => {
    const result = await answerHowToQuestion('how do I fly to the moon', 'user-1', ['employee']);
    expect(result.handled).toBe(false);
  });

  // Regression: the how-to gate used to be anchored to the START of the
  // message (`^\s*how to...`), so real phrasing that buries the how-to
  // intent mid-sentence fell straight through to the external LLM's
  // canned refusal — even though leave_approve's own catalog entry and
  // aliases matched fine. Reported live: a manager asked Mira exactly
  // these two phrasings and got "I couldn't find that in HRMS or the
  // approved MAS Callnet sources." both times.
  describe('mid-sentence how-to phrasing (previously fell through unmatched)', () => {
    it('fires on "I don\'t know how to approve leave for my team member. Can you help me?"', async () => {
      const result = await answerHowToQuestion(
        "I don't know how to approve leave for my team member. Can you help me?",
        'user-1',
        ['manager'],
      );
      expect(result.handled).toBe(true);
      expect(result.response?.actions?.[0]?.url).toBe('/leaves');
    });

    it('fires on "I don\'t know the path from where I can approve my team member leave request."', async () => {
      const result = await answerHowToQuestion(
        "I don't know the path from where I can approve my team member leave request.",
        'user-1',
        ['manager'],
      );
      expect(result.handled).toBe(true);
      expect(result.response?.actions?.[0]?.url).toBe('/leaves');
    });

    it('still respects RBAC on mid-sentence phrasing — an employee gets the denial, not the steps', async () => {
      const result = await answerHowToQuestion(
        "I don't know how to approve leave for my team member.",
        'user-1',
        ['employee'],
      );
      expect(result.handled).toBe(true);
      expect(result.response?.answer).toContain('does not include leave approval');
    });

    it('still requires an actual catalog match — an unrelated mid-sentence "how to" falls through', async () => {
      const result = await answerHowToQuestion(
        "I don't know how to fly to the moon from here.",
        'user-1',
        ['employee'],
      );
      expect(result.handled).toBe(false);
    });
  });

  describe('static_roles entries', () => {
    it('leave_apply is open to any employee (empty roles list)', async () => {
      const result = await answerHowToQuestion('how can I apply for leave', 'user-1', ['employee']);
      expect(result.handled).toBe(true);
      expect(result.response?.actions?.[0]?.url).toBe('/leaves');
      expect(result.response?.answer).toContain('1.');
    });

    it('leave_approve denies an employee-only caller with no action link', async () => {
      const result = await answerHowToQuestion('how do I approve my team\'s leave', 'user-1', ['employee']);
      expect(result.handled).toBe(true);
      expect(result.response?.answer).toContain('does not include leave approval');
      expect(result.response?.actions).toEqual([]);
    });

    it('leave_approve grants a manager caller with steps and the /leaves link', async () => {
      const result = await answerHowToQuestion('how can I approve my team\'s leave', 'user-1', ['manager']);
      expect(result.handled).toBe(true);
      expect(result.response?.actions?.[0]?.url).toBe('/leaves');
      expect(result.response?.answer).toContain('Approve');
    });

    it('reimbursement_approve denies a manager (manager is deliberately excluded, unlike leave)', async () => {
      const result = await answerHowToQuestion('how do I approve a reimbursement claim', 'user-1', ['manager']);
      expect(result.handled).toBe(true);
      expect(result.response?.actions).toEqual([]);
    });

    it('reimbursement_approve grants an hr caller', async () => {
      const result = await answerHowToQuestion('how can I approve a reimbursement claim', 'user-1', ['hr']);
      expect(result.handled).toBe(true);
      expect(result.response?.actions?.[0]?.url).toBe('/payroll/reimbursements');
    });

    it('super_admin bypasses every static_roles gate unconditionally, even leave_approve', async () => {
      const result = await answerHowToQuestion('how do I approve my team\'s leave', 'user-1', ['super_admin']);
      expect(result.handled).toBe(true);
      expect(result.response?.actions?.[0]?.url).toBe('/leaves');
    });
  });

  describe('page_code entries', () => {
    it('grants payslip_download when getAccessMe includes the page_code', async () => {
      mocks.getAccessMe.mockResolvedValue({ pages: pagesFor(['PAYROLL_PAYSLIPS']) });
      const result = await answerHowToQuestion('how do I download my payslip', 'user-1', ['employee']);
      expect(result.handled).toBe(true);
      expect(result.response?.actions?.[0]?.url).toBe('/payroll/payslips');
    });

    it('denies payslip_download when getAccessMe does not include the page_code', async () => {
      mocks.getAccessMe.mockResolvedValue({ pages: [] });
      const result = await answerHowToQuestion('how do I download my payslip', 'user-1', ['employee']);
      expect(result.handled).toBe(true);
      expect(result.response?.actions).toEqual([]);
    });

    it('denies resignation_approve for a plain employee even if getAccessMe is mocked wrong (defense in depth)', async () => {
      mocks.getAccessMe.mockResolvedValue({ pages: [] });
      const result = await answerHowToQuestion('how do I approve a resignation', 'user-1', ['employee']);
      expect(result.handled).toBe(true);
      expect(result.response?.actions).toEqual([]);
    });

    it('super_admin bypasses page_code checks too, without calling getAccessMe for the grant decision', async () => {
      mocks.getAccessMe.mockResolvedValue({ pages: [] });
      const result = await answerHowToQuestion('how do I view my team\'s roster', 'user-1', ['super_admin']);
      expect(result.handled).toBe(true);
      expect(result.response?.actions?.[0]?.url).toBe('/my-team');
    });
  });

  it('every verified catalog entry has a real, non-empty route and at least one step', () => {
    for (const entry of HOWTO_CATALOG.filter((e) => e.status === 'verified')) {
      expect(entry.route.startsWith('/')).toBe(true);
      expect(entry.steps.length).toBeGreaterThan(0);
    }
  });
});

// RBAC cross-check: every page_code entry's allow/deny decision must match
// what rbacPageMatrix.ts itself grants that role — this catalog must never
// develop its own, silently-drifted opinion of who can see a page.
describe('answerHowToQuestion — RBAC cross-check against rbacPageMatrix.ts', () => {
  const ROLES_TO_SWEEP = ['employee', 'manager', 'hr', 'branch_hr', 'admin', 'wfm', 'branch_wfm', 'payroll_head', 'finance'];

  it.each(
    HOWTO_CATALOG.filter((entry) =>
      // ijp_apply's page_code ('ijp_opportunities') is absent from
      // rbacPageMatrix.ts entirely — the real grant is a DB-seeded
      // role_page_access row (backend/sql/570_ijp_module.sql:176-181), not
      // this file. Sweeping it here would just compute "expected: denied"
      // for every role (getRolePageCodes never returns it for anyone),
      // silently asserting zero real coverage of the actual grant. It gets
      // its own dedicated block below instead.
      entry.status === 'verified' && entry.auth.mode === 'page_code' && entry.code !== 'ijp_apply'
    ).flatMap((entry) =>
      ROLES_TO_SWEEP.map((role) => ({ entry, role })),
    ),
  )('$entry.code / role $role matches getRolePageCodes', async ({ entry, role }) => {
    const pageCode = (entry.auth as { pageCode: string }).pageCode;
    const expectedAllowed = getRolePageCodes(role).includes(pageCode);
    mocks.getAccessMe.mockResolvedValue({
      pages: expectedAllowed ? [{ page_code: pageCode, can_view: true, can_create: false, can_edit: false, can_delete: false, can_export: false }] : [],
    });
    const driven = await answerHowToQuestion(`how do I ${entry.title.toLowerCase()}`, 'user-1', [role]);
    expect(driven.handled).toBe(true);
    const hasAction = (driven.response?.actions?.length ?? 0) > 0;
    expect(hasAction).toBe(expectedAllowed);
  });
});

// ijp_apply's real grant source is backend/sql/570_ijp_module.sql:176-181
// (role_page_access rows for employee/team_leader/tl/trainer/qa), not
// rbacPageMatrix.ts — dedicated coverage instead of the generic sweep above.
describe('answerHowToQuestion — ijp_apply (DB-seeded grant, not rbacPageMatrix.ts)', () => {
  it('grants ijp_apply for team_leader when getAccessMe returns ijp_opportunities', async () => {
    mocks.getAccessMe.mockResolvedValue({
      pages: [{ page_code: 'ijp_opportunities', can_view: true, can_create: true, can_edit: false, can_delete: false, can_export: false }],
    });
    const result = await answerHowToQuestion('how do I apply to an internal job posting', 'user-1', ['team_leader']);
    expect(result.handled).toBe(true);
    expect(result.response?.actions?.[0]?.url).toBe('/people/ijp');
  });

  it('denies ijp_apply for a role with no ijp_opportunities grant', async () => {
    mocks.getAccessMe.mockResolvedValue({ pages: [] });
    const result = await answerHowToQuestion('how do I apply to an internal job posting', 'user-1', ['finance']);
    expect(result.handled).toBe(true);
    expect(result.response?.actions).toEqual([]);
  });
});

// Route-drift guard: every catalog route must actually be a mounted <Route>
// path somewhere in src/config/routes/*.tsx — mirrors
// src/tests/page-catalog-route-drift.contract.test.ts's intent, applied to
// this new catalog instead of the page_catalog DB table.
describe('HOWTO_CATALOG route-drift guard', () => {
  function readMountedRoutePaths(): Set<string> {
    const routesDir = fileURLToPath(new URL('../../../../../src/config/routes/', import.meta.url));
    const paths = new Set<string>();
    for (const file of readdirSync(routesDir).filter((name) => name.endsWith('.tsx'))) {
      const content = readFileSync(`${routesDir}${file}`, 'utf8');
      for (const match of content.matchAll(/<Route\s+path="([^"]+)"/g)) paths.add(match[1]);
    }
    return paths;
  }

  it('every verified entry route is a real mounted <Route path>', () => {
    const mounted = readMountedRoutePaths();
    for (const entry of HOWTO_CATALOG.filter((e) => e.status === 'verified')) {
      expect(mounted.has(entry.route), `${entry.code}'s route "${entry.route}" is not a mounted <Route path> in src/config/routes/*.tsx`).toBe(true);
    }
  });
});
