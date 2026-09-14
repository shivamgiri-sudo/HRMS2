import type { Request, Response } from 'express';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { templateService } from './template.service.js';
import { dispatchService } from './dispatch.service.js';
import { notificationPreferencesService } from './notification-preferences.service.js';
import {
  CreateTemplateSchema,
  UpdateTemplateSchema,
  TemplateFiltersSchema,
  SendMessageSchema,
  BulkSendSchema,
  DispatchLogFiltersSchema,
  UpdatePreferencesSchema,
  RenderTemplateSchema,
} from './communication.validation.js';

function userId(req: Request): string {
  return (req as AuthenticatedRequest).authUser?.id ?? 'system';
}

export const communicationController = {
  // Templates
  async listTemplates(req: Request, res: Response) {
    try {
      const filters = TemplateFiltersSchema.parse(req.query);
      res.json({ success: true, data: await templateService.getTemplates(filters) });
    } catch (e) { res.status(400).json({ error: String(e) }); }
  },

  async getTemplate(req: Request, res: Response) {
    try {
      const t = await templateService.getTemplateById(req.params.id!);
      if (!t) return res.status(404).json({ error: 'Not found' });
      res.json({ success: true, data: t });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  },

  async createTemplate(req: Request, res: Response) {
    try {
      const data = CreateTemplateSchema.parse({ ...req.body, created_by: userId(req) });
      res.status(201).json({ success: true, data: await templateService.createTemplate(data) });
    } catch (e) { res.status(400).json({ error: String(e) }); }
  },

  async updateTemplate(req: Request, res: Response) {
    try {
      const updates = UpdateTemplateSchema.parse(req.body);
      res.json({ success: true, data: await templateService.updateTemplate(req.params.id!, updates) });
    } catch (e) { res.status(400).json({ error: String(e) }); }
  },

  async deleteTemplate(req: Request, res: Response) {
    try {
      await templateService.deactivateTemplate(req.params.id!);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  },

  async renderTemplate(req: Request, res: Response) {
    try {
      const dto = RenderTemplateSchema.parse(req.body);
      res.json({ success: true, data: await templateService.renderTemplate(dto) });
    } catch (e) { res.status(400).json({ error: String(e) }); }
  },

  // Dispatch
  async send(req: Request, res: Response) {
    try {
      const dto = SendMessageSchema.parse(req.body);
      res.json({ success: true, data: await dispatchService.send(dto) });
    } catch (e) { res.status(400).json({ error: String(e) }); }
  },

  async bulkSend(req: Request, res: Response) {
    try {
      const dto = BulkSendSchema.parse(req.body);
      res.json({ success: true, data: await dispatchService.bulkSend(dto) });
    } catch (e) { res.status(400).json({ error: String(e) }); }
  },

  async retryDispatch(req: Request, res: Response) {
    try {
      await dispatchService.retry(req.params.id!);
      res.status(204).send();
    } catch (e) { res.status(500).json({ error: String(e) }); }
  },

  async getLogs(req: Request, res: Response) {
    try {
      const filters = DispatchLogFiltersSchema.parse(req.query);
      res.json({ success: true, data: await dispatchService.getLogs(filters) });
    } catch (e) { res.status(400).json({ error: String(e) }); }
  },

  async getStats(req: Request, res: Response) {
    try {
      res.json({ success: true, data: await dispatchService.getStats() });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  },

  // Preferences
  async getPreferences(req: Request, res: Response) {
    try {
      const userId = (req as AuthenticatedRequest).authUser?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const { getEmployeeForUser } = await import('../../shared/accessGuard.js');
      const emp = await getEmployeeForUser(userId);
      const data = emp
        ? await notificationPreferencesService.getPreferences(emp.id)
        : await notificationPreferencesService.getUserPreferences(userId);
      res.json({ success: true, data });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  },

  async updatePreference(req: Request, res: Response) {
    try {
      const userId = (req as AuthenticatedRequest).authUser?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const { getEmployeeForUser } = await import('../../shared/accessGuard.js');
      const emp = await getEmployeeForUser(userId);
      const dto = UpdatePreferencesSchema.parse(req.body);
      const data = emp
        ? await notificationPreferencesService.updatePreference(emp.id, dto)
        : await notificationPreferencesService.updateUserPreference(userId, dto);
      res.json({ success: true, data });
    } catch (e) { res.status(400).json({ error: String(e) }); }
  },
};
