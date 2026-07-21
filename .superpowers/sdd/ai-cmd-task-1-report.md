# Task 1 Report: useAmbientInsights hook

## Status: DONE

## Commit hash
df0f4aed

## TypeScript check result
0 errors (npx tsc --noEmit produced no output)

## What was done
- Created `src/hooks/useAmbientInsights.ts` exactly as specified
- File exports `AmbientChip` type and `useAmbientInsights` function
- Module-level `ambientCache` (Map) persists across mounts with 5-minute TTL
- `hrmsApi.get<T>()` used with correct generic typing — no `any`
- All fetch errors caught silently; UI never blocked
- `refresh()` clears cache entry + resets chips + increments `tickRef.current` to trigger re-fetch

## Concerns
None. Implementation matches spec exactly.
