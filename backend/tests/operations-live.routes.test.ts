import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import type { Express } from 'express';

let app: Express;
const mockAuthHeader = 'Bearer mock-token-admin';

describe('Operations Live Status Routes', () => {
  beforeAll(async () => {
    // Import app after environment is set
    const { app: expressApp } = await import('../src/app.js');
    app = expressApp;
  });

  describe('GET /api/operations/live-status', () => {
    it('should return live agent status for authenticated OPERATIONS/ADMIN users', async () => {
      const response = await request(app)
        .get('/api/operations/live-status')
        .set('Authorization', mockAuthHeader);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('agents');
      expect(response.body).toHaveProperty('summary');
      expect(response.body).toHaveProperty('timestamp');
      expect(Array.isArray(response.body.agents)).toBe(true);

      if (response.body.agents.length > 0) {
        const agent = response.body.agents[0];
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
      expect(response.body).toHaveProperty('agents');
      expect(Array.isArray(response.body.agents)).toBe(true);
    });

    it('should support optional branchName filter', async () => {
      const response = await request(app)
        .get('/api/operations/live-status')
        .query({ branchName: 'HYD_MAIN' })
        .set('Authorization', mockAuthHeader);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('agents');
    });
  });

  describe('GET /api/operations/roster-vs-actual', () => {
    it('should return roster vs actual utilization for authenticated users', async () => {
      const response = await request(app)
        .get('/api/operations/roster-vs-actual')
        .set('Authorization', mockAuthHeader);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('utilization_pct');
      expect(response.body).toHaveProperty('processes');
      expect(Array.isArray(response.body.processes)).toBe(true);

      if (response.body.processes.length > 0) {
        const proc = response.body.processes[0];
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
      expect(response.body).toHaveProperty('employees');
      expect(Array.isArray(response.body.employees)).toBe(true);

      if (response.body.employees.length > 0) {
        const emp = response.body.employees[0];
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
      expect(response.body).toHaveProperty('employees');
    });
  });
});
