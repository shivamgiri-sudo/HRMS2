import { createHash } from 'crypto';
import { sqlLimitOffset } from "../../db/pagination.js";
import { db } from '../../db/mysql.js';
import type {
  AiGenerateRequest,
  AiGenerateResponse,
  AiUsageLogRow,
  AiPromptAuditRow,
} from './ai-provider.types.js';

class AiAuditService {
  private lastAuditWarningAt = 0;

  private warnAuditFailure(scope: string, error: unknown): void {
    const now = Date.now();
    if (now - this.lastAuditWarningAt < 30_000) return;
    this.lastAuditWarningAt = now;
    console.error(
      `[AI Audit] ${scope} failed; the Mira response was preserved:`,
      error instanceof Error ? error.message : error,
    );
  }

  async logUsage(
    request: AiGenerateRequest,
    response: AiGenerateResponse,
    error?: Error,
  ): Promise<number> {
    try {
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
        ],
      );
      return Number((result as { insertId?: number }).insertId || 0);
    } catch (auditError) {
      this.warnAuditFailure('usage log', auditError);
      return 0;
    }
  }

  async logPromptAudit(
    request: AiGenerateRequest,
    piiRedactionApplied: boolean,
    sensitiveFieldsRemoved: string[],
    responseSummary?: string,
    detectedIntent?: string,
  ): Promise<void> {
    const questionHash = this.hashString(request.userQuestion);
    const contextHash = this.hashString(JSON.stringify(request.sanitizedContext));

    try {
      await db.execute(
        `INSERT INTO ai_prompt_audit_log (
          user_id, provider_key, model_name, request_source,
          question_hash, sanitized_context_hash,
          pii_redaction_applied, sensitive_fields_removed_json, response_summary, detected_intent
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          detectedIntent || null,
        ],
      );
    } catch (auditError) {
      this.warnAuditFailure('prompt audit log', auditError);
    }
  }

  async logFeedback(
    userId: string,
    requestId: number | null,
    providerKey: string,
    modelName: string,
    rating: 'helpful' | 'not_helpful' | 'incorrect' | 'unsafe',
    feedbackText?: string,
  ): Promise<void> {
    await db.execute(
      `INSERT INTO ai_feedback (
        user_id, provider_key, model_name, request_id, rating, feedback_text
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, providerKey, modelName, requestId, rating, feedbackText || null],
    );
  }

  async getProviderUsageStats(
    providerKey?: string,
    fromDate?: Date,
    toDate?: Date,
  ): Promise<{
    totalRequests: number;
    successRate: number;
    avgLatencyMs: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    fallbackCount: number;
    safetyBlockedCount: number;
  }> {
    const from = fromDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = toDate || new Date();
    // providerKey is optional so an all-providers total is possible — a small
    // new capability (not pure wiring): the clause and its param are only
    // included when a key is actually supplied.
    const providerClause = providerKey ? 'provider_key = ? AND ' : '';
    const params = providerKey ? [providerKey, from, to] : [from, to];
    const [rows] = await db.execute<any[]>(
      `SELECT
        COUNT(*) AS total_requests,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS success_count,
        AVG(latency_ms) AS avg_latency_ms,
        SUM(COALESCE(input_token_count, 0)) AS total_input_tokens,
        SUM(COALESCE(output_token_count, 0)) AS total_output_tokens,
        SUM(CASE WHEN fallback_used = 1 THEN 1 ELSE 0 END) AS fallback_count,
        SUM(CASE WHEN safety_blocked = 1 THEN 1 ELSE 0 END) AS safety_blocked_count
      FROM ai_provider_usage_log
      WHERE ${providerClause}created_at BETWEEN ? AND ?`,
      params,
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
    const params: unknown[] = [];
    if (filters.providerKey) { conditions.push('provider_key = ?'); params.push(filters.providerKey); }
    if (filters.userId) { conditions.push('user_id = ?'); params.push(filters.userId); }
    if (filters.requestSource) { conditions.push('request_source = ?'); params.push(filters.requestSource); }
    if (filters.fromDate) { conditions.push('created_at >= ?'); params.push(filters.fromDate); }
    if (filters.toDate) { conditions.push('created_at <= ?'); params.push(filters.toDate); }
    const whereClause = conditions.join(' AND ');
    const [countRows] = await db.execute<any[]>(
      `SELECT COUNT(*) AS total FROM ai_provider_usage_log WHERE ${whereClause}`,
      params,
    );
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;
    const [logs] = await db.execute<any[]>(
      `SELECT * FROM ai_provider_usage_log
       WHERE ${whereClause}
       ORDER BY created_at DESC
       ${sqlLimitOffset(limit, offset)}`,
      params,
    );
    return { logs: logs as AiUsageLogRow[], total: Number(countRows[0]?.total || 0) };
  }

  async getPromptAuditLogs(filters: {
    userId?: string;
    providerKey?: string;
    fromDate?: Date;
    toDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<{ logs: AiPromptAuditRow[]; total: number }> {
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];
    if (filters.userId) { conditions.push('user_id = ?'); params.push(filters.userId); }
    if (filters.providerKey) { conditions.push('provider_key = ?'); params.push(filters.providerKey); }
    if (filters.fromDate) { conditions.push('created_at >= ?'); params.push(filters.fromDate); }
    if (filters.toDate) { conditions.push('created_at <= ?'); params.push(filters.toDate); }
    const whereClause = conditions.join(' AND ');
    const [countRows] = await db.execute<any[]>(
      `SELECT COUNT(*) AS total FROM ai_prompt_audit_log WHERE ${whereClause}`,
      params,
    );
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;
    const [logs] = await db.execute<any[]>(
      `SELECT * FROM ai_prompt_audit_log
       WHERE ${whereClause}
       ORDER BY created_at DESC
       ${sqlLimitOffset(limit, offset)}`,
      params,
    );
    return { logs: logs as AiPromptAuditRow[], total: Number(countRows[0]?.total || 0) };
  }

  async getTodayUsageCount(providerKey?: string): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const providerClause = providerKey ? 'provider_key = ? AND ' : '';
    const params = providerKey ? [providerKey, today] : [today];
    const [rows] = await db.execute<any[]>(
      `SELECT COUNT(*) AS count FROM ai_provider_usage_log
       WHERE ${providerClause}created_at >= ?`,
      params,
    );
    return Number(rows[0]?.count || 0);
  }

  async getMonthUsageCount(providerKey?: string): Promise<number> {
    const firstDay = new Date();
    firstDay.setDate(1);
    firstDay.setHours(0, 0, 0, 0);
    const providerClause = providerKey ? 'provider_key = ? AND ' : '';
    const params = providerKey ? [providerKey, firstDay] : [firstDay];
    const [rows] = await db.execute<any[]>(
      `SELECT COUNT(*) AS count FROM ai_provider_usage_log
       WHERE ${providerClause}created_at >= ?`,
      params,
    );
    return Number(rows[0]?.count || 0);
  }

  async getTodayTokenUsage(providerKey?: string): Promise<{ inputTokens: number; outputTokens: number }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return this.getTokenUsageSince(providerKey, today);
  }

  async getMonthTokenUsage(providerKey?: string): Promise<{ inputTokens: number; outputTokens: number }> {
    const firstDay = new Date();
    firstDay.setDate(1);
    firstDay.setHours(0, 0, 0, 0);
    return this.getTokenUsageSince(providerKey, firstDay);
  }

  private async getTokenUsageSince(
    providerKey: string | undefined,
    fromDate: Date,
  ): Promise<{ inputTokens: number; outputTokens: number }> {
    const providerClause = providerKey ? 'provider_key = ? AND ' : '';
    const params = providerKey ? [providerKey, fromDate] : [fromDate];
    const [rows] = await db.execute<any[]>(
      `SELECT
        SUM(COALESCE(input_token_count, 0)) AS input_tokens,
        SUM(COALESCE(output_token_count, 0)) AS output_tokens
       FROM ai_provider_usage_log
       WHERE ${providerClause}created_at >= ?`,
      params,
    );
    return {
      inputTokens: Number(rows[0]?.input_tokens || 0),
      outputTokens: Number(rows[0]?.output_tokens || 0),
    };
  }

  private hashString(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}

export const aiAuditService = new AiAuditService();
