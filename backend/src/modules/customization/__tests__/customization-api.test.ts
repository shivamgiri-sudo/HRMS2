import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// Mock Supabase and DB before importing app
vi.mock('../../../db/supabaseAdmin.js', () => ({
  supabaseAdmin: {},
  supabaseAuthClient: { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'demo-admin-id', email: 'admin@mascallnet.com' } }, error: null }) } },
}));
vi.mock('../../../db/mysql.js', () => ({
  db: { execute: vi.fn().mockResolvedValue([[], []]), getConnection: vi.fn().mockResolvedValue([[], []]) },
  pingDb: vi.fn(),
}));

import { app } from '../../../app.js';
import { db } from '../../../db/mysql.js';

const mockExecute = db.execute as ReturnType<typeof vi.fn>;

// Sign real JWTs so isDemo is never set — role checking goes through mock DB
const JWT_SECRET = process.env.JWT_SECRET || '3547183d0910b8d3d01d1db5629d07c8e1bfe5093c5534dbde4787ce948173fe38e55030ba28fceb120d96cdbc34cc91';
const makeToken = (userId: string, email: string) =>
  jwt.sign({ sub: userId, email, iat: Math.floor(Date.now() / 1000) }, JWT_SECRET, { expiresIn: '1h' });

const fakeRule = {
  id: 'rule-test-001', rule_name: 'Test Rule', entity_type: 'leave_type',
  config_type: 'override', config_data: JSON.stringify({ max_days: 10 }),
  priority: 5, is_active: 1, scope_type: null, scope_id: null,
  created_by: 'admin-user-id', created_at: new Date().toISOString(),
};

// Integration tests for Customization API
describe('Customization API', () => {
  // Real JWTs — no demo bypass, so requireRole does proper DB role lookup
  const adminToken    = makeToken('admin-user-id',    'admin@mascallnet.com');
  const hrToken       = makeToken('hr-user-id',       'hr@mascallnet.com');
  const employeeToken = makeToken('employee-user-id', 'employee@mascallnet.com');

  let testRuleId = 'rule-test-001';

  // Map user IDs to roles — used in the mockExecute user_roles handler
  const USER_ROLES: Record<string, string> = {
    'admin-user-id':    'admin',
    'hr-user-id':       'hr',
    'employee-user-id': 'employee',
  };

  // Track pending priority updates so getRule returns updated data after update
  let _pendingPriority: number | null = null;

  beforeAll(() => {
    // Route mock responses by SQL pattern; role resolved from params
    mockExecute.mockImplementation(async (sql: string, params?: unknown[]) => {
      const s = (sql as string).replace(/\s+/g, ' ').toLowerCase();
      if (s.includes('user_roles')) {
        const userId = params?.[0] as string;
        const role = USER_ROLES[userId] ?? 'employee';
        return [[{ role_key: role }], []];
      }
      if (s.includes('select count') && s.includes('customization_rule')) {
        return [[{ total: 1 }], []];
      }
      if (s.includes('update') && s.includes('customization_rule')) {
        // Capture the priority being set (it's before the WHERE clause id param)
        const priorityIdx = (params ?? []).findIndex(p => typeof p === 'number');
        if (priorityIdx !== -1) _pendingPriority = params![priorityIdx] as number;
        return [{ affectedRows: 1 }, []];
      }
      if (s.includes('customization_rule') && s.includes('select')) {
        const hasNonExistent = (params ?? []).some(p => typeof p === 'string' && p.includes('non-existent'));
        if (hasNonExistent) return [[], []];
        const rule = _pendingPriority !== null
          ? { ...fakeRule, priority: _pendingPriority }
          : fakeRule;
        _pendingPriority = null;
        return [[rule], []];
      }
      return [{ affectedRows: 1, insertId: 1 }, []];
    });
  });

  afterAll(() => {
    delete process.env.INTERNAL_DEMO_BYPASS;
  });

  describe('POST /api/customization/rules', () => {
    it('should create rule (admin)', async () => {
      const response = await request(app)
        .post('/api/customization/rules')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ruleName: 'Test Rule',
          entityType: 'leave_type',
          configType: 'override',
          configData: { max_days: 10 },
          priority: 5,
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body.rule_name).toBe('Test Rule');

      testRuleId = response.body.id;
    });

    it('should reject creation without auth', async () => {
      const response = await request(app)
        .post('/api/customization/rules')
        .send({
          ruleName: 'Unauthorized Rule',
          entityType: 'test',
          configType: 'override',
          configData: {},
        });

      expect(response.status).toBe(401);
    });

    it('should reject creation by non-admin', async () => {
      const response = await request(app)
        .post('/api/customization/rules')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          ruleName: 'Employee Rule',
          entityType: 'test',
          configType: 'override',
          configData: {},
        });

      expect(response.status).toBe(403);
    });

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/customization/rules')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          // Missing required fields
          ruleName: 'Invalid',
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('errors');
    });
  });

  describe('GET /api/customization/rules', () => {
    it('should list rules (admin)', async () => {
      const response = await request(app)
        .get('/api/customization/rules')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should list rules (HR)', async () => {
      const response = await request(app)
        .get('/api/customization/rules')
        .set('Authorization', `Bearer ${hrToken}`);

      expect(response.status).toBe(200);
    });

    it('should reject listing by employee', async () => {
      const response = await request(app)
        .get('/api/customization/rules')
        .set('Authorization', `Bearer ${employeeToken}`);

      expect(response.status).toBe(403);
    });

    it('should filter by entity type', async () => {
      const response = await request(app)
        .get('/api/customization/rules?entityType=leave_type')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.every((r: any) => r.entity_type === 'leave_type')).toBe(true);
    });

    it('should paginate results', async () => {
      const response = await request(app)
        .get('/api/customization/rules?page=1&limit=10')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('page', 1);
      expect(response.body).toHaveProperty('limit', 10);
      expect(response.body).toHaveProperty('total');
    });
  });

  describe('GET /api/customization/rules/:id', () => {
    it('should get rule by ID (admin)', async () => {
      if (!testRuleId) return;

      const response = await request(app)
        .get(`/api/customization/rules/${testRuleId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(testRuleId);
    });

    it('should return 404 for non-existent rule', async () => {
      const response = await request(app)
        .get('/api/customization/rules/non-existent-id')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(404);
    });
  });

  describe('PATCH /api/customization/rules/:id', () => {
    it('should update rule (admin)', async () => {
      if (!testRuleId) return;

      const response = await request(app)
        .patch(`/api/customization/rules/${testRuleId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          priority: 15,
        });

      expect(response.status).toBe(200);
      expect(response.body.priority).toBe(15);
    });

    it('should reject update by HR', async () => {
      if (!testRuleId) return;

      const response = await request(app)
        .patch(`/api/customization/rules/${testRuleId}`)
        .set('Authorization', `Bearer ${hrToken}`)
        .send({
          priority: 20,
        });

      expect(response.status).toBe(403);
    });
  });

  describe('POST /api/customization/rules/:id/toggle', () => {
    it('should toggle rule active status (admin)', async () => {
      if (!testRuleId) return;

      const response = await request(app)
        .post(`/api/customization/rules/${testRuleId}/toggle`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('is_active');
    });
  });

  describe('GET /api/customization/effective', () => {
    it('should get effective config for employee', async () => {
      const response = await request(app)
        .get('/api/customization/effective?employeeId=test-id&entityType=leave_type')
        .set('Authorization', `Bearer ${employeeToken}`);

      // May fail validation (UUID required) but should not crash
      expect([200, 400]).toContain(response.status);
    });

    it('should require employeeId', async () => {
      const response = await request(app)
        .get('/api/customization/effective?entityType=leave_type')
        .set('Authorization', `Bearer ${employeeToken}`);

      expect(response.status).toBe(400);
    });
  });

  describe('DELETE /api/customization/rules/:id', () => {
    it('should delete rule (admin)', async () => {
      if (!testRuleId) return;

      const response = await request(app)
        .delete(`/api/customization/rules/${testRuleId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(204);
    });

    it('should reject delete by HR', async () => {
      const response = await request(app)
        .delete('/api/customization/rules/some-id')
        .set('Authorization', `Bearer ${hrToken}`);

      expect(response.status).toBe(403);
    });
  });
});
