import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { getEmployeeForUser, hasProcessScope, hasRole } from '../../shared/accessGuard.js';
import { rosterCapacityService } from './roster-capacity.service.js';

type Request = AuthenticatedRequest;

const SCOPED_ROSTER_ROLES = ['wfm', 'process_manager'];

async function assertProcessScope(req: Request, processId: string | null | undefined): Promise<boolean> {
  const userId = req.authUser!.id;
  if (await hasRole(userId, 'admin', 'hr')) return true;
  return Boolean(processId) && hasProcessScope(userId, processId!, null, ...SCOPED_ROSTER_ROLES);
}

async function ownEmployeeProcessId(employeeId: string): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT process_id FROM employees WHERE id = ? LIMIT 1',
    [employeeId],
  );
  return (rows[0] as { process_id?: string } | undefined)?.process_id ?? null;
}

async function notificationOwnerId(notificationId: string): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT employee_id FROM weekoff_preference_notification WHERE id = ? LIMIT 1',
    [notificationId],
  );
  return (rows[0] as { employee_id?: string } | undefined)?.employee_id ?? null;
}

export const rosterCapacityController = {
  // ========== Capacity Config ==========
  async getCapacityConfig(req: Request, res: Response) {
    try {
      const { processId, dayOfWeek } = req.params;
      const config = await rosterCapacityService.getCapacityConfig(
        processId,
        parseInt(dayOfWeek)
      );

      if (!config) {
        return res.status(404).json({ error: 'Capacity config not found' });
      }

      res.json(config);
    } catch (error: unknown) {
      const err = error as Error;
      res.status(500).json({ error: err.message });
    }
  },

  async updateCapacityConfig(req: Request, res: Response) {
    try {
      const { processId, dayOfWeek } = req.params;
      // processId was trusted straight from the URL with no check that the caller
      // (role-gated to wfm/admin, but not scope-checked) actually owns that process.
      if (!(await assertProcessScope(req, processId))) {
        return res.status(403).json({ error: 'Not authorized for this process' });
      }
      const updates = req.body;

      const config = await rosterCapacityService.updateCapacityConfig(
        processId,
        parseInt(dayOfWeek),
        updates
      );

      res.json(config);
    } catch (error: unknown) {
      const err = error as Error;
      res.status(500).json({ error: err.message });
    }
  },

  // ========== Capacity Checking ==========
  async checkCapacity(req: Request, res: Response) {
    try {
      const { processId } = req.params;
      const { allocationDate, dayOfWeek } = req.query;

      if (!allocationDate || !dayOfWeek) {
        return res.status(400).json({ error: 'allocationDate and dayOfWeek required' });
      }

      const result = await rosterCapacityService.checkCapacity(
        processId,
        allocationDate as string,
        parseInt(dayOfWeek as string)
      );

      res.json(result);
    } catch (error: unknown) {
      const err = error as Error;
      res.status(500).json({ error: err.message });
    }
  },

  // ========== Allocation Management ==========
  async allocateWeekOff(req: Request, res: Response) {
    try {
      // process_id was trusted straight from the body with no scope check.
      if (!(await assertProcessScope(req, req.body?.process_id))) {
        return res.status(403).json({ error: 'Not authorized for this process' });
      }
      const allocation = await rosterCapacityService.allocateWeekOff(req.body);
      res.json(allocation);
    } catch (error: unknown) {
      const err = error as Error;
      res.status(400).json({ error: err.message });
    }
  },

  async getAllocations(req: Request, res: Response) {
    try {
      const allocations = await rosterCapacityService.getAllocations(req.query);
      res.json(allocations);
    } catch (error: unknown) {
      const err = error as Error;
      res.status(500).json({ error: err.message });
    }
  },

  // ========== Notifications ==========
  async getNotifications(req: Request, res: Response) {
    try {
      const { employeeId } = req.params;
      // No auth check beyond requireAuth existed here at all, despite the route
      // comment reading "Employee can view own" — any authenticated user could read
      // any other employee's week-off notification history by id.
      if (!(await hasRole(req.authUser!.id, 'admin', 'hr', 'wfm'))) {
        const caller = await getEmployeeForUser(req.authUser!.id);
        if (!caller || caller.id !== employeeId) {
          return res.status(403).json({ error: 'Not authorized to view this employee\'s notifications' });
        }
      }
      const unreadOnly = req.query.unreadOnly === 'true';

      const notifications = await rosterCapacityService.getNotifications(
        employeeId,
        unreadOnly
      );

      res.json(notifications);
    } catch (error: unknown) {
      const err = error as Error;
      res.status(500).json({ error: err.message });
    }
  },

  async markNotificationRead(req: Request, res: Response) {
    try {
      const { notificationId } = req.params;
      // No ownership check at all — any authenticated user could mark any other
      // employee's notification read by id.
      if (!(await hasRole(req.authUser!.id, 'admin', 'hr', 'wfm'))) {
        const owner = await notificationOwnerId(notificationId);
        const caller = await getEmployeeForUser(req.authUser!.id);
        if (!owner || !caller || owner !== caller.id) {
          return res.status(403).json({ error: 'Not authorized to modify this notification' });
        }
      }
      await rosterCapacityService.markNotificationRead(notificationId);
      res.json({ message: 'Notification marked as read' });
    } catch (error: unknown) {
      const err = error as Error;
      res.status(500).json({ error: err.message });
    }
  },

  // ========== Week-Off Preference (Enhanced) ==========
  async submitWeekOffPreference(req: Request, res: Response) {
    try {
      // This route carries no role requirement at all (self-service by design — the
      // route comment says "Employee submit"), but employee_id and process_id were
      // trusted straight from the body: any authenticated user could submit — and,
      // depending on capacity, get auto-approved — a week-off preference for any
      // OTHER employee in any process. Self-service means the caller's own mapped
      // employee record, not whatever id they claim in the body.
      const employee = await getEmployeeForUser(req.authUser!.id);
      if (!employee) {
        return res.status(409).json({ error: 'No employee record is mapped to this account' });
      }
      const processId = await ownEmployeeProcessId(employee.id);
      if (!processId) {
        return res.status(409).json({ error: 'Your employee record has no process assigned' });
      }
      const result = await rosterCapacityService.submitWeekOffPreference({
        employee_id: employee.id,
        process_id: processId,
        preferred_day: req.body.preferred_day,
        alternate_day: req.body.alternate_day ?? null,
      });
      res.json(result);
    } catch (error: unknown) {
      const err = error as Error;
      res.status(500).json({ error: err.message });
    }
  },
};
