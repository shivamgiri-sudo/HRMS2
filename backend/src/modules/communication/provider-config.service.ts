import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { db } from '../../db/mysql.js';
import { env } from '../../config/env.js';
import type { RowDataPacket } from 'mysql2';
import type {
  Channel, ProviderConfig, SaveProviderConfigDTO, AnyProviderType,
} from './communication.types.js';

const ALG = 'aes-256-gcm';

function getKey(): Buffer {
  // Prefer dedicated COMM_SECRET; fall back to PAYROLL_BANK_KEY for backward compatibility
  const raw = env.COMM_SECRET ?? env.PAYROLL_BANK_KEY;
  const buf = Buffer.alloc(32, 0);
  Buffer.from(raw, 'utf8').copy(buf, 0, 0, 32);
  return buf;
}

function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decrypt(blob: string): string {
  const buf = Buffer.from(blob, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv(ALG, getKey(), iv);
  decipher.setAuthTag(tag);
  return decipher.update(enc).toString('utf8') + decipher.final('utf8');
}

interface ProviderConfigRow extends RowDataPacket {
  id: string;
  channel: Channel;
  provider_type: AnyProviderType;
  config_json: unknown;
  is_enabled: number;
  test_ok: number | null;
  test_error: string | null;
  test_at: string | null;
  secret_enc?: string | null;
}

interface UpdateResultRow extends RowDataPacket {
  affectedRows: number;
}

function rowToConfig(r: RowDataPacket): ProviderConfig {
  return {
    id: r.id as string,
    channel: r.channel as Channel,
    provider_type: r.provider_type as AnyProviderType,
    config_json: typeof r.config_json === 'string' ? JSON.parse(r.config_json) : (r.config_json ?? {}),
    is_enabled: !!(r.is_enabled),
    test_ok: r.test_ok == null ? null : !!(r.test_ok),
    test_error: (r.test_error as string) ?? null,
    test_at: (r.test_at as string) ?? null,
  };
}

export const providerConfigService = {
  async listAll(): Promise<ProviderConfig[]> {
    const [rows] = await db.execute<ProviderConfigRow[]>(
      'SELECT id, channel, provider_type, config_json, is_enabled, test_ok, test_error, test_at FROM communication_provider_config ORDER BY channel',
    );
    return rows.map(rowToConfig);
  },

  async getWithSecrets(channel: Channel): Promise<{ config: ProviderConfig; secrets: Record<string, string> }> {
    const [rows] = await db.execute<ProviderConfigRow[]>(
      'SELECT * FROM communication_provider_config WHERE channel = ? LIMIT 1',
      [channel],
    );
    const row = rows[0];
    if (!row) throw new Error(`No config for channel: ${channel}`);
    const secrets: Record<string, string> = {};
    if (row.secret_enc) {
      try { Object.assign(secrets, JSON.parse(decrypt(row.secret_enc as string))); } catch { /* ignore bad decrypt */ }
    }
    return { config: rowToConfig(row), secrets };
  },

  async save(channel: Channel, dto: SaveProviderConfigDTO, userId: string): Promise<void> {
    const secretEnc = Object.keys(dto.secrets).length > 0 ? encrypt(JSON.stringify(dto.secrets)) : null;
    await db.execute(
      `INSERT INTO communication_provider_config
         (id, channel, provider_type, config_json, secret_enc, is_enabled, updated_by)
       VALUES (UUID(), ?, ?, ?, ?, 0, ?)
       ON DUPLICATE KEY UPDATE
         provider_type = VALUES(provider_type),
         config_json   = VALUES(config_json),
         secret_enc    = COALESCE(VALUES(secret_enc), secret_enc),
         updated_by    = VALUES(updated_by)`,
      [channel, dto.provider_type, JSON.stringify(dto.config), secretEnc, userId],
    );
  },

  async setEnabled(channel: Channel, enabled: boolean, userId: string): Promise<void> {
    const [result] = await db.execute<UpdateResultRow>(
      'UPDATE communication_provider_config SET is_enabled = ?, updated_by = ? WHERE channel = ?',
      [enabled ? 1 : 0, userId, channel],
    );
    if (result.affectedRows === 0) {
      throw Object.assign(new Error(`No configuration found for channel: ${channel}. Run database migrations first.`), { statusCode: 404 });
    }
  },

  async saveTestResult(channel: Channel, ok: boolean, error: string | null, userId: string): Promise<void> {
    await db.execute(
      'UPDATE communication_provider_config SET test_ok = ?, test_error = ?, test_at = NOW(), tested_by = ? WHERE channel = ?',
      [ok ? 1 : 0, error, userId, channel],
    );
  },

  async loadActiveConfig(channel: Channel): Promise<{ provider_type: AnyProviderType; config: Record<string, unknown>; secrets: Record<string, string> } | null> {
    const [rows] = await db.execute<ProviderConfigRow[]>(
      'SELECT provider_type, config_json, secret_enc FROM communication_provider_config WHERE channel = ? AND is_enabled = 1 LIMIT 1',
      [channel],
    );
    const row = rows[0];
    if (!row) return null;
    const config = typeof row.config_json === 'string' ? JSON.parse(row.config_json) : (row.config_json ?? {});
    const secrets: Record<string, string> = {};
    if (row.secret_enc) {
      try { Object.assign(secrets, JSON.parse(decrypt(row.secret_enc as string))); } catch { /* ignore */ }
    }
    return { provider_type: row.provider_type as AnyProviderType, config, secrets };
  },
};
