# roster.routes.ts Comparison - Package vs Our Version

**Date**: 2026-06-04  
**Status**: Package version has SIGNIFICANT improvements

---

## Key Differences

### Our Version (Current - 1.3KB)
- ✅ Basic route definitions
- ❌ NO scope guards
- ❌ NO middleware protection
- ❌ Anyone with auth can create/edit rosters

### Package Version (Enhanced - ~3KB)
- ✅ Comprehensive scope guards on ALL routes
- ✅ Specialized middleware functions
- ✅ Governance rules enforced
- ✅ Draft-only restrictions
- ✅ PM-only publish control

---

## Package Improvements

### 1. Specialized Middleware (NOT in our scopeMiddleware.ts)

Package adds 3 new middleware functions:

```typescript
// Check scope from query params
requireQueryScope(scopedRoles, globalRoles)

// Check scope from request body
requireBodyScope(scopedRoles, globalRoles)

// Check scope from roster plan (complex)
requireRosterPlanScope({
  planIdSource: "param" | "body" | "query",
  planIdKey: string,
  scopedRoles: string[],
  globalRoles: string[],
  requireDraft?: boolean,
  publishedChangeRoles?: string[]
})
```

### 2. Route-by-Route Enhancements

#### POST /plans (Create Plan)
**Our Version**: No protection  
**Package**:
```typescript
requireBodyScope(["wfm", "process_manager"], ["admin", "hr"])
```
✅ WFM/PM can create ONLY within scope

#### GET /plans (List Plans)
**Our Version**: No protection  
**Package**:
```typescript
requireQueryScope(["wfm", "process_manager", "branch_head"], ["admin", "hr", "ceo"])
```
✅ Scoped by query params
✅ CEO/Branch Head read-only

#### PATCH /plans/:id/publish (Publish Plan)
**Our Version**: No protection  
**Package**:
```typescript
requireRosterPlanScope({
  planIdSource: "param",
  planIdKey: "id",
  scopedRoles: ["process_manager"],
  globalRoles: ["admin"]
})
```
✅ PM-only (scoped)
✅ Admin emergency override
✅ Resolves plan's branch/process from DB

#### POST /assignments (Assign Employee)
**Our Version**: No protection  
**Package**:
```typescript
requireRosterPlanScope({
  planIdSource: "body",
  planIdKey: "planId",
  scopedRoles: ["wfm", "process_manager"],
  globalRoles: ["admin"],
  requireDraft: true,              // <-- NEW!
  publishedChangeRoles: ["process_manager"]
})
```
✅ Draft-only restriction
✅ Published changes PM-only
✅ Enforces governance rules

#### GET /assignments (List Assignments)
**Our Version**: No protection  
**Package**:
```typescript
requireRosterPlanScope({
  planIdSource: "query",
  planIdKey: "planId",
  scopedRoles: ["wfm", "process_manager", "branch_head"],
  globalRoles: ["admin", "hr", "ceo"]
})
```
✅ Scoped list
✅ Read-only for Branch Head/CEO

#### POST /upload (CSV Upload)
**Our Version**: No protection  
**Package**:
```typescript
requireRosterPlanScope({
  planIdSource: "query",
  planIdKey: "planId",
  scopedRoles: ["wfm", "process_manager"],
  globalRoles: ["admin"],
  requireDraft: true  // <-- Critical!
})
```
✅ Draft-only CSV upload
✅ Prevents published roster overwrite

---

## Governance Rules Documented

Package includes clear governance comments:

```typescript
/**
 * WFM roster governance:
 * - No branch-specific role names. Use generic role_key + user_assignment_scope.
 * - WFM can create/edit draft rosters only inside assigned branch/process scope.
 * - Published roster changes are not allowed here; use Auto Roster Process Manager change flow.
 * - CEO/Branch Head read-only access should be through scoped GET endpoints.
 */
```

---

## Missing Middleware Functions

Our `scopeMiddleware.ts` (44 lines) only has:
- requireScopedRole()
- getTargetFromBodyOrQuery()

Package's `scopeMiddleware.ts` has 3 MORE:
- requireQueryScope() - Line 69
- requireBodyScope() - Line 82
- requireRosterPlanScope() - Line 95

**Issue**: Package roster.routes.ts DEPENDS on these functions!

---

## Integration Challenge

**Problem**: Package assumes enhanced scopeMiddleware.ts

**Options**:

### Option A: Update Our scopeMiddleware.ts
1. Compare package vs our scopeMiddleware.ts
2. Add missing 3 functions
3. Apply package roster.routes.ts
4. Test thoroughly

**Effort**: 1 hour  
**Risk**: MEDIUM (may break existing auto-roster routes)

### Option B: Manual Port
1. Keep our scopeMiddleware.ts
2. Manually add scope guards to roster.routes.ts
3. Use existing requireScopedRole() pattern
4. Skip specialized middleware

**Effort**: 30 min  
**Risk**: LOW (consistent with our Phase 3.1 pattern)

### Option C: Defer to Phase 6
1. Document improvements
2. Add to Phase 6 (WFM & Roster module)
3. Do comprehensive update then

**Effort**: 0 min now, 1 hour later  
**Risk**: LOW (already planned)

---

## Recommendation

**Option C** - Defer to Phase 6 (WFM & Roster Module)

**Reasoning**:
1. We're in middle of corrections package integration
2. Roster routes are separate from auto-roster (already done)
3. Phase 6 is specifically for WFM & Roster
4. Comprehensive update better than piecemeal

**Action**: Document improvements, add to Phase 6 checklist

---

## What to Integrate NOW

From corrections package:
- ❌ roster.routes.ts (defer to Phase 6)
- ✅ Control Tower (DONE - Step 1)
- ✅ Auto-Roster list filtering (DONE - Step 2)

**Next**: Step 4 - Analyze readiness-verification-engine-v1

---

## Phase 6 Checklist Update

When we reach Phase 6 (WFM & Roster Module):

1. ✅ Update scopeMiddleware.ts with 3 new functions:
   - requireQueryScope()
   - requireBodyScope()
   - requireRosterPlanScope()

2. ✅ Apply package roster.routes.ts (or port manually)

3. ✅ Test governance rules:
   - WFM draft-only access
   - PM publish control
   - Published roster change prevention
   - CEO/Branch Head read-only

4. ✅ Verify CSV upload draft restriction

**Estimated Time**: 1-2 hours
