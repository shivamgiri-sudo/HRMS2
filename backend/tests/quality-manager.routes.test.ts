import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { app } from '../src/app';

describe('Manager Quality Routes', () => {
  const managerToken = 'mock-token-process_manager';
  const teamLeaderToken = 'mock-token-team_leader';
  const agentToken = 'mock-token-employee';

  describe('GET /api/manager/team-quality', () => {
    it('should return team quality summary for authenticated RM/TL', async () => {
      const response = await request(app)
        .get('/api/manager/team-quality')
        .set('Authorization', `Bearer ${managerToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('team_summary');
      expect(response.body).toHaveProperty('agent_breakdown');
      expect(response.body).toHaveProperty('last_updated');

      if (response.body.team_summary) {
        expect(response.body.team_summary).toHaveProperty('avg_quality');
        expect(response.body.team_summary).toHaveProperty('agent_count');
        expect(response.body.team_summary).toHaveProperty('calls_handled');
        expect(response.body.team_summary).toHaveProperty('quality_distribution');
      }

      expect(Array.isArray(response.body.agent_breakdown)).toBe(true);
    });

    it('should accept team_leader role and return valid data', async () => {
      const response = await request(app)
        .get('/api/manager/team-quality')
        .set('Authorization', `Bearer ${teamLeaderToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('team_summary');
      expect(response.body).toHaveProperty('agent_breakdown');
    });

    it('should return 403 for non-manager roles', async () => {
      const response = await request(app)
        .get('/api/manager/team-quality')
        .set('Authorization', `Bearer ${agentToken}`);

      expect(response.status).toBe(403);
    });

    it('should return 401 for missing authorization header', async () => {
      const response = await request(app)
        .get('/api/manager/team-quality');

      expect(response.status).toBe(401);
    });

    it('should support daysBack query parameter', async () => {
      const response = await request(app)
        .get('/api/manager/team-quality?daysBack=30')
        .set('Authorization', `Bearer ${managerToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('team_summary');
    });

    it('should support process query parameter', async () => {
      const response = await request(app)
        .get('/api/manager/team-quality?process=INBOUND')
        .set('Authorization', `Bearer ${managerToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('team_summary');
    });
  });
});
