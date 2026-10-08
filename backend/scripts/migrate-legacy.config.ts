// backend/scripts/migrate-legacy.config.ts
import type { ConnectionOptions } from 'mysql2/promise';
import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

function pickEnv(...keys: string[]): string {
  for (const key of keys) {
    const v = process.env[key]?.trim();
    if (v) return v;
  }
  throw new Error(`None of [${keys.join(', ')}] are set in .env`);
}

export const LEGACY_SRC: ConnectionOptions = {
  host:        pickEnv('LEGACY_MYSQL_HOST',     'BILL_DB_HOST'),
  port:        Number(process.env.LEGACY_MYSQL_PORT ?? process.env.BILL_DB_PORT ?? 3306),
  user:        pickEnv('LEGACY_MYSQL_USER',     'BILL_DB_USER'),
  password:    pickEnv('LEGACY_MYSQL_PASSWORD', 'BILL_DB_PASSWORD'),
  database:    pickEnv('LEGACY_MYSQL_DATABASE', 'BILL_DB_NAME'),
  dateStrings: true,
  timezone:    'local',
};

export const LEGACY_TABLES = {
  employees: 'employee_master',
  leave:     'leave_management',
} as const;

export const DST: ConnectionOptions = {
  host:        pickEnv('DB_HOST'),
  port:        Number(process.env.DB_PORT ?? 3306),
  user:        pickEnv('DB_USER'),
  password:    pickEnv('DB_PASSWORD'),
  database:    pickEnv('DB_NAME'),
  dateStrings: false,
  timezone:    '+00:00',
  decimalNumbers: true,
};
