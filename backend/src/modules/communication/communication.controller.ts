// backend/src/modules/communication/communication.controller.ts
import { Request, Response, NextFunction } from 'express';
import { templateService } from './template.service.js';
import { dispatchService } from './dispatch.service.js';
import { notificationPreferencesService } from './notification-preferences.service.js';
import {
  CreateTemplateSchema,
  UpdateTemplateSchema,
  SendMessageSchema,
  BulkSendSchema,
  UpdatePreferencesSchema
} from './communication.validation.js';

export const communicationController = {
  // Templates
  async getTemplates(req: Request, res: Response, next: NextFunction) {
    try {
      const templates = await templateService.getTemplates(req.query as any);
      res.json(templates);
    } catch (error) {
      next(error);
    }
  },

  async getTemplateById(req: Request, res: Response, next: NextFunction) {
    try {
      const template = await templateService.getTemplateById(req.params.id);
      if (!template) {
        return res.status(404).json({ error: 'Template not found' });
      }
      res.json(template);
    } catch (error) {
      next(error);
    }
  },

  async createTemplate(req: Request, res: Response, next: NextFunction) {
    try {
      const validated = CreateTemplateSchema.parse(req.body);
      const template = await templateService.createTemplate(validated);
      res.status(201).json(template);
    } catch (error) {
      next(error);
    }
  },

  async updateTemplate(req: Request, res: Response, next: NextFunction) {
    try {
      const validated = UpdateTemplateSchema.parse(req.body);
      const template = await templateService.updateTemplate(req.params.id, validated);
      res.json(template);
    } catch (error) {
      next(error);
    }
  },

  async deactivateTemplate(req: Request, res: Response, next: NextFunction) {
    try {
      await templateService.deactivateTemplate(req.params.id);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },

  // Dispatch
  async sendMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const validated = SendMessageSchema.parse(req.body);
      const result = await dispatchService.send(validated);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },

  async bulkSend(req: Request, res: Response, next: NextFunction) {
    try {
      const validated = BulkSendSchema.parse(req.body);
      const result = await dispatchService.bulkSend(validated);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },

  async retryDispatch(req: Request, res: Response, next: NextFunction) {
    try {
      await dispatchService.retry(req.params.id);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },

  async getDispatchLogs(req: Request, res: Response, next: NextFunction) {
    try {
      const logs = await dispatchService.getLogs(req.query as any);
      res.json(logs);
    } catch (error) {
      next(error);
    }
  },

  async getDispatchStats(req: Request, res: Response, next: NextFunction) {
    try {
      const stats = await dispatchService.getStats();
      res.json(stats);
    } catch (error) {
      next(error);
    }
  },

  // Preferences
  async getPreferences(req: Request, res: Response, next: NextFunction) {
    try {
      const prefs = await notificationPreferencesService.getPreferences(req.params.employeeId);
      res.json(prefs);
    } catch (error) {
      next(error);
    }
  },

  async updatePreferences(req: Request, res: Response, next: NextFunction) {
    try {
      const updates = req.body.map((u: any) => UpdatePreferencesSchema.parse(u));
      await notificationPreferencesService.updatePreferences(req.params.employeeId, updates);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
};
