# Task 4 Brief — Frontend: Wire bulk groups into the main component

## Context
Task 4 of 7 in Work Inbox Volume Relief (MAS PeopleOS HRMS).
Only file: `src/pages/NativeWorkInbox.tsx`.
No new files, no backend changes.

## What Already Exists (do NOT redefine)
- `groupItems()` function
- `GroupedItem` interface
- `GroupRow` component with props: `{ group, onExpand, expanded, onBulkAct, acting, onOpenItem, onActItem }`
- `TaskRow` component with props: `{ task, onOpen, onQuickAct, acting }`
- `actingIds` state (Set<string>)
- `setActedItems` state setter
- `setItems` state setter
- `setSummary` state setter
- `queryClient` (from useQueryClient)
- `hrmsApi` (available in the file for API calls)
- `MODULE_LABELS`, `humaniseModuleKey` helpers

## CRITICAL SCOPE RULE
Use Edit tool only — do NOT rewrite the whole file. Make targeted insertions/replacements.

## Changes Required

### Change 1: Add two new state variables
Find in `NativeWorkInbox` function body:
```typescript
  const [actingIds, setActingIds] = useState<Set<string>>(new Set());
```
Add immediately AFTER that line:
```typescript
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [bulkActingKeys, setBulkActingKeys] = useState<Set<string>>(new Set());
```

### Change 2: Add `bulkActGroup` handler
Find `completeTask` function. Add the following AFTER the closing `};` of `completeTask` (before `return (`):

```typescript
  const bulkActGroup = async (group: GroupedItem) => {
    setBulkActingKeys((prev) => new Set(prev).add(group.groupKey));
    try {
      const ids = group.items.map((i) => i.id);
      const res = await hrmsApi.post<{
        success: boolean;
        actioned: number;
        failed: { id: string; reason: string }[];
      }>("/api/inbox/bulk-actioned", {
        ids,
        source: group.source,
        remarks: "Bulk acknowledged",
      });

      const failedIds = new Set((res.failed ?? []).map((f) => f.id));
      const succeededIds = ids.filter((id) => !failedIds.has(id));

      setItems((prev) => prev.filter((i) => !succeededIds.includes(i.id)));

      if (succeededIds.length) {
        const firstItem = group.items[0];
        setActedItems((prev) => [
          {
            ...firstItem,
            title: `Batch (${succeededIds.length} items) — ${MODULE_LABELS[group.module] ?? humaniseModuleKey(group.module)}${group.branch_name ? ` · ${group.branch_name}` : ""}`,
            acted_at: new Date().toISOString(),
          },
          ...prev,
        ]);
      }

      setSummary((prev) => {
        if (!prev) return prev;
        const updated = { ...prev, by_module: { ...prev.by_module } };
        for (const item of group.items) {
          if (failedIds.has(item.id)) continue;
          updated.total = Math.max(0, updated.total - 1);
          updated[item.risk] = Math.max(0, (updated[item.risk] as number ?? 1) - 1);
          updated.by_module[item.module] = Math.max(0, (updated.by_module[item.module] ?? 1) - 1);
        }
        return updated;
      });

      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-unread-count"] });

      if (res.failed?.length) {
        import("sonner").then(({ toast }) => {
          toast.warning(`${succeededIds.length} of ${ids.length} items closed. ${res.failed.length} were already actioned or not found.`);
        });
      }
    } catch {
      import("sonner").then(({ toast }) => {
        toast.error("Bulk action failed. Please try again.");
      });
    } finally {
      setBulkActingKeys((prev) => {
        const s = new Set(prev);
        s.delete(group.groupKey);
        return s;
      });
    }
  };
```

### Change 3: Replace the table body rows rendering

Find the current rendering in the tbody. It currently looks like:
```typescript
            filtered.map((task) => (
              <TaskRow
                key={`${task.source}-${task.id}`}
                task={task}
                onOpen={() => setSelected(task)}
                onQuickAct={() => void completeTask(task.id, "")}
                acting={actingIds.has(task.id)}
              />
            ))
```

Replace it with:
```typescript
            groupItems(filtered).map((row) => {
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
              return (
                <TaskRow
                  key={`${task.source}-${task.id}`}
                  task={task}
                  onOpen={() => setSelected(task)}
                  onQuickAct={() => void completeTask(task.id, "")}
                  acting={actingIds.has(task.id)}
                />
              );
            })
```

## hrmsApi usage note
Look at how the existing `completeTask` function calls the API (it likely uses something like `hrmsApi.patch(...)` or `fetch(...)`). Use the same pattern for the `hrmsApi.post` call. If `hrmsApi` is not the correct name, use whatever API client is used in the existing `completeTask` function — adapt accordingly.

## Verification
```bash
npx tsc --noEmit
```
Expected: zero errors.

## Commit
```bash
git add src/pages/NativeWorkInbox.tsx
git commit -m "feat(inbox): wire bulk group acknowledgement into work inbox table"
```

## Report File
Write your full report to: `.superpowers/sdd/briefs/task-4-report.md`
Return only: status (DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED), commit SHA, one-line tsc summary, concerns.
