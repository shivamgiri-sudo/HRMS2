# Task 2 Brief — Frontend: `GroupedItem` type + `groupItems()` utility

## Context
Task 2 of 7. Pure frontend — one file only. Add a type and a pure utility function to `src/pages/NativeWorkInbox.tsx`. No backend changes. No new files.

## File to Modify
`src/pages/NativeWorkInbox.tsx`

## Where to Insert
Find the interface `PendingSummary` (it has fields: total, breached, aged, due_soon, on_track, by_module, truncated).
Add the new code **after** the closing `}` of `PendingSummary`, before the next comment or interface.

## Exact Code to Add

```typescript
export interface GroupedItem {
  kind: "group";
  groupKey: string;
  module: string;
  source: "inbox" | "tat" | "work_item";
  branch_name: string | null;
  items: PendingTask[];
  worstRisk: Risk;
  highestPriority: string;
}

/**
 * Collapse repeated same-module/source/branch items into GroupedItems.
 *
 * An item is eligible for grouping when:
 *   - At least 2 other items share the same module + source + branch_name
 *   - source is not "derived" (derived items require real workflow navigation)
 *   - No item in the candidate group has priority "urgent"
 *
 * Items that don't reach a group of 3+ stay as individual PendingTask rows.
 * The returned array preserves the original sort order — groups appear at the
 * position of their first member.
 */
export function groupItems(items: PendingTask[]): (PendingTask | GroupedItem)[] {
  const RISK_ORDER: Record<Risk, number> = { breached: 0, due_soon: 1, aged: 2, on_track: 3 };
  const PRIO_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

  const buckets = new Map<string, PendingTask[]>();

  for (const item of items) {
    if (item.source === "derived") continue;
    if (item.priority === "urgent") continue;
    const key = `${item.module}::${item.source}::${item.branch_name ?? "__none__"}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(item);
    buckets.set(key, bucket);
  }

  const groupKeys = new Set<string>();
  buckets.forEach((members, key) => {
    if (members.length >= 3) groupKeys.add(key);
  });

  if (!groupKeys.size) return items;

  const absorbed = new Set<string>();
  const groupByKey = new Map<string, GroupedItem>();

  buckets.forEach((members, key) => {
    if (!groupKeys.has(key)) return;
    const worstRisk = members.reduce<Risk>((worst, m) =>
      RISK_ORDER[m.risk] < RISK_ORDER[worst] ? m.risk : worst, "on_track");
    const highestPriority = members.reduce<string>((best, m) =>
      (PRIO_ORDER[m.priority] ?? 9) < (PRIO_ORDER[best] ?? 9) ? m.priority : best, "low");
    const first = members[0];
    groupByKey.set(key, {
      kind: "group",
      groupKey: key,
      module: first.module,
      source: first.source as "inbox" | "tat" | "work_item",
      branch_name: first.branch_name ?? null,
      items: members,
      worstRisk,
      highestPriority,
    });
    members.forEach((m) => absorbed.add(`${m.source}-${m.id}`));
  });

  const result: (PendingTask | GroupedItem)[] = [];
  const groupEmitted = new Set<string>();

  for (const item of items) {
    const itemKey = `${item.source}-${item.id}`;
    if (!absorbed.has(itemKey)) {
      result.push(item);
      continue;
    }
    const key = `${item.module}::${item.source}::${item.branch_name ?? "__none__"}`;
    if (!groupEmitted.has(key)) {
      result.push(groupByKey.get(key)!);
      groupEmitted.add(key);
    }
  }

  return result;
}
```

## Constraints
- `Risk` and `PendingTask` types are already defined in the same file — do not redefine them
- TypeScript strict is on — the `!` non-null assertion on `groupByKey.get(key)!` is safe because we only enter that branch when `groupEmitted` doesn't have the key, which only happens for keys that ARE in `groupByKey`
- Do not touch any other part of the file

## Verification
```bash
npx tsc --noEmit
```
Expected: zero errors.

## Commit
```bash
git add src/pages/NativeWorkInbox.tsx
git commit -m "feat(inbox): add GroupedItem type and groupItems() utility"
```

## Report File
Write your full report to: `.superpowers/sdd/briefs/task-2-report.md`
Return only: status, commit SHA, one-line tsc summary, concerns.
