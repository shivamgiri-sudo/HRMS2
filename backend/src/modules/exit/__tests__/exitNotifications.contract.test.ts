import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db/mysql.js', () => ({ db: { execute: vi.fn() } }));
vi.mock('../../communication/notification.gateway.js', () => ({
  notificationGateway: { notify: vi.fn().mockResolvedValue({ outcome: 'sent' }) },
}));

import { db } from '../../../db/mysql.js';
import { notificationGateway } from '../../communication/notification.gateway.js';
import {
  notifyResignationSubmittedToManager,
  notifyManagerDecision,
  notifyAutoExited,
  notifyFFApproved,
  notifyResignationRevoked,
} from '../exit.notifications.js';

const mockDb = db as any;
const mockNotify = notificationGateway.notify as any;

describe('Exit notifications smoke tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock loadExitContext query to return a valid context
    mockDb.execute.mockResolvedValue([[{
      employee_id: 'emp-123',
      employee_code: 'EMP001',
      employee_name: 'Test Employee',
      employee_user_id: 'employee-456',
      last_working_day_confirmed: '2026-10-01',
      last_working_day_proposed: '2026-10-01',
      manager_user_id: 'manager-123',
      branch_id: 'branch-1',
      process_id: 'process-1',
    }]]);
  });

  it('notifyResignationSubmittedToManager dispatches to manager', async () => {
    await notifyResignationSubmittedToManager('exit-id');
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        eventCode: 'exit_resignation_submitted',
        data: expect.objectContaining({ employee_name: 'Test Employee' }),
      })
    );
  });

  it('notifyManagerDecision approved dispatches to employee', async () => {
    await notifyManagerDecision('exit-id', 'approved');
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        eventCode: 'exit_manager_approved',
        data: expect.objectContaining({ lwd: '2026-10-01' }),
      })
    );
  });

  it('notifyManagerDecision returned includes reason', async () => {
    await notifyManagerDecision('exit-id', 'returned', 'Wrong date');
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        eventCode: 'exit_manager_returned',
        data: expect.objectContaining({ return_reason: 'Wrong date' }),
      })
    );
  });

  it('notifyAutoExited dispatches to manager', async () => {
    await notifyAutoExited('exit-id');
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        eventCode: 'exit_auto_exited',
        data: expect.objectContaining({ employee_name: 'Test Employee' }),
      })
    );
  });

  it('notifyFFApproved dispatches to employee with net payable', async () => {
    await notifyFFApproved('exit-id', 50000);
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        eventCode: 'exit_ff_approved',
        data: expect.objectContaining({ net_payable: '50,000' }),
      })
    );
  });

  it('notifyResignationRevoked dispatches to manager', async () => {
    await notifyResignationRevoked('exit-id', 'Changed mind');
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        eventCode: 'exit_revoked',
        data: expect.objectContaining({
          employee_name: 'Test Employee',
          revoke_reason: 'Changed mind',
        }),
      })
    );
  });
});
