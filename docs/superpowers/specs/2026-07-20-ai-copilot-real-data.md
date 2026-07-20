# PeopleOS Copilot — Real Data + Gemini Integration Design Spec

**Date:** 2026-07-20
**Status:** Approved for implementation

---

## Problem

The Copilot returns "Context analyzed. No immediate action items detected. All systems operating normally." for every employee question because:
1. No real HRMS data is fetched before the AI call
2. The rule-based provider only pattern-matches on aggregate admin counters
3. No real AI provider (Gemini) is active

---

## Track A — Intent-Driven Rule-Based Answers with Real HRMS Data

### Design

Add an **intent detection + data enrichment layer** that runs inside the `/api/ai/ask` handler BEFORE the provider is called. It:

1. Detects the question intent from the user's question string
2. Fetches the relevant HRMS data for that intent using the authenticated user's employee record
3. Injects the data into `rawContext` as non-PII-named fields
4. Passes the enriched context to the rule-based provider
5. The rule-based provider formats a real answer from the data

### Intents to handle (Phase 1)

| Intent key | Trigger keywords | Data source | Answer content |
|---|---|---|---|
| `salary_breakup` | salary, payslip, breakup, ctc, pay, earnings, deduction, take home, net pay | `GET /api/payroll/payslip/my` (latest) | Monthly: earnings, deductions, net pay, component breakdown |
| `leave_balance` | leave, balance, pl, el, cl, sick, casual, privilege, how many days | `GET /api/leave/balance` | Each leave type: name, remaining, used, total |
| `attendance_summary` | attendance, present, absent, late, punch, clocked, percentage | `GET /api/wfm/my-attendance` | Present/absent/late days, attendance %, LWP |
| `pending_actions` | pending, pending approval, pending requests, inbox, action | `GET /api/work-inbox/my-actions` | Count and list of pending items |
| `my_profile` | my details, my profile, my information, my designation, my branch | existing employee query | Name, designation, branch, join date |

### Implementation: new file `backend/src/modules/ai/ai-intent.service.ts`

```typescript
export type IntentKey = 'salary_breakup' | 'leave_balance' | 'attendance_summary' | 'pending_actions' | 'my_profile' | 'unknown';

export function detectIntent(question: string): IntentKey

export async function enrichContextForIntent(
  intent: IntentKey,
  userId: string,
  db: Pool
): Promise<Record<string, unknown>>
```

`detectIntent()` — keyword matching on lowercased question, returns the most specific intent.

`enrichContextForIntent()` — for each intent, queries the appropriate tables directly using `userId → employee_id` resolution and returns a flat object of safe field names (no raw PII column names that would trigger redaction).

Safe field name mapping (avoids redaction):
- `gross_salary` → `earnings_total`
- `net_salary` → `take_home_amount`
- `total_deductions` → `deductions_total`
- `basic` → `basic_component`
- `hra` → `hra_component`
- etc.

### Update rule-based provider answer builder

Extend `generateRuleBasedInsights()` in `ai-safety.service.ts` to handle enriched contexts:
- When `ctx.intent === 'salary_breakup'` → format a salary summary answer
- When `ctx.intent === 'leave_balance'` → format a leave balance answer
- When `ctx.intent === 'attendance_summary'` → format an attendance answer
- etc.

Each formatter produces a natural-language answer like:
> "Your salary for June 2026: Earnings ₹45,200 (Basic ₹27,000 + HRA ₹10,800 + Special ₹7,400). Deductions ₹5,340 (PF ₹3,240 + TDS ₹1,800 + PT ₹300). **Take-home: ₹39,860**. Present: 22 days, LWP: 0 days."

### Update `/api/ai/ask` handler

Before calling the provider, add:
```typescript
const intent = aiIntentService.detectIntent(question);
const enriched = await aiIntentService.enrichContextForIntent(intent, userId, db);
rawContext = { ...rawContext, intent, ...enriched };
```

---

## Track B — Gemini Provider Activation

### Design

Gemini API key is provided via environment variable `GEMINI_API_KEY`. The existing `gemini.provider.ts` already handles Gemini calls — it just has no key and no active DB row.

### What needs to happen

1. **Add `GEMINI_API_KEY` to `backend/src/config/env.ts`** — make it an optional string (not required so startup doesn't fail if absent)

2. **Seed the `ai_provider_config` row on startup** — if `GEMINI_API_KEY` is present in env, auto-insert/update a row in `ai_provider_config` with `provider_key='gemini'`, `active_status='active'`, `is_default=TRUE`, and the encrypted key. This replaces the manual DB admin flow.

3. **Update `gemini.provider.ts`** to also check `process.env.GEMINI_API_KEY` as a fallback when the DB-encrypted key is empty/null, so the env var path works cleanly.

4. **Add `backend/sql/513_gemini_provider_seed.sql`** — idempotent upsert that activates Gemini if the env var is set. Actually this is better done in application startup code, not a migration.

5. **For Gemini calls with salary data**: the safety service strips fields like `earnings_total`, `take_home_amount` (these are safe renamed fields — not in the PII blocklist). The Gemini provider will receive the enriched context from Track A and can formulate a much better natural-language answer.

### Gemini system prompt

The system instruction (built by `ai-safety.service.ts → buildSystemInstruction()`) needs a PeopleOS-specific prompt:

> "You are PeopleOS Copilot, an AI assistant for MAS Callnet's HR platform. Answer employee questions about their salary, attendance, leave, and HR data using the provided context. Be concise, specific, and friendly. Always use ₹ for currency. If data isn't in the context, say so honestly — do not hallucinate figures."

---

## Files to Create/Modify

| File | Change |
|------|--------|
| `backend/src/modules/ai/ai-intent.service.ts` | NEW — intent detection + HRMS data enrichment |
| `backend/src/modules/ai/ai-safety.service.ts` | Extend `generateRuleBasedInsights()` with intent-aware formatters |
| `backend/src/modules/ai/ai-insights.routes.ts` | Add intent enrichment before provider call |
| `backend/src/modules/ai/providers/gemini.provider.ts` | Add env var fallback for API key |
| `backend/src/modules/ai/providers/ruleBased.provider.ts` | Pass intent through to safety service formatter |
| `backend/src/config/env.ts` | Add optional `GEMINI_API_KEY` |
| `backend/src/modules/ai/ai-provider.registry.ts` | Auto-activate Gemini if env var is set on startup |
| `backend/.env` (production) | Add `GEMINI_API_KEY=AQ.Ab8...` (set on server, not in git) |

---

## Verification

1. `cd backend && npx tsc --noEmit` — 0 errors
2. POST `/api/ai/ask` with `{ question: "my salary breakup", context_type: "generic" }` as employee → returns real salary figures, not generic fallback
3. POST `/api/ai/ask` with `{ question: "my leave balance" }` → returns leave types with remaining days
4. POST `/api/ai/ask` with `{ question: "my attendance this month" }` → returns present/absent/late counts
5. GET `/api/ai/providers/active` → returns `{ providerKey: "gemini", providerName: "Google Gemini" }` when `GEMINI_API_KEY` is set
6. Same salary question via Gemini → richer natural language answer using same enriched context

---

## Security Notes

- `GEMINI_API_KEY` must NOT be committed to git — only set in `.env` on server
- Enriched salary fields use safe aliases (`earnings_total` not `gross_salary`) — pass the redaction layer
- Employee can only see their own data — `enrichContextForIntent` enforces this via `userId` resolution
- Gemini receives only the safe-aliased fields — PII redaction layer remains in place
