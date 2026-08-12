# Task 1 Brief: Backend reopen() service method + POST /:id/reopen route

## What you are building

Add a `reopen()` method to `grnSmartService` and a `POST /:id/reopen` route so that a
rejected GRN can be moved back to `draft` status for correction and resubmission.

## Files to modify

- `backend/src/modules/finance/grn-smart.service.ts`
- `backend/src/modules/finance/grn-smart.routes.ts`

## Context you need

### Service file layout
- `grnSmartService` is an object exported from `grn-smart.service.ts`
- Methods: `hasAllocations`, `reverseConsumption`, `saveAllocations`, `saveComponentAllocations`,
  `registerDocuments`, `analyzeDocument`, `confirmExtraction`, `revalidate`, `submit`, `review`,
  `cancel`, `getWorkspace`
- `cancel()` is the last method before `getWorkspace()` — insert `reopen()` between them
- `lockGrn(connection, grnId)` — acquires a FOR UPDATE lock and returns the GRN row
- `releaseAllocations(connection, allocations)` — sets `lifecycle_status = 'released'`
  (used by finance_head rejection path; you need to REVERSE this on reopen)
- `writeAudit(action, grnId, actorUserId, actorRole, changes)` — inserts an audit row
- `ResultSetHeader` is already imported from mysql2
- `db` is already imported — `await db.getConnection()` for transactions

### Status flow you are implementing
```
rejected  →  reopen()  →  draft
```
- Branch-head rejection: allocations were never reserved (lifecycle_status stays 'draft')
- Finance-head rejection: `releaseAllocations()` was called, so lifecycle_status = 'released'
  → reopen must restore them to 'draft'

### Route file layout
- `SMART_WRITE_ROLES` = `["accounts_head","finance_head","super_admin","admin","branch_head","branch_admin"]`
- Pattern for a cancel-like route (already in file):
  ```typescript
  smartGrnRouter.post(
    "/:id/cancel",
    requireWriteAccess,
    requireRole(...SMART_WRITE_ROLES),
    authorizeGrn,
    onlyWhenSmart,
    async (req: SmartRequest, res) => { ... }
  );
  ```
- Add `POST /:id/reopen` immediately after the cancel route, using identical middleware chain

## Exact implementation

### reopen() method (insert after cancel()'s closing `},`)

```typescript
  async reopen(grnId: string, actorUserId: string, actorRole: string) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const grn = await lockGrn(connection, grnId);
      if (String(grn.status) !== "rejected") {
        throw new Error(`Only rejected GRNs can be reopened. Current status: ${grn.status}`);
      }
      // Finance-head rejections call releaseAllocations(), setting lifecycle_status = 'released'.
      // Restore them to 'draft' so the next save can proceed normally.
      await connection.execute(
        `UPDATE grn_cost_allocation SET lifecycle_status = 'draft', updated_at = NOW()
           WHERE grn_request_id = ? AND lifecycle_status = 'released'`,
        [grnId]
      );
      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE grn_request
            SET status = 'draft',
                rejection_reason = NULL,
                branch_head_reviewed_by = NULL, branch_head_reviewed_at = NULL,
                branch_head_review_note = NULL,
                finance_head_reviewed_by = NULL, finance_head_reviewed_at = NULL,
                finance_head_review_note = NULL,
                reviewed_by = NULL, reviewed_at = NULL,
                review_note = NULL,
                submitted_at = NULL, submitted_by = NULL
          WHERE id = ? AND status = 'rejected'`,
        [grnId]
      );
      if (result.affectedRows !== 1) {
        throw new Error("GRN status changed before reopen; refresh and try again");
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    await writeAudit("REOPEN", grnId, actorUserId, actorRole, { previous_status: "rejected" });
    return { success: true, newStatus: "draft" as const };
  },
```

### Route (insert after POST /:id/cancel block)

```typescript
smartGrnRouter.post(
  "/:id/reopen",
  requireWriteAccess,
  requireRole(...SMART_WRITE_ROLES),
  authorizeGrn,
  onlyWhenSmart,
  async (req: SmartRequest, res) => {
    try {
      const user = actor(req);
      const data = await grnSmartService.reopen(req.params.id, user.id, user.role);
      res.json(data);
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : "Unable to reopen GRN",
      });
    }
  }
);
```

## Verification

After implementing, run:
```bash
cd /c/Users/ADMIN/Desktop/HRMS2-latest/backend && npx tsc --noEmit
```
Must exit 0 with no output.

## Commit

```bash
git add backend/src/modules/finance/grn-smart.service.ts \
        backend/src/modules/finance/grn-smart.routes.ts
git commit -m "feat(grn): POST /grns/:id/reopen — moves rejected → draft, restores released allocations"
```

## Report

Write your report to: `.superpowers/sdd/briefs/task-1-report.md`

Include:
- Status: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
- Commits made (short SHA)
- tsc output (confirm exit 0)
- Any concerns
