import { describe, it, expect } from '@jest/globals';
import request from 'supertest';
import { app } from '../src/app';

describe('QA Manager Quality Routes', () => {
  const qaToken = 'mock-token-qa';
  const managerToken = 'mock-token-process_manager';

  describe('GET /api/qa/quality-audit', () => {
    it('should return quality audit summary for authenticated QA', async () => {
      const response = await request(app)
        .get('/api/qa/quality-audit')
        .set('Authorization', `Bearer ${qaToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toHaveProperty('summary');
      expect(response.body.data).toHaveProperty('process_metrics');
      expect(response.body.data).toHaveProperty('anomalies');
      expect(response.body.data).toHaveProperty('risk_matrix');
      expect(response.body.data).toHaveProperty('last_updated');

      const data = response.body.data;
      expect(data.summary).toHaveProperty('total_calls_audited');
      expect(data.summary).toHaveProperty('avg_quality_score');
      expect(data.summary).toHaveProperty('compliance_rate');
      expect(data.summary).toHaveProperty('audit_period');

      expect(Array.isArray(data.process_metrics)).toBe(true);
      expect(Array.isArray(data.anomalies)).toBe(true);
    });

    it('should return 403 for non-QA roles', async () => {
      const response = await request(app)
        .get('/api/qa/quality-audit')
        .set('Authorization', `Bearer ${managerToken}`);

      expect(response.status).toBe(403);
    });

    it('should return 401 for missing authorization header', async () => {
      const response = await request(app)
        .get('/api/qa/quality-audit');

      expect(response.status).toBe(401);
    });

    it('should support daysBack query parameter', async () => {
      const response = await request(app)
        .get('/api/qa/quality-audit?daysBack=14')
        .set('Authorization', `Bearer ${qaToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.filter.daysBack).toBe(14);
    });

    it('should support process query parameter', async () => {
      const response = await request(app)
        .get('/api/qa/quality-audit?process=INBOUND')
        .set('Authorization', `Bearer ${qaToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.filter.process).toBe('INBOUND');
    });
  });
});
