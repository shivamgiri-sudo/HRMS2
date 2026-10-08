import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import type { AiProviderConfigRow, SafeAiProviderConfig } from './ai-provider.types.js';

const ALGORITHM = 'aes-256-cbc';
const ENCRYPTION_KEY_ENV = 'AI_ENCRYPTION_KEY';

type ProviderStatus = 'active' | 'inactive';

type ProviderCreateInput = {
  providerKey: string;
  providerName: string;
  activeStatus?: ProviderStatus;
  isDefault?: boolean;
  modelName?: string;
  baseUrl?: string;
  apiKey?: string;
  configJson?: Record<string, unknown>;
  safetyConfigJson?: Record<string, unknown>;
  dailyRequestLimit?: number;
  monthlyRequestLimit?: number;
  dailyTokenLimit?: number;
  monthlyTokenLimit?: number;
  timeoutMs?: number;
  fallbackProviderKey?: string;
  createdBy: string;
};

type ProviderUpdateInput = Omit<Partial<ProviderCreateInput>, 'providerKey' | 'createdBy'> & {
  updatedBy: string;
};

class AiProviderConfigService {
  private getEncryptionKey(): Buffer {
    const key = process.env[ENCRYPTION_KEY_ENV] || process.env.ENCRYPTION_KEY;
    if (!key) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('AI_ENCRYPTION_KEY or ENCRYPTION_KEY must be configured in production');
      }
      return createHash('sha256').update('dev-only-ai-encryption-key-not-for-production').digest();
    }
    return createHash('sha256').update(key).digest();
  }

  private encryptApiKey(apiKey: string): string {
    const key = this.getEncryptionKey();
    const iv = randomBytes(16);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(apiKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return `${iv.toString('hex')}:${encrypted}`;
  }

  private decryptApiKey(encryptedKey: string): string {
    try {
      const [ivHex, encrypted] = encryptedKey.split(':');
      if (!ivHex || !encrypted) throw new Error('Invalid encrypted key format');
      const decipher = createDecipheriv(ALGORITHM, this.getEncryptionKey(), Buffer.from(ivHex, 'hex'));
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (error) {
      console.error('[AI Config] Decryption failed:', error instanceof Error ? error.message : error);
      throw new Error('Failed to decrypt API key');
    }
  }

  async list(filters?: { activeStatus?: ProviderStatus }): Promise<SafeAiProviderConfig[]> {
    let query = 'SELECT * FROM ai_provider_config';
    const params: unknown[] = [];
    if (filters?.activeStatus) {
      query += ' WHERE active_status = ?';
      params.push(filters.activeStatus);
    }
    query += ' ORDER BY is_default DESC, provider_name ASC';
    const [rows] = await db.execute<RowDataPacket[]>(query, params);
    return rows.map((row) => this.toSafeConfig(row as AiProviderConfigRow, false));
  }

  async getByKey(providerKey: string, includeApiKey = false): Promise<SafeAiProviderConfig | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT * FROM ai_provider_config WHERE provider_key = ? LIMIT 1',
      [providerKey],
    );
    return rows.length ? this.toSafeConfig(rows[0] as AiProviderConfigRow, includeApiKey) : null;
  }

  async getDefaultProvider(includeApiKey = false): Promise<SafeAiProviderConfig | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT * FROM ai_provider_config WHERE active_status = ? AND is_default = ? LIMIT 1',
      ['active', true],
    );
    if (!rows.length) return this.getByKey('rule-based', false);
    return this.toSafeConfig(rows[0] as AiProviderConfigRow, includeApiKey);
  }

  async create(data: ProviderCreateInput): Promise<SafeAiProviderConfig> {
    const encryptedApiKey = data.apiKey ? this.encryptApiKey(data.apiKey) : null;
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `INSERT INTO ai_provider_config (
          provider_key, provider_name, active_status, is_default,
          model_name, base_url, encrypted_api_key,
          config_json, safety_config_json,
          daily_request_limit, monthly_request_limit,
          daily_token_limit, monthly_token_limit,
          timeout_ms, fallback_provider_key, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          data.providerKey,
          data.providerName,
          data.activeStatus || 'inactive',
          Boolean(data.isDefault),
          data.modelName || null,
          data.baseUrl || null,
          encryptedApiKey,
          data.configJson ? JSON.stringify(data.configJson) : null,
          data.safetyConfigJson ? JSON.stringify(data.safetyConfigJson) : null,
          data.dailyRequestLimit ?? null,
          data.monthlyRequestLimit ?? null,
          data.dailyTokenLimit ?? null,
          data.monthlyTokenLimit ?? null,
          data.timeoutMs || 30_000,
          data.fallbackProviderKey || null,
          data.createdBy,
        ],
      );
      if (data.isDefault) {
        await connection.execute(
          'UPDATE ai_provider_config SET is_default = FALSE WHERE provider_key != ?',
          [data.providerKey],
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    const created = await this.getByKey(data.providerKey, false);
    if (!created) throw new Error('Failed to retrieve created provider config');
    return created;
  }

  async update(id: string, data: ProviderUpdateInput): Promise<SafeAiProviderConfig> {
    const updates: string[] = [];
    const params: unknown[] = [];

    const add = (column: string, value: unknown) => {
      updates.push(`${column} = ?`);
      params.push(value);
    };

    if (data.providerName !== undefined) add('provider_name', data.providerName);
    if (data.activeStatus !== undefined) add('active_status', data.activeStatus);
    if (data.isDefault !== undefined) add('is_default', data.isDefault);
    if (data.modelName !== undefined) add('model_name', data.modelName || null);
    if (data.baseUrl !== undefined) add('base_url', data.baseUrl || null);
    if (data.apiKey) add('encrypted_api_key', this.encryptApiKey(data.apiKey));
    if (data.configJson !== undefined) add('config_json', data.configJson ? JSON.stringify(data.configJson) : null);
    if (data.safetyConfigJson !== undefined) add('safety_config_json', data.safetyConfigJson ? JSON.stringify(data.safetyConfigJson) : null);
    if (data.dailyRequestLimit !== undefined) add('daily_request_limit', data.dailyRequestLimit);
    if (data.monthlyRequestLimit !== undefined) add('monthly_request_limit', data.monthlyRequestLimit);
    if (data.dailyTokenLimit !== undefined) add('daily_token_limit', data.dailyTokenLimit);
    if (data.monthlyTokenLimit !== undefined) add('monthly_token_limit', data.monthlyTokenLimit);
    if (data.timeoutMs !== undefined) add('timeout_ms', data.timeoutMs);
    if (data.fallbackProviderKey !== undefined) add('fallback_provider_key', data.fallbackProviderKey || null);
    add('updated_by', data.updatedBy);

    const connection = await db.getConnection();
    let providerKey = '';
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE ai_provider_config SET ${updates.join(', ')} WHERE id = ?`,
        [...params, id],
      );
      if (result.affectedRows === 0) throw new Error('Provider config not found');

      const [rows] = await connection.execute<RowDataPacket[]>(
        'SELECT provider_key FROM ai_provider_config WHERE id = ? LIMIT 1',
        [id],
      );
      providerKey = String(rows[0]?.provider_key || '');
      if (!providerKey) throw new Error('Provider config not found');

      if (data.isDefault) {
        await connection.execute(
          'UPDATE ai_provider_config SET is_default = FALSE WHERE id != ?',
          [id],
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    const updated = await this.getByKey(providerKey, false);
    if (!updated) throw new Error('Failed to retrieve updated provider config');
    return updated;
  }

  async delete(id: string): Promise<void> {
    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT provider_key FROM ai_provider_config WHERE id = ? LIMIT 1',
      [id],
    );
    if (!rows.length) throw new Error('Provider config not found');
    if (String(rows[0].provider_key) === 'rule-based') {
      throw new Error('Cannot delete rule-based provider (required as fallback)');
    }
    await db.execute('DELETE FROM ai_provider_config WHERE id = ?', [id]);
  }

  async setDefault(providerKey: string): Promise<void> {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        'SELECT provider_key FROM ai_provider_config WHERE provider_key = ? LIMIT 1 FOR UPDATE',
        [providerKey],
      );
      if (!rows.length) throw new Error('Provider config not found');
      await connection.execute(
        'UPDATE ai_provider_config SET is_default = FALSE WHERE provider_key != ?',
        [providerKey],
      );
      await connection.execute(
        'UPDATE ai_provider_config SET is_default = TRUE, active_status = ? WHERE provider_key = ?',
        ['active', providerKey],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  private toSafeConfig(row: AiProviderConfigRow, includeApiKey: boolean): SafeAiProviderConfig {
    const config: SafeAiProviderConfig = {
      id: row.id,
      providerKey: row.provider_key,
      providerName: row.provider_name,
      activeStatus: row.active_status,
      isDefault: Boolean(row.is_default),
      modelName: row.model_name || undefined,
      baseUrl: row.base_url || undefined,
      timeout: row.timeout_ms || undefined,
      dailyRequestLimit: row.daily_request_limit ?? undefined,
      monthlyRequestLimit: row.monthly_request_limit ?? undefined,
      dailyTokenLimit: row.daily_token_limit ?? undefined,
      monthlyTokenLimit: row.monthly_token_limit ?? undefined,
    };

    if (includeApiKey && row.encrypted_api_key) {
      try {
        config.apiKey = this.decryptApiKey(row.encrypted_api_key);
      } catch {
        console.error('[AI Config] Failed to decrypt API key for', row.provider_key);
      }
    }

    if (row.safety_config_json) {
      try {
        config.safetyConfig = JSON.parse(row.safety_config_json) as Record<string, unknown>;
      } catch {
        console.warn('[AI Config] Invalid safety configuration JSON for', row.provider_key);
      }
    }
    return config;
  }
}

export const aiProviderConfigService = new AiProviderConfigService();
