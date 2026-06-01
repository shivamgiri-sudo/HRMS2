// backend/src/modules/communication/template.service.ts
import { randomUUID } from 'crypto';
import Handlebars from 'handlebars';
import fs from 'fs/promises';
import path from 'path';
import { db } from '../../db/mysql.js';
import { RowDataPacket } from 'mysql2';
import {
  CommunicationTemplate,
  CreateTemplateDTO,
  UpdateTemplateDTO,
  TemplateFilters,
  RenderTemplateDTO
} from './communication.types.js';

// Register Handlebars helpers
Handlebars.registerHelper('formatDate', (date: string, format: string) => {
  const d = new Date(date);
  return d.toLocaleDateString('en-IN');
});

Handlebars.registerHelper('currency', (amount: number) => {
  return `₹${amount.toLocaleString('en-IN')}`;
});

export class TemplateService {
  private templatesDir = path.join(__dirname, 'templates');
  private variableSchemas: any;

  constructor() {
    this.loadVariableSchemas();
  }

  private async loadVariableSchemas() {
    const schemasPath = path.join(this.templatesDir, 'variable-schemas.json');
    const content = await fs.readFile(schemasPath, 'utf-8');
    this.variableSchemas = JSON.parse(content);
  }

  async getTemplates(filters: TemplateFilters): Promise<CommunicationTemplate[]> {
    let query = 'SELECT * FROM communication_template WHERE 1=1';
    const params: any[] = [];

    if (filters.category) {
      query += ' AND category = ?';
      params.push(filters.category);
    }

    if (filters.channel) {
      query += ' AND channel = ?';
      params.push(filters.channel);
    }

    if (filters.is_active !== undefined) {
      query += ' AND is_active = ?';
      params.push(filters.is_active ? 1 : 0);
    }

    if (filters.search) {
      query += ' AND (name LIKE ? OR subject LIKE ?)';
      params.push(`%${filters.search}%`, `%${filters.search}%`);
    }

    query += ' ORDER BY created_at DESC';

    const [rows] = await db.execute<RowDataPacket[]>(query, params);
    return rows as CommunicationTemplate[];
  }

  async getTemplateById(id: string): Promise<CommunicationTemplate | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT * FROM communication_template WHERE id = ?',
      [id]
    );

    if (rows.length === 0) return null;
    return rows[0] as CommunicationTemplate;
  }

  async getTemplateByName(name: string): Promise<{ html: string; text?: string; category: string } | null> {
    const filePath = path.join(this.templatesDir, `${name}.hbs`);
    const textFilePath = path.join(this.templatesDir, `${name}.txt.hbs`);

    try {
      const htmlTemplate = await fs.readFile(filePath, 'utf-8');
      let textTemplate: string | undefined;

      try {
        textTemplate = await fs.readFile(textFilePath, 'utf-8');
      } catch {
        // Text version optional
      }

      const category = name.split('/')[0];
      return { html: htmlTemplate, text: textTemplate, category };
    } catch {
      const [rows] = await db.execute<RowDataPacket[]>(
        'SELECT body_html, body_text, category FROM communication_template WHERE name = ? AND is_active = 1',
        [name]
      );

      if (rows.length === 0) return null;

      return {
        html: rows[0].body_html,
        text: rows[0].body_text,
        category: rows[0].category
      };
    }
  }

  async createTemplate(data: CreateTemplateDTO): Promise<CommunicationTemplate> {
    const id = randomUUID();

    try {
      Handlebars.compile(data.body_html);
      if (data.body_text) {
        Handlebars.compile(data.body_text);
      }
    } catch (error) {
      throw new Error(`Invalid Handlebars syntax: ${error instanceof Error ? error.message : 'Unknown'}`);
    }

    await db.execute(
      `INSERT INTO communication_template
      (id, name, subject, body_html, body_text, category, channel, variables_schema, is_critical, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.name,
        data.subject || null,
        data.body_html,
        data.body_text || null,
        data.category,
        data.channel,
        data.variables_schema ? JSON.stringify(data.variables_schema) : null,
        data.is_critical ? 1 : 0,
        data.created_by
      ]
    );

    return this.getTemplateById(id) as Promise<CommunicationTemplate>;
  }

  async updateTemplate(id: string, updates: UpdateTemplateDTO): Promise<CommunicationTemplate> {
    const fields: string[] = [];
    const params: any[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      params.push(updates.name);
    }

    if (updates.subject !== undefined) {
      fields.push('subject = ?');
      params.push(updates.subject);
    }

    if (updates.body_html !== undefined) {
      Handlebars.compile(updates.body_html);
      fields.push('body_html = ?');
      params.push(updates.body_html);
    }

    if (updates.body_text !== undefined) {
      if (updates.body_text) {
        Handlebars.compile(updates.body_text);
      }
      fields.push('body_text = ?');
      params.push(updates.body_text);
    }

    if (updates.is_active !== undefined) {
      fields.push('is_active = ?');
      params.push(updates.is_active ? 1 : 0);
    }

    if (fields.length === 0) {
      throw new Error('No fields to update');
    }

    params.push(id);

    await db.execute(
      `UPDATE communication_template SET ${fields.join(', ')} WHERE id = ?`,
      params
    );

    return this.getTemplateById(id) as Promise<CommunicationTemplate>;
  }

  async deactivateTemplate(id: string): Promise<void> {
    await db.execute(
      'UPDATE communication_template SET is_active = 0 WHERE id = ?',
      [id]
    );
  }

  async renderTemplate(dto: RenderTemplateDTO): Promise<{ html: string; text?: string }> {
    let templateSource: { html: string; text?: string; category: string } | null = null;

    if (dto.template_id) {
      const template = await this.getTemplateById(dto.template_id);
      if (!template) throw new Error('Template not found');
      templateSource = {
        html: template.body_html,
        text: template.body_text || undefined,
        category: template.category
      };
    } else if (dto.template_name) {
      templateSource = await this.getTemplateByName(dto.template_name);
      if (!templateSource) throw new Error('Template not found');
    } else {
      throw new Error('Either template_id or template_name required');
    }

    const htmlTemplate = Handlebars.compile(templateSource.html);
    const html = htmlTemplate(dto.data);

    let text: string | undefined;
    if (templateSource.text) {
      const textTemplate = Handlebars.compile(templateSource.text);
      text = textTemplate(dto.data);
    }

    return { html, text };
  }

  getVariableSchema(category: string): any {
    return this.variableSchemas[category] || {};
  }
}

export const templateService = new TemplateService();
