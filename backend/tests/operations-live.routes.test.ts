import { describe, it, expect } from 'vitest';
import request from 'supertest';

// Imported statically, as every other route suite here does. This used to be a
// dynamic import inside beforeAll, "after environment is set" — but tests/setup.ts
// sets the environment before any test module is evaluated, so the deferral bought
// nothing and loading app.ts (which pulls in every router) regularly exceeded the
// 10s hook timeout, failing the whole file before a single test ran.
import { app } from '../src/app.js';

const mockAuthHeader = 'Bearer mock-token-admin';

describe('Operations Live Status Routes', () => {

  describe('GET /api/operations/live-status', () => {
    it('should return live agent status for authenticated OPERATIONS/ADMIN users', async () => {
      const response = await request(app)
        .get('/api/operations/live-status')
        .set('Authorization', mockAuthHeader);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty('agents');
      expect(response.body.data).toHaveProperty('summary');
      expect(response.body.data).toHaveProperty('timestamp');
      expect(Array.isArray(response.body.data.agents)).toBe(true);

      if (response.body.data.agents.length > 0) {
        const agent = response.body.data.agents[0];
        expect(agent).toHaveProperty('agent_id');
        expect(agent).toHaveProperty('agent_name');
        expect(agent).toHaveProperty('status');
        expect(agent).toHaveProperty('duration');
      }
    });

    it('should return 401 for missing authorization header', async () => {
      const response = await request(app)
        .get('/api/operations/live-status');

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('success', false);
    });

    it('should support optional processName filter', async () => {
      const response = await request(app)
        .get('/api/operations/live-status')
        .query({ processName: 'INBOUND_SALES' })
        .set('Authorization', mockAuthHeader);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty('agents');
      expect(Array.isArray(response.body.data.agents)).toBe(true);
    });

    it('should support optional branchName filter', async () => {
      const response = await request(app)
        .get('/api/operations/live-status')
        .query({ branchName: 'HYD_MAIN' })
        .set('Authorization', mockAuthHeader);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty('agents');
    });
  });

  describe('GET /api/operations/roster-vs-actual', () => {
    it('should return roster vs actual utilization for authenticated users', async () => {
      const response = await request(app)
        .get('/api/operations/roster-vs-actual')
        .set('Authorization', mockAuthHeader);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty('utilization_pct');
      expect(response.body.data).toHaveProperty('processes');
      expect(Array.isArray(response.body.data.processes)).toBe(true);

      if (response.body.data.processes.length > 0) {
        const proc = response.body.data.processes[0];
        expect(proc).toHaveProperty('process_name');
        expect(proc).toHaveProperty('planned_headcount');
        expect(proc).toHaveProperty('actual_logged_in');
        expect(proc).toHaveProperty('utilization_pct');
      }
    });

    it('should return 401 for missing authorization', async () => {
      const response = await request(app)
        .get('/api/operations/roster-vs-actual');

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/operations/attrition-risk', () => {
    it('should return attrition risk scores for authenticated users', async () => {
      const response = await request(app)
        .get('/api/operations/attrition-risk')
        .set('Authorization', mockAuthHeader);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty('employees');
      expect(Array.isArray(response.body.data.employees)).toBe(true);

      if (response.body.data.employees.length > 0) {
        const emp = response.body.data.employees[0];
        expect(emp).toHaveProperty('employee_code');
        expect(emp).toHaveProperty('risk_score');
        expect(emp).toHaveProperty('signals');
        expect(Array.isArray(emp.signals)).toBe(true);
      }
    });

    it('should return 401 for missing authorization', async () => {
      const response = await request(app)
        .get('/api/operations/attrition-risk');

      expect(response.status).toBe(401);
    });

    it('should support optional threshold filter', async () => {
      const response = await request(app)
        .get('/api/operations/attrition-risk')
        .query({ minRiskScore: 50 })
        .set('Authorization', mockAuthHeader);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty('employees');
    });
  });
});
