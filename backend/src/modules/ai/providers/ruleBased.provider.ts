/**
 * Rule-Based AI Provider
 * Deterministic insights without external API calls
 * Always available as fallback
 * PeopleOS AI Enhancement Phase 1
 */

import type {
  AiProvider,
  SafeAiProviderConfig,
  AiProviderTestResult,
  AiGenerateRequest,
  AiGenerateResponse,
} from '../ai-provider.types.js';
import { aiSafetyService } from '../ai-safety.service.js';

export class RuleBasedProvider implements AiProvider {
  key = 'rule-based';
  displayName = 'Rule-Based Provider (No External AI)';
  supportsChat = true;
  supportsJson = false;
  supportsStreaming = false;
  supportsEmbeddings = false;

  async testConnection(_config: SafeAiProviderConfig): Promise<AiProviderTestResult> {
    const startTime = Date.now();
    // Rule-based provider always works (no external dependency)
    return {
      success: true,
      latencyMs: Date.now() - startTime,
      model: 'internal-rules-v1',
    };
  }

  async generateText(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    const startTime = Date.now();

    // Generate deterministic insights from sanitized context
    const answer = aiSafetyService.generateRuleBasedInsights(
      request.sanitizedContext,
      request.roleKeys
    );

    // Extract insights and actions from context
    const insights = this.extractInsights(request.sanitizedContext);
    const actions = this.extractActions(request.sanitizedContext);

    const response: AiGenerateResponse = {
      answer,
      provider: this.key,
      model: 'internal-rules-v1',
      latencyMs: Date.now() - startTime,
      safetyBlocked: false,
      fallbackUsed: false,
      generatedAt: new Date().toISOString(),
      sourceContexts: this.extractSourceContexts(request.sanitizedContext),
      dataConfidence: request.sanitizedContext.data_confidence as Record<string, number> | undefined,
      insights,
      actions,
    };

    return response;
  }

  /**
   * Extract insights from context
   */
  private extractInsights(context: Record<string, unknown>): Array<{
    key: string;
    label: string;
    count?: number;
    severity?: 'low' | 'medium' | 'high' | 'critical';
  }> {
    const insights: any[] = [];

    // Check for common insight patterns
    if (typeof context.blocked_count === 'number' && context.blocked_count > 0) {
      insights.push({
        key: 'payroll_blocked',
        label: 'Payroll Blocked',
        count: context.blocked_count,
        severity: context.blocked_count > 10 ? 'critical' : context.blocked_count > 5 ? 'high' : 'medium',
      });
    }

    if (typeof context.risky_records === 'number' && context.risky_records > 0) {
      insights.push({
        key: 'attendance_risk',
        label: 'Attendance Exceptions',
        count: context.risky_records,
        severity: context.risky_records > 20 ? 'critical' : context.risky_records > 10 ? 'high' : 'medium',
      });
    }

    if (typeof context.late_marks === 'number' && context.late_marks > 0) {
      insights.push({
        key: 'late_marks',
        label: 'Late Marks',
        count: context.late_marks,
        severity: 'medium',
      });
    }

    if (typeof context.breached_tickets === 'number' && context.breached_tickets > 0) {
      insights.push({
        key: 'sla_breach',
        label: 'SLA Breached Tickets',
        count: context.breached_tickets,
        severity: 'high',
      });
    }

    if (typeof context.open_grievances === 'number' && context.open_grievances > 0) {
      insights.push({
        key: 'grievances',
        label: 'Open Grievances',
        count: context.open_grievances,
        severity: 'medium',
      });
    }

    return insights;
  }

  /**
   * Extract actionable items from context
   */
  private extractActions(context: Record<string, unknown>): Array<{
    key: string;
    label: string;
    url: string;
    priority: 'low' | 'medium' | 'high' | 'critical';
  }> {
    const actions: any[] = [];

    // Payroll blockers
    if (typeof context.blocked_count === 'number' && context.blocked_count > 0) {
      actions.push({
        key: 'resolve_payroll_blockers',
        label: 'Resolve Payroll Blockers',
        url: '/payroll/readiness',
        priority: context.blocked_count > 10 ? 'critical' : 'high',
      });
    }

    // Attendance exceptions
    if (typeof context.risky_records === 'number' && context.risky_records > 0) {
      actions.push({
        key: 'resolve_attendance_exceptions',
        label: 'Resolve Attendance Exceptions',
        url: '/attendance/exception-engine',
        priority: context.risky_records > 20 ? 'critical' : 'high',
      });
    }

    // Support SLA breach
    if (typeof context.breached_tickets === 'number' && context.breached_tickets > 0) {
      actions.push({
        key: 'resolve_sla_breach',
        label: 'Resolve SLA Breached Tickets',
        url: '/helpdesk',
        priority: 'high',
      });
    }

    // Grievances
    if (typeof context.open_grievances === 'number' && context.open_grievances > 0) {
      actions.push({
        key: 'review_grievances',
        label: 'Review Open Grievances',
        url: '/grievance',
        priority: 'medium',
      });
    }

    return actions;
  }

  /**
   * Extract source context names
   */
  private extractSourceContexts(context: Record<string, unknown>): string[] {
    const sources: string[] = [];

    if (context.blocked_count !== undefined) {
      sources.push('payroll_readiness');
    }
    if (context.risky_records !== undefined || context.late_marks !== undefined) {
      sources.push('attendance_exceptions');
    }
    if (context.breached_tickets !== undefined) {
      sources.push('support_sla');
    }
    if (context.open_grievances !== undefined) {
      sources.push('grievances');
    }
    if (context.active_headcount !== undefined) {
      sources.push('headcount_summary');
    }

    return sources.length > 0 ? sources : ['generic_context'];
  }
}

export const ruleBasedProvider = new RuleBasedProvider();
