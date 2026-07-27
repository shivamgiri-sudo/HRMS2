import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';

export interface OfficialEmailResolution {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  officialEmail: string;
  sourceTable: 'employees';
  sourceColumn: 'official_email';
  verified: boolean;
}

const ALLOWED_DOMAINS = ['teammas.in', 'teammas.co.in', 'mascallnet.com'];

function isOfficialDomain(email: string): boolean {
  const lower = email.trim().toLowerCase();
  const domain = lower.split('@')[1] ?? '';
  return ALLOWED_DOMAINS.some(d => domain === d || domain.endsWith('.' + d));
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***@***';
  const visible = local.length > 2 ? local[0] + '***' : '***';
  return `${visible}@${domain}`;
}

export type EmailResolutionErrorCode =
  | 'NO_EMPLOYEE'
  | 'NO_OFFICIAL_EMAIL'
  | 'INVALID_DOMAIN'
  | 'INACTIVE';

export class ReportEmailResolutionError extends Error {
  constructor(
    public readonly code: EmailResolutionErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ReportEmailResolutionError';
  }
}

export async function resolveRegisteredOfficialEmail(
  userId: string
): Promise<OfficialEmailResolution> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_code, full_name, official_email, active_status
     FROM employees
     WHERE user_id = ?
     LIMIT 1`,
    [userId]
  );

  if (!rows.length) {
    throw new ReportEmailResolutionError(
      'NO_EMPLOYEE',
      'No employee record is linked to this user account. Please contact HR to link your account.'
    );
  }

  const emp = rows[0] as {
    id: string;
    employee_code: string;
    full_name: string;
    official_email: string | null;
    active_status: number;
  };

  if (!emp.active_status) {
    throw new ReportEmailResolutionError(
      'INACTIVE',
      'Your employee record is inactive. Report requests are not permitted for inactive employees.'
    );
  }

  if (!emp.official_email || !emp.official_email.trim()) {
    throw new ReportEmailResolutionError(
      'NO_OFFICIAL_EMAIL',
      'No official company email address is registered for your employee profile. Please contact HR or IT to add your official email before requesting reports.'
    );
  }

  const normalised = emp.official_email.trim().toLowerCase();

  if (!isOfficialDomain(normalised)) {
    throw new ReportEmailResolutionError(
      'INVALID_DOMAIN',
      'The email address registered on your profile does not appear to be a company email address. Report files can only be sent to official company email addresses. Please contact HR or IT.'
    );
  }

  return {
    employeeId: emp.id,
    employeeCode: emp.employee_code,
    employeeName: emp.full_name,
    officialEmail: normalised,
    sourceTable: 'employees',
    sourceColumn: 'official_email',
    verified: true,
  };
}
