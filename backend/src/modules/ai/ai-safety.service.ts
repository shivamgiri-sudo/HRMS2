/**
 * AI Safety Service
 * Enforces PII protection, role-based visibility, and sanitized context generation
 * PeopleOS AI Enhancement Phase 1
 */

import type { PiiCategory, SanitizedContext } from './ai-provider.types.js';
import { aiRedactionService } from './ai-redaction.service.js';

interface SafetyCheckResult {
  allowed: boolean;
  reason?: string;
  blockedCategories?: PiiCategory[];
}

interface ContextSanitizationResult {
  sanitizedContext: SanitizedContext;
  piiRedactionApplied: boolean;
  sensitiveFieldsRemoved: string[];
  dataConfidence: Record<string, number>;
}

class AiSafetyService {
  /**
   * Check if context is safe for external AI provider
   */
  async checkContextSafety(
    context: Record<string, unknown>,
    useExternalProvider: boolean
  ): Promise<SafetyCheckResult> {
    // Rule-based provider always allowed (no external API)
    if (!useExternalProvider) {
      return { allowed: true };
    }

    // Check for raw sensitive data in context
    const contextStr = JSON.stringify(context);
    const piiDetection = aiRedactionService.detectPii(contextStr);

    if (piiDetection.hasPii) {
      // Block external provider if raw PII detected
      return {
        allowed: false,
        reason: 'Context contains raw PII that cannot be sent to external AI provider',
        blockedCategories: piiDetection.categories,
      };
    }

    // Check for sensitive field names
    const { removed } = aiRedactionService.removeSensitiveFields(context);
    if (removed.length > 0 && removed.some((field) => this.isCriticalField(field))) {
      return {
        allowed: false,
        reason: 'Context contains critical sensitive fields',
        blockedCategories: ['payroll_sensitive', 'statutory_sensitive'],
      };
    }

    return { allowed: true };
  }

  /**
   * Check if field is critical (salary, statutory, bank)
   */
  private isCriticalField(fieldName: string): boolean {
    const critical = [
      'salary',
      'ctc',
      'basic_pay',
      'gross_salary',
      'net_salary',
      'aadhaar',
      'pan',
      'bank_account',
      'account_number',
      'password',
      'api_key',
      'secret',
    ];
    const lower = fieldName.toLowerCase();
    return critical.some((c) => lower.includes(c));
  }

  /**
   * Sanitize context for AI provider
   * Removes PII, masks identifiers, keeps only safe aggregates
   */
  async sanitizeContext(
    rawContext: Record<string, unknown>,
    roleKeys: string[]
  ): Promise<ContextSanitizationResult> {
    // Remove sensitive fields first
    const { cleaned, removed } = aiRedactionService.removeSensitiveFields(rawContext);

    // Redact any remaining PII in text values
    const redacted = aiRedactionService.redactObject(cleaned);

    // Convert raw employee/candidate codes to masked versions
    const sanitized = this.maskIdentifiers(redacted);

    // Add safety metadata
    const sanitizedContext: SanitizedContext = {
      ...sanitized,
      safe_mode: true,
      last_refreshed_at: new Date().toISOString(),
    };

    // Calculate data confidence (if confidence fields present)
    const dataConfidence = this.extractDataConfidence(rawContext);
    if (Object.keys(dataConfidence).length > 0) {
      sanitizedContext.data_confidence = dataConfidence;
    }

    return {
      sanitizedContext,
      piiRedactionApplied: removed.length > 0,
      sensitiveFieldsRemoved: removed,
      dataConfidence,
    };
  }

  /**
   * Mask employee and candidate identifiers
   */
  private maskIdentifiers(context: Record<string, unknown>): Record<string, unknown> {
    const masked: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(context)) {
      if (value === null || value === undefined) {
        masked[key] = value;
      } else if (key === 'employee_id' || key === 'employeeId') {
        // Keep as is for backend correlation, but mask employee_code
        masked[key] = value;
      } else if (key === 'employee_code' || key === 'employeeCode') {
        masked[key] = typeof value === 'string' ? aiRedactionService.maskEmployeeCode(value) : value;
      } else if (key === 'candidate_id' || key === 'candidateId') {
        masked[key] = value;
      } else if (key === 'candidate_code' || key === 'candidateCode') {
        masked[key] = typeof value === 'string' ? aiRedactionService.maskCandidateCode(value) : value;
      } else if (key === 'full_name' || key === 'fullName' || key === 'name') {
        // Mask employee/candidate names
        masked[key] = typeof value === 'string' ? this.maskName(value) : value;
      } else if (Array.isArray(value)) {
        masked[key] = value.map((item) =>
          typeof item === 'object' && item !== null
            ? this.maskIdentifiers(item as Record<string, unknown>)
            : item
        );
      } else if (typeof value === 'object') {
        masked[key] = this.maskIdentifiers(value as Record<string, unknown>);
      } else {
        masked[key] = value;
      }
    }

    return masked;
  }

  /**
   * Mask person name (show first name initial only)
   */
  private maskName(name: string): string {
    if (!name || typeof name !== 'string') return '***';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 0) return '***';
    return `${parts[0][0]}***`;
  }

  /**
   * Extract data confidence scores from context
   */
  private extractDataConfidence(context: Record<string, unknown>): Record<string, number> {
    const confidence: Record<string, number> = {};

    // Look for confidence_score, data_confidence fields
    if (typeof context.confidence_score === 'number') {
      confidence.overall = context.confidence_score;
    }

    if (context.data_confidence && typeof context.data_confidence === 'object') {
      const dc = context.data_confidence as Record<string, unknown>;
      for (const [key, value] of Object.entries(dc)) {
        if (typeof value === 'number') {
          confidence[key] = value;
        }
      }
    }

    return confidence;
  }

  /**
   * Build system instruction for AI provider
   */
  buildSystemInstruction(roleKeys: string[], module?: string): string {
    const role = roleKeys[0] || 'employee';
    const roleDisplay = this.getRoleDisplay(role);

    const peopleOSPrefix = `You are PeopleOS Copilot, an AI assistant for MAS Callnet's HR platform. ` +
      `Answer employee questions about their salary, attendance, leave, and HR data ` +
      `using the provided context. Be concise, specific, and friendly. ` +
      `Always use ₹ (Indian Rupee) for currency. ` +
      `If the data isn't in the context, say so honestly — never fabricate figures. ` +
      `\n\n`;

    return peopleOSPrefix + `You are a PeopleOS Assistant for MAS Callnet HRMS.

Your role:
- Provide insights and recommendations based on the provided context
- Explain HRMS data in clear, business-friendly language
- Highlight risks, blockers, and action items
- Always cite data freshness and confidence scores
- Never make final decisions on payroll, BGV, compliance, or termination
- Never claim actions were completed when they were not
- Always label recommendations as AI-generated with confidence levels

User context:
- Role: ${roleDisplay}
${module ? `- Module: ${module}` : ''}
- Data is sanitized and PII-protected

Rules:
- Do not invent employee names, codes, or IDs not in the context
- Do not reveal sensitive data (salary, Aadhaar, PAN, bank)
- Stay within the user's business scope
- Recommend next actions, do not execute them
- Always mention data confidence and freshness
- Label insights as "AI-generated recommendation"

Answer the user's question based solely on the provided context. Be concise and actionable.`;
  }

  /**
   * Get role display name
   */
  private getRoleDisplay(roleKey: string): string {
    const roleMap: Record<string, string> = {
      super_admin: 'Super Admin',
      admin: 'Admin',
      ceo: 'CEO',
      hr: 'HR',
      payroll: 'Payroll',
      payroll_hr: 'Payroll HR',
      wfm: 'WFM',
      process_manager: 'Process Manager',
      manager: 'Manager',
      team_leader: 'Team Leader',
      tl: 'Team Leader',
      recruiter: 'Recruiter',
      trainer: 'Trainer',
      qa: 'QA',
      employee: 'Employee',
    };
    return roleMap[roleKey] || roleKey;
  }

  /**
   * Validate AI response for safety
   */
  validateResponse(response: string): { safe: boolean; reason?: string } {
    // Check for PII in response
    const piiDetection = aiRedactionService.detectPii(response);
    if (piiDetection.hasPii) {
      return {
        safe: false,
        reason: 'AI response contains PII',
      };
    }

    // Check for execution claims
    const executionPatterns = [
      /i\s+(have\s+)?(completed|executed|performed|ran|updated|deleted|created)/i,
      /successfully\s+(completed|executed|performed|updated|deleted|created)/i,
      /action\s+(was|has been)\s+(completed|executed)/i,
    ];

    for (const pattern of executionPatterns) {
      if (pattern.test(response)) {
        return {
          safe: false,
          reason: 'AI response claims to have executed actions (not allowed)',
        };
      }
    }

    return { safe: true };
  }

  /**
   * Generate safe role-based insights from context
   * Used by rule-based provider
   */
  generateRuleBasedInsights(
    context: Record<string, unknown>,
    roleKeys: string[]
  ): string {
    // Intent-enriched answers take priority for any role
    const intent = context.intent as string | undefined;

    if (intent === 'salary_breakup' && context.salary_data_available === true) {
      return this.formatSalaryBreakup(context);
    }
    if (intent === 'leave_balance' && context.leave_data_available === true) {
      return this.formatLeaveBalance(context);
    }
    if (intent === 'attendance_summary' && context.attendance_data_available === true) {
      return this.formatAttendanceSummary(context);
    }
    if (intent === 'salary_breakup' && context.salary_data_available === false) {
      return 'No payslip records found yet. Your salary summary will appear here once your first payroll is processed. Contact HR if you believe this is an error.';
    }
    if (intent === 'leave_balance' && context.leave_data_available === false) {
      return 'No leave balance records found for this year. Leave balances are set up by HR at the start of each year. Please contact HR to check your allocation.';
    }
    if (intent === 'attendance_summary' && context.attendance_data_available === false) {
      return 'No attendance records found for this month yet. Attendance is recorded daily — check back after your first punch-in.';
    }

    const role = roleKeys[0] || 'employee';

    // Extract common metrics
    const blockedCount = this.extractNumber(context, [
      'blocked_count',
      'blockedCount',
      'blocked',
    ]);
    const riskyCount = this.extractNumber(context, [
      'risky_count',
      'riskyCount',
      'risky_records',
      'risk_count',
    ]);
    const activeCount = this.extractNumber(context, [
      'active_headcount',
      'activeHeadcount',
      'active_count',
    ]);

    // Role-specific insights
    if (role === 'payroll' || role === 'payroll_hr') {
      if (blockedCount > 0) {
        return this.generatePayrollBlockerInsight(context, blockedCount);
      }
      return 'Payroll readiness check shows no blockers. System is ready for payroll processing.';
    }

    if (role === 'wfm') {
      if (riskyCount > 0) {
        return this.generateAttendanceRiskInsight(context, riskyCount);
      }
      return 'Attendance monitoring shows no high-risk exceptions. Operations running smoothly.';
    }

    if (role === 'ceo' || role === 'admin') {
      return this.generateExecutiveSummary(context, activeCount, blockedCount, riskyCount);
    }

    // Default insight
    return 'Context analyzed. No immediate action items detected. All systems operating normally.';
  }

  private extractNumber(context: Record<string, unknown>, keys: string[]): number {
    for (const key of keys) {
      const value = context[key];
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        const num = parseFloat(value);
        if (!isNaN(num)) return num;
      }
    }
    return 0;
  }

  private generatePayrollBlockerInsight(
    context: Record<string, unknown>,
    blockedCount: number
  ): string {
    let insight = `Found ${blockedCount} employee(s) blocked from payroll. `;

    // Look for blocker breakdown
    const topBlockers = context.top_blockers as Array<{ reason: string; count: number }> | undefined;
    if (topBlockers && Array.isArray(topBlockers) && topBlockers.length > 0) {
      const top = topBlockers[0];
      insight += `Top blocker: ${top.reason} (${top.count} employee${top.count > 1 ? 's' : ''}). `;
    }

    insight += 'Recommend resolving blockers before payroll run.';

    return insight;
  }

  private generateAttendanceRiskInsight(
    context: Record<string, unknown>,
    riskyCount: number
  ): string {
    let insight = `Detected ${riskyCount} attendance exception(s). `;

    const lateMarks = this.extractNumber(context, ['late_marks', 'lateMarks']);
    const lwpDays = this.extractNumber(context, ['lwp_days', 'lwpDays', 'lwp_value']);

    if (lateMarks > 0) {
      insight += `${lateMarks} late mark(s). `;
    }
    if (lwpDays > 0) {
      insight += `${lwpDays} LWP day(s). `;
    }

    insight += 'Recommend scanning exceptions and resolving unreconciled records.';

    return insight;
  }

  private generateExecutiveSummary(
    context: Record<string, unknown>,
    activeCount: number,
    blockedCount: number,
    riskyCount: number
  ): string {
    let summary = '';

    if (activeCount > 0) {
      summary += `Active headcount: ${activeCount}. `;
    }

    const issues: string[] = [];
    if (blockedCount > 0) {
      issues.push(`${blockedCount} payroll blocker(s)`);
    }
    if (riskyCount > 0) {
      issues.push(`${riskyCount} attendance exception(s)`);
    }

    if (issues.length > 0) {
      summary += `Action items: ${issues.join(', ')}. `;
    } else {
      summary += 'No critical action items. ';
    }

    summary += 'All systems operational.';

    return summary;
  }

  private formatSalaryBreakup(ctx: Record<string, unknown>): string {
    const month = String(ctx.salary_month ?? 'latest period');
    const earnings = Number(ctx.earnings_total ?? 0);
    const deductions = Number(ctx.deductions_total ?? 0);
    const takeHome = Number(ctx.take_home_amount ?? 0);
    const basic = Number(ctx.basic_component ?? 0);
    const hra = Number(ctx.hra_component ?? 0);
    const special = Number(ctx.special_allowance_component ?? 0);
    const pf = Number(ctx.pf_deduction ?? 0);
    const tds = Number(ctx.tds_deduction ?? 0);
    const pt = Number(ctx.professional_tax_deduction ?? 0);
    const lwp = Number(ctx.lwp_deduction ?? 0);
    const presentDays = Number(ctx.present_days_count ?? 0);
    const workingDays = Number(ctx.working_days_count ?? 0);

    const fmt = (n: number) => `₹${n.toLocaleString('en-IN')}`;

    const lines: string[] = [
      `Your salary for ${month}:`,
      ``,
      `Earnings: ${fmt(earnings)}`,
      basic > 0 ? `  • Basic: ${fmt(basic)}` : '',
      hra > 0 ? `  • HRA: ${fmt(hra)}` : '',
      special > 0 ? `  • Special Allowance: ${fmt(special)}` : '',
      ``,
      `Deductions: ${fmt(deductions)}`,
      pf > 0 ? `  • PF: ${fmt(pf)}` : '',
      tds > 0 ? `  • TDS: ${fmt(tds)}` : '',
      pt > 0 ? `  • Professional Tax: ${fmt(pt)}` : '',
      lwp > 0 ? `  • LWP Deduction: ${fmt(lwp)}` : '',
      ``,
      `Take-home: ${fmt(takeHome)}`,
      workingDays > 0 ? `Present: ${presentDays}/${workingDays} days` : '',
    ];
    return lines.filter(Boolean).join('\n');
  }

  private formatLeaveBalance(ctx: Record<string, unknown>): string {
    const year = Number(ctx.leave_year ?? new Date().getFullYear());
    const balances = ctx.leave_balances as Array<{
      name: string; allocated: number; used: number; available: number
    }> ?? [];
    if (!balances.length) return `No leave balance data available for ${year}.`;

    const lines = [`Your leave balances for ${year}:`, ``];
    for (const b of balances) {
      lines.push(`${b.name}: ${b.available} days available (${b.used}/${b.allocated} used)`);
    }
    const totalAvail = Number(ctx.total_available_leaves ?? 0);
    lines.push(``, `Total available: ${totalAvail} days`);
    return lines.join('\n');
  }

  private formatAttendanceSummary(ctx: Record<string, unknown>): string {
    const month = String(ctx.attendance_month ?? 'this month');
    const present = Number(ctx.present_days_att ?? 0);
    const absent = Number(ctx.absent_days_att ?? 0);
    const late = Number(ctx.late_days_att ?? 0);
    const lateMarks = Number(ctx.late_marks_count ?? 0);
    const lwp = Number(ctx.lwp_total ?? 0);
    const workingDays = Number(ctx.working_days_att ?? 0);
    const attPct = Number(ctx.attendance_percentage ?? 0);
    const hours = Number(ctx.total_hours_logged ?? 0);

    const lines = [
      `Your attendance for ${month}:`,
      ``,
      `Present: ${present} days | Absent: ${absent} days | Late: ${late} days`,
      `Attendance: ${attPct}% (${present}/${workingDays} working days)`,
      lateMarks > 0 ? `Late marks: ${lateMarks}` : '',
      lwp > 0 ? `LWP (Leave Without Pay): ${lwp} day(s)` : '',
      hours > 0 ? `Total hours logged: ${hours}h` : '',
    ];
    return lines.filter(Boolean).join('\n');
  }
}

export const aiSafetyService = new AiSafetyService();
