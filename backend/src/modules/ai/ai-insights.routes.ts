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
import type { AiGenerateRequest } from './ai-provider.types.js';

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
aiInsightsRouter.post('/providers', requireRole('super_admin'), h(async (req, res) => {
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
aiInsightsRouter.put('/providers/:id', requireRole('super_admin'), h(async (req, res) => {
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
aiInsightsRouter.post('/providers/:id/test', requireRole('super_admin'), h(async (req, res) => {
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
aiInsightsRouter.post('/providers/:id/set-default', requireRole('super_admin'), h(async (req, res) => {
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
aiInsightsRouter.post('/providers/:id/disable', requireRole('super_admin'), h(async (req, res) => {
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
aiInsightsRouter.get('/providers/usage', requireRole('super_admin'), h(async (req, res) => {
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
 * POST /api/ai/ask - Ask AI assistant
 */
aiInsightsRouter.post('/ask', h(async (req, res) => {
  const { question, context_type, entity_id } = req.body;

  if (!question || typeof question !== 'string') {
    return res.status(400).json(apiError('VALIDATION_ERROR', 'question is required', 400));
  }

  const userId = req.authUser!.id;
  const roleKeys = (req as any).userRoles || ['employee'];

  // Get active provider
  const provider = await aiProviderRegistry.getDefault();
  const config = await aiProviderConfigService.getByKey(provider.key, true);

  // Build sanitized context from PeopleOS services
  // For now, use a simple context; full integration with peopleos.service.ts to follow
  const rawContext: Record<string, unknown> = {
    user_id: userId,
    user_role: roleKeys[0],
    context_type: context_type || 'generic',
    entity_id: entity_id || null,
    timestamp: new Date().toISOString(),
  };

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
      userQuestion: question,
      sanitizedContext: sanitizationResult.sanitizedContext,
      requestSource: 'copilot',
      entityType: context_type,
      entityId: entity_id,
      systemInstruction: aiSafetyService.buildSystemInstruction(roleKeys, context_type),
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
    systemInstruction: aiSafetyService.buildSystemInstruction(roleKeys, context_type),
    userQuestion: question,
    sanitizedContext: sanitizationResult.sanitizedContext,
    temperature: 0.3,
    maxOutputTokens: 1024,
    requestSource: 'copilot',
    entityType: context_type,
    entityId: entity_id,
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

  // For now, redirect to /ask with specific context
  // Full entity explanation integration to be completed
  return res.json(apiSuccess({
    message: 'Entity explanation not yet fully implemented. Use /api/ai/ask with context_type and entity_id.',
    entity_type,
    entity_id,
  }));
}));

/**
 * GET /api/ai/role-insights - Get role-wise insights
 */
aiInsightsRouter.get('/role-insights', h(async (req, res) => {
  const userId = req.authUser!.id;
  const roleKeys = (req as any).userRoles || ['employee'];

  // For now, return role-based placeholder insights
  // Full integration with peopleos.service.ts to follow
  const insights = {
    role: roleKeys[0],
    insights: [
      { key: 'placeholder', label: 'Role insights coming soon', severity: 'low' as const },
    ],
    actions: [],
  };

  return res.json(apiSuccess(insights));
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
