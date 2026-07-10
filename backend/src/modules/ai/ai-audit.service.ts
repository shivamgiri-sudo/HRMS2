/**
 * AI Audit Service
 * Logs all AI provider usage, prompts, and sensitive access
 * PeopleOS AI Enhancement Phase 1
 */

import { createHash } from 'crypto';
import { db } from '../../db/mysql.js';
import type {
  AiGenerateRequest,
  AiGenerateResponse,
  AiUsageLogRow,
  AiPromptAuditRow,
} from './ai-provider.types.js';

class AiAuditService {
  /**
   * Log AI provider usage
   */
  async logUsage(
    request: AiGenerateRequest,
    response: AiGenerateResponse,
    error?: Error
  ): Promise<number> {
    const [result] = await db.execute(
      `INSERT INTO ai_provider_usage_log (
        provider_key, model_name, user_id, role_keys_json,
        request_source, entity_type, entity_id,
        input_token_count, output_token_count, latency_ms,
        success, fallback_used, safety_blocked, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        response.provider,
        response.model,
        request.userId,
        JSON.stringify(request.roleKeys),
        request.requestSource,
        request.entityType || null,
        request.entityId || null,
        response.inputTokens || null,
        response.outputTokens || null,
        response.latencyMs,
        !error,
        response.fallbackUsed,
        response.safetyBlocked,
        error ? error.message : null,
      ]
    );

    return (result as any).insertId;
  }

  /**
   * Log prompt audit (question hash, context hash, PII redaction)
   */
  async logPromptAudit(
    request: AiGenerateRequest,
    piiRedactionApplied: boolean,
    sensitiveFieldsRemoved: string[],
    responseSummary?: string
  ): Promise<void> {
    const questionHash = this.hashString(request.userQuestion);
    const contextHash = this.hashString(JSON.stringify(request.sanitizedContext));

    await db.execute(
      `INSERT INTO ai_prompt_audit_log (
        user_id, provider_key, model_name, request_source,
        question_hash, sanitized_context_hash,
        pii_redaction_applied, sensitive_fields_removed_json, response_summary
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        request.userId,
        request.providerKey,
        request.model || null,
        request.requestSource,
        questionHash,
        contextHash,
        piiRedactionApplied,
        JSON.stringify(sensitiveFieldsRemoved),
        responseSummary || null,
      ]
    );
  }

  /**
   * Log AI feedback
   */
  async logFeedback(
    userId: string,
    requestId: number | null,
    providerKey: string,
    modelName: string,
    rating: 'helpful' | 'not_helpful' | 'incorrect' | 'unsafe',
    feedbackText?: string
  ): Promise<void> {
    await db.execute(
      `INSERT INTO ai_feedback (
        user_id, provider_key, model_name, request_id, rating, feedback_text
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, providerKey, modelName, requestId, rating, feedbackText || null]
    );
  }

  /**
   * Get usage statistics for provider
   */
  async getProviderUsageStats(
    providerKey: string,
    fromDate?: Date,
    toDate?: Date
  ): Promise<{
    totalRequests: number;
    successRate: number;
    avgLatencyMs: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    fallbackCount: number;
    safetyBlockedCount: number;
  }> {
    const from = fromDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
    const to = toDate || new Date();

    const [rows] = await db.execute<any[]>(
      `SELECT
        COUNT(*) as total_requests,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count,
        AVG(latency_ms) as avg_latency_ms,
        SUM(COALESCE(input_token_count, 0)) as total_input_tokens,
        SUM(COALESCE(output_token_count, 0)) as total_output_tokens,
        SUM(CASE WHEN fallback_used = 1 THEN 1 ELSE 0 END) as fallback_count,
        SUM(CASE WHEN safety_blocked = 1 THEN 1 ELSE 0 END) as safety_blocked_count
      FROM ai_provider_usage_log
      WHERE provider_key = ? AND created_at BETWEEN ? AND ?`,
      [providerKey, from, to]
    );

    const row = rows[0] || {};
    const totalRequests = Number(row.total_requests || 0);
    const successCount = Number(row.success_count || 0);

    return {
      totalRequests,
      successRate: totalRequests > 0 ? (successCount / totalRequests) * 100 : 0,
      avgLatencyMs: Number(row.avg_latency_ms || 0),
      totalInputTokens: Number(row.total_input_tokens || 0),
      totalOutputTokens: Number(row.total_output_tokens || 0),
      fallbackCount: Number(row.fallback_count || 0),
      safetyBlockedCount: Number(row.safety_blocked_count || 0),
    };
  }

  /**
   * Get usage logs with filters
   */
  async getUsageLogs(filters: {
    providerKey?: string;
    userId?: string;
    requestSource?: string;
    fromDate?: Date;
    toDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<{ logs: AiUsageLogRow[]; total: number }> {
    const conditions: string[] = ['1=1'];
    const params: any[] = [];

    if (filters.providerKey) {
      conditions.push('provider_key = ?');
      params.push(filters.providerKey);
    }
    if (filters.userId) {
      conditions.push('user_id = ?');
      params.push(filters.userId);
    }
    if (filters.requestSource) {
      conditions.push('request_source = ?');
      params.push(filters.requestSource);
    }
    if (filters.fromDate) {
      conditions.push('created_at >= ?');
      params.push(filters.fromDate);
    }
    if (filters.toDate) {
      conditions.push('created_at <= ?');
      params.push(filters.toDate);
    }

    const whereClause = conditions.join(' AND ');

    // Get total count
    const [countRows] = await db.execute<any[]>(
      `SELECT COUNT(*) as total FROM ai_provider_usage_log WHERE ${whereClause}`,
      params
    );
    const total = Number(countRows[0]?.total || 0);

    // Get paginated logs
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;

    const [logs] = await db.execute<any[]>(
      `SELECT * FROM ai_provider_usage_log
      WHERE ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return {
      logs: logs as AiUsageLogRow[],
      total,
    };
  }

  /**
   * Get prompt audit logs
   */
  async getPromptAuditLogs(filters: {
    userId?: string;
    providerKey?: string;
    fromDate?: Date;
    toDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<{ logs: AiPromptAuditRow[]; total: number }> {
    const conditions: string[] = ['1=1'];
    const params: any[] = [];

    if (filters.userId) {
      conditions.push('user_id = ?');
      params.push(filters.userId);
    }
    if (filters.providerKey) {
      conditions.push('provider_key = ?');
      params.push(filters.providerKey);
    }
    if (filters.fromDate) {
      conditions.push('created_at >= ?');
      params.push(filters.fromDate);
    }
    if (filters.toDate) {
      conditions.push('created_at <= ?');
      params.push(filters.toDate);
    }

    const whereClause = conditions.join(' AND ');

    // Get total count
    const [countRows] = await db.execute<any[]>(
      `SELECT COUNT(*) as total FROM ai_prompt_audit_log WHERE ${whereClause}`,
      params
    );
    const total = Number(countRows[0]?.total || 0);

    // Get paginated logs
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;

    const [logs] = await db.execute<any[]>(
      `SELECT * FROM ai_prompt_audit_log
      WHERE ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return {
      logs: logs as AiPromptAuditRow[],
      total,
    };
  }

  /**
   * Hash string for audit logging (SHA-256)
   */
  private hashString(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  /**
   * Get usage count for today
   */
  async getTodayUsageCount(providerKey: string): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [rows] = await db.execute<any[]>(
      `SELECT COUNT(*) as count FROM ai_provider_usage_log
      WHERE provider_key = ? AND created_at >= ?`,
      [providerKey, today]
    );

    return Number(rows[0]?.count || 0);
  }

  /**
   * Get usage count for this month
   */
  async getMonthUsageCount(providerKey: string): Promise<number> {
    const firstDay = new Date();
    firstDay.setDate(1);
    firstDay.setHours(0, 0, 0, 0);

    const [rows] = await db.execute<any[]>(
      `SELECT COUNT(*) as count FROM ai_provider_usage_log
      WHERE provider_key = ? AND created_at >= ?`,
      [providerKey, firstDay]
    );

    return Number(rows[0]?.count || 0);
  }

  /**
   * Get token usage for today
   */
  async getTodayTokenUsage(providerKey: string): Promise<{
    inputTokens: number;
    outputTokens: number;
  }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [rows] = await db.execute<any[]>(
      `SELECT
        SUM(COALESCE(input_token_count, 0)) as input_tokens,
        SUM(COALESCE(output_token_count, 0)) as output_tokens
      FROM ai_provider_usage_log
      WHERE provider_key = ? AND created_at >= ?`,
      [providerKey, today]
    );

    return {
      inputTokens: Number(rows[0]?.input_tokens || 0),
      outputTokens: Number(rows[0]?.output_tokens || 0),
    };
  }

  /**
   * Get token usage for this month
   */
  async getMonthTokenUsage(providerKey: string): Promise<{
    inputTokens: number;
    outputTokens: number;
  }> {
    const firstDay = new Date();
    firstDay.setDate(1);
    firstDay.setHours(0, 0, 0, 0);

    const [rows] = await db.execute<any[]>(
      `SELECT
        SUM(COALESCE(input_token_count, 0)) as input_tokens,
        SUM(COALESCE(output_token_count, 0)) as output_tokens
      FROM ai_provider_usage_log
      WHERE provider_key = ? AND created_at >= ?`,
      [providerKey, firstDay]
    );

    return {
      inputTokens: Number(rows[0]?.input_tokens || 0),
      outputTokens: Number(rows[0]?.output_tokens || 0),
    };
  }
}

export const aiAuditService = new AiAuditService();
