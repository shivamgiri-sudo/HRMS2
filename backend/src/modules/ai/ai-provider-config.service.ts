/**
 * AI Provider Configuration Service
 * CRUD operations for provider config with API key encryption
 * PeopleOS AI Enhancement Phase 1
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import { db } from '../../db/mysql.js';
import type { AiProviderConfigRow, SafeAiProviderConfig } from './ai-provider.types.js';

// Encryption algorithm and key derivation
const ALGORITHM = 'aes-256-cbc';
const ENCRYPTION_KEY_ENV = 'AI_ENCRYPTION_KEY';

class AiProviderConfigService {
  /**
   * Get encryption key from environment
   */
  private getEncryptionKey(): Buffer {
    const key = process.env[ENCRYPTION_KEY_ENV];
    if (!key) {
      // Generate a default key from NODE_ENV for development
      // In production, AI_ENCRYPTION_KEY MUST be set
      const fallback = process.env.NODE_ENV || 'development-fallback-key';
      console.warn(`[AI Config] ${ENCRYPTION_KEY_ENV} not set, using fallback (NOT SECURE FOR PRODUCTION)`);
      return createHash('sha256').update(fallback).digest();
    }
    return createHash('sha256').update(key).digest();
  }

  /**
   * Encrypt API key
   */
  private encryptApiKey(apiKey: string): string {
    const key = this.getEncryptionKey();
    const iv = randomBytes(16);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(apiKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  /**
   * Decrypt API key
   */
  private decryptApiKey(encryptedKey: string): string {
    try {
      const key = this.getEncryptionKey();
      const parts = encryptedKey.split(':');
      if (parts.length !== 2) {
        throw new Error('Invalid encrypted key format');
      }
      const iv = Buffer.from(parts[0], 'hex');
      const encrypted = parts[1];
      const decipher = createDecipheriv(ALGORITHM, key, iv);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (error: any) {
      console.error('[AI Config] Decryption failed:', error.message);
      throw new Error('Failed to decrypt API key');
    }
  }

  /**
   * List all provider configs (safe - no API keys)
   */
  async list(filters?: { activeStatus?: 'active' | 'inactive' }): Promise<SafeAiProviderConfig[]> {
    let query = 'SELECT * FROM ai_provider_config';
    const params: any[] = [];

    if (filters?.activeStatus) {
      query += ' WHERE active_status = ?';
      params.push(filters.activeStatus);
    }

    query += ' ORDER BY is_default DESC, provider_name ASC';

    const [rows] = await db.execute<any[]>(query, params);

    return rows.map((row: AiProviderConfigRow) => this.toSafeConfig(row, false));
  }

  /**
   * Get provider config by key (with optional API key)
   */
  async getByKey(providerKey: string, includeApiKey = false): Promise<SafeAiProviderConfig | null> {
    const [rows] = await db.execute<any[]>(
      'SELECT * FROM ai_provider_config WHERE provider_key = ? LIMIT 1',
      [providerKey]
    );

    if (rows.length === 0) return null;

    return this.toSafeConfig(rows[0] as AiProviderConfigRow, includeApiKey);
  }

  /**
   * Get active default provider
   */
  async getDefaultProvider(includeApiKey = false): Promise<SafeAiProviderConfig | null> {
    const [rows] = await db.execute<any[]>(
      'SELECT * FROM ai_provider_config WHERE active_status = ? AND is_default = ? LIMIT 1',
      ['active', true]
    );

    if (rows.length === 0) {
      // Fallback to rule-based provider
      return this.getByKey('rule-based', false);
    }

    return this.toSafeConfig(rows[0] as AiProviderConfigRow, includeApiKey);
  }

  /**
   * Create provider config
   */
  async create(data: {
    providerKey: string;
    providerName: string;
    activeStatus?: 'active' | 'inactive';
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
  }): Promise<SafeAiProviderConfig> {
    const encryptedApiKey = data.apiKey ? this.encryptApiKey(data.apiKey) : null;

    const [result] = await db.execute(
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
        data.isDefault || false,
        data.modelName || null,
        data.baseUrl || null,
        encryptedApiKey,
        data.configJson ? JSON.stringify(data.configJson) : null,
        data.safetyConfigJson ? JSON.stringify(data.safetyConfigJson) : null,
        data.dailyRequestLimit || null,
        data.monthlyRequestLimit || null,
        data.dailyTokenLimit || null,
        data.monthlyTokenLimit || null,
        data.timeoutMs || 30000,
        data.fallbackProviderKey || null,
        data.createdBy,
      ]
    );

    const id = (result as any).insertId;
    const created = await this.getByKey(data.providerKey, false);
    if (!created) throw new Error('Failed to retrieve created provider config');
    return created;
  }

  /**
   * Update provider config
   */
  async update(
    id: string,
    data: {
      providerName?: string;
      activeStatus?: 'active' | 'inactive';
      isDefault?: boolean;
      modelName?: string;
      baseUrl?: string;
      apiKey?: string; // If blank, preserve existing; if set, encrypt and replace
      configJson?: Record<string, unknown>;
      safetyConfigJson?: Record<string, unknown>;
      dailyRequestLimit?: number;
      monthlyRequestLimit?: number;
      dailyTokenLimit?: number;
      monthlyTokenLimit?: number;
      timeoutMs?: number;
      fallbackProviderKey?: string;
      updatedBy: string;
    }
  ): Promise<SafeAiProviderConfig> {
    // Build update query dynamically
    const updates: string[] = [];
    const params: any[] = [];

    if (data.providerName !== undefined) {
      updates.push('provider_name = ?');
      params.push(data.providerName);
    }
    if (data.activeStatus !== undefined) {
      updates.push('active_status = ?');
      params.push(data.activeStatus);
    }
    if (data.isDefault !== undefined) {
      updates.push('is_default = ?');
      params.push(data.isDefault);
    }
    if (data.modelName !== undefined) {
      updates.push('model_name = ?');
      params.push(data.modelName);
    }
    if (data.baseUrl !== undefined) {
      updates.push('base_url = ?');
      params.push(data.baseUrl);
    }
    if (data.apiKey) {
      // Only update if API key is provided (non-empty)
      updates.push('encrypted_api_key = ?');
      params.push(this.encryptApiKey(data.apiKey));
    }
    if (data.configJson !== undefined) {
      updates.push('config_json = ?');
      params.push(data.configJson ? JSON.stringify(data.configJson) : null);
    }
    if (data.safetyConfigJson !== undefined) {
      updates.push('safety_config_json = ?');
      params.push(data.safetyConfigJson ? JSON.stringify(data.safetyConfigJson) : null);
    }
    if (data.dailyRequestLimit !== undefined) {
      updates.push('daily_request_limit = ?');
      params.push(data.dailyRequestLimit);
    }
    if (data.monthlyRequestLimit !== undefined) {
      updates.push('monthly_request_limit = ?');
      params.push(data.monthlyRequestLimit);
    }
    if (data.dailyTokenLimit !== undefined) {
      updates.push('daily_token_limit = ?');
      params.push(data.dailyTokenLimit);
    }
    if (data.monthlyTokenLimit !== undefined) {
      updates.push('monthly_token_limit = ?');
      params.push(data.monthlyTokenLimit);
    }
    if (data.timeoutMs !== undefined) {
      updates.push('timeout_ms = ?');
      params.push(data.timeoutMs);
    }
    if (data.fallbackProviderKey !== undefined) {
      updates.push('fallback_provider_key = ?');
      params.push(data.fallbackProviderKey);
    }

    updates.push('updated_by = ?');
    params.push(data.updatedBy);

    params.push(id);

    await db.execute(
      `UPDATE ai_provider_config SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    // If setting as default, clear other defaults
    if (data.isDefault) {
      await db.execute(
        'UPDATE ai_provider_config SET is_default = FALSE WHERE id != ?',
        [id]
      );
    }

    const [rows] = await db.execute<any[]>(
      'SELECT provider_key FROM ai_provider_config WHERE id = ? LIMIT 1',
      [id]
    );

    if (rows.length === 0) throw new Error('Provider config not found');

    const updated = await this.getByKey(rows[0].provider_key, false);
    if (!updated) throw new Error('Failed to retrieve updated provider config');
    return updated;
  }

  /**
   * Delete provider config
   */
  async delete(id: string): Promise<void> {
    // Prevent deleting rule-based provider
    const [rows] = await db.execute<any[]>(
      'SELECT provider_key FROM ai_provider_config WHERE id = ? LIMIT 1',
      [id]
    );

    if (rows.length === 0) throw new Error('Provider config not found');

    if (rows[0].provider_key === 'rule-based') {
      throw new Error('Cannot delete rule-based provider (required as fallback)');
    }

    await db.execute('DELETE FROM ai_provider_config WHERE id = ?', [id]);
  }

  /**
   * Set provider as default
   */
  async setDefault(providerKey: string): Promise<void> {
    // Clear all defaults
    await db.execute('UPDATE ai_provider_config SET is_default = FALSE');

    // Set new default
    await db.execute(
      'UPDATE ai_provider_config SET is_default = TRUE, active_status = ? WHERE provider_key = ?',
      ['active', providerKey]
    );
  }

  /**
   * Convert DB row to safe config (strips sensitive data)
   */
  private toSafeConfig(row: AiProviderConfigRow, includeApiKey: boolean): SafeAiProviderConfig {
    const config: SafeAiProviderConfig = {
      providerKey: row.provider_key,
      providerName: row.provider_name,
      modelName: row.model_name || undefined,
      baseUrl: row.base_url || undefined,
      timeout: row.timeout_ms || undefined,
      dailyRequestLimit: row.daily_request_limit ?? undefined,
      monthlyRequestLimit: row.monthly_request_limit ?? undefined,
    };

    // Only include decrypted API key if explicitly requested (for provider execution)
    if (includeApiKey && row.encrypted_api_key) {
      try {
        config.apiKey = this.decryptApiKey(row.encrypted_api_key);
      } catch (error) {
        console.error('[AI Config] Failed to decrypt API key for', row.provider_key);
      }
    }

    // Parse JSON fields
    if (row.config_json) {
      try {
        config.safetyConfig = JSON.parse(row.config_json);
      } catch {}
    }

    if (row.safety_config_json) {
      try {
        config.safetyConfig = JSON.parse(row.safety_config_json);
      } catch {}
    }

    return config;
  }
}

export const aiProviderConfigService = new AiProviderConfigService();
