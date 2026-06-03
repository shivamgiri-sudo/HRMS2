/**
 * Phase 1 Testing: Client Master Backend Services
 * Unit tests for client.service.ts and enhanced-portal-user.service.ts
 *
 * Run with: npm test -- client-services.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { db } from '../src/db/mysql.js';
import {
  listClients,
  getClient,
  createClient,
  updateClient,
  toggleClientStatus,
  getClientStats,
  getClientUsageSummary,
  type CreateClientInput
} from '../src/modules/portal/client.service.js';
import {
  getEnhancedPortalUser,
  listEnhancedPortalUsers,
  updatePortalUser,
  deactivatePortalUser,
  reactivatePortalUser,
  logPortalUserActivity,
  getPortalUserActivity,
  grantPermission,
  revokePermission,
  getUserPermissions,
  getUserActivitySummary
} from '../src/modules/portal/enhanced-portal-user.service.js';

describe('Phase 1: Client Service Tests', () => {
  let testClientId: string;
  const testAdminId = 'test-admin-001';

  beforeAll(async () => {
    // Ensure database connection
    await db.execute('SELECT 1');
  });

  afterAll(async () => {
    // Cleanup test data
    if (testClientId) {
      await db.execute('DELETE FROM clients WHERE id = ?', [testClientId]);
    }
    await db.execute('DELETE FROM clients WHERE client_code LIKE ?', ['TEST_%']);
  });

  describe('Client CRUD Operations', () => {
    it('should create a new client', async () => {
      const clientData: CreateClientInput = {
        client_code: 'TEST_CLIENT_001',
        client_name: 'Test Corporation',
        legal_entity_name: 'Test Corp Private Limited',
        industry: 'Technology',
        primary_contact_name: 'John Doe',
        primary_contact_email: 'john.doe@testcorp.com',
        primary_contact_phone: '+91-9876543210',
        city: 'Mumbai',
        country: 'India',
        billing_cycle: 'MONTHLY',
      };

      const client = await createClient(clientData, testAdminId);

      expect(client).toBeDefined();
      expect(client.client_code).toBe('TEST_CLIENT_001');
      expect(client.client_name).toBe('Test Corporation');
      expect(client.subscription_status).toBe('ACTIVE');

      testClientId = client.id;
    });

    it('should retrieve a client by ID', async () => {
      const client = await getClient(testClientId);

      expect(client).toBeDefined();
      expect(client?.id).toBe(testClientId);
      expect(client?.client_code).toBe('TEST_CLIENT_001');
    });

    it('should list clients with filters', async () => {
      const clients = await listClients({ active_only: true });

      expect(Array.isArray(clients)).toBe(true);
      expect(clients.length).toBeGreaterThan(0);
      const testClient = clients.find(c => c.id === testClientId);
      expect(testClient).toBeDefined();
    });

    it('should update client details', async () => {
      await updateClient(testClientId, {
        primary_contact_email: 'updated@testcorp.com',
        website: 'https://testcorp.com'
      });

      const updated = await getClient(testClientId);
      expect(updated?.primary_contact_email).toBe('updated@testcorp.com');
      expect(updated?.website).toBe('https://testcorp.com');
    });

    it('should toggle client status', async () => {
      await toggleClientStatus(testClientId, false);
      let client = await getClient(testClientId);
      expect(client?.active_status).toBe(false);

      await toggleClientStatus(testClientId, true);
      client = await getClient(testClientId);
      expect(client?.active_status).toBe(true);
    });

    it('should search clients by name', async () => {
      const clients = await listClients({ search: 'Test Corporation' });

      expect(clients.length).toBeGreaterThan(0);
      const found = clients.find(c => c.client_code === 'TEST_CLIENT_001');
      expect(found).toBeDefined();
    });
  });

  describe('Client Analytics', () => {
    it('should get client statistics', async () => {
      const stats = await getClientStats();

      expect(stats).toBeDefined();
      expect(typeof stats.total_clients).toBe('number');
      expect(typeof stats.active_clients).toBe('number');
      expect(stats.total_clients).toBeGreaterThanOrEqual(stats.active_clients);
    });

    it('should get client usage summary', async () => {
      const summary = await getClientUsageSummary(30);

      expect(Array.isArray(summary)).toBe(true);
      // Summary might be empty if no usage data yet
    });
  });
});

describe('Phase 1: Enhanced Portal User Service Tests', () => {
  let testUserId: string;
  const testClientId = 'test-client-001';
  const testAdminId = 'test-admin-001';

  beforeAll(async () => {
    // Create test user
    const [result] = await db.execute(
      `INSERT INTO portal_users (id, email, client_id, is_active, process_ids, access_level)
       VALUES (UUID(), ?, ?, 1, '[]', 'READ_ONLY')`,
      ['testuser@portal.com', testClientId]
    ) as any;

    testUserId = result.insertId.toString();
  });

  afterAll(async () => {
    // Cleanup
    await db.execute('DELETE FROM portal_user_activity_log WHERE user_id = ?', [testUserId]);
    await db.execute('DELETE FROM portal_user_permissions WHERE user_id = ?', [testUserId]);
    await db.execute('DELETE FROM portal_users WHERE id = ?', [testUserId]);
  });

  describe('Portal User Management', () => {
    it('should retrieve portal user by ID', async () => {
      const user = await getEnhancedPortalUser(testUserId);

      expect(user).toBeDefined();
      expect(user?.email).toBe('testuser@portal.com');
      expect(user?.access_level).toBe('READ_ONLY');
    });

    it('should list portal users with filters', async () => {
      const users = await listEnhancedPortalUsers({ active_only: true });

      expect(Array.isArray(users)).toBe(true);
    });

    it('should update portal user details', async () => {
      await updatePortalUser(testUserId, {
        full_name: 'Test User',
        phone: '+91-9876543210',
        designation: 'Manager',
        access_level: 'FULL_ACCESS'
      });

      const updated = await getEnhancedPortalUser(testUserId);
      expect(updated?.full_name).toBe('Test User');
      expect(updated?.designation).toBe('Manager');
      expect(updated?.access_level).toBe('FULL_ACCESS');
    });

    it('should deactivate portal user', async () => {
      await deactivatePortalUser(testUserId, testAdminId, 'Testing deactivation');

      const user = await getEnhancedPortalUser(testUserId);
      expect(user?.is_active).toBe(false);
      expect(user?.deactivated_by).toBe(testAdminId);
      expect(user?.deactivation_reason).toBe('Testing deactivation');
    });

    it('should reactivate portal user', async () => {
      await reactivatePortalUser(testUserId);

      const user = await getEnhancedPortalUser(testUserId);
      expect(user?.is_active).toBe(true);
      expect(user?.deactivated_by).toBeNull();
    });
  });

  describe('Activity Tracking', () => {
    it('should log user activity', async () => {
      await logPortalUserActivity({
        user_id: testUserId,
        action_type: 'LOGIN',
        resource_type: 'PORTAL',
        ip_address: '192.168.1.1',
        request_method: 'POST',
        request_path: '/api/portal/login',
        response_status: 200,
        duration_ms: 150
      });

      const activities = await getPortalUserActivity(testUserId, 10);
      expect(activities.length).toBeGreaterThan(0);

      const loginActivity = activities.find(a => a.action_type === 'LOGIN');
      expect(loginActivity).toBeDefined();
      expect(loginActivity?.ip_address).toBe('192.168.1.1');
    });

    it('should retrieve activity by action type', async () => {
      await logPortalUserActivity({
        user_id: testUserId,
        action_type: 'VIEW_REPORT',
        resource_type: 'REPORT',
        resource_id: 'report-001',
        ip_address: '192.168.1.1'
      });

      const activities = await getPortalUserActivity(testUserId, 10, 'VIEW_REPORT');
      expect(activities.length).toBeGreaterThan(0);
      expect(activities.every(a => a.action_type === 'VIEW_REPORT')).toBe(true);
    });
  });

  describe('Permission Management', () => {
    it('should grant permission to user', async () => {
      await grantPermission({
        user_id: testUserId,
        permission_type: 'VIEW_REPORTS',
        resource_scope: 'ALL',
        granted_by: testAdminId
      });

      const permissions = await getUserPermissions(testUserId);
      expect(permissions.length).toBeGreaterThan(0);

      const viewReports = permissions.find(p => p.permission_type === 'VIEW_REPORTS');
      expect(viewReports).toBeDefined();
      expect(viewReports?.resource_scope).toBe('ALL');
    });

    it('should grant permission with resource scope', async () => {
      await grantPermission({
        user_id: testUserId,
        permission_type: 'DOWNLOAD_DATA',
        resource_scope: 'PROCESS_SPECIFIC',
        resource_ids: ['process-001', 'process-002'],
        granted_by: testAdminId
      });

      const permissions = await getUserPermissions(testUserId);
      const downloadPerm = permissions.find(p => p.permission_type === 'DOWNLOAD_DATA');

      expect(downloadPerm).toBeDefined();
      expect(downloadPerm?.resource_scope).toBe('PROCESS_SPECIFIC');
      expect(Array.isArray(downloadPerm?.resource_ids)).toBe(true);
    });

    it('should revoke permission', async () => {
      await revokePermission(testUserId, 'VIEW_REPORTS');

      const permissions = await getUserPermissions(testUserId);
      const viewReports = permissions.find(p => p.permission_type === 'VIEW_REPORTS');

      expect(viewReports).toBeUndefined();
    });
  });

  describe('User Analytics', () => {
    it('should get user activity summary', async () => {
      // Log some activities first
      await logPortalUserActivity({
        user_id: testUserId,
        action_type: 'API_CALL',
        resource_type: 'API',
        ip_address: '192.168.1.1'
      });

      const summary = await getUserActivitySummary(testClientId, 30);

      expect(Array.isArray(summary)).toBe(true);
    });
  });
});

describe('Phase 1: Integration Tests', () => {
  it('should handle client creation and portal user assignment', async () => {
    // Create client
    const clientData: CreateClientInput = {
      client_code: 'TEST_INTEGRATION_001',
      client_name: 'Integration Test Corp',
      primary_contact_email: 'contact@integration.com',
      billing_cycle: 'MONTHLY'
    };

    const client = await createClient(clientData, 'admin');
    expect(client).toBeDefined();

    // Create portal user for this client
    const [userResult] = await db.execute(
      `INSERT INTO portal_users (id, email, client_id, is_active, process_ids)
       VALUES (UUID(), ?, ?, 1, '[]')`,
      ['user@integration.com', client.id]
    ) as any;

    const userId = userResult.insertId.toString();

    // Grant permissions
    await grantPermission({
      user_id: userId,
      permission_type: 'VIEW_REPORTS',
      resource_scope: 'ALL',
      granted_by: 'admin'
    });

    // Log activity
    await logPortalUserActivity({
      user_id: userId,
      action_type: 'LOGIN',
      ip_address: '192.168.1.1'
    });

    // Verify user has access
    const permissions = await getUserPermissions(userId);
    expect(permissions.length).toBeGreaterThan(0);

    const activities = await getPortalUserActivity(userId);
    expect(activities.length).toBeGreaterThan(0);

    // Cleanup
    await db.execute('DELETE FROM portal_user_activity_log WHERE user_id = ?', [userId]);
    await db.execute('DELETE FROM portal_user_permissions WHERE user_id = ?', [userId]);
    await db.execute('DELETE FROM portal_users WHERE id = ?', [userId]);
    await db.execute('DELETE FROM clients WHERE id = ?', [client.id]);
  });
});

describe('Phase 1: Error Handling', () => {
  it('should handle non-existent client gracefully', async () => {
    const client = await getClient('non-existent-id');
    expect(client).toBeNull();
  });

  it('should handle non-existent user gracefully', async () => {
    const user = await getEnhancedPortalUser('non-existent-id');
    expect(user).toBeNull();
  });

  it('should handle empty activity log', async () => {
    const activities = await getPortalUserActivity('non-existent-user');
    expect(Array.isArray(activities)).toBe(true);
    expect(activities.length).toBe(0);
  });
});
