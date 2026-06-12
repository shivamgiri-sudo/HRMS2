import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';

// Named query map — each key maps to a safe SELECT that accepts optional filters
const QUERIES: Record<string, (filters: Record<string, string>) => { sql: string; params: unknown[] }> = {
  branch_master: (f) => ({
    sql: `SELECT b.id, b.branch_code, b.branch_name, b.call_centre_code, b.city, b.state,
                 COUNT(DISTINCT e.id) AS employee_count,
                 COUNT(DISTINCT p.id) AS process_count,
                 b.active_status
            FROM branch_master b
            LEFT JOIN employees e ON e.branch_id = b.id AND e.active_status = 1
            LEFT JOIN process_master p ON p.branch_id = b.id AND p.active_status = 1
           WHERE 1=1 ${f.branch ? 'AND b.id = ?' : ''}
           GROUP BY b.id ORDER BY b.branch_name`,
    params: f.branch ? [f.branch] : [],
  }),
  user_master: (_f) => ({
    sql: `SELECT ur.user_id, ur.role_key, ur.active_status,
                 e.first_name, e.last_name, e.email, e.employee_code,
                 e.branch_id, bm.branch_name
            FROM user_roles ur
            LEFT JOIN employees e ON e.user_id = ur.user_id
            LEFT JOIN branch_master bm ON bm.id = e.branch_id
           ORDER BY ur.role_key, e.last_name`,
    params: [],
  }),
  process_master: (f) => ({
    sql: `SELECT p.id, p.process_code, p.process_name, p.call_centre_code,
                 b.branch_name, l.lob_name,
                 COUNT(DISTINCT e.id) AS headcount,
                 p.active_status
            FROM process_master p
            LEFT JOIN branch_master b ON b.id = p.branch_id
            LEFT JOIN lob_master l ON l.id = p.lob_id
            LEFT JOIN employees e ON e.process_id = p.id AND e.active_status = 1
           WHERE 1=1 ${f.branch ? 'AND p.branch_id = ?' : ''}
           GROUP BY p.id ORDER BY b.branch_name, p.process_name`,
    params: f.branch ? [f.branch] : [],
  }),
  role_access_map: (_f) => ({
    sql: `SELECT rpa.role_key, rpa.page_code, rpa.can_view, rpa.can_create,
                 rpa.can_edit, rpa.can_delete, rpa.can_export
            FROM role_page_access rpa
           ORDER BY rpa.role_key, rpa.page_code`,
    params: [],
  }),
  cc_headcount: (f) => ({
    sql: `SELECT COALESCE(e.call_centre_code, b.call_centre_code) AS cc_code,
                 b.branch_name, COUNT(e.id) AS headcount,
                 COUNT(CASE WHEN LOWER(e.employment_status) = 'active' THEN 1 END) AS active_count
            FROM employees e
            LEFT JOIN branch_master b ON b.id = e.branch_id
           WHERE 1=1 ${f.ccCode ? 'AND COALESCE(e.call_centre_code, b.call_centre_code) = ?' : ''}
           GROUP BY cc_code, b.branch_name ORDER BY cc_code`,
    params: f.ccCode ? [f.ccCode] : [],
  }),
  employee_dir: (f) => ({
    sql: `SELECT e.employee_code, CONCAT(e.first_name,' ',e.last_name) AS full_name,
                 e.email, d.designation_name, b.branch_name, p.process_name,
                 e.employment_status, e.date_of_joining,
                 COALESCE(e.call_centre_code, b.call_centre_code) AS cc_code
            FROM employees e
            LEFT JOIN designation_master d ON d.id = e.designation_id
            LEFT JOIN branch_master b ON b.id = e.branch_id
            LEFT JOIN process_master p ON p.id = e.process_id
           WHERE e.active_status = 1
             ${f.branch ? 'AND e.branch_id = ?' : ''}
             ${f.status ? 'AND e.employment_status = ?' : ''}
           ORDER BY b.branch_name, e.last_name`,
    params: [
      ...(f.branch ? [f.branch] : []),
      ...(f.status ? [f.status] : []),
    ],
  }),
};

export const reportingService = {
  async listReports(): Promise<RowDataPacket[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT * FROM report_master WHERE active_status = 1 ORDER BY report_category, report_name'
    );
    return rows;
  },

  async runReport(reportCode: string, filters: Record<string, string>): Promise<{ columns: string[]; rows: unknown[]; count: number }> {
    const [meta] = await db.execute<RowDataPacket[]>(
      'SELECT * FROM report_master WHERE report_code = ? AND active_status = 1 LIMIT 1',
      [reportCode]
    );
    if (!meta[0]) throw Object.assign(new Error(`Report ${reportCode} not found`), { statusCode: 404 });

    const queryKey = meta[0].query_key as string;
    const builder = QUERIES[queryKey];
    if (!builder) throw Object.assign(new Error(`No query builder for ${queryKey}`), { statusCode: 501 });

    const { sql, params } = builder(filters);
    const [rows] = await db.execute<RowDataPacket[]>(sql, params);

    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    return { columns, rows, count: rows.length };
  },
};
