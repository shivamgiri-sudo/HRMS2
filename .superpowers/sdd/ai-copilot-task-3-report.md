# Task 3 Report: Activate Gemini via GEMINI_API_KEY env var

## Status: COMPLETE

## Commit
`e24d00b8` — feat(ai): activate Gemini via GEMINI_API_KEY env var when no DB config exists

## Changes Made

### 1. `backend/src/config/env.ts`
Added `GEMINI_API_KEY: z.string().default(""),` to the Zod env schema (after SOURCE_DB_PASSWORD). Follows the same optional-string-with-empty-default pattern used by `LMS_BRIDGE_SECRET` and `LMS_API_URL`.

### 2. `backend/src/modules/ai/ai-provider.registry.ts`
- Added `import { env } from '../../config/env.js'` at top of file.
- Modified `getDefault()` to check `env.GEMINI_API_KEY` before the rule-based fallback:
  ```typescript
  if (!config) {
    if (env.GEMINI_API_KEY) {
      console.info('[AI Registry] Using Gemini from GEMINI_API_KEY env var');
      return this.get('gemini') ?? ruleBasedProvider;
    }
    console.warn('[AI Registry] No default provider configured, using rule-based fallback');
    return ruleBasedProvider;
  }
  ```

### 3. `backend/src/modules/ai/ai-insights.routes.ts` — No changes needed
Verified line 303: `model: config?.modelName` uses optional chaining — null-safe when config is absent. The `config?.apiKey` path is also optional-chained. No code changes required.

## TypeScript Result
`npx tsc --noEmit` — 0 errors in modified files.

Pre-existing errors (4 total, all in `src/modules/privacy-engine/`) are unrelated to this task and were present before these changes.

## Behaviour

| Condition | Result |
|---|---|
| `GEMINI_API_KEY` set, no DB config row | Gemini provider used |
| `GEMINI_API_KEY` absent, no DB config row | Rule-based fallback (unchanged behaviour) |
| DB config row exists | DB config used (unchanged behaviour) |

## Concerns
None. The change is minimal and strictly additive. The Gemini provider already reads `process.env.GEMINI_API_KEY` directly in `generateText()` — no wiring was needed there.
