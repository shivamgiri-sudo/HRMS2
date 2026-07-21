# Task 2: Create `AmbientStrip` component (State 1)

## Context
Task 2 of 7 in building the AI Command Bar for MAS PeopleOS HRMS.
Task 1 is complete: `src/hooks/useAmbientInsights.ts` exists and exports `useAmbientInsights(contextType)` returning `{ chips: AmbientChip[], loading: boolean, refresh: () => void }` and type `AmbientChip = { label: string; severity: "critical"|"warning"|"info"; action_url?: string }`.

## Your job
Create ONE new file: `src/components/ai/AmbientStrip.tsx`

## Requirements

### File to create: `src/components/ai/AmbientStrip.tsx`

```tsx
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAmbientInsights, type AmbientChip } from "@/hooks/useAmbientInsights";

const SEVERITY_DOT: Record<AmbientChip["severity"], string> = {
  critical: "bg-red-400 animate-pulse",
  warning:  "bg-amber-400",
  info:     "bg-slate-400",
};

const SEVERITY_TEXT: Record<AmbientChip["severity"], string> = {
  critical: "text-red-300",
  warning:  "text-amber-300",
  info:     "text-slate-300",
};

export function AmbientStrip({
  contextType,
  onOpen,
}: {
  contextType: string;
  onOpen: () => void;
}) {
  const { chips, loading } = useAmbientInsights(contextType);

  return (
    <div
      role="complementary"
      aria-label="AI Copilot insights"
      className="fixed bottom-0 left-0 right-0 z-40 flex h-9 items-center gap-3 bg-slate-900/95 px-4 backdrop-blur-sm select-none"
    >
      <Sparkles className="h-3.5 w-3.5 flex-shrink-0 text-violet-400" />

      {loading && chips.length === 0 ? (
        <span className="text-xs text-slate-500">Loading insights…</span>
      ) : chips.length > 0 ? (
        <div className="flex items-center gap-3 flex-1 min-w-0 overflow-hidden">
          {chips.map((chip, i) => (
            <button
              key={i}
              type="button"
              onClick={onOpen}
              className="flex items-center gap-1.5 text-xs hover:opacity-80 transition-opacity flex-shrink-0"
            >
              <span className={cn("h-1.5 w-1.5 rounded-full flex-shrink-0", SEVERITY_DOT[chip.severity])} />
              <span className={cn(SEVERITY_TEXT[chip.severity])}>{chip.label}</span>
            </button>
          ))}
          {chips.length > 0 && <span className="text-slate-600 text-xs flex-shrink-0">·</span>}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onOpen}
        className="ml-auto flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200 transition-colors flex-shrink-0"
      >
        Ask anything
        <kbd className="inline-flex h-5 items-center gap-0.5 rounded border border-slate-700 bg-slate-800 px-1.5 font-mono text-[10px] text-slate-400">
          ⌘K
        </kbd>
      </button>
    </div>
  );
}
```

## Global Constraints
- Named export only (no default export)
- No `any`
- Imports: only `lucide-react`, `@/lib/utils`, and `@/hooks/useAmbientInsights`
- Fixed 36px height (`h-9`) dark bar (`bg-slate-900/95`) pinned bottom full-width
- `z-40` so it sits below dialogs/modals (z-50) but above page content
- Each chip and the "Ask anything" button call `onOpen`
- The Sparkles icon uses `text-violet-400` (NOT `text-brand-400`)

## Steps
1. Write the file exactly as specified above
2. Run `cd c:/Users/ADMIN/Desktop/HRMS2-latest && npx tsc --noEmit` — fix any TypeScript errors
3. Commit: `git add src/components/ai/AmbientStrip.tsx && git commit -m "feat(ai): AmbientStrip — 36px dark bottom bar with contextual insight chips"`

## Report file
Write your full report to: `c:\Users\ADMIN\Desktop\HRMS2-latest\.superpowers\sdd\ai-cmd-task-2-report.md`

Include: Status, commit hash, TypeScript result, concerns.

Return ONLY: status word, commit hash, one-line test summary, concerns.
