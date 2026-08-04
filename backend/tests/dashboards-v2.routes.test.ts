import { describe, it, expect } from 'vitest';
import request from 'supertest';

// Static import — see operations-live.routes.test.ts for why (tests/setup.ts sets the
// environment before any module loads, so a dynamic import inside beforeAll bought nothing
// and risked exceeding the hook timeout).
import { app } from '../src/app.js';

/**
 * Demo tokens (mock-token-*) satisfy requireRole's route gate directly from the token, but
 * getUserRoleContext()/resolveDashboardScope() re-derive the caller's role independently
 * from the database — and tests/setup.ts mocks db.execute to always return empty rows, so
 * every demo user id (e.g. "demo-admin-id") resolves to no roles at all and falls back to
 * "employee". There is therefore no demo token that reaches ORG_ALL scope here: every one
 * of them is a SELF_ONLY role with no employees row behind it, so resolveDashboardScope
 * correctly refuses (DashboardScopeConfigurationError) rather than guessing.
 *
 * The older /api/operations/* routes swallow that same exception into a silent empty-but-200
 * response (see operations-live.routes.ts's resolveOperationsScope try/catch). These v2
 * routes deliberately do not — an unconfigured account should see an explicit 409 telling an
 * administrator what to add, not a 200 that looks like "genuinely zero data". That is the
 * property this suite locks in: no path here ever returns 200 with data for an account
 * resolveDashboardScope couldn't actually place, admin-claiming token or not.
 *
 * The real branch/process/team rollup numbers (grouping, scope-narrowing math, name
 * resolution) were verified separately against the live database by hand — seed 2026-08-04
 * — rather than through this mocked harness; see the design spec for those figures.
 */
const adminToken = 'Bearer mock-token-admin';
const scopedToken = 'Bearer mock-token-team_leader';

describe('Quality Dashboard v2 Routes', () => {
  describe('GET /api/quality-dashboard-v2/summary', () => {
    it('returns 401 with no authorization header', async () => {
      const res = await request(app).get('/api/quality-dashboard-v2/summary?level=branch');
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('success', false);
    });

    it('rejects an invalid level with 400', async () => {
      const res = await request(app)
        .get('/api/quality-dashboard-v2/summary?level=galaxy')
        .set('Authorization', adminToken);
      expect(res.status).toBe(400);
    });

    it('requires id for process/team/analyst levels', async () => {
      for (const level of ['process', 'team', 'analyst']) {
        const res = await request(app)
          .get(`/api/quality-dashboard-v2/summary?level=${level}`)
          .set('Authorization', adminToken);
        expect(res.status).toBe(400);
      }
    });

    it('fails closed (409) for an unconfigured account rather than leaking org-wide data — even for an admin-claiming token', async () => {
      for (const token of [adminToken, scopedToken]) {
        const res = await request(app)
          .get('/api/quality-dashboard-v2/summary?level=branch')
          .set('Authorization', token);
        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ success: false, code: 'DASHBOARD_SCOPE_NOT_CONFIGURED' });
      }
    });
  });

  describe('GET /api/quality-dashboard-v2/analyst/:employeeId/calls', () => {
    it('returns 401 with no authorization header', async () => {
      const res = await request(app).get('/api/quality-dashboard-v2/analyst/some-id/calls');
      expect(res.status).toBe(401);
    });
  });
});

describe('Operations Dashboard v2 Routes', () => {
  describe('GET /api/operations-dashboard-v2/summary', () => {
    it('returns 401 with no authorization header', async () => {
      const res = await request(app).get('/api/operations-dashboard-v2/summary?level=branch');
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('success', false);
    });

    it('rejects an invalid level with 400', async () => {
      const res = await request(app)
        .get('/api/operations-dashboard-v2/summary?level=galaxy')
        .set('Authorization', adminToken);
      expect(res.status).toBe(400);
    });

    it('requires id for process/team/analyst levels', async () => {
      for (const level of ['process', 'team', 'analyst']) {
        const res = await request(app)
          .get(`/api/operations-dashboard-v2/summary?level=${level}`)
          .set('Authorization', adminToken);
        expect(res.status).toBe(400);
      }
    });

    it('fails closed (409) for an unconfigured account rather than leaking org-wide data — even for an admin-claiming token', async () => {
      for (const token of [adminToken, scopedToken]) {
        const res = await request(app)
          .get('/api/operations-dashboard-v2/summary?level=branch')
          .set('Authorization', token);
        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ success: false, code: 'DASHBOARD_SCOPE_NOT_CONFIGURED' });
      }
    });
  });

  describe('GET /api/operations-dashboard-v2/analyst/:employeeId/detail', () => {
    it('returns 401 with no authorization header', async () => {
      const res = await request(app).get('/api/operations-dashboard-v2/analyst/some-id/detail');
      expect(res.status).toBe(401);
    });
  });
});
