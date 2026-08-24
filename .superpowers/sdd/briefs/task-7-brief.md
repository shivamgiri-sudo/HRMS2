# Task 7 Brief — Frontend: "Needs You" vs "Your Team Can Handle" section split

## Context
Task 7 of 7 in Work Inbox Volume Relief (MAS PeopleOS HRMS).
Only file: `src/pages/NativeWorkInbox.tsx`. No new files, no backend changes.

## CRITICAL SCOPE RULE
Use Edit tool only. Do NOT rewrite the file. Targeted changes only.

## What Already Exists (do NOT redefine)
- `groupItems()`, `GroupedItem`, `PendingTask`
- `GroupRow` component with props including `onOpenItem`, `onActItem`
- `TaskRow` component with `focused?: boolean` prop
- `expandedGroups`, `bulkActingKeys`, `actingIds`, `focusedIndex` state
- `bulkActGroup`, `completeTask`, `setSelected` functions
- `useKeyboardNav` hook already wired

## Changes Required

### Change 1: Add `classifyItem` function and `SectionDivider` component
Find the comment `// ── Keyboard Navigation` near the bottom.
Add the following IMMEDIATELY BEFORE that comment:

```typescript
// ── Section Classifier ────────────────────────────────────────────────────────

const EXCLUSIVE_MODULES = new Set([
  "exit_clearance", "resignation", "bgv", "payroll_attendance_conflict", "pip_checkpoint",
]);

function classifyItem(item: PendingTask | GroupedItem): "needs_you" | "team_can_handle" {
  if ("kind" in item && item.kind === "group") {
    if (item.worstRisk === "breached" || item.worstRisk === "due_soon") return "needs_you";
    return "team_can_handle";
  }
  const task = item as PendingTask;
  if (task.risk === "breached" || task.risk === "due_soon") return "needs_you";
  if (task.priority === "urgent" || task.priority === "high") return "needs_you";
  if (task.source === "derived") return "needs_you";
  if (EXCLUSIVE_MODULES.has(task.module)) return "needs_you";
  return "team_can_handle";
}

function SectionDivider({
  label,
  count,
  actionLabel,
  onAction,
}: {
  label: string;
  count: number;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <tr>
      <td colSpan={6} className="px-3 pt-4 pb-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">{count}</span>
          </div>
          {actionLabel && onAction && (
            <button
              onClick={onAction}
              className="text-[10px] font-semibold text-slate-400 hover:text-slate-600 transition-colors"
            >
              {actionLabel}
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
```

### Change 2: Add section split variables after `filtered` declaration
Find where `filtered` is declared in `NativeWorkInbox`. It will look something like:
```typescript
  const filtered = items.filter(...)
```
Add AFTER that block:
```typescript
  const groupedFiltered = groupItems(filtered);
  const needsYou = groupedFiltered.filter((r) => classifyItem(r) === "needs_you");
  const teamCanHandle = groupedFiltered.filter((r) => classifyItem(r) === "team_can_handle");
```

### Change 3: Replace the table body rendering with two-section layout
Currently the table body contains:
```typescript
            groupItems(filtered).map((row) => {
```
(the full map block added in Task 4)

Replace the ENTIRE contents of `<tbody>` (the `groupItems(filtered).map(...)` block) with the two-section layout below. Keep the same empty-state check that's already there — only replace the rows rendering:

```typescript
                  {needsYou.length > 0 && (
                    <SectionDivider label="Needs You" count={needsYou.length} />
                  )}
                  {needsYou.map((row) => {
                    if ("kind" in row && row.kind === "group") {
                      return (
                        <GroupRow
                          key={row.groupKey}
                          group={row}
                          expanded={expandedGroups.has(row.groupKey)}
                          onExpand={() =>
                            setExpandedGroups((prev) => {
                              const s = new Set(prev);
                              s.has(row.groupKey) ? s.delete(row.groupKey) : s.add(row.groupKey);
                              return s;
                            })
                          }
                          onBulkAct={() => void bulkActGroup(row)}
                          acting={bulkActingKeys.has(row.groupKey)}
                          onOpenItem={(task) => setSelected(task)}
                          onActItem={(task) => void completeTask(task.id, "")}
                        />
                      );
                    }
                    const task = row as PendingTask;
                    const rowIndex = groupedFiltered.indexOf(row);
                    return (
                      <TaskRow
                        key={`${task.source}-${task.id}`}
                        task={task}
                        onOpen={() => setSelected(task)}
                        onQuickAct={() => void completeTask(task.id, "")}
                        acting={actingIds.has(task.id)}
                        focused={rowIndex === focusedIndex}
                      />
                    );
                  })}

                  {teamCanHandle.length > 0 && (
                    <SectionDivider
                      label="Your Team Can Handle"
                      count={teamCanHandle.length}
                    />
                  )}
                  {teamCanHandle.map((row) => {
                    if ("kind" in row && row.kind === "group") {
                      return (
                        <GroupRow
                          key={row.groupKey}
                          group={row}
                          expanded={expandedGroups.has(row.groupKey)}
                          onExpand={() =>
                            setExpandedGroups((prev) => {
                              const s = new Set(prev);
                              s.has(row.groupKey) ? s.delete(row.groupKey) : s.add(row.groupKey);
                              return s;
                            })
                          }
                          onBulkAct={() => void bulkActGroup(row)}
                          acting={bulkActingKeys.has(row.groupKey)}
                          onOpenItem={(task) => setSelected(task)}
                          onActItem={(task) => void completeTask(task.id, "")}
                        />
                      );
                    }
                    const task = row as PendingTask;
                    const rowIndex = groupedFiltered.indexOf(row);
                    return (
                      <TaskRow
                        key={`${task.source}-${task.id}`}
                        task={task}
                        onOpen={() => setSelected(task)}
                        onQuickAct={() => void completeTask(task.id, "")}
                        acting={actingIds.has(task.id)}
                        focused={rowIndex === focusedIndex}
                        showReassign
                      />
                    );
                  })}
```

### Change 4: Add `showReassign` prop to `TaskRow`
The `teamCanHandle` rows pass `showReassign` to `TaskRow`. Update `TaskRow` to accept it:

Find the `TaskRow` props interface (which currently has `focused?: boolean`). Add:
```typescript
  showReassign?: boolean;
```

And in `TaskRow`'s JSX, find the actions `<td>` (where the Act and Details buttons are). Add AFTER those existing buttons:
```typescript
          {showReassign && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                import("sonner").then(({ toast }) => toast.info("Reassignment coming in the next update."));
              }}
              className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-400 hover:bg-slate-50 transition-colors"
            >
              Reassign
            </button>
          )}
```

### Change 5: Update empty-state check
Find the empty-state conditional that uses `filtered.length === 0`. Change it to use `groupedFiltered.length === 0`.

## Verification
```bash
npx tsc --noEmit
```
Expected: zero errors.

Also run backend check:
```bash
cd backend && npx tsc --noEmit
```

## Commit
```bash
git add src/pages/NativeWorkInbox.tsx
git commit -m "feat(inbox): add Needs You vs Your Team section split to work inbox"
```

## Report File
Write report to: `.superpowers/sdd/briefs/task-7-report.md`
Return only: status, commit SHA, one-line tsc summary, concerns.
