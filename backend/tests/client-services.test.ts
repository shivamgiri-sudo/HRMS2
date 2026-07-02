/**
 * Phase 1 Testing: Client Master Backend Services
 * Unit tests for client.service.ts and enhanced-portal-user.service.ts
 *
 * Run with: npm test -- client-services.test.ts
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

// Use live DB when SKIP_LIVE_DB=false, otherwise mock
const USE_LIVE_DB = process.env.SKIP_LIVE_DB === 'false';
// Portal user tests use client_user table (same concept, different name in live DB)
const USE_PORTAL_USERS = USE_LIVE_DB;

// Only mock when not using live DB. vi.mock is hoisted, but the factory
// checks USE_LIVE_DB at call time so it conditionally returns real vs mock.
vi.mock('../src/db/mysql.js', async (importOriginal) => {
  if (process.env.SKIP_LIVE_DB === 'false') {
    return importOriginal();
  }
  return {
    db: { execute: vi.fn().mockResolvedValue([[], []]) },
    pingDb: vi.fn(),
  };
});

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

// Skipped: requires a live MySQL connection for full CRUD/data-integrity coverage.
// Run manually against a local DB: npm test -- tests/client-services.test.ts
describe.skipIf(!USE_LIVE_DB)('Phase 1: Client Service Tests', () => {
  let testClientId: string;
  const testAdminId = 'test-admin-001';

  beforeAll(async () => {
    // Ensure database connection
    await db.execute('SELECT 1');
  });

  afterAll(async () => {
    // Cleanup test data
    if (testClientId) {
      await db.execute('DELETE FROM client_master WHERE id = ?', [testClientId]);
    }
    await db.execute('DELETE FROM client_master WHERE client_code LIKE ?', ['TEST_%']);
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
        client_name: 'Test Corporation Updated',
      });

      const updated = await getClient(testClientId);
      expect(updated?.client_name).toBe('Test Corporation Updated');
    });

    it('should toggle client status', async () => {
      await toggleClientStatus(testClientId, false);
      let client = await getClient(testClientId);
      expect(client?.active_status).toBeFalsy();

      await toggleClientStatus(testClientId, true);
      client = await getClient(testClientId);
      expect(client?.active_status).toBeTruthy();
    });

    it('should search clients by name', async () => {
      const clients = await listClients({ search: 'TEST_CLIENT_001' });

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

// Uses client_user table (portal_users renamed in live DB)
describe.skipIf(!USE_PORTAL_USERS)('Phase 1: Enhanced Portal User Service Tests', () => {
  let testUserId: string;
  let testClientId: string;
  const testAdminId = 'test-admin-001';

  beforeAll(async () => {
    // Create a real client_master row (client_user has FK constraint)
    const { randomUUID } = await import('crypto');
    testClientId = randomUUID();
    await db.execute(
      `INSERT INTO client_master (id, client_code, client_name, active_status) VALUES (?, 'TEST_PORTAL_CLIENT', 'Portal Test Client', 1)`,
      [testClientId]
    );
    // Create test user in client_user table
    testUserId = randomUUID();
    await db.execute(
      `INSERT INTO client_user (id, email, client_id, name, is_active, process_ids)
       VALUES (?, ?, ?, 'Test Portal User', 1, '[]')`,
      [testUserId, 'testuser@portal.com', testClientId]
    );
  });

  afterAll(async () => {
    // Cleanup
    await db.execute('DELETE FROM portal_access_log WHERE client_user_id = ?', [testUserId]);
    await db.execute('DELETE FROM user_page_access WHERE user_id = ?', [testUserId]);
    await db.execute('DELETE FROM client_user WHERE id = ?', [testUserId]);
    await db.execute('DELETE FROM client_master WHERE id = ?', [testClientId]);
  });

  describe('Portal User Management', () => {
    it('should retrieve portal user by ID', async () => {
      const user = await getEnhancedPortalUser(testUserId);

      expect(user).toBeDefined();
      expect(user?.email).toBe('testuser@portal.com');
      expect(user?.is_active).toBeTruthy();
    });

    it('should list portal users with filters', async () => {
      const users = await listEnhancedPortalUsers({ active_only: true });

      expect(Array.isArray(users)).toBe(true);
    });

    it('should update portal user details', async () => {
      await updatePortalUser(testUserId, {
        full_name: 'Test User Updated',
        designation: 'Manager',
      });

      const updated = await getEnhancedPortalUser(testUserId);
      expect(updated?.full_name).toBe('Test User Updated');
      expect(updated?.designation).toBe('Manager');
    });

    it('should deactivate portal user', async () => {
      await deactivatePortalUser(testUserId, testAdminId, 'Testing deactivation');

      const user = await getEnhancedPortalUser(testUserId);
      expect(user?.is_active).toBeFalsy();
    });

    it('should reactivate portal user', async () => {
      await reactivatePortalUser(testUserId);

      const user = await getEnhancedPortalUser(testUserId);
      expect(user?.is_active).toBeTruthy();
    });
  });

  describe('Activity Tracking', () => {
    it('should log user activity', async () => {
      await logPortalUserActivity({
        user_id: testUserId,
        action_type: 'LOGIN',
        ip_address: '192.168.1.1',
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
        ip_address: '192.168.1.1',
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

// Skipped: requires portal_users table (not present in current live DB schema).
describe.skipIf(!USE_PORTAL_USERS)('Phase 1: Integration Tests', () => {
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

    // Create portal user for this client (uses client_user table in live DB)
    const userId = (await import('crypto')).randomUUID();
    await db.execute(
      `INSERT INTO client_user (id, email, client_id, name, is_active, process_ids)
       VALUES (?, ?, ?, 'Integration Test User', 1, '[]')`,
      [userId, 'user@integration.com', client.id]
    );

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
    await db.execute('DELETE FROM portal_access_log WHERE client_user_id = ?', [userId]);
    await db.execute('DELETE FROM user_page_access WHERE user_id = ?', [userId]);
    await db.execute('DELETE FROM client_user WHERE id = ?', [userId]);
    await db.execute('DELETE FROM client_master WHERE id = ?', [client.id]);
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
