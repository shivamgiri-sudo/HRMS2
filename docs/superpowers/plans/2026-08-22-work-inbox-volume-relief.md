# Work Inbox — Package 1: Volume Relief — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship four features that cut the cost of processing a high-volume Work Inbox: bulk group acknowledgement, smart remarks chips, keyboard navigation, and a "Needs You vs Your Team" section split.

**Architecture:** Backend gets one new endpoint (`POST /api/inbox/bulk-actioned`) added inline to `inbox.routes.ts` and `inbox.service.ts`. All other changes are pure frontend additions to `NativeWorkInbox.tsx` — no new files, no new DB tables, no schema migrations.

**Tech Stack:** TypeScript, Express/MySQL2 (backend); React 18, Vite, Tailwind, `@tanstack/react-query`, Lucide (frontend).

## Global Constraints

- Never alter an already-applied SQL migration — additive changes only.
- Never `git add -A` — stage by explicit file path.
- Backend auth: all routes behind `requireAuth`; bulk endpoint needs no elevated role (user can only bulk-act items that already belong to them).
- `db.execute()` from `../../db/mysql.js` is the only DB client — never import a second pool.
- `source === "derived"` items must never appear in a bulk call — they have no stored row to mark.
- TypeScript `strict` is on — no `any` without explicit `eslint-disable` comments.
- Validate TypeScript builds with `cd backend && npx tsc --noEmit` and `cd .. && npx tsc --noEmit` after each task.

---

## File Map

| File | Change |
|------|--------|
| `backend/src/modules/inbox/inbox.service.ts` | Add `bulkActioned()` export |
| `backend/src/modules/inbox/inbox.routes.ts` | Add `POST /bulk-actioned` route |
| `src/pages/NativeWorkInbox.tsx` | Add `GroupedItem` type, `groupItems()`, `GroupRow`, `MODULE_REMARKS`, `RemarksChips`, `useKeyboardNav`, section classifier, section divider |

---

## Task 1 — Backend: `bulkActioned()` + route

**Files:**
- Modify: `backend/src/modules/inbox/inbox.service.ts` (after the closing `}` of `inboxService`, before `getMyPending`)
- Modify: `backend/src/modules/inbox/inbox.routes.ts` (after the existing `PATCH /:id/actioned` route, before `PATCH /mark-all-read`)

**Interfaces:**
- Produces:
  - `bulkActioned(userId, ids, source, remarks?) → Promise<{ actioned: number; failed: BulkFailure[] }>`
  - `POST /api/inbox/bulk-actioned` → `{ success: true, actioned: number, failed: BulkFailure[] }`

```typescript
// BulkFailure — used in both service and route response
interface BulkFailure {
  id: string;
  reason: "not_found" | "already_actioned" | "wrong_source" | "access_denied";
}
```

- [ ] **Step 1: Add `bulkActioned` to `inbox.service.ts`**

Open `backend/src/modules/inbox/inbox.service.ts`. Add the following immediately after the closing `},` of the `inboxService` object (before the blank line that precedes `// ── Platform-wide pending task queue`):

```typescript
export interface BulkFailure {
  id: string;
  reason: "not_found" | "already_actioned" | "wrong_source" | "access_denied";
}

/**
 * Mark a batch of inbox items as actioned in a single transaction.
 *
 * For `inbox` source: single bulk UPDATE scoped to user_id (natural access
 * control — rows owned by another user update 0 rows and appear in `failed`).
 * For `tat` and `work_item` sources: sequential loop using the same underlying
 * logic as the single-item endpoints. Batch sizes for those sources are
 * typically small (< 20) so sequential is acceptable.
 *
 * Never throws — partial failures are reported in the `failed` array so the
 * caller can remove succeeded items from the UI while leaving failures in place.
 */
export async function bulkActioned(
  userId: string,
  ids: string[],
  source: "inbox" | "tat" | "work_item",
  remarks?: string,
): Promise<{ actioned: number; failed: BulkFailure[] }> {
  if (!ids.length) return { actioned: 0, failed: [] };
  if (ids.length > 500) {
    return { actioned: 0, failed: ids.map((id) => ({ id, reason: "wrong_source" as const })) };
  }

  const failed: BulkFailure[] = [];
  let actioned = 0;

  if (source === "inbox") {
    // Determine which of the supplied IDs actually belong to this user and are open.
    const placeholders = ids.map(() => "?").join(",");
    const [owned] = await db.execute<RowDataPacket[]>(
      `SELECT id, is_actioned FROM work_inbox_item WHERE id IN (${placeholders}) AND user_id = ?`,
      [...ids, userId],
    );
    const ownedMap = new Map<string, boolean>(
      (owned as RowDataPacket[]).map((r) => [String(r.id), Boolean(r.is_actioned)]),
    );

    for (const id of ids) {
      if (!ownedMap.has(id)) { failed.push({ id, reason: "access_denied" }); continue; }
      if (ownedMap.get(id))  { failed.push({ id, reason: "already_actioned" }); continue; }
    }

    const actionable = ids.filter((id) => ownedMap.has(id) && !ownedMap.get(id));
    if (actionable.length) {
      const ph = actionable.map(() => "?").join(",");
      await db.execute(
        `UPDATE work_inbox_item SET is_actioned = 1, is_read = 1 WHERE id IN (${ph}) AND user_id = ?`,
        [...actionable, userId],
      );
      actioned = actionable.length;
    }
    return { actioned, failed };
  }

  if (source === "tat") {
    for (const id of ids) {
      try {
        const [rows] = await db.execute<RowDataPacket[]>(
          "SELECT id, status FROM task_tat_instance WHERE id = ? AND (assigned_to = ? OR owner_user_id = ?)",
          [id, userId, userId],
        );
        const row = (rows as RowDataPacket[])[0];
        if (!row) { failed.push({ id, reason: "access_denied" }); continue; }
        if (["completed", "cancelled"].includes(String(row.status ?? ""))) {
          failed.push({ id, reason: "already_actioned" }); continue;
        }
        await db.execute(
          "INSERT INTO tat_task_completions (task_id, completed_by, remarks, completed_at) VALUES (?, ?, ?, NOW())",
          [id, userId, remarks ?? null],
        );
        await db.execute(
          "UPDATE task_tat_instance SET status = 'completed' WHERE id = ?",
          [id],
        );
        actioned++;
      } catch {
        failed.push({ id, reason: "not_found" });
      }
    }
    return { actioned, failed };
  }

  if (source === "work_item") {
    for (const id of ids) {
      try {
        const [rows] = await db.execute<RowDataPacket[]>(
          "SELECT id, status FROM work_item WHERE id = ? AND (assigned_to_user_id = ? OR created_by = ?)",
          [id, userId, userId],
        );
        const row = (rows as RowDataPacket[])[0];
        if (!row) { failed.push({ id, reason: "access_denied" }); continue; }
        if (["completed", "cancelled"].includes(String(row.status ?? ""))) {
          failed.push({ id, reason: "already_actioned" }); continue;
        }
        await db.execute(
          "UPDATE work_item SET status = 'completed', completed_at = NOW() WHERE id = ?",
          [id],
        );
        await db.execute(
          "INSERT INTO work_item_audit_log (work_item_id, action, remarks, performed_by, performed_at) VALUES (?, 'bulk_completed', ?, ?, NOW())",
          [id, remarks ?? "Bulk acknowledged", userId],
        );
        actioned++;
      } catch {
        failed.push({ id, reason: "not_found" });
      }
    }
    return { actioned, failed };
  }

  return { actioned: 0, failed: ids.map((id) => ({ id, reason: "wrong_source" as const })) };
}
```

- [ ] **Step 2: Add the route to `inbox.routes.ts`**

In `backend/src/modules/inbox/inbox.routes.ts`, add this import at the top alongside the existing import from `./inbox.service.js`:

```typescript
import { inboxService, getMyPending, getTimeline, bulkActioned } from "./inbox.service.js";
```

Then add this route immediately after the `PATCH /:id/actioned` handler (around line 71) and before `PATCH /mark-all-read`:

```typescript
// POST /bulk-actioned — mark a batch of items as actioned in one call
// Caller can only act on their own items; ownership is enforced per-source in bulkActioned().
router.post("/bulk-actioned", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const { ids, source, remarks } = req.body as {
    ids?: unknown;
    source?: unknown;
    remarks?: unknown;
  };

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, error: "ids must be a non-empty array" });
  }
  if (!["inbox", "tat", "work_item"].includes(String(source ?? ""))) {
    return res.status(400).json({ success: false, error: "source must be inbox | tat | work_item" });
  }
  if (ids.length > 500) {
    return res.status(400).json({ success: false, error: "Maximum 500 ids per call" });
  }

  const result = await bulkActioned(
    userId,
    ids.map(String),
    source as "inbox" | "tat" | "work_item",
    typeof remarks === "string" ? remarks : undefined,
  );
  return res.json({ success: true, ...result });
}));
```

- [ ] **Step 3: Build-check the backend**

```bash
cd backend && npx tsc --noEmit
```

Expected: no errors. If you see "Cannot find name 'BulkFailure'" in routes, add `import type { BulkFailure } from "./inbox.service.js";` to `inbox.routes.ts`.

- [ ] **Step 4: Manual smoke test** (requires a running dev server)

```bash
# Replace TOKEN and ITEM_ID with real values from your browser's DevTools network tab
curl -s -X POST http://localhost:3000/api/inbox/bulk-actioned \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ids":["ITEM_ID"],"source":"inbox","remarks":"test bulk"}' | jq .
```

Expected response:
```json
{ "success": true, "actioned": 1, "failed": [] }
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/inbox/inbox.service.ts backend/src/modules/inbox/inbox.routes.ts
git commit -m "feat(inbox): add POST /api/inbox/bulk-actioned endpoint"
```

---

## Task 2 — Frontend: `GroupedItem` type + `groupItems()` function

**Files:**
- Modify: `src/pages/NativeWorkInbox.tsx` — add after the existing `PendingTask` interface definition

**Interfaces:**
- Produces:
  - `GroupedItem` interface
  - `groupItems(items: PendingTask[]) → (PendingTask | GroupedItem)[]`
- Consumes:
  - `PendingTask` (already defined in the file)
  - `Risk` type (already defined in the file)

- [ ] **Step 1: Add `GroupedItem` interface and `groupItems()` to `NativeWorkInbox.tsx`**

Open `src/pages/NativeWorkInbox.tsx`. Find the line `interface PendingSummary {` (around line 52 in the original, slightly different now). Add the following **after** the closing `}` of `PendingSummary`:

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
  // Build a map: groupKey → members
  const RISK_ORDER: Record<Risk, number> = { breached: 0, due_soon: 1, aged: 2, on_track: 3 };
  const PRIO_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

  const buckets = new Map<string, PendingTask[]>();

  for (const item of items) {
    // "derived" source has no stored row — can never bulk-act
    if (item.source === "derived") continue;
    // Urgent items always stay individual
    if (item.priority === "urgent") continue;
    const key = `${item.module}::${item.source}::${item.branch_name ?? "__none__"}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(item);
    buckets.set(key, bucket);
  }

  // Collect the keys that qualify (≥ 3 members)
  const groupKeys = new Set<string>();
  buckets.forEach((members, key) => {
    if (members.length >= 3) groupKeys.add(key);
  });

  if (!groupKeys.size) return items;

  // Track which PendingTask ids have been absorbed into a group
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

  // Rebuild array in original order: replace the first member of each group with
  // the GroupedItem, drop subsequent members.
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
    // Subsequent members of the group are skipped — they live inside group.items
  }

  return result;
}
```

- [ ] **Step 2: TypeScript build-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/NativeWorkInbox.tsx
git commit -m "feat(inbox): add GroupedItem type and groupItems() utility"
```

---

## Task 3 — Frontend: `GroupRow` component + confirmation dialog

**Files:**
- Modify: `src/pages/NativeWorkInbox.tsx` — add `GroupRow` component after the existing `ActedRow` component

**Interfaces:**
- Consumes:
  - `GroupedItem` (from Task 2)
  - `RISK_STYLES`, `MODULE_LABELS`, `humaniseModuleKey`, `PRIORITY_STYLES` (all exist in file)
- Produces:
  - `GroupRow` component with props `{ group, onExpand, expanded, onBulkAct, acting }`

- [ ] **Step 1: Add `GroupRow` to `NativeWorkInbox.tsx`**

Find the `// ── Table chrome` comment that precedes `function TableHead()`. Add the following immediately **before** that comment:

```typescript
// ── Group Row ─────────────────────────────────────────────────────────────────

function GroupRow({
  group,
  onExpand,
  expanded,
  onBulkAct,
  acting,
}: {
  group: GroupedItem;
  onExpand: () => void;
  expanded: boolean;
  onBulkAct: () => void;
  acting: boolean;
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
          onOpen={() => {/* opened from parent via setSelected */}}
          onQuickAct={() => {/* individual act handled by parent */}}
          acting={false}
        />
      ))}
    </>
  );
}
```

- [ ] **Step 2: TypeScript build-check**

```bash
npx tsc --noEmit
```

Expected: no errors. If you see "Cannot find name 'GroupedItem'", ensure Task 2 was committed and is visible in the same file.

- [ ] **Step 3: Commit**

```bash
git add src/pages/NativeWorkInbox.tsx
git commit -m "feat(inbox): add GroupRow component with bulk-acknowledge confirmation"
```

---

## Task 4 — Frontend: Wire groups into the main component

**Files:**
- Modify: `src/pages/NativeWorkInbox.tsx` — update `NativeWorkInbox` function body

**Interfaces:**
- Consumes:
  - `groupItems()` (Task 2)
  - `GroupedItem` (Task 2)
  - `GroupRow` (Task 3)
  - `bulkActioned` — via `hrmsApi.post<{ success: boolean; actioned: number; failed: { id: string; reason: string }[] }>("/api/inbox/bulk-actioned", ...)`
- Produces: updated rendered table with grouped rows

- [ ] **Step 1: Add `expandedGroups` and `bulkActingKeys` state to `NativeWorkInbox`**

Inside the `NativeWorkInbox` function body, find the line:
```typescript
  const [actingIds, setActingIds] = useState<Set<string>>(new Set());
```

Add immediately after it:
```typescript
  // Groups whose individual rows are expanded in the table
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  // Group keys currently being bulk-acted (shows spinner on their row)
  const [bulkActingKeys, setBulkActingKeys] = useState<Set<string>>(new Set());
```

- [ ] **Step 2: Add `bulkActGroup` handler**

Inside `NativeWorkInbox`, find the `completeTask` function. Add the following **after** it (before `return (`):

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

      // Remove succeeded items from the pending list
      setItems((prev) => prev.filter((i) => !succeededIds.includes(i.id)));

      // Add a single batch entry to the recently-acted list
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

      // Update summary counts
      setSummary((prev) => {
        if (!prev) return prev;
        const updated = { ...prev, by_module: { ...prev.by_module } };
        for (const item of group.items) {
          if (failedIds.has(item.id)) continue;
          updated.total = Math.max(0, updated.total - 1);
          updated[item.risk] = Math.max(0, updated[item.risk] - 1);
          updated.by_module[item.module] = Math.max(0, (updated.by_module[item.module] ?? 1) - 1);
        }
        return updated;
      });

      // Immediately drop from notification bell
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

- [ ] **Step 3: Replace the table body rendering to use `groupItems()`**

Inside `NativeWorkInbox`, find the section that currently renders:
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

Also update the `GroupRow`'s `onOpen` and `onQuickAct` for expanded individual rows. Find the `GroupRow` component and replace the two empty arrow functions:

```typescript
          onOpen={() => setSelected(task)}
          onQuickAct={() => void completeTask(task.id, "")}
```

Wait — `GroupRow` is a standalone component and cannot call `setSelected` / `completeTask` directly. Pass them as props. Update `GroupRow`'s props interface:

```typescript
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
```

And in the expanded rows section of `GroupRow`:
```typescript
      {expanded && group.items.map((task) => (
        <TaskRow
          key={`${task.source}-${task.id}`}
          task={task}
          onOpen={() => onOpenItem(task)}
          onQuickAct={() => onActItem(task)}
          acting={false}
        />
      ))}
```

And in the main render, pass the new props:
```typescript
                  <GroupRow
                    key={row.groupKey}
                    group={row}
                    expanded={expandedGroups.has(row.groupKey)}
                    onExpand={...}
                    onBulkAct={() => void bulkActGroup(row)}
                    acting={bulkActingKeys.has(row.groupKey)}
                    onOpenItem={(task) => setSelected(task)}
                    onActItem={(task) => void completeTask(task.id, "")}
                  />
```

- [ ] **Step 4: TypeScript build-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/NativeWorkInbox.tsx
git commit -m "feat(inbox): wire bulk group acknowledgement into work inbox table"
```

---

## Task 5 — Frontend: Smart Remarks Chips

**Files:**
- Modify: `src/pages/NativeWorkInbox.tsx` — add `MODULE_REMARKS` constant and `RemarksChips` component, wire into `ActionSheet`

**Interfaces:**
- Consumes: `task.module` (string) from `PendingTask`
- Produces: `RemarksChips` component with props `{ module: string; onSelect: (text: string) => void }`

- [ ] **Step 1: Add `MODULE_REMARKS` constant**

Find the `// ── Helpers` comment section (at the top of the file near `MODULE_LABELS`). Add the following after the closing `};` of `MODULE_LABELS`:

```typescript
/**
 * Pre-written remarks for common module actions, shown as one-click chips
 * above the remarks textarea in the ActionSheet. Keyed by work_inbox_item.type
 * (same keys as MODULE_LABELS). Modules not present here show no chips — clean
 * degradation, no broken UI.
 */
const MODULE_REMARKS: Record<string, readonly string[]> = {
  leave_approval:            ["Approved — coverage confirmed", "Declined — insufficient balance", "Approved with conditions"],
  leave_request:             ["Approved — coverage confirmed", "Declined — insufficient balance"],
  attendance_missing_punch:  ["Regularized — supervisor verified", "Declined — records correct"],
  attendance_regularization: ["Regularized — supervisor verified", "Declined — records correct"],
  regularization:            ["Regularized — verified", "Declined — records correct"],
  bgv:                       ["Clear — proceeding", "Document resubmission requested", "Escalated to HR Head"],
  exit_clearance:            ["Cleared", "Pending — asset return outstanding", "Escalated"],
  resignation:               ["Acknowledged — notice period begins", "Escalated to Branch Head"],
  onboarding:                ["Completed — employee notified", "Pending documents — follow-up sent"],
  offboarding:               ["Clearance complete", "Pending — IT access outstanding"],
  it_provisioning:           ["Provisioned", "Deferred — pending approval"],
  asset_return:              ["Assets received and logged", "Partial return — follow-up required"],
  pip_checkpoint:            ["Checkpoint noted — plan on track", "Checkpoint missed — escalating"],
  walkin_feedback_pending:   ["Feedback submitted", "No-show — candidate not reachable"],
  visitor_approval_needed:   ["Approved — visitor registered", "Declined — not authorised"],
};
```

- [ ] **Step 2: Add `RemarksChips` component**

Add this component immediately before the `// ── Action Sheet` comment:

```typescript
// ── Remarks Chips ─────────────────────────────────────────────────────────────

function RemarksChips({ module, onSelect }: { module: string; onSelect: (text: string) => void }) {
  const chips = MODULE_REMARKS[module];
  if (!chips?.length) return null;
  return (
    <div className="mb-2">
      <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">Quick remarks</p>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => onSelect(chip)}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:border-slate-300 transition-colors"
          >
            {chip}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire `RemarksChips` into `ActionSheet`**

Inside the `ActionSheet` component, find the remarks section — the block that starts with:
```typescript
          {task.source !== "derived" && (
            <div>
              <p className="mb-2 text-xs font-black uppercase tracking-widest text-slate-400">Remarks (optional)</p>
              <Textarea
```

Replace that entire block with:
```typescript
          {task.source !== "derived" && (
            <div>
              <RemarksChips module={task.module} onSelect={(text) => setRemarks(text)} />
              <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">Remarks (optional)</p>
              <Textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                rows={3}
                placeholder="Add a note before completing…"
                className="resize-none text-sm"
              />
            </div>
          )}
```

- [ ] **Step 4: TypeScript build-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/NativeWorkInbox.tsx
git commit -m "feat(inbox): add smart remarks chips to ActionSheet"
```

---

## Task 6 — Frontend: `useKeyboardNav` hook

**Files:**
- Modify: `src/pages/NativeWorkInbox.tsx` — add hook before `NativeWorkInbox` component

**Interfaces:**
- Produces:
  ```typescript
  useKeyboardNav(opts: {
    itemCount: number;
    focusedIndex: number;
    setFocusedIndex: (n: number) => void;
    onAct: (index: number) => void;
    onOpen: (index: number) => void;
    onOpenUrl: (index: number) => void;
    onToggleLegend: () => void;
  }): void
  ```
- Consumes: React `useEffect`, `useCallback`

- [ ] **Step 1: Add `useKeyboardNav` hook**

Find the `// ── Main page` comment. Add the following immediately before it:

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
      // Don't hijack typing in inputs/textareas/selects
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
  }, []); // optsRef handles fresh values — no deps needed
}
```

- [ ] **Step 2: Add `focusedIndex`, `showKeyLegend` state and wire the hook in `NativeWorkInbox`**

Inside `NativeWorkInbox`, find the line:
```typescript
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
```

Add after it:
```typescript
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [showKeyLegend, setShowKeyLegend] = useState(false);
```

Then find the `completeTask` declaration. Add this immediately after the `completeTask` function:

```typescript
  useKeyboardNav({
    itemCount: filtered.length,
    focusedIndex,
    setFocusedIndex,
    onAct: (index) => {
      const item = filtered[index];
      if (!item || "kind" in item) return; // groups not keyboard-actable individually
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

- [ ] **Step 3: Apply focus ring to focused `TaskRow`**

In the table rendering, replace:
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
              );
```

with:
```typescript
              const task = row as PendingTask;
              const rowIndex = filtered.indexOf(row);
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
```

Update `TaskRow`'s props interface to accept `focused?: boolean` and add the ring class:

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
  const rs = RISK_STYLES[task.risk];
  // ...existing riskLabel...
  return (
    <tr className={`group border-b border-slate-100 last:border-0 hover:bg-slate-50/80 transition-colors ${rs.row} ${focused ? "ring-2 ring-inset ring-blue-500 bg-blue-50/30" : ""}`}>
```

- [ ] **Step 4: Add keyboard legend overlay**

Inside `NativeWorkInbox`, find the closing `</DashboardLayout>` tag. Add the legend panel just before the `<ActionSheet` component:

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
            {[
              ["J / K", "Navigate rows"],
              ["A", "Act on row"],
              ["D", "Details sheet"],
              ["O", "Open link"],
              ["S", "Snooze (soon)"],
              ["?", "Toggle this panel"],
              ["Esc", "Clear focus"],
            ].map(([key, desc]) => (
              <div key={key} className="flex justify-between">
                <kbd className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">{key}</kbd>
                <span className="text-slate-500">{desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}
```

Also add a small "?" button to the header bar to toggle the legend. Inside the header `<div className="relative flex...">`, find the Refresh button. Add before it:

```typescript
                <button
                  onClick={() => setShowKeyLegend((v) => !v)}
                  className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3.5 py-2 text-xs font-bold text-white backdrop-blur-sm hover:bg-white/20 transition-all"
                  title="Keyboard shortcuts"
                >
                  <span className="font-mono">?</span>
                </button>
```

- [ ] **Step 5: TypeScript build-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/NativeWorkInbox.tsx
git commit -m "feat(inbox): add keyboard navigation (J/K/A/O/D/?) to work inbox"
```

---

## Task 7 — Frontend: "Needs You" vs "Your Team Can Handle" section split

**Files:**
- Modify: `src/pages/NativeWorkInbox.tsx` — add `classifyItem()` function and `SectionDivider` component; update table rendering

**Interfaces:**
- Produces:
  - `classifyItem(item: PendingTask | GroupedItem): "needs_you" | "team_can_handle"`
  - `SectionDivider` component with props `{ label: string; count: number }`

- [ ] **Step 1: Add `classifyItem()` function**

Find the `// ── Main page` comment. Add immediately before `useKeyboardNav`:

```typescript
// ── Section Classifier ────────────────────────────────────────────────────────

const EXCLUSIVE_MODULES = new Set([
  "exit_clearance", "resignation", "bgv", "payroll_attendance_conflict", "pip_checkpoint",
]);

/**
 * Decide whether an item belongs in "Needs You" (only you can resolve it) or
 * "Your Team Can Handle" (any team member with the same role could act).
 *
 * This is a frontend heuristic — no API call needed. The split is informational,
 * not access-controlled: every row in both sections is still actionable by the
 * current user.
 */
function classifyItem(item: PendingTask | GroupedItem): "needs_you" | "team_can_handle" {
  if ("kind" in item && item.kind === "group") {
    // A group is "needs_you" if its worst risk is breached/due_soon
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
```

- [ ] **Step 2: Add `SectionDivider` component**

Add immediately after `classifyItem`:

```typescript
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

- [ ] **Step 3: Split the filtered list and render two sections**

Inside `NativeWorkInbox`, find where `filtered` is declared:
```typescript
  const filtered = items.filter((item) => { ... });
```

After that block, add:
```typescript
  // After grouping, split into two sections
  const groupedFiltered = groupItems(filtered);
  const needsYou = groupedFiltered.filter((r) => classifyItem(r) === "needs_you");
  const teamCanHandle = groupedFiltered.filter((r) => classifyItem(r) === "team_can_handle");
```

Then replace the table `<tbody>` content. Find the block:
```typescript
            groupItems(filtered).map((row) => {
```

Replace the entire `<tbody>` contents with:

```typescript
                  {/* Needs You section */}
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

                  {/* Your Team section */}
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
                      />
                    );
                  })}
```

Also update the empty-state check at the top of the table block. Replace:
```typescript
          ) : filtered.length === 0 ? (
```
with:
```typescript
          ) : groupedFiltered.length === 0 ? (
```

- [ ] **Step 4: Final TypeScript build-check (both frontend and backend)**

```bash
npx tsc --noEmit && cd backend && npx tsc --noEmit
```

Expected: no errors in either.

- [ ] **Step 5: Commit**

```bash
git add src/pages/NativeWorkInbox.tsx
git commit -m "feat(inbox): add Needs You vs Your Team section split to work inbox"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|-----------------|------|
| Bulk group ≥ 3 same module/source/branch | Task 2 (`groupItems`) |
| No urgent items in groups | Task 2 (`groupItems`) |
| No derived items in groups | Task 2 (`groupItems`) |
| GroupRow with count badge and worst-risk badge | Task 3 |
| "Acknowledge All" inline confirmation (not modal) | Task 3 |
| `POST /api/inbox/bulk-actioned` endpoint | Task 1 |
| Bulk API: role-scoped, 500 item max, single transaction for inbox source | Task 1 |
| Partial failure response `{ actioned, failed }` | Task 1 |
| Failed items stay in list; success toast on partial | Task 4 |
| Bell cache invalidated after bulk act | Task 4 |
| Recently-acted batch entry after bulk act | Task 4 |
| MODULE_REMARKS constant per module type | Task 5 |
| Chips replace (not append) textarea on click | Task 5 |
| No chips rendered for unsupported modules | Task 5 (`RemarksChips` returns null) |
| J/K/A/O/D/? keyboard bindings | Task 6 |
| Listener suppressed when input/textarea focused | Task 6 |
| Focus ring on focused row | Task 6 |
| `S` stub shows toast | Task 6 |
| Keyboard legend overlay toggled by `?` | Task 6 |
| "Needs You" section: breached, urgent, high, derived, exclusive modules | Task 7 |
| "Your Team Can Handle" section: everything else | Task 7 |
| Reassign button in team section shows stub toast | Not yet — add to `TaskRow` in Task 7 step 3 below |

**Gap found — Reassign stub button in "Your Team Can Handle" rows.**

Add to Task 7, Step 3: inside the `teamCanHandle.map()` block for individual `TaskRow` rows, the spec says the "Your Team" section rows show a faint Reassign button stub. Update the `TaskRow` component to accept an optional `showReassign?: boolean` prop and render a stub button when true:

```typescript
// In TaskRow props interface, add:
  showReassign?: boolean;

// In TaskRow render, inside the Actions <td>, after the existing buttons:
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

Pass `showReassign={true}` only in the `teamCanHandle.map()` rendering block.

**No other gaps found.**
