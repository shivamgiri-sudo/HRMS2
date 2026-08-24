# Task 6 Brief — Frontend: `useKeyboardNav` hook + legend overlay

## Context
Task 6 of 7 in Work Inbox Volume Relief (MAS PeopleOS HRMS).
Only file: `src/pages/NativeWorkInbox.tsx`. No new files, no backend changes.

## CRITICAL SCOPE RULE
Use Edit tool only. Do NOT rewrite the file. Four targeted changes only.

## What Already Exists (do NOT redefine)
- `useRef`, `useEffect` — already imported from React (check first)
- `useState` — already imported
- `X` from lucide-react — check if already imported; add only if missing

## Changes Required

### Change 1: Add `useKeyboardNav` hook
Find the comment `// ── Main page` near the bottom of the file.
Add the following IMMEDIATELY BEFORE that comment:

```typescript
// ── Keyboard Navigation ───────────────────────────────────────────────────────

function useKeyboardNav(opts: {
  itemCount: number;
  focusedIndex: number;
  setFocusedIndex: (n: number) => void;
  onAct: (index: number) => void;
  onOpen: (index: number) => void;
  onOpenUrl: (index: number) => void;
  onToggleLegend: () => void;
}) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const { itemCount, focusedIndex, setFocusedIndex, onAct, onOpen, onOpenUrl, onToggleLegend } = optsRef.current;

      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          setFocusedIndex(focusedIndex < itemCount - 1 ? focusedIndex + 1 : 0);
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          setFocusedIndex(focusedIndex > 0 ? focusedIndex - 1 : itemCount - 1);
          break;
        case "a":
          if (focusedIndex >= 0) { e.preventDefault(); onAct(focusedIndex); }
          break;
        case "o":
          if (focusedIndex >= 0) { e.preventDefault(); onOpenUrl(focusedIndex); }
          break;
        case "d":
          if (focusedIndex >= 0) { e.preventDefault(); onOpen(focusedIndex); }
          break;
        case "?":
          e.preventDefault();
          onToggleLegend();
          break;
        case "Escape":
          setFocusedIndex(-1);
          break;
        case "s":
          if (focusedIndex >= 0) {
            e.preventDefault();
            import("sonner").then(({ toast }) => toast.info("Snooze coming in the next update."));
          }
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
```

### Change 2: Add state + wire hook inside `NativeWorkInbox`
Find in `NativeWorkInbox` function body:
```typescript
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
```
Add AFTER it:
```typescript
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [showKeyLegend, setShowKeyLegend] = useState(false);
```

Then find the `completeTask` function. Add the hook call AFTER `completeTask`'s closing `};` (and after `bulkActGroup`'s closing `};`), before `return (`:

```typescript
  useKeyboardNav({
    itemCount: filtered.length,
    focusedIndex,
    setFocusedIndex,
    onAct: (index) => {
      const item = filtered[index];
      if (!item || "kind" in item) return;
      const task = item as PendingTask;
      if (task.source !== "derived") void completeTask(task.id, "");
    },
    onOpen: (index) => {
      const item = filtered[index];
      if (!item || "kind" in item) return;
      setSelected(item as PendingTask);
    },
    onOpenUrl: (index) => {
      const item = filtered[index];
      if (!item || "kind" in item) return;
      const url = (item as PendingTask).action_url;
      if (url) window.open(url, "_blank");
    },
    onToggleLegend: () => setShowKeyLegend((v) => !v),
  });
```

### Change 3: Add `focused` prop to `TaskRow` and apply ring class
Find the `TaskRow` function definition. Its current props interface looks like:
```typescript
function TaskRow({
  task,
  onOpen,
  onQuickAct,
  acting,
}: {
  task: PendingTask;
  onOpen: () => void;
  onQuickAct: () => void;
  acting: boolean;
}) {
```

Replace it with (adding `focused` prop):
```typescript
function TaskRow({
  task,
  onOpen,
  onQuickAct,
  acting,
  focused = false,
}: {
  task: PendingTask;
  onOpen: () => void;
  onQuickAct: () => void;
  acting: boolean;
  focused?: boolean;
}) {
```

Then find the `<tr` opening tag inside `TaskRow`. It currently has classes like `border-b border-slate-100 last:border-0 hover:bg-slate-50/80 transition-colors` and possibly a risk row class. Add the focused ring at the end of its className:

Change the `<tr` className to append: `${focused ? "ring-2 ring-inset ring-blue-500 bg-blue-50/30" : ""}`

Then in the table rendering (in `NativeWorkInbox`), update individual TaskRow renders to pass `focused`. Find the pattern:
```typescript
              const task = row as PendingTask;
              return (
                <TaskRow
                  key={`${task.source}-${task.id}`}
                  task={task}
                  onOpen={() => setSelected(task)}
                  onQuickAct={() => void completeTask(task.id, "")}
                  acting={actingIds.has(task.id)}
                />
```

Replace with:
```typescript
              const task = row as PendingTask;
              const rowIndex = groupItems(filtered).indexOf(row);
              return (
                <TaskRow
                  key={`${task.source}-${task.id}`}
                  task={task}
                  onOpen={() => setSelected(task)}
                  onQuickAct={() => void completeTask(task.id, "")}
                  acting={actingIds.has(task.id)}
                  focused={rowIndex === focusedIndex}
                />
```

### Change 4: Add keyboard legend overlay + "?" button in header
Find the closing `</DashboardLayout>` tag (or the last `}` of the main return JSX). Add the legend panel JUST BEFORE the `<ActionSheet` usage (or just before the closing tag of the outermost JSX element):

```typescript
      {showKeyLegend && (
        <div className="fixed bottom-4 right-4 z-50 rounded-2xl border border-slate-200 bg-white shadow-2xl p-4 w-56">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-black uppercase tracking-widest text-slate-500">Keyboard shortcuts</p>
            <button onClick={() => setShowKeyLegend(false)} className="p-1 rounded hover:bg-slate-100">
              <X className="h-3.5 w-3.5 text-slate-400" />
            </button>
          </div>
          <div className="space-y-1.5 text-xs text-slate-600">
            {([
              ["J / K", "Navigate rows"],
              ["A", "Act on row"],
              ["D", "Details sheet"],
              ["O", "Open link"],
              ["S", "Snooze (soon)"],
              ["?", "Toggle this panel"],
              ["Esc", "Clear focus"],
            ] as [string, string][]).map(([key, desc]) => (
              <div key={key} className="flex justify-between">
                <kbd className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">{key}</kbd>
                <span className="text-slate-500">{desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}
```

Also find the header area where there are buttons (look for a Refresh button or filter buttons in the header). Add a "?" toggle button near those buttons:
```typescript
                <button
                  onClick={() => setShowKeyLegend((v) => !v)}
                  className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3.5 py-2 text-xs font-bold text-white backdrop-blur-sm hover:bg-white/20 transition-all"
                  title="Keyboard shortcuts (?)"
                >
                  <span className="font-mono">?</span>
                </button>
```

## Import Check
Before editing, check if `useRef` is already imported from React (it should be if there are other hooks). If not, add it. Check if `X` is already in the lucide-react import; add it only if missing.

## Verification
```bash
npx tsc --noEmit
```
Expected: zero errors.

## Commit
```bash
git add src/pages/NativeWorkInbox.tsx
git commit -m "feat(inbox): add keyboard navigation (J/K/A/O/D/?) to work inbox"
```

## Report File
Write report to: `.superpowers/sdd/briefs/task-6-report.md`
Return only: status, commit SHA, one-line tsc summary, concerns.
