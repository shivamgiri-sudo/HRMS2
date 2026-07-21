# Task 4: Create `AmbientInsightBar` component (State 3 — inline page injection)

## Context
Task 4 of 7. Tasks 1-3 complete:
- `src/hooks/useAmbientInsights.ts` — `useAmbientInsights(contextType)` → `{ chips, loading, refresh }`
- `AmbientChip` type: `{ label: string; severity: "critical"|"warning"|"info"; action_url?: string }`

## Your job
Create ONE new file: `src/components/ai/AmbientInsightBar.tsx`

This is an INLINE component rendered INSIDE specific dashboard pages (not fixed/floating).
It returns `null` when there are no chips — pages can drop it in without always seeing it.

## Complete file to implement

```tsx
import { AlertTriangle, Info, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAmbientInsights, type AmbientChip } from "@/hooks/useAmbientInsights";

const CHIP_CLASS: Record<AmbientChip["severity"], string> = {
  critical: "border-red-200 bg-red-50 text-red-700",
  warning:  "border-amber-200 bg-amber-50 text-amber-700",
  info:     "border-slate-200 bg-slate-50 text-slate-600",
};

const ChipIcon = ({ severity }: { severity: AmbientChip["severity"] }) => {
  if (severity === "critical" || severity === "warning") return <AlertTriangle className="h-3 w-3 flex-shrink-0" />;
  return <Info className="h-3 w-3 flex-shrink-0" />;
};

export function AmbientInsightBar({
  contextType,
  onOpenPalette,
}: {
  contextType: string;
  onOpenPalette: () => void;
}) {
  const { chips, loading } = useAmbientInsights(contextType);

  if (!loading && chips.length === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="flex items-center gap-1 text-xs text-violet-600 font-semibold flex-shrink-0">
        <Sparkles className="h-3 w-3" />
        AI
      </span>
      {loading && chips.length === 0 ? (
        <span className="text-xs text-slate-400">Loading insights…</span>
      ) : (
        chips.map((chip, i) => (
          <button
            key={i}
            type="button"
            onClick={chip.action_url ? () => { window.location.href = chip.action_url!; } : onOpenPalette}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition hover:opacity-80",
              CHIP_CLASS[chip.severity]
            )}
          >
            <ChipIcon severity={chip.severity} />
            {chip.label}
          </button>
        ))
      )}
    </div>
  );
}
```

## Global Constraints
- Named export `AmbientInsightBar` only (no default)
- Returns `null` when `!loading && chips.length === 0`
- No `any`
- Props: `{ contextType: string; onOpenPalette: () => void }`
- Chips with `action_url` navigate there; chips without call `onOpenPalette`
- Sparkles icon: `text-violet-600`

## Steps
1. Write the file
2. `cd c:/Users/ADMIN/Desktop/HRMS2-latest && npx tsc --noEmit` — 0 errors
3. Commit: `git add src/components/ai/AmbientInsightBar.tsx && git commit -m "feat(ai): AmbientInsightBar — inline page-level insight chip row for dashboards"`

## Report file
`c:\Users\ADMIN\Desktop\HRMS2-latest\.superpowers\sdd\ai-cmd-task-4-report.md`

Return: status, commit hash, TypeScript result, concerns.
