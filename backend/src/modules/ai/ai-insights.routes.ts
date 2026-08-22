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
import { getEmployeeForUser } from '../../shared/accessGuard.js';
import { aiProviderRegistry } from './ai-provider.registry.js';
import { generateInsights } from './ai-insights-engine.js';
import { aiProviderConfigService } from './ai-provider-config.service.js';
import { aiSafetyService } from './ai-safety.service.js';
import { aiAuditService } from './ai-audit.service.js';
import { checkAndIncrement } from './ai-rate-limiter.js';
import { validateQuestion, validateContextType, validateEntityId } from './ai-input-guard.js';
import type { AiGenerateRequest } from './ai-provider.types.js';
import {
  answerSelfAccountQuestion,
  describeAccountIntentForHistory,
  getMiraSuggestedPrompts,
  MIRA_NAME,
  MIRA_TAGLINE,
  MiraDataUnavailableError,
} from './ai-account.service.js';
import { recordTurn, resolveFollowUp, lastIntentTurn, providerHistory, providerHistorySummaries, getPendingAction, detectConfirmation, getThread } from './ai-conversation.service.js';
import { draftLeaveRequest, confirmLeaveAction, cancelLeaveAction, isLeaveActionRequest, miraActionsEnabled } from './mira-leave-action.service.js';
import {
  answerCompanyQuestion,
  companyKnowledgeMissResponse,
  companyKnowledgeStatus,
  COMPANY_SYSTEM_INSTRUCTION,
  detectCompanyIntent,
  getPublicCompanyContext,
  refreshOfficialCompanyKnowledge,
} from './ai-company-knowledge.service.js';
import { answerHowToQuestion } from './ai-howto.service.js';
import { detectFeedbackIntent, describeFeedbackForHistory, logFeedback } from './ai-feedback.service.js';
import { runTriagePass } from './mira-triage-scheduler.js';
import { buildDailyBriefForEmployee } from '../management/daily-brief/daily-brief-dispatch.service.js';
import { listComplaints, getComplaintDetail, retriageComplaint, getComplaintStats } from './mira-complaints.service.js';
import { ruleBasedProvider } from './providers/ruleBased.provider.js';

export const aiInsightsRouter = Router();

const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: (err?: unknown) => void) => fn(req, res).catch(next);

function getRoleKeys(req: AuthenticatedRequest): string[] {
  const raw = [
    ...(req.userRoles ?? []),
    ...(req.authUser?.roles ?? []),
    req.authUser?.role ?? '',
  ];
  const normalized = raw
    .map((role) => String(role).trim().toLowerCase())
    .filter(Boolean);
  return normalized.length ? Array.from(new Set(normalized)) : ['employee'];
}

function canAccessAnyBusinessAction(roleKeys: string[]): boolean {
  return roleKeys.some((role) => ['super_admin', 'admin'].includes(role));
}

/**
 * Build a full AiGenerateResponse for an answer produced locally (never sent to an
 * external provider), matching the shape ai-account.service.ts's own response()
 * helper produces — kept here rather than exported from that module since this is
 * specific to the action-taking flow, not a self-account read.
 */
function miraLocalResponse(answer: string, opts: { pendingAction?: import('./ai-provider.types.js').AiPendingAction; actions?: import('./ai-provider.types.js').AiAction[] } = {}) {
  return {
    answer,
    provider: 'mira-secure-local',
    model: 'hrms-action-v1',
    latencyMs: 1,
    safetyBlocked: false,
    fallbackUsed: false,
    generatedAt: new Date().toISOString(),
    sourceContexts: ['mira_action:leave_request'],
    dataConfidence: { overall: 1 },
    insights: [],
    actions: opts.actions ?? [],
    pendingAction: opts.pendingAction,
  };
}

// All routes require authentication
aiInsightsRouter.use(requireAuth);

/**
 * GET /api/ai/providers - List all providers (safe config, no API keys)
 */
aiInsightsRouter.get('/providers', requireRole('super_admin', 'admin'), h(async (_req, res) => {
  const providers = await aiProviderConfigService.list();
  const registry = aiProviderRegistry.listAll();

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
aiInsightsRouter.get('/providers/active', h(async (_req, res) => {
  const config = await aiProviderConfigService.getDefaultProvider(false);
  return res.json(apiSuccess(config || { providerKey: 'rule-based', providerName: 'Rule-Based Provider' }));
}));

function timeOfDayGreetingIST(): string {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()));
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * GET /api/ai/session - Server-authoritative assistant identity and prompts.
 *
 * `?greet=1` additionally computes a time-aware greeting and a critical-updates
 * preview — the frontend passes this only right after a fresh sign-in (see
 * AuthContext.tsx), not on every mount, so this heavier path (it calls the same
 * daily-brief builder GET /api/management/daily-brief/preview already uses) only
 * runs once per login rather than on every chat-panel open.
 */
aiInsightsRouter.get('/session', h(async (req, res) => {
  const roleKeys = getRoleKeys(req);
  const base = {
    assistant: {
      name: MIRA_NAME,
      tagline: MIRA_TAGLINE,
      description: 'Live answers from your own HRMS account and approved MAS Callnet company sources.',
    },
    roleKeys,
    prompts: getMiraSuggestedPrompts(),
    capabilities: {
      selfAccount: true,
      proactiveBriefing: true,
      companyKnowledge: true,
      openRouterReady: true,
      voiceInput: true,
      spokenReplies: true,
      crossEmployeePersonalData: false,
      executesActions: miraActionsEnabled(),
      externalPersonalDataSharing: false,
    },
  };

  if (req.query.greet !== '1') {
    return res.json(apiSuccess(base));
  }

  const employee = await getEmployeeForUser(req.authUser!.id);
  if (!employee?.id) {
    return res.json(apiSuccess({ ...base, greeting: `${timeOfDayGreetingIST()}!`, hasCriticalUpdates: false, updatesPreview: [] }));
  }

  const { db: mysqlDb } = await import('../../db/mysql.js');
  const [nameRows] = await mysqlDb.execute<import('mysql2').RowDataPacket[]>(
    'SELECT full_name FROM employees WHERE id = ? LIMIT 1', [employee.id],
  );
  const firstName = String(nameRows[0]?.full_name ?? '').trim().split(/\s+/)[0] || undefined;
  const greetingPrefix = `${timeOfDayGreetingIST()}${firstName ? `, ${firstName}` : ''}`;

  try {
    const result = await buildDailyBriefForEmployee(employee.id);
    // Executive-family recipients get a rollup brief (`mode: 'executive_rollup'`) with
    // no per-signal `attention` array — see daily-brief-aggregator.service.ts's
    // buildExecutiveDailyBrief vs buildManagerDailyBrief. Only the latter has one.
    const attention = result.ok && !('mode' in result.brief && result.brief.mode === 'executive_rollup')
      ? (result.brief as { attention?: Array<{ key: string; label: string }> }).attention ?? []
      : [];
    const updatesPreview = attention.slice(0, 5).map((signal) => ({ key: signal.key, label: signal.label }));
    const greeting = updatesPreview.length
      ? `${greetingPrefix} — there ${updatesPreview.length === 1 ? 'is' : 'are'} ${updatesPreview.length} update${updatesPreview.length === 1 ? '' : 's'} for you today. Want me to walk you through them?`
      : `${greetingPrefix}! No critical updates for you right now.`;
    return res.json(apiSuccess({ ...base, greeting, hasCriticalUpdates: updatesPreview.length > 0, updatesPreview }));
  } catch (error) {
    // The greeting is a nicety, not core chat function — never fail /session over it.
    console.error('[Mira] failed to build greeting updates', error instanceof Error ? error.message : error);
    return res.json(apiSuccess({ ...base, greeting: `${greetingPrefix}!`, hasCriticalUpdates: false, updatesPreview: [] }));
  }
}));

/**
 * GET /api/ai/briefing - Proactive, self-only live HRMS briefing.
 */
aiInsightsRouter.get('/briefing', h(async (req, res) => {
  try {
    const local = await answerSelfAccountQuestion('Give me my account summary', req.authUser!.id, getRoleKeys(req));
    if (!local.response) return res.status(503).json(apiError('DATA_UNAVAILABLE', 'Your HRMS briefing is not available right now.', 503));
    return res.json(apiSuccess(local.response));
  } catch (error) {
    if (error instanceof MiraDataUnavailableError) {
      return res.status(503).json(apiError('DATA_UNAVAILABLE', 'I could not read your live HRMS data right now. Please try again shortly.', 503));
    }
    throw error;
  }
}));

/**
 * GET /api/ai/company-knowledge/status - Approved company knowledge status.
 */
aiInsightsRouter.get('/company-knowledge/status', h(async (_req, res) => {
  return res.json(apiSuccess(await companyKnowledgeStatus()));
}));

/**
 * POST /api/ai/company-knowledge/refresh - Refresh allowlisted official MAS pages.
 */
aiInsightsRouter.post('/company-knowledge/refresh', requireRole('super_admin', 'admin'), h(async (_req, res) => {
  return res.json(apiSuccess(await refreshOfficialCompanyKnowledge()));
}));

/**
 * POST /api/ai/providers - Create provider config
 */
aiInsightsRouter.post('/providers', requireRole('super_admin', 'admin'), h(async (req, res) => {
  const { providerKey, providerName, activeStatus, isDefault, apiKey, modelName, baseUrl, timeout, dailyRequestLimit, monthlyRequestLimit, dailyTokenLimit, monthlyTokenLimit } = req.body;

  if (!providerKey || !providerName) {
    return res.status(400).json(apiError('VALIDATION_ERROR', 'providerKey and providerName are required', 400));
  }
  if (!aiProviderRegistry.get(String(providerKey))) {
    return res.status(400).json(apiError('VALIDATION_ERROR', 'Provider is not supported by this HRMS build', 400));
  }

  const created = await aiProviderConfigService.create({
    providerKey,
    providerName,
    activeStatus,
    isDefault,
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
    apiKey,
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
 * GET /api/ai/analytics/summary - Aggregate usage/success/fallback/safety stats.
 * providerKey/fromDate/toDate are all optional — omitting providerKey returns
 * an all-providers total.
 */
aiInsightsRouter.get('/analytics/summary', requireRole('super_admin', 'admin'), h(async (req, res) => {
  const { providerKey, fromDate, toDate } = req.query;
  const stats = await aiAuditService.getProviderUsageStats(
    providerKey ? String(providerKey) : undefined,
    fromDate ? new Date(String(fromDate)) : undefined,
    toDate ? new Date(String(toDate)) : undefined,
  );
  return res.json(apiSuccess(stats));
}));

/**
 * GET /api/ai/analytics/counts - Today/month request and token counts.
 */
aiInsightsRouter.get('/analytics/counts', requireRole('super_admin', 'admin'), h(async (req, res) => {
  const providerKey = req.query.providerKey ? String(req.query.providerKey) : undefined;
  const [today, month, todayTokens, monthTokens] = await Promise.all([
    aiAuditService.getTodayUsageCount(providerKey),
    aiAuditService.getMonthUsageCount(providerKey),
    aiAuditService.getTodayTokenUsage(providerKey),
    aiAuditService.getMonthTokenUsage(providerKey),
  ]);
  return res.json(apiSuccess({ today, month, todayTokens, monthTokens }));
}));

/**
 * GET /api/ai/analytics/prompt-audit - Filterable prompt-audit log, incl.
 * detected_intent for requests made after 1077_ai_prompt_audit_detected_intent.sql —
 * historical rows before that migration have a NULL detected_intent, since
 * question_hash/sanitized_context_hash are one-way hashes with nothing to
 * backfill intent from.
 */
aiInsightsRouter.get('/analytics/prompt-audit', requireRole('super_admin', 'admin'), h(async (req, res) => {
  const { userId, providerKey, fromDate, toDate, limit, offset } = req.query;
  const filters: any = {};
  if (userId) filters.userId = String(userId);
  if (providerKey) filters.providerKey = String(providerKey);
  if (fromDate) filters.fromDate = new Date(String(fromDate));
  if (toDate) filters.toDate = new Date(String(toDate));
  if (limit) filters.limit = parseInt(String(limit), 10);
  if (offset) filters.offset = parseInt(String(offset), 10);
  return res.json(apiSuccess(await aiAuditService.getPromptAuditLogs(filters)));
}));

/**
 * POST /api/ai/insights - Dashboard insight panels (KPI, attendance, leave,
 * ATS, exit risk, CEO dashboard, WFM roster, quality/operations).
 *
 * Rule-based, not LLM-backed: every insight is derived from the numeric
 * fields the caller already computed and is displaying on the dashboard, so
 * it responds instantly, costs nothing, and can never fabricate a claim. See
 * ai-insights-engine.ts for the per-context_type analyzers.
 */
aiInsightsRouter.post('/insights', h(async (req, res) => {
  const { context_type, data } = req.body ?? {};
  const contextType = typeof context_type === 'string' && context_type.trim() ? context_type : 'generic';
  const payload = data && typeof data === 'object' ? data : {};
  const insights = generateInsights(contextType, payload);
  return res.json(apiSuccess({ insights }));
}));

/**
 * POST /api/ai/ask - Ask Mira.
 * Self-account intents are answered locally and never sent to an external AI.
 */
async function askHandler(req: AuthenticatedRequest, res: Response, mode: 'json' | 'sse') {
  const { question, context_type, entity_id } = req.body;
  const userId = req.authUser!.id;
  const roleKeys = getRoleKeys(req);

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
  if (entity_id) {
    return res.status(403).json(apiError(
      'FORBIDDEN',
      'Direct entity IDs are not accepted in chat. Mira answers your own account questions without exposing another employee record.',
      403,
    ));
  }

  const safeContextType = contextCheck.sanitizedContextType ?? 'generic';
  const safeQuestion = questionCheck.sanitizedQuestion!;

  /**
   * Remember the exchange and return it. `externalSafe` decides whether this
   * turn may ever be replayed to a provider: self-account answers carry the
   * employee's own salary and attendance, so they stay in process.
   */
  let sseOpen = false;
  const openSse = () => {
    if (sseOpen) return;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // nginx buffers SSE into uselessness without this
    });
    sseOpen = true;
  };
  const sseSend = (event: string, data: unknown) => {
    openSse();
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const respond = (
    response: { answer: string },
    options: { externalSafe: boolean; intent?: string; redactedSummary?: string },
  ) => {
    recordTurn(userId, {
      question: safeQuestion,
      answer: response.answer,
      intent: options.intent,
      externalSafe: options.externalSafe,
      redactedSummary: options.redactedSummary,
    });
    if (mode === 'sse') {
      // A locally answered question has nothing to stream — send it whole, then close.
      if (!sseOpen) sseSend('chunk', { text: response.answer });
      sseSend('done', apiSuccess(response));
      return res.end();
    }
    return res.json(apiSuccess(response));
  };

  // Checked before self-account: an explicit feedback/complaint-about-the-
  // system message ("I have a complaint about the HRMS system", "feedback
  // on Mira") must never be answered from live HRMS data or fall through to
  // a generic refusal — it needs to be captured and routed to the admin
  // team. detectFeedbackIntent requires the message to name the system
  // itself (see ai-feedback.service.ts's SYSTEM_NAME comment), so this never
  // intercepts an employee's own existing-grievance question, which
  // self-account's support intent already owns correctly.
  const feedback = detectFeedbackIntent(safeQuestion);
  if (feedback.isFeedback) {
    const feedbackResponse = await logFeedback(userId, safeQuestion, feedback.category);
    const request: AiGenerateRequest = {
      userId,
      roleKeys,
      providerKey: feedbackResponse.provider,
      userQuestion: safeQuestion,
      sanitizedContext: { intent: `feedback:${feedback.category}`, data_scope: 'mira_feedback', safe_mode: true },
      requestSource: 'mira_feedback',
      entityType: 'mira_feedback',
    };
    await aiAuditService.logUsage(request, feedbackResponse);
    await aiAuditService.logPromptAudit(request, false, [], feedbackResponse.answer.slice(0, 200), `feedback:${feedback.category}`);
    return respond(feedbackResponse, {
      externalSafe: false,
      intent: `feedback:${feedback.category}`,
      redactedSummary: describeFeedbackForHistory(feedback.category),
    });
  }

  // A confirm/cancel reply only means something when a draft is actually waiting —
  // checked before everything else below so "yes" can never be reinterpreted as a
  // new self-account/how-to/company-knowledge question.
  if (miraActionsEnabled() && getPendingAction(userId)) {
    const decision = detectConfirmation(safeQuestion);
    if (decision === 'confirm') {
      const result = await confirmLeaveAction(userId);
      const miraResponse = miraLocalResponse(result.message, result.leaveRequestId ? { actions: [{ key: 'leaves', label: 'Open leave dashboard', url: '/leaves', priority: 'low' }] } : {});
      return respond(miraResponse, { externalSafe: false, intent: 'leave_action_confirm', redactedSummary: 'The user confirmed a drafted leave request; Mira submitted it via the normal leave workflow.' });
    }
    if (decision === 'cancel') {
      const result = await cancelLeaveAction(userId);
      return respond(miraLocalResponse(result.message), { externalSafe: false, intent: 'leave_action_cancel', redactedSummary: 'The user cancelled a drafted leave request.' });
    }
    // A pending draft exists but this message wasn't a yes/no — fall through to the
    // normal pipeline below; a genuinely new question is still answered normally,
    // and the stale draft simply expires on its own TTL if never confirmed.
  }

  const respondWithDraft = (draft: Awaited<ReturnType<typeof draftLeaveRequest>>) => {
    if (draft.summary) {
      const pendingAction: import('./ai-provider.types.js').AiPendingAction = {
        type: 'leave_request', summary: draft.summary, confirmLabel: 'Yes, submit it', cancelLabel: 'No, cancel',
      };
      return respond(miraLocalResponse(draft.summary, { pendingAction }), {
        externalSafe: false, intent: 'leave_action_draft',
        redactedSummary: 'The user asked Mira to raise a leave request; Mira drafted it and is awaiting confirmation before submitting.',
      });
    }
    const answer = draft.clarifyingQuestion ?? draft.error ?? 'I could not understand that leave request.';
    return respond(miraLocalResponse(answer), {
      externalSafe: false, intent: 'leave_action_draft',
      redactedSummary: 'The user asked Mira to raise a leave request; Mira could not complete the draft without more information.',
    });
  };

  // A reply to Mira's own clarifying question ("what date?" → "23rd August") has
  // no reason to re-mention the word "leave", so isLeaveActionRequest() below
  // would never match it on its own — without this, the user has to restate the
  // whole "raise leave for..." request every single turn. Recognised instead by
  // the conversation still being mid-draft: no pendingAction yet (that's a
  // completed draft, handled above) but the most recent intent-bearing turn was
  // itself an unresolved leave_action_draft attempt. Accumulates every trailing
  // leave_action_draft turn's original text (not just the latest one) so a detail
  // given two turns ago — a leave type mentioned before the date was asked for —
  // is not lost by the time the date finally arrives.
  if (miraActionsEnabled() && !getPendingAction(userId) && lastIntentTurn(userId)?.intent === 'leave_action_draft') {
    const priorTurns = getThread(userId);
    const carriedContext: string[] = [];
    for (let i = priorTurns.length - 1; i >= 0; i -= 1) {
      if (priorTurns[i].intent !== 'leave_action_draft') break;
      carriedContext.unshift(priorTurns[i].question);
    }
    const draft = await draftLeaveRequest([...carriedContext, safeQuestion].join(' '), userId);
    return respondWithDraft(draft);
  }

  // "raise leave for 23rd August" is an action request, not a read-only balance
  // question — checked before self-account so ai-account.service.ts's existing
  // 'leave' intent (balances) never swallows it and answers the wrong thing.
  if (miraActionsEnabled() && isLeaveActionRequest(safeQuestion)) {
    const draft = await draftLeaveRequest(safeQuestion, userId);
    return respondWithDraft(draft);
  }

  // "and last month?" only means something against the previous turn. Rewrite it
  // into a question the intent router can serve; leave anything self-contained be.
  const carried = resolveFollowUp(safeQuestion, lastIntentTurn(userId));
  const routedQuestion = carried ?? safeQuestion;

  let local;
  try {
    local = await answerSelfAccountQuestion(routedQuestion, userId, roleKeys);
  } catch (error) {
    if (error instanceof MiraDataUnavailableError) {
      return res.status(503).json(apiError(
        'DATA_UNAVAILABLE',
        'I could not read your live HRMS data right now. Please try again shortly or open the relevant HRMS page.',
        503,
      ));
    }
    throw error;
  }
  if (local.handled && local.response) {
    const request: AiGenerateRequest = {
      userId,
      roleKeys,
      providerKey: local.response.provider,
      userQuestion: safeQuestion,
      sanitizedContext: { intent: local.intent, data_scope: 'authenticated_user_self_only', safe_mode: true },
      requestSource: 'mira_self_account',
      entityType: 'self_account',
    };
    await aiAuditService.logUsage(request, local.response);
    await aiAuditService.logPromptAudit(request, false, [], local.response.answer.slice(0, 200), local.intent);
    return respond(local.response, { externalSafe: false, intent: local.intent, redactedSummary: describeAccountIntentForHistory(local.intent) });
  }

  // Tried after self-account (so "how many leaves do I have" isn't
  // reinterpreted as a how-to question) and before company-knowledge (so a
  // "how do I…" question about HRMS mechanics never falls through to the
  // external LLM, which has no HRMS-navigation knowledge and was the actual
  // root cause of vague answers to this class of question).
  const howTo = await answerHowToQuestion(safeQuestion, userId, roleKeys);
  if (howTo.handled && howTo.response) {
    const request: AiGenerateRequest = {
      userId,
      roleKeys,
      providerKey: howTo.response.provider,
      userQuestion: safeQuestion,
      sanitizedContext: { intent: howTo.intent, data_scope: 'howto_catalog', safe_mode: true },
      requestSource: 'mira_howto',
      entityType: 'howto_catalog',
    };
    await aiAuditService.logUsage(request, howTo.response);
    await aiAuditService.logPromptAudit(request, false, [], howTo.response.answer.slice(0, 200), howTo.intent);
    // externalSafe: true — how-to steps and the RBAC-gated wording contain no
    // employee PII, so unlike self-account answers this is safe to replay to
    // an external provider on a follow-up turn.
    return respond(howTo.response, { externalSafe: true, intent: howTo.intent });
  }

  const companyAnswer = await answerCompanyQuestion(safeQuestion);
  if (companyAnswer) {
    const request: AiGenerateRequest = {
      userId,
      roleKeys,
      providerKey: companyAnswer.provider,
      userQuestion: safeQuestion,
      sanitizedContext: { data_scope: 'approved_company_public_information', safe_mode: true },
      requestSource: 'mira_company_knowledge',
      entityType: 'company_public',
    };
    await aiAuditService.logUsage(request, companyAnswer);
    await aiAuditService.logPromptAudit(request, false, [], companyAnswer.answer.slice(0, 200), `company:${detectCompanyIntent(safeQuestion)}`);
    return respond(companyAnswer, { externalSafe: true });
  }

  const providerConfig = await aiProviderConfigService.getDefaultProvider(false);
  const rateResult = await checkAndIncrement(userId, providerConfig?.dailyRequestLimit ?? 0);
  if (!rateResult.allowed) {
    res.setHeader('X-RateLimit-Remaining', '0');
    res.setHeader('X-RateLimit-Reset', rateResult.resetAt.toISOString());
    return res.status(429).json(apiError('RATE_LIMIT_EXCEEDED', 'Daily external AI request limit reached. Your live HRMS self-service answers remain available.', 429));
  }
  res.setHeader('X-RateLimit-Remaining', String(rateResult.remaining));

  const provider = await aiProviderRegistry.getDefault();
  const config = await aiProviderConfigService.getByKey(provider.key, true);

  const companyContext = await getPublicCompanyContext(safeQuestion);
  const rawContext: Record<string, unknown> = {
    ...companyContext,
    actor_role: roleKeys[0],
    context_type: safeContextType,
    timestamp: new Date().toISOString(),
    privacy_scope: 'approved_company_public_information_only; no employee personal data',
  };

  const sanitizationResult = await aiSafetyService.sanitizeContext(rawContext, roleKeys);
  const useExternalProvider = provider.key !== 'rule-based';
  const safetyCheck = await aiSafetyService.checkContextSafety(
    sanitizationResult.sanitizedContext,
    useExternalProvider
  );

  if (!safetyCheck.allowed && useExternalProvider) {
    const request: AiGenerateRequest = {
      userId,
      roleKeys,
      providerKey: ruleBasedProvider.key,
      userQuestion: safeQuestion,
      sanitizedContext: sanitizationResult.sanitizedContext,
      requestSource: 'copilot',
      entityType: safeContextType,
      systemInstruction: COMPANY_SYSTEM_INSTRUCTION,
    };

    const response = companyKnowledgeMissResponse();
    await aiAuditService.logUsage(request, response);
    await aiAuditService.logPromptAudit(
      request,
      sanitizationResult.piiRedactionApplied,
      sanitizationResult.sensitiveFieldsRemoved,
      response.answer.slice(0, 200),
      'unclassified', // no intent could be determined for this question at all — genuinely unclassified, not invented
    );
    return respond(response, { externalSafe: true });
  }

  if (provider.key === 'rule-based') {
    const response = companyKnowledgeMissResponse();
    const request: AiGenerateRequest = {
      userId, roleKeys, providerKey: response.provider, userQuestion: safeQuestion,
      sanitizedContext: sanitizationResult.sanitizedContext, requestSource: 'mira_company_knowledge', entityType: 'company_public',
    };
    await aiAuditService.logUsage(request, response);
    await aiAuditService.logPromptAudit(request, false, [], response.answer.slice(0, 200), 'unclassified');
    return respond(response, { externalSafe: true });
  }

  const request: AiGenerateRequest = {
    userId,
    roleKeys,
    providerKey: provider.key,
    model: config?.modelName,
    apiKey: config?.apiKey,
    systemInstruction: COMPANY_SYSTEM_INSTRUCTION,
    userQuestion: safeQuestion,
    sanitizedContext: sanitizationResult.sanitizedContext,
    // Only turns that were themselves external-safe; self-account answers stay
    // in process, so a salary reply from an earlier turn cannot ride along here.
    conversation: providerHistory(userId),
    // Complete, always-safe superset — self-account turns included as a
    // redacted topic summary, never their raw answer. Providers should prefer
    // this via pickConversationEntries(); kept as a second field rather than
    // replacing `conversation` above so existing callers/tests referencing
    // that field are unaffected.
    conversationSummaries: providerHistorySummaries(userId),
    temperature: 0.2,
    maxOutputTokens: 800,
    requestSource: 'copilot',
    entityType: safeContextType,
  };

  // Stream only when the caller asked for it and the provider can. Chunks are
  // emitted as they arrive; the post-processing below still runs on the whole
  // answer, so a streamed reply is held to the same checks as a non-streamed one.
  const canStream = mode === 'sse' && typeof provider.generateTextStream === 'function';
  let response = canStream
    ? await provider.generateTextStream!(request, (text) => sseSend('chunk', { text }))
    : await provider.generateText(request);
  const modelDisclaimer = /\b(knowledge cutoff|training data|my memory|as an ai|i (?:do not|don't) have access to (?:live|real[- ]?time)|i cannot access (?:live|real[- ]?time))\b/i;
  if ((response.fallbackUsed && response.provider === 'rule-based') || modelDisclaimer.test(response.answer)) {
    response = companyKnowledgeMissResponse();
  }
  const responseValidation = aiSafetyService.validateResponse(response.answer);
  if (!responseValidation.safe) {
    console.warn('[AI] Response validation failed:', responseValidation.reason);
    const failure = apiError('AI_RESPONSE_UNSAFE', responseValidation.reason || 'AI response failed safety check', 400);
    // Streaming has already sent headers and possibly text, so the rejection has
    // to travel as an event. The client discards what it rendered on `error`.
    if (mode === 'sse') {
      sseSend('error', failure);
      return res.end();
    }
    return res.status(400).json(failure);
  }

  await aiAuditService.logUsage(request, response);
  await aiAuditService.logPromptAudit(
    request,
    sanitizationResult.piiRedactionApplied,
    sanitizationResult.sensitiveFieldsRemoved,
    response.answer.slice(0, 200)
    // detected_intent intentionally omitted (-> undefined/NULL) — no intent
    // is computed for the external-LLM path; inventing one here would be
    // worse than leaving it blank.
  );

  return respond(response, { externalSafe: true });
}

aiInsightsRouter.post('/ask', h((req, res) => askHandler(req, res, 'json')));

/**
 * POST /api/ai/ask/stream - Same pipeline, delivered as Server-Sent Events.
 *
 * Only the provider path is slow enough to be worth streaming: self-account
 * answers average 88ms and company-knowledge answers 1ms, against ~2.5s here.
 * Locally answered questions therefore arrive as a single chunk.
 *
 * Events:
 *   chunk  { text }            partial answer, may be superseded
 *   done   { success, data }   the authoritative answer
 *   error  { success, error }  rejected; discard anything already rendered
 *
 * `done` is authoritative, not merely the last chunk. Post-processing can
 * replace a streamed answer wholesale — a model disclaimer or a rule-based
 * fallback becomes the approved not-found reply — so the client must render
 * `done` over whatever the chunks built, rather than appending to it.
 */
aiInsightsRouter.post('/ask/stream', h((req, res) => askHandler(req, res, 'sse')));

/**
 * POST /api/ai/explain - Secure self-record explanation only.
 */
aiInsightsRouter.post('/explain', h(async (req, res) => {
  const { entity_type, entity_id } = req.body;
  if (!entity_type || !entity_id) {
    return res.status(400).json(apiError('VALIDATION_ERROR', 'entity_type and entity_id are required', 400));
  }
  if (entity_type !== 'employee') {
    return res.status(403).json(apiError('FORBIDDEN', 'Secure chat explanations currently support only your own employee record.', 403));
  }

  const userId = req.authUser!.id;
  const roleKeys = getRoleKeys(req);
  const ownEmployee = await getEmployeeForUser(userId);
  if (!ownEmployee?.id || ownEmployee.id !== entity_id) {
    return res.status(403).json(apiError('FORBIDDEN', 'Mira may explain only your own employee record.', 403));
  }

  const local = await answerSelfAccountQuestion('Show my profile details', userId, roleKeys);
  if (!local.response) {
    return res.status(503).json(apiError('REQUEST_FAILED', 'Your profile could not be explained right now.', 503));
  }
  return res.json(apiSuccess({ ...local.response, entity_type, entity_id }));
}));

/**
 * GET /api/ai/role-insights - Fast assigned-action summary for the caller.
 */
aiInsightsRouter.get('/role-insights', h(async (req, res) => {
  const userId = req.authUser!.id;
  const roleKeys = getRoleKeys(req);
  const role = roleKeys[0] ?? 'employee';

  const local = await answerSelfAccountQuestion('What actions are pending from my side?', userId, roleKeys);
  if (local.response) {
    return res.json(apiSuccess({ role, ...local.response }));
  }
  return res.json(apiSuccess({
    role,
    answer: 'No role insight is available right now.',
    provider: 'mira-secure-local',
    model: 'hrms-self-account-v1',
    latencyMs: 1,
    safetyBlocked: false,
    fallbackUsed: false,
    generatedAt: new Date().toISOString(),
    sourceContexts: ['assigned_actions'],
  }));
}));

/**
 * GET /api/ai/supported-contexts - Available context types for current user
 */
aiInsightsRouter.get('/supported-contexts', h(async (req, res) => {
  const roleKeys = getRoleKeys(req);
  const contexts: string[] = ['generic', 'self_account'];

  if (roleKeys.includes('payroll') || roleKeys.includes('payroll_hr')) {
    contexts.push('payroll_blockers', 'payroll_readiness');
  }
  if (roleKeys.includes('wfm')) {
    contexts.push('attendance_risk', 'roster_risk');
  }
  if (roleKeys.includes('ceo') || roleKeys.includes('admin') || roleKeys.includes('super_admin')) {
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
    'unknown',
    rating,
    feedback_text
  );

  return res.json(apiSuccess({ message: 'Feedback recorded' }));
}));

/**
 * POST /api/ai/explain-action - Explain an action only when assigned to the caller,
 * assigned to one of the caller's roles, or the caller is a global administrator.
 */
aiInsightsRouter.post('/explain-action', h(async (req, res) => {
  const { action_id } = req.body;
  if (!action_id) {
    return res.status(400).json(apiError('VALIDATION_ERROR', 'action_id is required', 400));
  }

  const userId = req.authUser!.id;
  const roleKeys = getRoleKeys(req);
  const { db } = await import('../../db/mysql.js');
  const rolePlaceholders = roleKeys.map(() => '?').join(',');
  const accessSql = canAccessAnyBusinessAction(roleKeys)
    ? 'SELECT * FROM business_action_queue WHERE id = ? LIMIT 1'
    : `SELECT * FROM business_action_queue
        WHERE id = ?
          AND (owner_user_id = ? OR owner_role IN (${rolePlaceholders}))
        LIMIT 1`;
  const accessParams = canAccessAnyBusinessAction(roleKeys)
    ? [action_id]
    : [action_id, userId, ...roleKeys];
  const [actions] = await db.execute<any[]>(accessSql, accessParams);

  if (actions.length === 0) {
    return res.status(404).json(apiError('NOT_FOUND', 'Action not found or outside your assigned scope', 404));
  }

  const action = actions[0];
  const rawActionContext: Record<string, unknown> = {
    risk_type: action.risk_type,
    severity: action.severity,
    source_module: action.source_module,
    title: action.title,
    status: action.status,
    escalation_level: action.escalation_level || 0,
  };

  if (action.source_module === 'payroll') {
    const match = action.title?.match(/\((\d+) employees\)/);
    rawActionContext.blocked_count = match ? parseInt(match[1]) : 0;
    rawActionContext.blocker_type = action.title?.split(' (')[0] || 'Unknown';
  } else if (action.source_module === 'attendance') {
    const match = action.title?.match(/\((\d+) days\)/);
    rawActionContext.unreconciled_days = match ? parseInt(match[1]) : 0;
  } else if (action.source_module === 'onboarding') {
    const match = action.description?.match(/Age: (\d+) days/);
    rawActionContext.stuck_days = match ? parseInt(match[1]) : 0;
    rawActionContext.stage = action.title?.split(' at ')[1]?.split(' (')[0] || 'unknown';
  } else if (action.source_module === 'roster') {
    const match = action.title?.match(/\((\d+) HC\)/);
    rawActionContext.shortage = match ? parseInt(match[1]) : 0;
  }

  const sanitized = await aiSafetyService.sanitizeContext(rawActionContext, roleKeys);
  const provider = await aiProviderRegistry.getDefault();
  const config = await aiProviderConfigService.getByKey(provider.key, true);
  const systemInstruction = `You are ${MIRA_NAME}, explaining an authorised business action.
Explain concisely why it exists, the business risk, and the recommended next step.
Never mention employee names, employee codes, personal identifiers, or unscoped records.
Label the answer as an AI-generated recommendation.`;

  const request: AiGenerateRequest = {
    userId,
    roleKeys,
    providerKey: provider.key,
    model: config?.modelName,
    apiKey: config?.apiKey,
    systemInstruction,
    userQuestion: 'Explain this assigned action and recommend next steps',
    sanitizedContext: sanitized.sanitizedContext,
    temperature: 0.3,
    maxOutputTokens: 512,
    requestSource: 'explain_action',
    entityType: 'business_action',
    entityId: action_id,
  };

  let response;
  let fallbackUsed = false;
  try {
    response = await provider.generateText(request);
  } catch (error) {
    console.warn('[AI Explain Action] Provider failed, using rule-based fallback:', error);
    request.providerKey = ruleBasedProvider.key;
    response = await ruleBasedProvider.generateText(request);
    fallbackUsed = true;
  }

  const responseValidation = aiSafetyService.validateResponse(response.answer);
  if (!responseValidation.safe) {
    return res.status(400).json(apiError('AI_RESPONSE_UNSAFE', responseValidation.reason || 'Unsafe AI response', 400));
  }

  await aiAuditService.logUsage(request, response);
  await aiAuditService.logPromptAudit(
    request,
    sanitized.piiRedactionApplied,
    sanitized.sensitiveFieldsRemoved,
    response.answer.slice(0, 200),
    'explain_action', // this whole route only ever answers one kind of question
  );

  return res.json(apiSuccess({
    explanation: response.answer,
    insights: response.insights || [],
    actions: response.actions || [],
    provider: response.provider,
    model: response.model,
    safe_mode: true,
    fallback_used: fallbackUsed,
    data_confidence: response.dataConfidence || {},
    generated_at: response.generatedAt,
  }));
}));

/**
 * POST /api/ai/triage/run — Immediately trigger a Mira triage pass over all pending
 * MIRA_FEEDBACK work_items. Equivalent to running mira-issue-triage-run.ts from the CLI
 * but callable from the Work Inbox UI without a server restart.
 *
 * The scheduler (mira-triage-scheduler.ts) fires automatically every 15 minutes; this
 * endpoint exists for super_admin to force an immediate pass without waiting.
 *
 * Safe to call repeatedly — findUntriagedMiraFeedback() is idempotent: items that
 * already have a 'mira_ai_triage' audit row are not re-processed.
 */
aiInsightsRouter.post('/triage/run', requireAuth, requireRole('super_admin'), h(async (_req, res) => {
  const outcomes = await runTriagePass();
  const processed = Object.values(outcomes).reduce((sum, n) => sum + n, 0);
  return res.json(apiSuccess({ processed, outcomes }));
}));

// ── Mira Complaints Management ─────────────────────────────────────────────────

/** GET /api/ai/complaints — paginated list of all MIRA_FEEDBACK items with triage state */
aiInsightsRouter.get('/complaints', requireRole('super_admin'), h(async (req, res) => {
  const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit ?? '200'), 10) || 200));
  const complaints = await listComplaints(limit);
  return res.json(apiSuccess(complaints));
}));

/** GET /api/ai/complaints/stats — summary counts for the dashboard header */
aiInsightsRouter.get('/complaints/stats', requireRole('super_admin'), h(async (_req, res) => {
  const stats = await getComplaintStats();
  return res.json(apiSuccess(stats));
}));

/** GET /api/ai/complaints/:id — full detail: complaint + audit trail + fix drafts + usage */
aiInsightsRouter.get('/complaints/:id', requireRole('super_admin'), h(async (req, res) => {
  const detail = await getComplaintDetail(req.params.id);
  if (!detail) return res.status(404).json(apiError('NOT_FOUND', 'Complaint not found', 404));
  return res.json(apiSuccess(detail));
}));

/** POST /api/ai/complaints/:id/retriage — force re-triage on a specific complaint (for ai_error items) */
aiInsightsRouter.post('/complaints/:id/retriage', requireRole('super_admin'), h(async (req, res) => {
  const result = await retriageComplaint(req.params.id);
  if (!result.ok) return res.status(404).json(apiError('NOT_FOUND', 'Complaint not found', 404));
  return res.json(apiSuccess({ outcome: result.outcome }));
}));
