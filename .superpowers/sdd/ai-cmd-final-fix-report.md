# AI Command Bar — Security Fix Report

**Status:** DONE  
**Commit:** 2a0dd8d7  
**TypeScript:** 0 errors (`npx tsc --noEmit` clean)

## Fixes Applied

### Fix 1 — URL injection in CommandPalette action links (Critical)
File: `src/components/ai/CommandPalette.tsx`

- Action link `<a href={action.url}>` replaced with `<button>` using `navigate(action.url)` after filtering to same-origin URLs only (via `new URL(..., window.location.origin)` check, with fallback for relative paths starting with `/`).
- "Open full conversation" `<a href="/peopleos/copilot">` replaced with `<button>` using `navigate("/peopleos/copilot")`.

### Fix 2 — Open-redirect in AmbientInsightBar (Critical)
File: `src/components/ai/AmbientInsightBar.tsx`

- Added `import { useNavigate } from "react-router-dom"` and `const navigate = useNavigate()`.
- Chip `onClick` handler replaced: `window.location.href = ...` removed; now uses `navigate(url)` for relative paths only; falls back to `onOpenPalette()` for non-relative URLs.

### Fix 3 — Stale chips on contextType change (Important)
File: `src/hooks/useAmbientInsights.ts`

- Added `setChips([])` immediately after `const cancelled = { v: false }` in the `useEffect`, so old context chips are cleared before the new fetch resolves.

### Fix 4 — Whitespace trim before AI post (Important)
File: `src/components/ai/CommandPalette.tsx`

- Changed `question: query` to `question: query.trim()` in the `hrmsApi.post` call inside `askAI`.

### Fix 5 — aria-live region for AI response (Accessibility)
File: `src/components/ai/CommandPalette.tsx`

- Added `aria-live="polite"` and `aria-atomic="true"` to the AI result container `<div>`.
