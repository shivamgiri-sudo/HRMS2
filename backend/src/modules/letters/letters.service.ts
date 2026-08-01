import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getIstDateString } from '../../utils/dateUtils.js';
import { resolveAppointmentLetterSalary, toLetterRows } from "./appointmentLetterData.service.js";
import { istDate, assertUsableName } from "./letterFormat.js";

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
      "SELECT id, template_code, template_name, letter_type, description FROM letter_template WHERE active_status = 1 ORDER BY letter_type"
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
    const template = (tplRows as RowDataPacket[])[0] as any;
    if (!template) throw Object.assign(new Error(`Template not found: ${data.template_code}`), { statusCode: 404 });

    // Fetch employee data
    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT e.*, d.designation_name, dept.dept_name,
              bm.branch_name,
              CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS full_name
       FROM employees e
       LEFT JOIN designation_master d ON d.id = e.designation_id
       LEFT JOIN department_master dept ON dept.id = e.department_id
       LEFT JOIN branch_master bm ON bm.id = e.branch_id
       WHERE e.id = ? LIMIT 1`,
      [data.employee_id]
    );
    const emp = (empRows as RowDataPacket[])[0] as any;
    if (!emp) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });


    // Build data payload matching renderer variable names
    // Salary comes from the resolver, which knows the three real sources
    // (approved package -> assignment -> legacy snapshot). The fields below
    // previously read columns that do not exist on employee_salary_assignment,
    // so every line of the salary table rendered "0.00".
    const salary = await resolveAppointmentLetterSalary(data.employee_id);

    const vars: Record<string, string> = {
      full_name:         assertUsableName(emp.full_name ?? `${emp.first_name} ${emp.last_name ?? ""}`),
      employee_code:     emp.employee_code ?? "",
      designation:       emp.designation_name ?? "",
      department:        emp.dept_name ?? "",
      location:          emp.branch_name ?? "",
      date_of_joining:   istDate(emp.date_of_joining),
      date_of_exit:      istDate(emp.date_of_exit),
      issued_date:       istDate(data.issued_date ?? new Date()),
      epf_no:            emp.epf_number ?? "",
      esi_no:            emp.esic_number ?? "",
      ...toLetterRows(salary),
      ...data.override_vars,
    };

    // generated_text stores a JSON blob so the renderer can re-hydrate later
    const generatedText = JSON.stringify({ type: template.letter_type, data: vars });
    const id = randomUUID();

    await db.execute(
      `INSERT INTO generated_letter
         (id, employee_id, template_id, letter_type, generated_text, generated_by, issued_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, data.employee_id, template.id, template.letter_type, generatedText,
       data.generated_by, data.issued_date ?? null]
    );

    return { id, letter_type: template.letter_type as string, template_code: data.template_code };
  },

  async listAll() {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT gl.id, gl.letter_type, gl.issued_date, gl.acknowledged_at, gl.created_at,
              lt.template_name, lt.template_code,
              e.employee_code,
              CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name
       FROM generated_letter gl
       JOIN letter_template lt ON lt.id = gl.template_id
       JOIN employees e ON e.id = gl.employee_id
       ORDER BY gl.created_at DESC`
    );
    return rows as RowDataPacket[];
  },

  async listGenerated(employeeId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT gl.id, gl.letter_type, gl.issued_date, gl.acknowledged_at, gl.created_at,
              lt.template_name, lt.template_code,
              e.employee_code,
              CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name
       FROM generated_letter gl
       JOIN letter_template lt ON lt.id = gl.template_id
       JOIN employees e ON e.id = gl.employee_id
       WHERE gl.employee_id = ? ORDER BY gl.created_at DESC`,
      [employeeId]
    );
    return rows as RowDataPacket[];
  },

  async acknowledge(letterId: string) {
    await db.execute("UPDATE generated_letter SET acknowledged_at = NOW() WHERE id = ?", [letterId]);
  },
};
