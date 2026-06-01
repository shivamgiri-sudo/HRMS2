import { randomUUID } from 'crypto';
import Handlebars from 'handlebars';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import type {
  CommunicationTemplate,
  CreateTemplateDTO,
  UpdateTemplateDTO,
  TemplateFilters,
  RenderTemplateDTO,
} from './communication.types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMPL_DIR = path.join(__dirname, 'templates');

// Register helpers once at module load
Handlebars.registerHelper('formatDate', (date: string) => {
  if (!date) return '';
  return new Date(date).toLocaleDateString('en-IN');
});
Handlebars.registerHelper('currency', (amount: number) => {
  return `₹${Number(amount ?? 0).toLocaleString('en-IN')}`;
});

let _schemas: Record<string, any> | null = null;
async function getVariableSchemas(): Promise<Record<string, any>> {
  if (_schemas) return _schemas;
  const raw = await fs.readFile(path.join(TMPL_DIR, 'variable-schemas.json'), 'utf-8');
  _schemas = JSON.parse(raw);
  return _schemas!;
}

async function readFileTemplate(name: string): Promise<{ html: string; text?: string; category: string }> {
  const htmlPath = path.join(TMPL_DIR, `${name}.hbs`);
  const txtPath  = path.join(TMPL_DIR, `${name}.txt.hbs`);
  const html = await fs.readFile(htmlPath, 'utf-8');
  let text: string | undefined;
  try { text = await fs.readFile(txtPath, 'utf-8'); } catch { /* optional */ }
  const category = name.split('/')[0]!;
  return { html, text, category };
}

class TemplateService {
  async getTemplates(filters: TemplateFilters): Promise<CommunicationTemplate[]> {
    let q = 'SELECT * FROM communication_template WHERE 1=1';
    const p: unknown[] = [];
    if (filters.category)              { q += ' AND category = ?';                   p.push(filters.category); }
    if (filters.channel)               { q += ' AND channel = ?';                    p.push(filters.channel); }
    if (filters.is_active !== undefined) { q += ' AND is_active = ?';                p.push(filters.is_active ? 1 : 0); }
    if (filters.search)                { q += ' AND (name LIKE ? OR subject LIKE ?)'; p.push(`%${filters.search}%`, `%${filters.search}%`); }
    q += ' ORDER BY created_at DESC';
    const [rows] = await db.execute<RowDataPacket[]>(q, p);
    return rows as CommunicationTemplate[];
  }

  async getTemplateById(id: string): Promise<CommunicationTemplate | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT * FROM communication_template WHERE id = ?', [id]
    );
    return rows[0] as CommunicationTemplate ?? null;
  }

  async getTemplateByName(name: string): Promise<{ html: string; text?: string; category: string } | null> {
    try {
      return await readFileTemplate(name);
    } catch {
      const [rows] = await db.execute<RowDataPacket[]>(
        'SELECT body_html, body_text, category FROM communication_template WHERE name = ? AND is_active = 1',
        [name]
      );
      if (!rows[0]) return null;
      const r = rows[0] as any;
      return { html: r.body_html, text: r.body_text ?? undefined, category: r.category };
    }
  }

  async createTemplate(data: CreateTemplateDTO): Promise<CommunicationTemplate> {
    try {
      Handlebars.compile(data.body_html);
      if (data.body_text) Handlebars.compile(data.body_text);
    } catch (e) {
      throw new Error(`Invalid Handlebars syntax: ${e instanceof Error ? e.message : String(e)}`);
    }
    const id = randomUUID();
    await db.execute(
      `INSERT INTO communication_template
       (id, name, subject, body_html, body_text, category, channel, variables_schema, is_critical, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.name, data.subject ?? null, data.body_html, data.body_text ?? null,
       data.category, data.channel,
       data.variables_schema ? JSON.stringify(data.variables_schema) : null,
       data.is_critical ? 1 : 0, data.created_by]
    );
    return (await this.getTemplateById(id))!;
  }

  async updateTemplate(id: string, updates: UpdateTemplateDTO): Promise<CommunicationTemplate> {
    const fields: string[] = [];
    const params: unknown[] = [];
    if (updates.name      !== undefined) { fields.push('name = ?');      params.push(updates.name); }
    if (updates.subject   !== undefined) { fields.push('subject = ?');   params.push(updates.subject); }
    if (updates.body_html !== undefined) {
      Handlebars.compile(updates.body_html);
      fields.push('body_html = ?'); params.push(updates.body_html);
    }
    if (updates.body_text !== undefined) {
      if (updates.body_text) Handlebars.compile(updates.body_text);
      fields.push('body_text = ?'); params.push(updates.body_text);
    }
    if (updates.is_active !== undefined) { fields.push('is_active = ?'); params.push(updates.is_active ? 1 : 0); }
    if (!fields.length) throw new Error('No fields to update');
    params.push(id);
    await db.execute(`UPDATE communication_template SET ${fields.join(', ')} WHERE id = ?`, params);
    return (await this.getTemplateById(id))!;
  }

  async deactivateTemplate(id: string): Promise<void> {
    await db.execute('UPDATE communication_template SET is_active = 0 WHERE id = ?', [id]);
  }

  async renderTemplate(dto: RenderTemplateDTO): Promise<{ html: string; text?: string }> {
    let source: { html: string; text?: string } | null = null;
    if (dto.template_id) {
      const t = await this.getTemplateById(dto.template_id);
      if (!t) throw new Error('Template not found');
      source = { html: t.body_html, text: t.body_text ?? undefined };
    } else if (dto.template_name) {
      source = await this.getTemplateByName(dto.template_name);
      if (!source) throw new Error('Template not found');
    } else {
      throw new Error('template_id or template_name required');
    }
    const html = Handlebars.compile(source.html)(dto.data);
    const text = source.text ? Handlebars.compile(source.text)(dto.data) : undefined;
    return { html, text };
  }

  async getVariableSchema(category: string): Promise<unknown> {
    const schemas = await getVariableSchemas();
    return schemas[category] ?? {};
  }
}

export const templateService = new TemplateService();
