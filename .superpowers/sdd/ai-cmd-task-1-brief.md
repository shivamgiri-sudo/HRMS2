# Task 1: Create `useAmbientInsights` hook

## Context
You are working on the MAS PeopleOS HRMS codebase at c:\Users\ADMIN\Desktop\HRMS2-latest.
This is Task 1 of 7 in building a new AI Command Bar to replace a floating chat bubble widget.
This task is isolated — no other tasks have run yet.

## Your job
Create ONE new file: `src/hooks/useAmbientInsights.ts`

## Requirements (implement exactly as specified)

### File to create: `src/hooks/useAmbientInsights.ts`

```typescript
import { useState, useEffect, useRef } from "react";
import { hrmsApi } from "@/lib/hrmsApi";

export type AmbientChip = {
  label: string;
  severity: "critical" | "warning" | "info";
  action_url?: string;
};

// Module-level cache: contextType -> { chips, expires_at }
const ambientCache = new Map<string, { chips: AmbientChip[]; expires_at: number }>();
const REFRESH_MS = 5 * 60 * 1000; // 5 minutes

export function useAmbientInsights(contextType: string): {
  chips: AmbientChip[];
  loading: boolean;
  refresh: () => void;
} {
  const [chips, setChips] = useState<AmbientChip[]>(() => {
    const cached = ambientCache.get(contextType);
    return cached && cached.expires_at > Date.now() ? cached.chips : [];
  });
  const [loading, setLoading] = useState(false);
  const tickRef = useRef(0);

  const doFetch = async (key: string, cancelled: { v: boolean }) => {
    const cached = ambientCache.get(key);
    if (cached && cached.expires_at > Date.now()) {
      if (!cancelled.v) setChips(cached.chips);
      return;
    }
    if (!cancelled.v) setLoading(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: { answer?: string; insights?: { label: string; severity?: string; action_url?: string }[] } }>(
        `/api/ai/role-insights?context_type=${encodeURIComponent(key)}`
      );
      if (cancelled.v) return;
      const raw = res?.data?.insights ?? [];
      const parsed: AmbientChip[] = raw.slice(0, 3).map((i) => ({
        label: i.label,
        severity: (["critical", "warning", "info"].includes(i.severity ?? "") ? i.severity : "info") as AmbientChip["severity"],
        action_url: i.action_url,
      }));
      ambientCache.set(key, { chips: parsed, expires_at: Date.now() + REFRESH_MS });
      setChips(parsed);
    } catch {
      // AI unavailable — keep existing chips, fail silently
    } finally {
      if (!cancelled.v) setLoading(false);
    }
  };

  useEffect(() => {
    if (!contextType) return;
    const cancelled = { v: false };
    void doFetch(contextType, cancelled);
    const interval = setInterval(() => void doFetch(contextType, cancelled), REFRESH_MS);
    return () => {
      cancelled.v = true;
      clearInterval(interval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextType, tickRef.current]);

  function refresh() {
    ambientCache.delete(contextType);
    setChips([]);
    tickRef.current += 1;
  }

  return { chips, loading, refresh };
}
```

## Global Constraints
- No `any` in new files (use typed generics for API responses)
- All AI calls must `.catch(() => null)` or be in try/catch — never block UI
- The hook re-exports `AmbientChip` as a named type export
- Module-level cache (`ambientCache`) persists across component mounts — this is intentional
- REFRESH_MS = 300_000 (5 minutes exactly)
- `hrmsApi.get` is imported from `@/lib/hrmsApi`

## Important note on hrmsApi response shape
`hrmsApi.get<T>(url)` returns `T` directly (not `{ data: T }`). The backend `/api/ai/role-insights` returns `{ success: boolean; data: { answer?: string; insights?: [...] } }`. So the correct access is `res?.data?.insights`.

## Steps
1. Write the file exactly as specified above
2. Run `cd c:/Users/ADMIN/Desktop/HRMS2-latest && npx tsc --noEmit` — fix any TypeScript errors
3. Commit: `git add src/hooks/useAmbientInsights.ts && git commit -m "feat(ai): add useAmbientInsights hook with 5-min module-level cache"`

## Report file
Write your full report to: `c:\Users\ADMIN\Desktop\HRMS2-latest\.superpowers\sdd\ai-cmd-task-1-report.md`

Your report must include:
- Status: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED
- Commit hash(es) created
- TypeScript check result (exact output or "0 errors")
- Any concerns or deviations from spec

Return ONLY: status word, commit hash, one-line test summary, and concerns (if any).
