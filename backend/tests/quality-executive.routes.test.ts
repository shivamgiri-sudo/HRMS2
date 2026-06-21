import { describe, it, expect } from '@jest/globals';
import request from 'supertest';
import { app } from '../src/app';

describe('Executive Quality Routes', () => {
  const ceoToken = 'mock-token-ceo';
  const adminToken = 'mock-token-admin';
  const qaToken = 'mock-token-qa';

  describe('GET /api/executive/quality-summary', () => {
    it('should return org-wide quality summary for authenticated CEO', async () => {
      const response = await request(app)
        .get('/api/executive/quality-summary')
        .set('Authorization', `Bearer ${ceoToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toHaveProperty('metrics');
      expect(response.body.data).toHaveProperty('top_performers');
      expect(response.body.data).toHaveProperty('bottom_performers');
      expect(response.body.data).toHaveProperty('process_performance');
      expect(response.body.data).toHaveProperty('risk_summary');
      expect(response.body.data).toHaveProperty('org_benchmarks');
      expect(response.body.data).toHaveProperty('last_updated');

      const data = response.body.data;
      expect(data.metrics).toHaveProperty('overall_quality_score');
      expect(data.metrics).toHaveProperty('target_quality_score');
      expect(data.metrics).toHaveProperty('gap_pct');
      expect(data.metrics).toHaveProperty('status');
      expect(data.metrics).toHaveProperty('trend_7day');
      expect(data.metrics).toHaveProperty('trend_30day');

      expect(Array.isArray(data.top_performers)).toBe(true);
      expect(Array.isArray(data.bottom_performers)).toBe(true);
      expect(Array.isArray(data.process_performance)).toBe(true);
      expect(data.risk_summary).toHaveProperty('critical_agents_count');
      expect(data.risk_summary).toHaveProperty('at_risk_agents_count');
    });

    it('should allow admin role to access quality summary', async () => {
      const response = await request(app)
        .get('/api/executive/quality-summary')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty('metrics');
    });

    it('should return 403 for non-executive roles (QA)', async () => {
      const response = await request(app)
        .get('/api/executive/quality-summary')
        .set('Authorization', `Bearer ${qaToken}`);

      expect(response.status).toBe(403);
    });

    it('should return 401 for missing authorization header', async () => {
      const response = await request(app)
        .get('/api/executive/quality-summary');

      expect(response.status).toBe(401);
    });

    it('should support daysBack query parameter', async () => {
      const response = await request(app)
        .get('/api/executive/quality-summary?daysBack=60')
        .set('Authorization', `Bearer ${ceoToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.filter.daysBack).toBe(60);
    });

    it('should return top 10 and bottom 10 performers', async () => {
      const response = await request(app)
        .get('/api/executive/quality-summary')
        .set('Authorization', `Bearer ${ceoToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.top_performers.length).toBeLessThanOrEqual(10);
      expect(response.body.data.bottom_performers.length).toBeLessThanOrEqual(10);

      // Each performer should have required fields
      if (response.body.data.top_performers.length > 0) {
        const performer = response.body.data.top_performers[0];
        expect(performer).toHaveProperty('rank');
        expect(performer).toHaveProperty('agent_code');
        expect(performer).toHaveProperty('agent_name');
        expect(performer).toHaveProperty('quality_score');
        expect(performer).toHaveProperty('calls_handled');
      }
    });
  });
});
