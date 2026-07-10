import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getIstDateString } from '../../utils/dateUtils.js';

function interpolate(template: string, vars: Record<string, string | null>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

export const lettersService = {
  async getById(letterId: string): Promise<{ id: string; employee_id: string; letter_type: string } | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT id, employee_id, letter_type FROM generated_letter WHERE id = ? LIMIT 1",
      [letterId]
    );
    return (rows as RowDataPacket[])[0] as { id: string; employee_id: string; letter_type: string } ?? null;
  },

  async listTemplates() {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT id, template_code, template_name, letter_type FROM letter_template WHERE active_status = 1 ORDER BY letter_type"
    );
    return rows as RowDataPacket[];
  },

  async generateLetter(data: {
    employee_id: string;
    template_code: string;
    generated_by: string;
    issued_date?: string;
    override_vars?: Record<string, string>;
  }) {
    // Fetch template
    const [tplRows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM letter_template WHERE template_code = ? AND active_status = 1 LIMIT 1",
      [data.template_code]
    );
    const template = (tplRows as RowDataPacket[])[0];
    if (!template) throw Object.assign(new Error(`Template not found: ${data.template_code}`), { statusCode: 404 });

    // Fetch employee data for interpolation
    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT e.*, d.designation_name, s.ctc_annual
       FROM employees e
       LEFT JOIN designation_master d ON d.id = e.designation_id
       LEFT JOIN employee_salary_assignment s ON s.employee_id = e.id AND s.active_status = 1
       WHERE e.id = ? LIMIT 1`,
      [data.employee_id]
    );
    const emp = (empRows as RowDataPacket[])[0];
    if (!emp) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });

    const vars: Record<string, string | null> = {
      full_name: emp.full_name ?? `${emp.first_name} ${emp.last_name ?? ""}`.trim(),
      employee_code: emp.employee_code,
      designation: emp.designation_name ?? "",
      date_of_joining: emp.date_of_joining ?? "",
      date_of_exit: emp.date_of_exit ?? "",
      ctc_annual: emp.ctc_annual ? String(emp.ctc_annual) : "",
      effective_date: data.issued_date ?? getIstDateString(),
      ...data.override_vars,
    };

    const generatedText = interpolate(template.body_template as string, vars);
    const id = randomUUID();

    await db.execute(
      `INSERT INTO generated_letter
         (id, employee_id, template_id, letter_type, generated_text, generated_by, issued_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, data.employee_id, template.id, template.letter_type, generatedText,
       data.generated_by, data.issued_date ?? null]
    );

    return { id, letter_type: template.letter_type, generated_text: generatedText };
  },

  async listGenerated(employeeId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT gl.id, gl.letter_type, gl.issued_date, gl.acknowledged_at, gl.created_at,
              lt.template_name
       FROM generated_letter gl
       JOIN letter_template lt ON lt.id = gl.template_id
       WHERE gl.employee_id = ? ORDER BY gl.created_at DESC`,
      [employeeId]
    );
    return rows as RowDataPacket[];
  },

  async acknowledge(letterId: string) {
    await db.execute("UPDATE generated_letter SET acknowledged_at = NOW() WHERE id = ?", [letterId]);
  },
};
