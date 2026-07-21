# Task 2 Report: Wire intent enrichment into /api/ai/ask + extend rule-based formatter

## Status
COMPLETE

## Commit
ae7ee3f8 — feat(ai): wire intent enrichment into /ask — real salary, leave, attendance answers

## TypeScript Check
`npx tsc --noEmit` — 0 errors

## Changes Applied

### ai-insights.routes.ts
- Added `import { detectAndEnrich } from './ai-intent.service.js'`
- Added `import type { Pool } from 'mysql2/promise'` (needed for cast)
- Added `import { db } from '../../db/mysql.js'` (static import)
- Inserted non-blocking intent enrichment try/catch block between `rawContext` assignment and `sanitizeContext` call

### ai-safety.service.ts
- Added 6 intent-aware branches at the top of `generateRuleBasedInsights` (before `const role`)
- Added 3 private formatter methods: `formatSalaryBreakup`, `formatLeaveBalance`, `formatAttendanceSummary`
- Updated `buildSystemInstruction` to prepend `peopleOSPrefix` (PeopleOS Copilot identity + ₹ currency rule + honesty rule)

## Concern
The `db` export from `../../db/mysql.ts` is a custom wrapper object, not a `mysql2/promise` `Pool`. `detectAndEnrich` in `ai-intent.service.ts` (Task 1) declares its `db` parameter as `Pool`. A `db as unknown as Pool` cast was used at the call site to bridge the type gap without modifying `ai-intent.service.ts`. This is safe at runtime because the wrapper exposes the same `execute` method signature the intent service uses. If Task 1 is ever updated, consider changing `detectAndEnrich`'s parameter type to the narrower custom `db` shape to remove the cast.
