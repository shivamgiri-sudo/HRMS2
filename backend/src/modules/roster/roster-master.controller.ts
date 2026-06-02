import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { rosterMasterService } from './roster-master.service.js';

type Request = AuthenticatedRequest;

export const rosterMasterController = {
  // ========== Templates ==========
  async createTemplate(req: Request, res: Response) {
    const template = await rosterMasterService.createTemplate({
      ...req.body,
      created_by: req.authUser?.id,
    });
    res.status(201).json(template);
  },

  async listTemplates(req: Request, res: Response) {
    const { process_id, is_active } = req.query;

    const templates = await rosterMasterService.listTemplates({
      process_id: process_id as string,
      is_active: is_active === 'true' ? true : is_active === 'false' ? false : undefined,
    });

    res.json({ data: templates });
  },

  async getTemplate(req: Request, res: Response) {
    const template = await rosterMasterService.getTemplateById(req.params.id);

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json(template);
  },

  async updateTemplate(req: Request, res: Response) {
    const template = await rosterMasterService.updateTemplate(req.params.id, req.body);
    res.json(template);
  },

  async deleteTemplate(req: Request, res: Response) {
    await rosterMasterService.deleteTemplate(req.params.id);
    res.status(204).send();
  },

  // ========== Week-Off Preferences ==========
  async createWeekOffPreference(req: Request, res: Response) {
    const preference = await rosterMasterService.createWeekOffPreference({
      employee_id: req.authUser?.id!,
      preferred_day: req.body.preferred_day,
      alternate_day: req.body.alternate_day,
    });

    res.status(201).json(preference);
  },

  async getMyWeekOffPreference(req: Request, res: Response) {
    const preference = await rosterMasterService.getWeekOffPreference(req.authUser?.id!);

    if (!preference) {
      return res.status(404).json({ error: 'No preference found' });
    }

    res.json(preference);
  },

  async listWeekOffPreferences(req: Request, res: Response) {
    const { approved, process_id } = req.query;

    const preferences = await rosterMasterService.listWeekOffPreferences({
      approved: approved === 'true' ? true : approved === 'false' ? false : undefined,
      process_id: process_id as string,
    });

    res.json({ data: preferences });
  },

  async approveWeekOffPreference(req: Request, res: Response) {
    const preference = await rosterMasterService.approveWeekOffPreference(
      req.params.employee_id,
      req.authUser?.id!
    );

    res.json(preference);
  },

  // ========== Auto-Roster Generation ==========
  async generateRoster(req: Request, res: Response) {
    const result = await rosterMasterService.generateRoster({
      template_id: req.body.template_id,
      process_id: req.body.process_id,
      start_date: req.body.start_date,
      end_date: req.body.end_date,
      employee_ids: req.body.employee_ids,
      apply_preferences: req.body.apply_preferences ?? true,
    });

    res.json(result);
  },

  // ========== Validation ==========
  async validateSupportRatio(req: Request, res: Response) {
    const { process_id, date } = req.query;

    if (!process_id || !date) {
      return res.status(400).json({ error: 'process_id and date are required' });
    }

    const result = await rosterMasterService.validateSupportRatio(
      process_id as string,
      date as string
    );

    res.json(result);
  },
};
