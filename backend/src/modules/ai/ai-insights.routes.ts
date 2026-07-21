/**
 * AI Insights Routes
 * Full AI provider API implementation
 * PeopleOS AI Enhancement Phase 1
 */

import { Router } from 'express';
import type { Response } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { apiError, apiSuccess } from '../../shared/apiResponse.js';
import { aiProviderRegistry } from './ai-provider.registry.js';
import { aiProviderConfigService } from './ai-provider-config.service.js';
import { aiSafetyService } from './ai-safety.service.js';
import { aiAuditService } from './ai-audit.service.js';
import { checkAndIncrement } from './ai-rate-limiter.js';
import { validateQuestion, validateContextType, validateEntityId } from './ai-input-guard.js';
import type { AiGenerateRequest } from './ai-provider.types.js';
import { detectAndEnrich } from './ai-intent.service.js';
import type { Pool } from 'mysql2/promise';
import { db } from '../../db/mysql.js';

export const aiInsightsRouter = Router();

const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: (err?: unknown) => void) => fn(req, res).catch(next);

// All routes require authentication
aiInsightsRouter.use(requireAuth);

/**
 * GET /api/ai/providers - List all providers (safe config, no API keys)
 */
aiInsightsRouter.get('/providers', requireRole('super_admin', 'admin'), h(async (req, res) => {
  const providers = await aiProviderConfigService.list();
  const registry = aiProviderRegistry.listAll();

  // Merge DB config with registry info
  const merged = providers.map((config) => {
    const registryEntry = registry.find((r) => r.key === config.providerKey);
    return {
      ...config,
      capabilities: registryEntry?.capabilities || {
        supportsChat: false,
        supportsJson: false,
        supportsStreaming: false,
        supportsEmbeddings: false,
      },
    };
  });

  return res.json(apiSuccess(merged));
}));

/**
 * GET /api/ai/providers/active - Get active default provider
 */
aiInsightsRouter.get('/providers/active', h(async (req, res) => {
  const config = await aiProviderConfigService.getDefaultProvider(false);
  return res.json(apiSuccess(config || { providerKey: 'rule-based', providerName: 'Rule-Based Provider' }));
}));

/**
 * POST /api/ai/providers - Create provider config
 */
aiInsightsRouter.post('/providers', requireRole('super_admin', 'admin'), h(async (req, res) => {
  const { providerKey, providerName, apiKey, modelName, baseUrl, timeout, dailyRequestLimit, monthlyRequestLimit, dailyTokenLimit, monthlyTokenLimit } = req.body;

  if (!providerKey || !providerName) {
    return res.status(400).json(apiError('VALIDATION_ERROR', 'providerKey and providerName are required', 400));
  }

  const created = await aiProviderConfigService.create({
    providerKey,
    providerName,
    apiKey,
    modelName,
    baseUrl,
    timeoutMs: timeout,
    dailyRequestLimit,
    monthlyRequestLimit,
    dailyTokenLimit,
    monthlyTokenLimit,
    createdBy: req.authUser!.id,
  });

  return res.status(201).json(apiSuccess(created));
}));

/**
 * PUT /api/ai/providers/:id - Update provider config
 */
aiInsightsRouter.put('/providers/:id', requireRole('super_admin', 'admin'), h(async (req, res) => {
  const { providerName, activeStatus, isDefault, apiKey, modelName, baseUrl, timeout, dailyRequestLimit, monthlyRequestLimit, dailyTokenLimit, monthlyTokenLimit } = req.body;

  const updated = await aiProviderConfigService.update(req.params.id, {
    providerName,
    activeStatus,
    isDefault,
    apiKey, // Will preserve existing if blank
    modelName,
    baseUrl,
    timeoutMs: timeout,
    dailyRequestLimit,
    monthlyRequestLimit,
    dailyTokenLimit,
    monthlyTokenLimit,
    updatedBy: req.authUser!.id,
  });

  return res.json(apiSuccess(updated));
}));

/**
 * POST /api/ai/providers/:id/test - Test provider connection
 */
aiInsightsRouter.post('/providers/:id/test', requireRole('super_admin', 'admin'), h(async (req, res) => {
  const [rows] = await (await import('../../db/mysql.js')).db.execute<any[]>(
    'SELECT provider_key FROM ai_provider_config WHERE id = ? LIMIT 1',
    [req.params.id]
  );

  if (rows.length === 0) {
    return res.status(404).json(apiError('NOT_FOUND', 'Provider not found', 404));
  }

  const providerKey = rows[0].provider_key;
  const withConfig = await aiProviderRegistry.getWithConfig(providerKey);

  if (!withConfig) {
    return res.status(404).json(apiError('NOT_FOUND', 'Provider not found in registry', 404));
  }

  const testResult = await withConfig.provider.testConnection(withConfig.config!);

  return res.json(apiSuccess(testResult));
}));

/**
 * POST /api/ai/providers/:id/set-default - Set provider as default
 */
aiInsightsRouter.post('/providers/:id/set-default', requireRole('super_admin', 'admin'), h(async (req, res) => {
  const [rows] = await (await import('../../db/mysql.js')).db.execute<any[]>(
    'SELECT provider_key FROM ai_provider_config WHERE id = ? LIMIT 1',
    [req.params.id]
  );

  if (rows.length === 0) {
    return res.status(404).json(apiError('NOT_FOUND', 'Provider not found', 404));
  }

  await aiProviderConfigService.setDefault(rows[0].provider_key);

  return res.json(apiSuccess({ message: 'Provider set as default' }));
}));

/**
 * POST /api/ai/providers/:id/disable - Disable provider
 */
aiInsightsRouter.post('/providers/:id/disable', requireRole('super_admin', 'admin'), h(async (req, res) => {
  await aiProviderConfigService.update(req.params.id, {
    activeStatus: 'inactive',
    isDefault: false,
    updatedBy: req.authUser!.id,
  });

  return res.json(apiSuccess({ message: 'Provider disabled' }));
}));

/**
 * GET /api/ai/providers/usage - Usage logs
 */
aiInsightsRouter.get('/providers/usage', requireRole('super_admin', 'admin'), h(async (req, res) => {
  const { providerKey, userId, requestSource, fromDate, toDate, limit, offset } = req.query;

  const filters: any = {};
  if (providerKey) filters.providerKey = String(providerKey);
  if (userId) filters.userId = String(userId);
  if (requestSource) filters.requestSource = String(requestSource);
  if (fromDate) filters.fromDate = new Date(String(fromDate));
  if (toDate) filters.toDate = new Date(String(toDate));
  if (limit) filters.limit = parseInt(String(limit), 10);
  if (offset) filters.offset = parseInt(String(offset), 10);

  const result = await aiAuditService.getUsageLogs(filters);

  return res.json(apiSuccess(result));
}));

/**
 * POST /api/ai/insights - Compatibility endpoint for dashboard insight panels.
 * Interactive Copilot requests continue to use /ask; panels degrade to an
 * empty insight list when no server-generated recommendations are available.
 */
aiInsightsRouter.post('/insights', h(async (_req, res) => {
  return res.json(apiSuccess({ insights: [] }));
}));

/**
 * POST /api/ai/ask - Ask AI assistant
 */
aiInsightsRouter.post('/ask', h(async (req, res) => {
  const { question, context_type, entity_id } = req.body;

  const userId = req.authUser!.id;
  const roleKeys: string[] = (req as any).userRoles || ['employee'];

  // Input guard — validate before rate-limit so blocked input isn't counted
  const questionCheck = validateQuestion(question ?? '');
  if (!questionCheck.valid) {
    return res.status(400).json(apiError('VALIDATION_ERROR', questionCheck.reason!, 400));
  }
  const contextCheck = validateContextType(context_type, roleKeys);
  if (!contextCheck.valid) {
    return res.status(403).json(apiError('FORBIDDEN', contextCheck.reason!, 403));
  }
  const entityCheck = validateEntityId(entity_id);
  if (!entityCheck.valid) {
    return res.status(400).json(apiError('VALIDATION_ERROR', entityCheck.reason!, 400));
  }

  // Per-user daily rate limit
  const providerConfig = await aiProviderConfigService.getDefaultProvider(false);
  const rateResult = checkAndIncrement(userId, providerConfig?.dailyRequestLimit ?? 0);
  if (!rateResult.allowed) {
    res.setHeader('X-RateLimit-Remaining', '0');
    res.setHeader('X-RateLimit-Reset', rateResult.resetAt.toISOString());
    return res.status(429).json(apiError('RATE_LIMIT_EXCEEDED', 'Daily AI request limit reached. Try again tomorrow.', 429));
  }
  res.setHeader('X-RateLimit-Remaining', String(rateResult.remaining));

  const safeContextType = contextCheck.sanitizedContextType ?? 'generic';
  const safeEntityId = entity_id ? String(entity_id).slice(0, 128) : null;
  const safeQuestion = questionCheck.sanitizedQuestion!;

  // Get active provider
  const provider = await aiProviderRegistry.getDefault();
  const config = await aiProviderConfigService.getByKey(provider.key, true);

  const rawContext: Record<string, unknown> = {
    user_id: userId,
    user_role: roleKeys[0],
    context_type: safeContextType,
    entity_id: safeEntityId,
    timestamp: new Date().toISOString(),
  };

  // Intent enrichment — fetch real HRMS data for employee self-service questions
  try {
    const { intent, data } = await detectAndEnrich(safeQuestion, userId, db as unknown as Pool);
    if (intent !== 'unknown') {
      rawContext.intent = intent;
      Object.assign(rawContext, data);
    }
  } catch {
    // non-blocking — continue without enrichment
  }

  // Sanitize context
  const sanitizationResult = await aiSafetyService.sanitizeContext(rawContext, roleKeys);

  // Check if context is safe for external provider
  const useExternalProvider = provider.key !== 'rule-based';
  const safetyCheck = await aiSafetyService.checkContextSafety(
    sanitizationResult.sanitizedContext,
    useExternalProvider
  );

  if (!safetyCheck.allowed && useExternalProvider) {
    // Force fallback to rule-based provider
    console.warn('[AI] Context not safe for external provider, using rule-based fallback');
    const fallbackProvider = ruleBasedProvider;
    const request: AiGenerateRequest = {
      userId,
      roleKeys,
      providerKey: fallbackProvider.key,
      userQuestion: safeQuestion,
      sanitizedContext: sanitizationResult.sanitizedContext,
      requestSource: 'copilot',
      entityType: safeContextType,
      entityId: safeEntityId ?? undefined,
      systemInstruction: aiSafetyService.buildSystemInstruction(roleKeys, safeContextType),
    };

    const response = await fallbackProvider.generateText(request);

    // Log usage
    await aiAuditService.logUsage(request, response);
    await aiAuditService.logPromptAudit(
      request,
      sanitizationResult.piiRedactionApplied,
      sanitizationResult.sensitiveFieldsRemoved
    );

    return res.json(apiSuccess(response));
  }

  // Build AI request
  const request: AiGenerateRequest = {
    userId,
    roleKeys,
    providerKey: provider.key,
    model: config?.modelName,
    apiKey: config?.apiKey,
    systemInstruction: aiSafetyService.buildSystemInstruction(roleKeys, safeContextType),
    userQuestion: safeQuestion,
    sanitizedContext: sanitizationResult.sanitizedContext,
    temperature: 0.3,
    maxOutputTokens: 1024,
    requestSource: 'copilot',
    entityType: safeContextType,
    entityId: safeEntityId ?? undefined,
  };

  // Generate response
  const response = await provider.generateText(request);

  // Validate response safety
  const responseValidation = aiSafetyService.validateResponse(response.answer);
  if (!responseValidation.safe) {
    console.warn('[AI] Response validation failed:', responseValidation.reason);
    return res.status(400).json(
      apiError('AI_RESPONSE_UNSAFE', responseValidation.reason || 'AI response failed safety check', 400)
    );
  }

  // Log usage and audit
  await aiAuditService.logUsage(request, response);
  await aiAuditService.logPromptAudit(
    request,
    sanitizationResult.piiRedactionApplied,
    sanitizationResult.sensitiveFieldsRemoved,
    response.answer.slice(0, 200) // Summary only
  );

  return res.json(apiSuccess(response));
}));

/**
 * POST /api/ai/explain - Explain specific entity
 */
aiInsightsRouter.post('/explain', h(async (req, res) => {
  const { entity_type, entity_id } = req.body;

  if (!entity_type || !entity_id) {
    return res.status(400).json(apiError('VALIDATION_ERROR', 'entity_type and entity_id are required', 400));
  }

  const userId = req.authUser!.id;
  const roleKeys = (req as any).userRoles || ['employee'];

  // DPDP entity ownership check — employee role may only explain their own records
  const isPrivilegedRole = roleKeys.some((r: string) =>
    ['admin', 'super_admin', 'hr', 'hr_admin', 'manager', 'branch_head',
     'process_manager', 'payroll', 'payroll_hr', 'dpo', 'ceo'].includes(r)
  );
  if (!isPrivilegedRole && entity_type === 'employee') {
    const { db: dbConn } = await import('../../db/mysql.js');
    const [empRows] = await dbConn.execute<import('mysql2').RowDataPacket[]>(
      'SELECT id FROM employees WHERE user_id = ? LIMIT 1',
      [userId]
    );
    const ownEmployeeId: string | null = empRows[0]?.id ?? null;
    if (ownEmployeeId !== entity_id) {
      return res.status(403).json(apiError('FORBIDDEN', 'You may only request AI explanations for your own record.', 403));
    }
  }

  const provider = await aiProviderRegistry.getDefault();
  const config = await aiProviderConfigService.getByKey(provider.key, true);
  const rawContext = { user_id: userId, user_role: roleKeys[0], context_type: entity_type, entity_id };
  const sanitizationResult = await aiSafetyService.sanitizeContext(rawContext, roleKeys);

  const request: AiGenerateRequest = {
    userId,
    roleKeys,
    providerKey: provider.key,
    model: config?.modelName,
    apiKey: config?.apiKey,
    systemInstruction: aiSafetyService.buildSystemInstruction(roleKeys, entity_type),
    userQuestion: `Explain this ${entity_type} record (ID: ${entity_id}) in plain language. What does it represent and what actions might be needed?`,
    sanitizedContext: sanitizationResult.sanitizedContext,
    temperature: 0.2,
    maxOutputTokens: 512,
    requestSource: 'explain',
    entityType: entity_type,
    entityId: entity_id,
  };

  const response = await provider.generateText(request);
  await aiAuditService.logUsage(request, response);

  return res.json(apiSuccess({ ...response, entity_type, entity_id }));
}));

/**
 * GET /api/ai/role-insights - Get role-wise insights
 */
aiInsightsRouter.get('/role-insights', h(async (req, res) => {
  const userId = req.authUser!.id;
  const roleKeys: string[] = (req as any).userRoles || ['employee'];
  const role = roleKeys[0] ?? 'employee';

  // Shared daily rate limit with /ask
  const providerConfig = await aiProviderConfigService.getDefaultProvider(false);
  const rateResult = checkAndIncrement(userId, providerConfig?.dailyRequestLimit ?? 0);
  if (!rateResult.allowed) {
    res.setHeader('X-RateLimit-Remaining', '0');
    res.setHeader('X-RateLimit-Reset', rateResult.resetAt.toISOString());
    return res.status(429).json(apiError('RATE_LIMIT_EXCEEDED', 'Daily AI request limit reached.', 429));
  }

  const provider = await aiProviderRegistry.getDefault();

  // Build role-specific question for the AI provider
  const rolePromptMap: Record<string, string> = {
    payroll_hr: 'What are the top payroll readiness issues I should act on today? Focus on salary lock status, validation blockers, and overdue tasks.',
    hr: 'What are the top onboarding and joining actions I should prioritize today? Highlight any blocked candidates or overdue provisioning.',
    branch_head: 'What approval actions are pending for my branch today? Summarize any offers needing approval and new joiners.',
    wfm: 'What roster and shift alignment tasks need my attention today? Highlight unassigned employees or missing WFM data.',
    it: 'What IT provisioning tasks are overdue or unassigned today? Highlight employees who cannot login yet.',
    admin: 'What admin provisioning tasks (biometric, ID card) are pending today?',
    super_admin: 'Give me a summary of data anomalies, security flags, and system health issues that need attention.',
    manager: 'What team attendance, leave, and performance items need my action today?',
    employee: 'What tasks or actions do I need to complete today? Check joining documents, onboarding steps, or leave requests.',
  };

  const question = rolePromptMap[role] ?? `What actions should I take today as a ${role}?`;

  const rawContext = { user_id: userId, user_role: role, context_type: 'role_insights', timestamp: new Date().toISOString() };
  const sanitizationResult = await aiSafetyService.sanitizeContext(rawContext, roleKeys);

  const config = await aiProviderConfigService.getByKey(provider.key, true);
  const request: AiGenerateRequest = {
    userId,
    roleKeys,
    providerKey: provider.key,
    model: config?.modelName,
    apiKey: config?.apiKey,
    systemInstruction: aiSafetyService.buildSystemInstruction(roleKeys, 'role_insights'),
    userQuestion: question,
    sanitizedContext: sanitizationResult.sanitizedContext,
    temperature: 0.3,
    maxOutputTokens: 512,
    requestSource: 'role_insights',
  };

  const response = await provider.generateText(request);
  await aiAuditService.logUsage(request, response);

  return res.json(apiSuccess({ role, ...response }));
}));

/**
 * GET /api/ai/supported-contexts - Available context types for current user
 */
aiInsightsRouter.get('/supported-contexts', h(async (req, res) => {
  const roleKeys = (req as any).userRoles || ['employee'];

  const contexts: string[] = ['generic'];

  if (roleKeys.includes('payroll') || roleKeys.includes('payroll_hr')) {
    contexts.push('payroll_blockers', 'payroll_readiness');
  }

  if (roleKeys.includes('wfm')) {
    contexts.push('attendance_risk', 'roster_risk');
  }

  if (roleKeys.includes('ceo') || roleKeys.includes('admin')) {
    contexts.push('ceo_summary', 'people_risk', 'support_risk');
  }

  return res.json(apiSuccess({ contexts }));
}));

/**
 * POST /api/ai/feedback - Submit feedback on AI response
 */
aiInsightsRouter.post('/feedback', h(async (req, res) => {
  const { request_id, rating, feedback_text } = req.body;

  if (!rating || !['helpful', 'not_helpful', 'incorrect', 'unsafe'].includes(rating)) {
    return res.status(400).json(apiError('VALIDATION_ERROR', 'Invalid rating value', 400));
  }

  const provider = await aiProviderRegistry.getDefault();

  await aiAuditService.logFeedback(
    req.authUser!.id,
    request_id ? parseInt(request_id, 10) : null,
    provider.key,
    'unknown', // Model name not available here
    rating,
    feedback_text
  );

  return res.json(apiSuccess({ message: 'Feedback recorded' }));
}));

/**
 * POST /api/ai/explain-action - Explain business action with AI
 * Phase 2: Smart Work Inbox Enhancement
 */
aiInsightsRouter.post('/explain-action', h(async (req, res) => {
  const { action_id } = req.body;

  if (!action_id) {
    return res.status(400).json(apiError('VALIDATION_ERROR', 'action_id is required', 400));
  }

  const userId = req.authUser!.id;
  const roleKeys = (req as any).userRoles || ['employee'];

  // Fetch business action
  const { db } = await import('../../db/mysql.js');
  const [actions] = await db.execute<any[]>(
    'SELECT * FROM business_action_queue WHERE id = ? LIMIT 1',
    [action_id]
  );

  if (actions.length === 0) {
    return res.status(404).json(apiError('NOT_FOUND', 'Action not found', 404));
  }

  const action = actions[0];

  // Build sanitized context based on source module (no PII)
  let sanitizedContext: any = {
    risk_type: action.risk_type,
    severity: action.severity,
    source_module: action.source_module,
    title: action.title,
    status: action.status,
    escalation_level: action.escalation_level || 0,
  };

  // Module-specific context (safe data only - counts, not names)
  if (action.source_module === 'payroll') {
    const match = action.title?.match(/\((\d+) employees\)/);
    sanitizedContext.blocked_count = match ? parseInt(match[1]) : 0;
    sanitizedContext.blocker_type = action.title?.split(' (')[0] || 'Unknown';
  } else if (action.source_module === 'attendance') {
    const match = action.title?.match(/\((\d+) days\)/);
    sanitizedContext.unreconciled_days = match ? parseInt(match[1]) : 0;
  } else if (action.source_module === 'onboarding') {
    const match = action.description?.match(/Age: (\d+) days/);
    sanitizedContext.stuck_days = match ? parseInt(match[1]) : 0;
    sanitizedContext.stage = action.title?.split(' at ')[1]?.split(' (')[0] || 'unknown';
  } else if (action.source_module === 'roster') {
    const match = action.title?.match(/\((\d+) HC\)/);
    sanitizedContext.shortage = match ? parseInt(match[1]) : 0;
  }

  // Get active provider
  const provider = await aiProviderRegistry.getDefault();
  const config = await aiProviderConfigService.getByKey(provider.key, true);

  // Build system instruction for action explanation
  const systemInstruction = `You are a PeopleOS Assistant explaining business action items.

Explain concisely (2-3 sentences):
1. Why this action exists (what triggered it)
2. What the business risk is if not resolved
3. What the recommended next steps are (be specific)

Use clear, business-friendly language.
Do not mention employee names or codes. Use aggregates only.
Always label this as an AI recommendation.`;

  // Build AI request
  const request: AiGenerateRequest = {
    userId,
    roleKeys,
    providerKey: provider.key,
    model: config?.modelName,
    apiKey: config?.apiKey,
    systemInstruction,
    userQuestion: 'Explain this action and recommend next steps',
    sanitizedContext,
    temperature: 0.3,
    maxOutputTokens: 512,
    requestSource: 'explain_action',
    entityType: 'business_action',
    entityId: action_id,
  };

  // Generate response
  let response;
  let fallbackUsed = false;

  try {
    response = await provider.generateText(request);
  } catch (error) {
    console.warn('[AI Explain Action] Provider failed, using rule-based fallback:', error);
    const fallbackProvider = ruleBasedProvider;
    request.providerKey = fallbackProvider.key;
    response = await fallbackProvider.generateText(request);
    fallbackUsed = true;
  }

  // Log usage and audit
  await aiAuditService.logUsage(request, response);
  await aiAuditService.logPromptAudit(
    request,
    false, // No PII in context
    [],
    response.answer.slice(0, 200)
  );

  return res.json(apiSuccess({
    explanation: response.answer,
    insights: response.insights || [],
    actions: response.actions || [],
    provider: response.provider,
    model: response.model,
    safe_mode: true, // Always true for explain-action (no PII sent)
    fallback_used: fallbackUsed,
    data_confidence: response.dataConfidence || {},
    generated_at: response.generatedAt,
  }));
}));

// Import rule-based provider for fallback
import { ruleBasedProvider } from './providers/ruleBased.provider.js';
