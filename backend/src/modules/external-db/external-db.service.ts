// backend/src/modules/external-db/external-db.service.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import sql from 'mssql';
import mysql from 'mysql2/promise';
import { db } from '../../db/mysql.js';
import { env } from '../../config/env.js';
import type { RowDataPacket } from 'mysql2';

export interface DbCredentials {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  table?: string;
  date_column?: string;
  employee_code_column?: string;
  db_type: 'mssql' | 'mysql';
  tables?: string[];
  encrypt?: boolean;
  trust_server_certificate?: boolean;
}

const ALGO = 'aes-256-gcm';
const KEY_BUF = () => Buffer.from(env.ENCRYPTION_KEY, 'hex');

export function encryptCredentials(creds: DbCredentials): string {
  return encryptSecretPayload(creds as unknown as Record<string, unknown>);
}

export function encryptSecretPayload(payload: Record<string, unknown>): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGO, KEY_BUF(), iv);
  const plain = JSON.stringify(payload);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptCredentials(stored: string): DbCredentials {
  return decryptSecretPayload(stored) as unknown as DbCredentials;
}

export function decryptSecretPayload(stored: string): Record<string, unknown> {
  const [ivHex, tagHex, encHex] = stored.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const encrypted = Buffer.from(encHex, 'hex');
  const decipher = createDecipheriv(ALGO, KEY_BUF(), iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(plain) as Record<string, unknown>;
}

const LEGACY_SECRET_KEY = /(password|passphrase|private[_-]?key|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization)/i;

function splitLegacySecrets(value: unknown): {
  sanitized: unknown;
  secrets: Record<string, unknown>;
} {
  if (Array.isArray(value)) {
    const entries = value.map(splitLegacySecrets);
    return {
      sanitized: entries.map((entry) => entry.sanitized),
      secrets: Object.assign({}, ...entries.map((entry, index) => (
        Object.fromEntries(Object.entries(entry.secrets).map(([key, item]) => [`${index}.${key}`, item]))
      ))),
    };
  }
  if (!value || typeof value !== 'object') return { sanitized: value, secrets: {} };

  const sanitized: Record<string, unknown> = {};
  const secrets: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (LEGACY_SECRET_KEY.test(key)) {
      secrets[key] = item;
      continue;
    }
    const nested = splitLegacySecrets(item);
    sanitized[key] = nested.sanitized;
    for (const [nestedKey, nestedValue] of Object.entries(nested.secrets)) {
      secrets[`${key}.${nestedKey}`] = nestedValue;
    }
  }
  return { sanitized, secrets };
}

export async function migrateLegacyIntegrationSecrets(): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT integration_key, integration_type, config_json, encrypted_credentials
       FROM integration_config`
  );
  let migrated = 0;

  for (const row of rows) {
    const rawConfig = typeof row.config_json === 'string'
      ? JSON.parse(row.config_json)
      : (row.config_json ?? {});
    const { sanitized, secrets } = splitLegacySecrets(rawConfig);
    if (Object.keys(secrets).length === 0) continue;

    let encrypted = row.encrypted_credentials ? String(row.encrypted_credentials) : '';
    if (!encrypted) {
      if (row.integration_type === 'database') {
        const config = rawConfig as Record<string, any>;
        const password = String(
          secrets.password ?? secrets.passphrase ?? config.password ?? config.pass ?? ''
        );
        encrypted = encryptCredentials({
          host: String(config.host ?? ''),
          port: Number(config.port ?? (config.db_type === 'mssql' ? 1433 : 3306)),
          database: String(config.database ?? ''),
          username: String(config.username ?? config.user ?? ''),
          password,
          date_column: config.date_column,
          employee_code_column: config.employee_code_column,
          tables: config.tables ?? config.source_tables ?? [],
          db_type: config.db_type === 'mssql' || config.db_type === 'sqlserver' ? 'mssql' : 'mysql',
          encrypt: Boolean(config.encrypt),
          trust_server_certificate: config.trust_server_certificate !== false,
        });
      } else {
        encrypted = encryptSecretPayload({ legacy_secrets: secrets });
      }
    }

    await db.execute(
      `UPDATE integration_config
          SET config_json = ?, encrypted_credentials = ?, updated_at = NOW()
        WHERE integration_key = ?`,
      [JSON.stringify(sanitized), encrypted, row.integration_key]
    );
    migrated += 1;
  }

  if (migrated > 0) {
    console.log(`[security] encrypted and removed plaintext secrets from ${migrated} integration connector(s)`);
  }
  return migrated;
}

const mssqlPools = new Map<string, sql.ConnectionPool>();
const mysqlPools = new Map<string, mysql.Pool>();

export async function getCredentialsForKey(key: string): Promise<DbCredentials | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT encrypted_credentials, config_json FROM integration_config WHERE integration_key = ?`,
    [key]
  );
  const row = (rows as any[])[0];
  if (!row) return null;
  if (row.encrypted_credentials) {
    return decryptCredentials(row.encrypted_credentials);
  }
  return null;
}

export async function getPoolForKey(key: string): Promise<sql.ConnectionPool | mysql.Pool> {
  const creds = await getCredentialsForKey(key);
  if (!creds) throw new Error(`No credentials configured for integration: ${key}`);

  if (creds.db_type === 'mssql') {
    const existing = mssqlPools.get(key);
    if (existing) {
      if (existing.connected) return existing;
      await existing.close().catch(() => {});
      mssqlPools.delete(key);
    }
    const pool = await new sql.ConnectionPool({
      server: creds.host,
      port: creds.port,
      user: creds.username,
      password: creds.password,
      database: creds.database,
      options: {
        encrypt: creds.encrypt ?? false,
        trustServerCertificate: creds.trust_server_certificate ?? true,
        enableArithAbort: true,
      },
      connectionTimeout: 15000,
      requestTimeout: 60000,
    }).connect();
    mssqlPools.set(key, pool);
    return pool;
  } else {
    const existing = mysqlPools.get(key);
    if (existing) return existing;
    const pool = mysql.createPool({
      host: creds.host,
      port: creds.port,
      user: creds.username,
      password: creds.password,
      database: creds.database,
      waitForConnections: true,
      connectionLimit: 5,
      connectTimeout: 15000,
    });
    mysqlPools.set(key, pool);
    return pool;
  }
}

export function invalidatePool(key: string): void {
  mssqlPools.delete(key);
  mysqlPools.delete(key);
}

export async function testPoolForKey(key: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const creds = await getCredentialsForKey(key);
    if (!creds) return { ok: false, error: 'No credentials configured' };

    invalidatePool(key); // force fresh connection for test
    const pool = await getPoolForKey(key);

    if (creds.db_type === 'mssql') {
      await (pool as sql.ConnectionPool).request().query('SELECT 1 AS ok');
    } else {
      await (pool as mysql.Pool).execute('SELECT 1 AS ok');
    }
    return { ok: true };
  } catch (e: unknown) {
    invalidatePool(key);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
