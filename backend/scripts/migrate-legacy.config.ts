// backend/scripts/migrate-legacy.config.ts
import type { ConnectionOptions } from 'mysql2/promise';
import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

export const LEGACY_SRC: ConnectionOptions = {
  host:        '192.168.10.22',       // Fill in: 122.184.128.90
  port:        3306,
  user:        'shivam_user',       // Fill in: root
  password:    'qwersdfg!@#hjk',   // Fill in: (provided separately)
  database:    'db_bill',   // Fill in: legacy source DB name
  dateStrings: true,
  timezone:    'local',
};

export const LEGACY_TABLES = {
  employees: 'employee_master',
  leave:     'leave_management',
} as const;

export const DST: ConnectionOptions = {
  host:        process.env.DB_HOST     ?? '122.184.128.90',
  port:        Number(process.env.DB_PORT ?? 3306),
  user:        process.env.DB_USER     ?? 'root',
  password:    process.env.DB_PASSWORD ?? 'vicidialnow',
  database:    process.env.DB_NAME     ?? 'mas_hrms',
  dateStrings: false,
  timezone:    '+00:00',
  decimalNumbers: true,
};
