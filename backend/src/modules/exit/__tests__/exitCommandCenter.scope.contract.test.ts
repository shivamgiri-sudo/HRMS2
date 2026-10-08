import { describe, it, expect } from 'vitest';
import { getExitCommandCenter } from '../exit-intelligence.service.js';

describe('getExitCommandCenter branch scoping', () => {
  it('super_admin call resolves without error', async () => {
    const result = await getExitCommandCenter({
      actorUserId: 'test-super-admin-id',
      actorRoles: ['super_admin'],
    });
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('requests');
    expect(Array.isArray(result.requests)).toBe(true);
  });

  it('payroll_head call resolves without error', async () => {
    const result = await getExitCommandCenter({
      actorUserId: 'test-payroll-head-id',
      actorRoles: ['payroll_head'],
    });
    expect(result).toHaveProperty('requests');
  });

  it('user with no scope rows gets empty or valid result', async () => {
    const result = await getExitCommandCenter({
      actorUserId: '00000000-0000-0000-0000-000000000001',
      actorRoles: ['hr'],
    });
    // A scoped user with no user_assignment_scope rows gets scopeWhere='1=0'.
    // The function must resolve (not throw) and the requests list must be an empty array.
    expect(Array.isArray(result.requests)).toBe(true);
    expect(result.requests.length).toBe(0);
  });
});
