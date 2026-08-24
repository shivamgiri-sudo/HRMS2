# Task 3 Brief — Frontend: `GroupRow` component + confirmation dialog

## Context
Task 3 of 7 in the Work Inbox Volume Relief plan (MAS PeopleOS HRMS).
You are adding ONE component (`GroupRow`) to `src/pages/NativeWorkInbox.tsx`.
No other file changes. No new files.

## CRITICAL SCOPE RULE
Add ONLY the `GroupRow` component as specified below. Do NOT modify any other existing component, function, state, import, or constant in the file. Do NOT add `ChevronDown`, `CheckCheck`, `Loader`, or `X` to imports if they are already present — check the existing import line first and only add what's missing.

## File to Modify
`src/pages/NativeWorkInbox.tsx`

## What Already Exists in the File
- `GroupedItem` interface (added in Task 2) — DO NOT redefine
- `groupItems()` function (added in Task 2) — DO NOT redefine
- `RISK_STYLES`, `MODULE_LABELS`, `humaniseModuleKey`, `PRIORITY_STYLES` — already defined
- `TaskRow` component — already defined
- `useState` — already imported from React
- `ChevronDown`, `CheckCheck`, `Loader` — likely already imported from lucide-react (check first)

## Where to Insert
Find the comment `// ── Table chrome` that precedes `function TableHead()`.
Add the following block IMMEDIATELY BEFORE that comment line.

## Exact Code to Add

```typescript
// ── Group Row ─────────────────────────────────────────────────────────────────

function GroupRow({
  group,
  onExpand,
  expanded,
  onBulkAct,
  acting,
  onOpenItem,
  onActItem,
}: {
  group: GroupedItem;
  onExpand: () => void;
  expanded: boolean;
  onBulkAct: () => void;
  acting: boolean;
  onOpenItem: (task: PendingTask) => void;
  onActItem: (task: PendingTask) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const rs = RISK_STYLES[group.worstRisk];
  const label = MODULE_LABELS[group.module] ?? humaniseModuleKey(group.module);

  const handleBulkClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirming(true);
  };

  const handleConfirm = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirming(false);
    onBulkAct();
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirming(false);
  };

  return (
    <>
      <tr className={`border-b border-slate-100 bg-slate-50/60 hover:bg-slate-100/80 transition-colors ${rs.row}`}>
        {/* Count badge + risk */}
        <td className="py-2.5 pl-3 pr-2 whitespace-nowrap w-24">
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center justify-center rounded-full bg-slate-800 text-white text-[10px] font-black px-2 py-0.5 min-w-[1.5rem]">
              {group.items.length}
            </span>
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${rs.badge}`}>
              {group.worstRisk === "due_soon" ? "Due Soon"
                : group.worstRisk === "on_track" ? "On Track"
                : group.worstRisk.charAt(0).toUpperCase() + group.worstRisk.slice(1)}
            </span>
          </div>
        </td>
        {/* Module */}
        <td className="py-2.5 px-2 whitespace-nowrap w-28 hidden sm:table-cell">
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
            {label}
          </span>
        </td>
        {/* Description */}
        <td className="py-2.5 px-2 min-w-0 max-w-xs">
          <p className="text-sm font-semibold text-slate-700 leading-snug">
            {label}
            {group.branch_name && (
              <span className="ml-1.5 font-normal text-slate-400">· {group.branch_name}</span>
            )}
          </p>
          {confirming && (
            <div className="mt-1.5 flex items-center gap-2">
              <span className="text-xs text-amber-700 font-medium">
                Close all {group.items.length} items?
              </span>
              <button
                onClick={handleConfirm}
                className="rounded-md bg-slate-900 px-2 py-0.5 text-xs font-bold text-white hover:bg-slate-700"
              >
                Yes, close all
              </button>
              <button
                onClick={handleCancel}
                className="rounded-md border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
            </div>
          )}
        </td>
        {/* Priority */}
        <td className="py-2.5 px-2 whitespace-nowrap w-20 hidden md:table-cell">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${PRIORITY_STYLES[group.highestPriority] ?? PRIORITY_STYLES.normal}`}>
            {group.highestPriority}
          </span>
        </td>
        {/* Age placeholder */}
        <td className="py-2.5 px-2 whitespace-nowrap w-32 hidden lg:table-cell">
          <p className="text-xs text-slate-400">{group.items.length} items</p>
        </td>
        {/* Actions */}
        <td className="py-2.5 pl-2 pr-3 whitespace-nowrap">
          <div className="flex items-center gap-1.5 justify-end">
            <button
              onClick={onExpand}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
              {expanded ? "Collapse" : "Expand"}
            </button>
            {!confirming && (
              <button
                onClick={handleBulkClick}
                disabled={acting}
                className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-700 transition-colors disabled:opacity-50"
              >
                {acting ? <Loader className="h-3 w-3 animate-spin" /> : <CheckCheck className="h-3 w-3" />}
                Close All ({group.items.length})
              </button>
            )}
          </div>
        </td>
      </tr>
      {/* Expanded individual rows */}
      {expanded && group.items.map((task) => (
        <TaskRow
          key={`${task.source}-${task.id}`}
          task={task}
          onOpen={() => onOpenItem(task)}
          onQuickAct={() => onActItem(task)}
          acting={false}
        />
      ))}
    </>
  );
}
```

## Import Check
Before adding anything, check the existing lucide-react import line. If `ChevronDown`, `CheckCheck`, or `Loader` are missing from it, add them. If they're already there, do NOT add them again.

## Verification
```bash
npx tsc --noEmit
```
Expected: zero errors.

## Commit
```bash
git add src/pages/NativeWorkInbox.tsx
git commit -m "feat(inbox): add GroupRow component with bulk-acknowledge confirmation"
```

## Report File
Write your full report to: `.superpowers/sdd/briefs/task-3-report.md`
Return only: status (DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED), commit SHA, one-line tsc summary, concerns.
