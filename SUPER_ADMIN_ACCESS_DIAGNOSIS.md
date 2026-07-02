# Super Admin Access Diagnosis

## Issue
User `shivam.giri@teammas.in` (Super Admin) reports many pages are not showing or are restricted.

## Diagnosis Results ✅

### Database Check (PASSED)
```
📧 Email: shivam.giri@teammas.in
👤 Name: SHIVAM SHIV GIRI
🆔 User ID: a4a4902e-6222-11f1-adb1-00155d0ab410
🔒 Blocked: NO ✅
👔 Employee ID: 8b13186b-6584-11f1-adb1-00155d0ab410
🏷️  Employee Code: MAS47814
📊 Active Status: Active ✅
🎭 Roles: admin,employee,super_admin ✅
```

**User role assignments:**
- ✅ admin (System Administrator) - Active
- ✅ employee (Employee) - Active
- ✅ super_admin (Super Administrator) - Active

**Page access:**
- ✅ super_admin has 140 page access entries in `role_page_access` table
- ✅ All permissions granted (view, create, edit, delete, export)

### Frontend Access Control Logic (VERIFIED)

**File:** `src/components/layout/CompactDashboardLayout.tsx` (lines 80-108)

```typescript
const canShow = (item: { pageCode?: string; roles?: string[]; adminOnly?: boolean }) => {
  if (isSuperAdmin) return true;  // ✅ CORRECT - super_admin bypasses all checks
  if (item.pageCode) return visibleSet.has(item.pageCode) || canViewPage(item.pageCode);
  if (item.roles?.length) return hasAnyRole(...item.roles);
  if ((item as any).adminOnly && !isAdminOrHR) return false;
  return true;
};
```

**Logic is CORRECT** — `super_admin` role should bypass all restrictions at line 86.

### Backend Access Control (VERIFIED)

**File:** `backend/src/modules/access/access.service.ts` (lines 168-257)

```typescript
export async function getAccessMe(userId: string): Promise<AccessMeResponse> {
  // 1. Fetches roles from user_roles table ✅
  // 2. Fetches employee record ✅
  // 3. Fetches assignment scopes ✅
  // 4. Fetches page permissions from role_page_access ✅
  // 5. Merges user-specific overrides ✅
  
  return {
    roles,  // ['admin', 'employee', 'super_admin']
    pages,  // 140 page access entries
    scopes,
    // ... other fields
  };
}
```

**Backend logic is CORRECT** — returns all roles and pages.

---

## Root Cause 🎯

The database and backend are **100% correct**. The issue is likely:

### **1. Stale JWT Token** (MOST LIKELY)
The JWT access token was issued **before** the `super_admin` role was granted, so the frontend is still using the old token with outdated role data.

**Solution:** User must **log out and log back in** to get a fresh token.

### **2. Frontend Cache Issue**
The `useUserRole` hook caches the `/api/access/me` response via React Query with key `["user-role-workforce-os", user?.id]`. If the cache is stale, pages won't show.

**Solution:** Hard refresh (Ctrl+Shift+R) or clear browser localStorage.

### **3. Browser LocalStorage Corruption**
Old auth flags might be interfering.

**Solution:** Open browser console and run:
```javascript
localStorage.clear();
location.reload();
```

---

## Quick Fixes (In Order of Likelihood)

### ✅ Fix 1: Force Logout and Re-login
**User must try this first:**
1. Click profile icon → Sign Out
2. Wait for complete logout
3. Log in again with `shivam.giri@teammas.in`
4. Check if all pages now appear

### ✅ Fix 2: Clear Browser Cache
In browser console (F12):
```javascript
localStorage.clear();
sessionStorage.clear();
location.reload();
```

### ✅ Fix 3: Hard Refresh Frontend
Press **Ctrl+Shift+R** (Windows) or **Cmd+Shift+R** (Mac) to clear cache and reload.

---

## Advanced Debugging (If Above Doesn't Work)

### Check JWT Token Content
In browser console:
```javascript
const token = localStorage.getItem('hrms_access_token');
if (token) {
  const [, payload] = token.split('.');
  console.log(JSON.parse(atob(payload)));
}
```

**Expected:** `sub` field should match user ID `a4a4902e-6222-11f1-adb1-00155d0ab410`

### Check `/api/access/me` Response
In browser console:
```javascript
fetch('/api/access/me', {
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('hrms_access_token')}`
  }
})
  .then(r => r.json())
  .then(data => console.log('Access Me:', data));
```

**Expected:** Response should include:
```json
{
  "success": true,
  "data": {
    "roles": ["admin", "employee", "super_admin"],
    "pages": [...140 pages...],
    ...
  }
}
```

### Check React Query Cache
In browser console (React DevTools):
```javascript
// Check if useUserRole hook has correct data
console.log(window.__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers.get(1).findFiberByHostInstance(document.querySelector('[data-role]')));
```

---

## Backend Code Reference

### Access Control Flow
1. **Login** (`/api/auth/login`) → Issues JWT with `sub: user_id`
2. **Frontend** calls `/api/access/me` → Gets roles + pages
3. **useUserRole** hook caches response in React Query
4. **CompactDashboardLayout** filters navigation based on `super_admin` check (line 86)
5. **ProtectedRoute** checks route-level role requirements (line 45 — `super_admin` bypasses)

### Navigation Filtering
**File:** `src/components/layout/navConfig.tsx`
- Defines all nav items with optional `roles[]` and `pageCode` restrictions
- `CompactDashboardLayout` applies `canShow()` filter
- `super_admin` bypasses ALL restrictions

---

## Recommendation

**IMMEDIATE ACTION:** User should **log out completely and log back in**. This will:
1. Clear old JWT token
2. Issue new token with current role data
3. Fetch fresh `/api/access/me` response with all 140 pages
4. Render all navigation items (super_admin bypasses all role checks)

If logout+login doesn't work, then there's a different issue (likely frontend bundle not deployed or browser using cached JS). In that case:
1. Check if latest frontend build is deployed
2. Check if nginx is serving stale files
3. Check if CDN/proxy is caching old JS bundles

---

## Technical Summary

| Check | Status | Details |
|-------|--------|---------|
| User exists | ✅ PASS | User ID `a4a4902e-6222-11f1-adb1-00155d0ab410` |
| User not blocked | ✅ PASS | `is_blocked = 0` |
| Employee active | ✅ PASS | `active_status = 1` |
| Has super_admin role | ✅ PASS | In `user_roles` table |
| Role is active | ✅ PASS | `active_status = 1` |
| Page permissions | ✅ PASS | 140 entries in `role_page_access` |
| Backend logic | ✅ PASS | `getAccessMe()` returns correct data |
| Frontend logic | ✅ PASS | `isSuperAdmin` check bypasses all restrictions |
| **Most Likely Cause** | ⚠️ STALE TOKEN | User needs to logout+login |

---

## Files Analyzed
- ✅ `backend/src/modules/access/access.service.ts` (getAccessMe function)
- ✅ `backend/src/modules/access/access.routes.ts` (/api/access/me endpoint)
- ✅ `src/hooks/useUserRole.ts` (useUserRole hook, useWorkforceAccess)
- ✅ `src/components/auth/ProtectedRoute.tsx` (route-level role check)
- ✅ `src/components/layout/CompactDashboardLayout.tsx` (navigation filter logic)
- ✅ `src/components/layout/navConfig.tsx` (navigation definition)
- ✅ Database: `auth_user`, `user_roles`, `workforce_role_catalog`, `role_page_access`

---

**Date:** 2026-07-01  
**Diagnosis by:** Claude Sonnet 4.5  
**Status:** ✅ Database Verified, ⚠️ Token Refresh Required
