# ESI Registration Documents — Final Fix Report

**Status:** DONE
**Commit:** d34f4fa6416e62800e97fad2d5938b19aba65d39
**Date:** 2026-08-25 13:16:52 IST

## Critical Bug Fixed

The `writeAuditLog` function in `esi-reg-docs.routes.ts` was attempting to insert into a non-existent table `payroll_audit_trail`, causing audit log failures.

## Changes Applied

**File:** `backend/src/modules/payroll/esi-reg-docs.routes.ts`

### Before (Lines 168-183)
```typescript
async function writeAuditLog(
  action: string,
  performedBy: string,
  targetEmployeeId: string | null,
  details: Record<string, unknown>
): Promise<void> {
  try {
    await db.execute(
      `INSERT INTO payroll_audit_trail (id, action, performed_by, target_employee_id, details, created_at)
       VALUES (UUID(), ?, ?, ?, ?, NOW())`,
      [action, performedBy, targetEmployeeId, JSON.stringify(details)]
    );
  } catch (err) {
    console.error("[esi-reg-docs] audit log failed", err);
  }
}
```

### After
```typescript
async function writeAuditLog(
  action: string,
  performedBy: string,
  targetEmployeeId: string | null,
  details: Record<string, unknown>
): Promise<void> {
  try {
    await db.execute(
      `INSERT INTO sensitive_action_log
       (id, actor_user_id, action_type, module_key, entity_type, entity_id, change_summary, acted_at)
       VALUES (UUID(), ?, ?, 'payroll', 'esi_registration', ?, ?, NOW())`,
      [performedBy, action, targetEmployeeId, JSON.stringify(details)]
    );
  } catch (err) {
    console.error("[esi-reg-docs] audit log failed", err);
  }
}
```

## Key Mapping Changes

| Old Column | New Column | Value |
|---|---|---|
| `payroll_audit_trail` | `sensitive_action_log` | (table name) |
| `performed_by` | `actor_user_id` | (parameter 1) |
| `action` | `action_type` | (parameter 2) |
| - | `module_key` | `'payroll'` (hardcoded) |
| - | `entity_type` | `'esi_registration'` (hardcoded) |
| `target_employee_id` | `entity_id` | (parameter 3) |
| `details` | `change_summary` | (parameter 4) |
| `created_at` | `acted_at` | `NOW()` |

## Verification Results

### Test Suite
```
Test Files  1 passed (1)
Tests       8 passed (8)
Duration    1.90s
```

All tests passing:
- GET /esi-reg-docs (list endpoint)
- GET /esi-reg-docs/:id/download (single employee ZIP)
- POST /esi-reg-docs/bulk-download (bulk ZIP)
- GET /esi-reg-docs/export-csv (CSV export)
- Authorization checks
- Document availability checks
- Audit log functionality

### TypeScript Check
```
No TypeScript errors in esi-reg files
```

### Commit Verification
```
commit d34f4fa6416e62800e97fad2d5938b19aba65d39
1 file changed, 4 insertions(+), 3 deletions(-)
backend/src/modules/payroll/esi-reg-docs.routes.ts
```

## Affected Audit Points

This fix ensures audit logs are now correctly written for:

1. **Single ESI document download** (`esi_reg_doc_download`)
2. **Bulk ESI document download** (`esi_bulk_doc_download`)
3. **CSV export** (`esi_reg_csv_export`)

All three operations now correctly log to `sensitive_action_log` with proper module_key, entity_type, and actor tracking.

## Impact

- **Before:** All audit log writes silently failed (caught by try-catch)
- **After:** Audit logs now persist correctly in the platform-wide audit table
- **Breaking Changes:** None (existing routes and API unchanged)
- **Database:** Uses existing `sensitive_action_log` table from migration 015

## Rollback Plan

If needed, revert with:
```bash
git revert d34f4fa6416e62800e97fad2d5938b19aba65d39
```

## Next Steps

- Deploy to production
- Monitor `sensitive_action_log` table for ESI audit entries
- Consider adding a database constraint or app-level validation to prevent future table name mismatches
