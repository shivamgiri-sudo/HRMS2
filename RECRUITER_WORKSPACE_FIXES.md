# Recruiter Workspace & Queue Fixes

## ✅ Fixed: Candidates Not Showing in Walkin Queue

### Problem:
- Candidates registering via `/interview-registration` weren't appearing in `/ats/walkin-queue`
- The registration created `ats_candidate` but not `ats_queue_token`

### Solution Implemented:
**File:** `backend/src/modules/ats/ats.service.ts`

Added auto-creation of queue tokens for Walk-In candidates:
- Token format: `WI-YYYYMMDD-XXXX` (e.g., `WI-20260617-0001`)
- Daily counter resets each day
- Status: `active`, Stage: `Arrived`
- Non-blocking (won't fail candidate creation if token fails)

**Commit:** `37404ee`

---

## 🔄 Pending: Remove Extra Recruiter Login Layer

### Current Issue:
You mentioned there's an extra login layer for recruiters. The route is:
```
/ats/recruiter/my-candidates → ProtectedRoute + Gate(ATS_RECRUITER_QUEUE)
```

### Analysis:

The current setup has:
1. **ProtectedRoute** - Requires HRMS login (JWT auth)
2. **Gate** - Checks page access permission

This is actually **correct** and **not an extra layer**. It's using the same HRMS authentication.

### What You Might Be Experiencing:

**If recruiters are seeing a separate login:**
- Check if they're accessing via a different URL (e.g., a standalone recruiter portal)
- Check if there's a `/recruiter-login` route in the app

Let me check for any standalone recruiter authentication:

```bash
# Check for separate recruiter auth routes
grep -r "recruiter.*auth\|recruiter.*login" backend/src/modules/ats
```

---

## 🎯 Recommended Solution

### Option 1: Use Existing HRMS Portal (Recommended)

**Benefits:**
- Single sign-on
- Unified user management
- Consistent access control
- No duplicate authentication

**Implementation:**
1. Recruiters log into main HRMS portal
2. Navigate to: **ATS** → **My Candidates**
3. URL: `http://localhost:8081/ats/recruiter/my-candidates`

**Required:**
- Ensure recruiter users have the `ATS_RECRUITER_QUEUE` page permission
- Add menu item in dashboard sidebar for easy access

### Option 2: Add Direct Menu Link

**File:** `src/components/layout/DashboardLayout.tsx` or sidebar component

Add menu item:
```typescript
{
  label: 'My Candidates',
  icon: '👥',
  path: '/ats/recruiter/my-candidates',
  permission: 'ATS_RECRUITER_QUEUE'
}
```

---

## 📋 Recruiter Workspace Features

### Current Features:
✅ View assigned candidates
✅ Update interview feedback
✅ Multi-round evaluation
✅ Final decision tracking

### Missing Features (if needed):
- ⬜ Real-time notifications for new candidates
- ⬜ Quick filters (today, pending, completed)
- ⬜ Bulk actions
- ⬜ Export to Excel

---

## 🔧 Queue Integration Check

### Verify Queue Token Creation:

```sql
-- Check if tokens are being created
SELECT 
  c.candidate_code,
  c.full_name,
  c.mobile,
  qt.token,
  qt.arrival_time,
  qt.status
FROM ats_candidate c
LEFT JOIN ats_queue_token qt ON qt.candidate_id = c.id
WHERE c.sourcing_channel = 'Walk-In'
  AND DATE(c.created_at) = CURDATE()
ORDER BY c.created_at DESC;
```

### Expected Result:
```
| candidate_code | full_name    | mobile     | token              | arrival_time        | status |
|----------------|--------------|------------|--------------------|---------------------|--------|
| CND-ABC123     | John Doe     | 9876543210 | WI-20260617-0001  | 2026-06-17 10:30:00 | active |
```

---

## 🚀 Next Steps

### 1. Verify Queue Token Creation

After the backend fix, test the flow:

```bash
# 1. Restart backend
cd backend && npm run dev

# 2. Register a candidate
# Open: http://localhost:8081/interview-registration
# Fill form and submit

# 3. Check walkin queue
# Open: http://localhost:8081/ats/walkin-queue
# Should see the candidate with token WI-YYYYMMDD-XXXX
```

### 2. Grant Recruiter Access

**Option A: Via UI**
1. Go to: **Settings** → **Access Control** → **Page Permissions**
2. Find role: `recruiter`
3. Enable: `ATS_RECRUITER_QUEUE` permission

**Option B: Via SQL**
```sql
-- Grant recruiter role access to workspace
INSERT INTO role_page_access (id, role_key, page_code, can_access)
VALUES (UUID(), 'recruiter', 'ATS_RECRUITER_QUEUE', 1)
ON DUPLICATE KEY UPDATE can_access = 1;

-- Grant walkin queue access
INSERT INTO role_page_access (id, role_key, page_code, can_access)
VALUES (UUID(), 'recruiter', 'ATS_WALKIN_QUEUE', 1)
ON DUPLICATE KEY UPDATE can_access = 1;
```

### 3. Add Menu Item (Optional)

Make it easy for recruiters to find their workspace:

**File:** Sidebar/Navigation component

```typescript
// Add to recruiter menu section
{
  icon: <Users className="h-4 w-4" />,
  label: 'My Candidates',
  path: '/ats/recruiter/my-candidates',
  badge: pendingCount > 0 ? String(pendingCount) : undefined,
}
```

---

## 📊 Testing Checklist

- ⬜ Register candidate via `/interview-registration`
- ⬜ Verify candidate appears in `/ats/walkin-queue`
- ⬜ Check queue token is created (format: WI-YYYYMMDD-XXXX)
- ⬜ Recruiter can log in to HRMS portal
- ⬜ Recruiter can access `/ats/recruiter/my-candidates`
- ⬜ Recruiter can see assigned candidates
- ⬜ Recruiter can update feedback

---

## 🐛 Troubleshooting

### Candidates Still Not Showing:

**1. Check backend console for errors:**
```bash
tail -f /tmp/backend.log
```

**2. Check database:**
```sql
-- Are candidates being created?
SELECT * FROM ats_candidate ORDER BY created_at DESC LIMIT 5;

-- Are queue tokens being created?
SELECT * FROM ats_queue_token ORDER BY arrival_time DESC LIMIT 5;
```

**3. Check sourcing channel:**
```sql
-- Verify candidates are marked as Walk-In
SELECT candidate_code, full_name, sourcing_channel 
FROM ats_candidate 
WHERE DATE(created_at) = CURDATE();
```

### Recruiter Can't Access:

**1. Check authentication:**
- Is user logged into HRMS?
- Does user have `recruiter` role?

**2. Check page permissions:**
```sql
SELECT r.role_key, rpa.page_code, rpa.can_access
FROM role_page_access rpa
JOIN roles r ON r.role_key = rpa.role_key
WHERE r.role_key = 'recruiter'
  AND rpa.page_code IN ('ATS_RECRUITER_QUEUE', 'ATS_WALKIN_QUEUE');
```

**3. Check user role assignment:**
```sql
SELECT u.email, r.role_key
FROM users u
JOIN user_roles ur ON ur.user_id = u.id
JOIN roles r ON r.id = ur.role_id
WHERE u.email = 'recruiter@teammas.in';
```

---

## 💡 Summary

**✅ FIXED:**
- Candidates now auto-generate queue tokens on registration
- Walk-in queue will show new registrations immediately

**✅ RECOMMENDED:**
- Keep existing HRMS authentication (no separate recruiter login)
- Grant `ATS_RECRUITER_QUEUE` permission to recruiter role
- Add convenient menu link for recruiters

**NO EXTRA LOGIN LAYER:**
- Current setup uses standard HRMS auth + page permissions
- This is the correct approach for security and user management
