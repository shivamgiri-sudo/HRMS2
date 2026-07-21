# Task 3: Activate Gemini via GEMINI_API_KEY env var

## Context
Task 3 of 4. Tasks 1-2 complete — real HRMS data now enriches the AI context.

IMPORTANT DISCOVERY: `backend/src/modules/ai/providers/gemini.provider.ts` line 100 **already reads `process.env.GEMINI_API_KEY`** directly in `generateText()`. When the env var is absent it falls back to `ruleBasedProvider`. So Gemini already works via env var at the provider level — we just need to make it the DEFAULT provider when the key is set.

The only reason Gemini isn't used is that `aiProviderRegistry.getDefault()` checks the DB for an active config row — and there is none. We need `getDefault()` to return the Gemini provider when `GEMINI_API_KEY` is in the environment.

## Files to modify

### 1. `backend/src/config/env.ts`

The Zod schema uses `z.string().default("")` for optional string fields (pattern: `LMS_BRIDGE_SECRET`, `LMS_API_URL`).

Find the env schema object (the `z.object({...})` call). Add inside it:
```typescript
GEMINI_API_KEY: z.string().default(""),
```

No other changes to env.ts needed.

### 2. `backend/src/modules/ai/ai-provider.registry.ts`

The current `getDefault()` method:
```typescript
async getDefault(): Promise<AiProvider> {
  const config = await aiProviderConfigService.getDefaultProvider(false);

  if (!config) {
    console.warn('[AI Registry] No default provider configured, using rule-based fallback');
    return ruleBasedProvider;
  }
  // ...
}
```

Add import at the top of the file (after existing imports):
```typescript
import { env } from '../../config/env.js';
```

Then modify `getDefault()` to check `env.GEMINI_API_KEY` before falling back to rule-based:
```typescript
async getDefault(): Promise<AiProvider> {
  const config = await aiProviderConfigService.getDefaultProvider(false);

  if (!config) {
    // If no DB config but GEMINI_API_KEY is set in environment, use Gemini directly
    if (env.GEMINI_API_KEY) {
      console.info('[AI Registry] Using Gemini from GEMINI_API_KEY env var');
      return this.get('gemini') ?? ruleBasedProvider;
    }
    console.warn('[AI Registry] No default provider configured, using rule-based fallback');
    return ruleBasedProvider;
  }

  const provider = this.get(config.providerKey);

  if (!provider) {
    console.warn(`[AI Registry] Provider ${config.providerKey} not found in registry, using rule-based fallback`);
    return ruleBasedProvider;
  }

  return provider;
}
```

This is the minimal change: when no DB config exists AND the env var is set, return the Gemini provider. The Gemini provider's `generateText()` already reads `process.env.GEMINI_API_KEY` so it will work without any config object.

### 3. `backend/src/modules/ai/ai-insights.routes.ts`

The POST /ask handler currently fetches config like this (around line 235):
```typescript
const provider = await aiProviderRegistry.getDefault();
const config = await aiProviderConfigService.getByKey(provider.key, true);
```

`config` is then used as `config?.modelName` and `config?.apiKey`. When Gemini is active via env var, `config` will be `null` (no DB row). The code uses `config?.apiKey` with optional chaining — this is fine since Gemini reads the env var directly.

Check that `config?.modelName` also gracefully handles null (it should already with `?.`). No changes needed if the existing code already uses optional chaining on config. Verify and leave unchanged if safe.

## Global Constraints
- GEMINI_API_KEY must NOT be hardcoded anywhere — only read from `env.GEMINI_API_KEY`
- The check is: `if (env.GEMINI_API_KEY)` — truthy check on the string (empty string = falsy = use rule-based)
- No new files created — only modify the two specified files
- Existing behavior when GEMINI_API_KEY is absent must be IDENTICAL to current behavior
- No `any` in new code

## Steps
1. Add `GEMINI_API_KEY: z.string().default(""),` to env.ts schema
2. Add `import { env } from '../../config/env.js'` to ai-provider.registry.ts
3. Modify `getDefault()` to return Gemini when env var is set and no DB config exists
4. Verify ai-insights.routes.ts handles `config = null` gracefully (should already — just confirm)
5. Run `cd c:/Users/ADMIN/Desktop/HRMS2-latest/backend && npx tsc --noEmit` — 0 errors
6. Commit: `git add backend/src/config/env.ts backend/src/modules/ai/ai-provider.registry.ts && git commit -m "feat(ai): activate Gemini via GEMINI_API_KEY env var when no DB config exists"`

## Report file
`c:\Users\ADMIN\Desktop\HRMS2-latest\.superpowers\sdd\ai-copilot-task-3-report.md`

Return: status, commit hash, TypeScript result, concerns.
