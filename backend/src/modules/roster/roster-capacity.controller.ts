import type { Request, Response } from 'express';
import { rosterCapacityService } from './roster-capacity.service.js';

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
      const result = await rosterCapacityService.submitWeekOffPreference(req.body);
      res.json(result);
    } catch (error: unknown) {
      const err = error as Error;
      res.status(500).json({ error: err.message });
    }
  },
};
