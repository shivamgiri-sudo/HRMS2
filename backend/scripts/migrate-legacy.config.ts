// backend/scripts/migrate-legacy.config.ts
import type { ConnectionOptions } from 'mysql2/promise';
import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export const LEGACY_SRC: ConnectionOptions = {
  host:        requiredEnv('LEGACY_MYSQL_HOST'),
  port:        Number(process.env.LEGACY_MYSQL_PORT ?? 3306),
  user:        requiredEnv('LEGACY_MYSQL_USER'),
  password:    requiredEnv('LEGACY_MYSQL_PASSWORD'),
  database:    requiredEnv('LEGACY_MYSQL_DATABASE'),
  dateStrings: true,
  timezone:    'local',
};

export const LEGACY_TABLES = {
  employees: 'employee_master',
  leave:     'leave_management',
} as const;

export const DST: ConnectionOptions = {
  host:        requiredEnv('DB_HOST'),
  port:        Number(process.env.DB_PORT ?? 3306),
  user:        requiredEnv('DB_USER'),
  password:    requiredEnv('DB_PASSWORD'),
  database:    requiredEnv('DB_NAME'),
  dateStrings: false,
  timezone:    '+00:00',
  decimalNumbers: true,
};
