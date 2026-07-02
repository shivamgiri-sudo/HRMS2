# Role Assignment & Access Control System - Complete Guide

**Date:** June 15, 2026  
**Status:** ✅ **FULLY IMPLEMENTED**

---

## 🎯 Quick Answer

### **YES, you HAVE role assignment functionality!**

Your project has a **complete role-based access control (RBAC) system** that allows assigning roles to employees, which controls what pages/features they can access.

---

## 📋 System Components

### **1. Backend API - Role Assignment**

**File:** `backend/src/modules/admin/role-assignment.routes.ts`

**Base Route:** `/api/admin/roles`

**Available Endpoints:**

#### **A. List All Roles**
```http
GET /api/admin/roles
Authorization: Admin only
```
**Response:**
```json
{
  "success": true,
  "data": [
    {"role_key": "admin", "role_name": "Administrator", "description": "Full system access"},
    {"role_key": "hr", "role_name": "HR Manager", "description": "HR operations"},
    {"role_key": "manager", "role_name": "Team Manager", "description": "Team management"},
    {"role_key": "qa", "role_name": "Quality Analyst", "description": "Quality monitoring"},
    // ... more roles
  ]
}
```

#### **B. Get User's Roles**
```http
GET /api/admin/roles/users/:userId/roles
Authorization: Admin, HR
```
**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "user_id": "user-uuid",
      "role_key": "manager",
      "role_name": "Team Manager",
      "description": "Team management",
      "assigned_by": "admin-uuid",
      "assigned_by_email": "admin@company.com",
      "assigned_at": "2026-06-01 10:30:00",
      "active_status": 1
    }
  ]
}
```

#### **C. Assign Role to User** ⭐ **MAIN FUNCTION**
```http
POST /api/admin/roles/users/:userId/roles
Authorization: Admin only

Body:
{
  "roleKey": "manager"
}
```
**Response:**
```json
{
  "success": true,
  "message": "Role 'manager' assigned successfully",
  "data": {
    "id": "new-uuid",
    "user_id": "user-uuid",
    "role_key": "manager",
    "role_name": "Team Manager"
  }
}
```

**Features:**
- ✅ Auto-reactivates if role was previously revoked
- ✅ Tracks who assigned the role and when
- ✅ Upsert logic (idempotent)

#### **D. Revoke Role from User**
```http
DELETE /api/admin/roles/users/:userId/roles/:roleKey
Authorization: Admin only
```
**Response:**
```json
{
  "success": true,
  "message": "Role 'manager' revoked successfully"
}
```

**Features:**
- ✅ Soft delete (sets `active_status = 0`)
- ✅ Tracks who revoked and when
- ✅ Preserves audit trail

#### **E. Bulk Role Assignment**
```http
POST /api/admin/roles/users/bulk-assign
Authorization: Admin only

Body:
{
  "assignments": [
    {"userId": "user-1-uuid", "roleKey": "manager"},
    {"userId": "user-2-uuid", "roleKey": "qa"},
    {"userId": "user-3-uuid", "roleKey": "hr"}
  ]
}
```
**Response:**
```json
{
  "success": true,
  "data": {
    "success": 2,
    "failed": 1,
    "errors": ["User user-3-uuid: Role hr not found"]
  },
  "message": "Bulk assignment completed: 2 success, 1 failed"
}
```

#### **F. Role Assignment Audit Log**
```http
GET /api/admin/roles/role-audit?userId=xxx&roleKey=xxx&fromDate=2026-06-01&limit=100
Authorization: Admin only
```
**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "user_id": "user-uuid",
      "user_email": "john@company.com",
      "role_key": "manager",
      "role_name": "Team Manager",
      "assigned_by_email": "admin@company.com",
      "assigned_at": "2026-06-01 10:30:00",
      "active_status": 1,
      "revoked_by_email": null,
      "revoked_at": null
    }
  ]
}
```

---

### **2. Frontend UI - Access Control Pages**

#### **A. Unified Access Control** ⭐ **MAIN PAGE**

**File:** `src/pages/UnifiedAccessControl.tsx`

**Route:** `/access-control` (or similar - check your routes)

**Features:**
1. **Page Access Tab:**
   - Select a role (admin, manager, hr, qa, etc.)
   - See all pages that role can access
   - Toggle permissions: View, Create, Edit, Delete, Export
   - Save permissions per page

2. **RBAC Mismatches Tab:**
   - Shows users with inconsistent role assignments
   - Displays MySQL roles vs. expected roles

3. **Designation Roles Tab:**
   - Map designations (e.g., "Team Lead") → roles (e.g., "manager")
   - Auto-assign roles based on employee designation

4. **Access Requests Tab:**
   - Employees can request access to specific pages
   - Admins approve/deny requests

**Key Functions:**
```typescript
// Assign role mutation
const assignRoleMutation = useMutation({
  mutationFn: async (userId: string) => {
    await hrmsApi.post(`/api/admin/roles/users/${userId}/roles`, {
      roleKey: selectedRole
    });
  },
  onSuccess: () => toast.success("Role assigned"),
  onError: () => toast.error("Failed to assign role")
});

// Revoke role mutation
const revokeRoleMutation = useMutation({
  mutationFn: async (userId: string, roleKey: string) => {
    await hrmsApi.delete(`/api/admin/roles/users/${userId}/roles/${roleKey}`);
  }
});
```

#### **B. Super Admin Access Control**

**File:** `src/pages/SuperAdminAccessControl.tsx`

**Features:**
- High-level role management
- System-wide permission overrides
- Role hierarchy management

#### **C. Super Admin Module Access**

**File:** `src/pages/SuperAdminModuleAccess.tsx`

**Features:**
- Module-level access control
- Enable/disable entire modules per role

---

### **3. Database Schema**

#### **Table: `user_roles`**
```sql
CREATE TABLE user_roles (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    role_key VARCHAR(50) NOT NULL,
    assigned_by VARCHAR(36),
    assigned_at DATETIME,
    revoked_by VARCHAR(36),
    revoked_at DATETIME,
    active_status TINYINT DEFAULT 1,
    
    UNIQUE KEY unique_user_role (user_id, role_key),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (assigned_by) REFERENCES users(id),
    FOREIGN KEY (revoked_by) REFERENCES users(id)
);
```

#### **Table: `roles`**
```sql
CREATE TABLE roles (
    id VARCHAR(36) PRIMARY KEY,
    role_key VARCHAR(50) UNIQUE NOT NULL,
    role_name VARCHAR(100) NOT NULL,
    description TEXT,
    active_status TINYINT DEFAULT 1,
    created_at DATETIME,
    updated_at DATETIME
);
```

**Common Role Keys:**
- `admin` - Full system access
- `super_admin` - Super administrator
- `hr` - HR operations
- `manager` - Team management
- `process_manager` - Process-specific management
- `qa` - Quality analyst
- `employee` - Basic employee access
- `recruiter` - ATS/recruitment
- `finance` - Payroll/finance

#### **Table: `role_page_access`**
```sql
CREATE TABLE role_page_access (
    id VARCHAR(36) PRIMARY KEY,
    role_key VARCHAR(50) NOT NULL,
    page_code VARCHAR(100) NOT NULL,
    can_view BOOLEAN DEFAULT FALSE,
    can_create BOOLEAN DEFAULT FALSE,
    can_edit BOOLEAN DEFAULT FALSE,
    can_delete BOOLEAN DEFAULT FALSE,
    can_export BOOLEAN DEFAULT FALSE,
    
    UNIQUE KEY unique_role_page (role_key, page_code),
    FOREIGN KEY (role_key) REFERENCES roles(role_key)
);
```

#### **Table: `designation_role_mapping`**
```sql
CREATE TABLE designation_role_mapping (
    id VARCHAR(36) PRIMARY KEY,
    designation_id VARCHAR(36) NOT NULL,
    role_key VARCHAR(50) NOT NULL,
    auto_assign BOOLEAN DEFAULT TRUE,
    
    FOREIGN KEY (designation_id) REFERENCES designation_master(id),
    FOREIGN KEY (role_key) REFERENCES roles(role_key)
);
```

---

### **4. Middleware - Role Enforcement**

#### **File:** `backend/src/middleware/requireRole.ts`

**Usage in Routes:**
```typescript
import { requireRole } from "../../middleware/requireRole.js";

// Admin only
router.get("/admin-only", requireRole("admin"), handler);

// Multiple roles allowed
router.get("/hr-manager", requireRole("hr", "manager"), handler);

// Everyone authenticated (no role check)
router.get("/public", requireAuth, handler);
```

**How it Works:**
1. Checks user's JWT token
2. Queries `user_roles` table for active roles
3. Matches against required roles
4. Returns 403 Forbidden if no match

---

## 🚀 How to Use the System

### **Scenario 1: Assign Manager Role to Employee**

**Step 1: Get User ID**
```sql
SELECT id, email FROM users WHERE email = 'john.doe@company.com';
-- Result: user_id = '123e4567-e89b-12d3-a456-426614174000'
```

**Step 2: Assign Role via API**
```bash
curl -X POST http://localhost:5055/api/admin/roles/users/123e4567-e89b-12d3-a456-426614174000/roles \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"roleKey": "manager"}'
```

**Step 3: Verify Assignment**
```bash
curl http://localhost:5055/api/admin/roles/users/123e4567-e89b-12d3-a456-426614174000/roles \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

### **Scenario 2: Assign Role via UI**

1. **Login as Admin**
2. **Navigate to:** `/access-control` or `/super-admin-access-control`
3. **Go to "RBAC Mismatches" or "Users" tab**
4. **Find employee** by name/email
5. **Click "Assign Role" button**
6. **Select role** from dropdown (manager, hr, qa, etc.)
7. **Click "Save"**
8. **Employee now has access** to role-specific pages

### **Scenario 3: Bulk Assign Roles**

```javascript
// JavaScript/TypeScript example
const assignments = [
  { userId: 'user-1-uuid', roleKey: 'manager' },
  { userId: 'user-2-uuid', roleKey: 'qa' },
  { userId: 'user-3-uuid', roleKey: 'hr' },
];

const response = await hrmsApi.post('/api/admin/roles/users/bulk-assign', {
  assignments
});

console.log(response.data);
// { success: 3, failed: 0, errors: [] }
```

### **Scenario 4: Auto-Assign by Designation**

**Step 1: Map Designation → Role**
```sql
INSERT INTO designation_role_mapping (id, designation_id, role_key, auto_assign)
VALUES (
  UUID(),
  (SELECT id FROM designation_master WHERE designation_name = 'Team Lead'),
  'manager',
  TRUE
);
```

**Step 2: Trigger Auto-Assignment**
When employee's designation is set to "Team Lead", the system automatically assigns "manager" role.

---

## 🔐 Role-Specific Page Access

### **How Pages Are Protected**

**Frontend Route Guard:**
```typescript
// Example: ProtectedRoute component
import { useAuth } from '@/hooks/useAuth';

function ProtectedRoute({ requiredRole, children }) {
  const { user, hasRole } = useAuth();
  
  if (!hasRole(requiredRole)) {
    return <Navigate to="/unauthorized" />;
  }
  
  return children;
}

// Usage in routes
<Route 
  path="/operations-kpi" 
  element={
    <ProtectedRoute requiredRole="manager">
      <NativeOperationsKPI />
    </ProtectedRoute>
  } 
/>
```

**Backend Route Protection:**
```typescript
// Operations KPI endpoint
router.get(
  "/leaderboard",
  requireAuth,
  requireRole("admin", "hr", "manager", "qa", "process_manager"),
  async (req, res) => {
    // Only accessible to users with one of these roles
    // ...
  }
);
```

### **Page Access Matrix**

| Page/Feature | Admin | HR | Manager | QA | Employee |
|--------------|-------|-----|---------|-----|----------|
| **Operations KPI Dashboard** | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Employee Management** | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Payroll** | ✅ | ✅ | ❌ | ❌ | View Only |
| **ATS/Recruitment** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Role Assignment** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Quality Dashboard** | ✅ | ✅ | ✅ | ✅ | ❌ |
| **My Profile** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **My KPI Dashboard** | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## 📊 Current Roles in System

**Query to see all roles:**
```sql
SELECT role_key, role_name, description, active_status 
FROM roles 
ORDER BY role_name;
```

**Expected Roles:**
1. **admin** - Administrator (full access)
2. **super_admin** - Super Administrator
3. **hr** - HR Manager (employee management, payroll, leave)
4. **manager** - Team Manager (team KPIs, performance reviews)
5. **process_manager** - Process Manager (process-specific KPIs)
6. **qa** - Quality Analyst (quality monitoring, call reviews)
7. **employee** - Employee (self-service features)
8. **recruiter** - Recruiter (ATS, candidate management)
9. **finance** - Finance (payroll, compensation)
10. **wfm** - Workforce Management (attendance, rostering)

---

## 🧪 Testing Role Assignment

### **Test 1: Assign Role**
```bash
# 1. Get user ID
USER_ID=$(mysql -h 122.184.128.90 -u shivam_user -p'Mas@2024$secure' mas_hrms -se "SELECT id FROM users WHERE email='test@company.com' LIMIT 1")

# 2. Assign manager role
curl -X POST http://localhost:5055/api/admin/roles/users/$USER_ID/roles \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"roleKey": "manager"}'

# 3. Verify assignment
curl http://localhost:5055/api/admin/roles/users/$USER_ID/roles \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### **Test 2: Verify Page Access**
```bash
# Login as the user
# Try to access Operations KPI page
curl http://localhost:5055/api/kpi/leaderboard?period=2026-06&family=operations \
  -H "Authorization: Bearer $USER_TOKEN"

# Should return 200 OK if user has manager role
# Should return 403 Forbidden if user doesn't have required role
```

### **Test 3: Revoke Role**
```bash
# Revoke manager role
curl -X DELETE http://localhost:5055/api/admin/roles/users/$USER_ID/roles/manager \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Try to access Operations KPI again
# Should now return 403 Forbidden
```

---

## 📈 Role Assignment Workflow

```
┌─────────────────────────────────────────────┐
│  Admin Dashboard                            │
│  - Access Control Page                      │
└─────────────────┬───────────────────────────┘
                  │
                  ↓
┌─────────────────────────────────────────────┐
│  Select Employee                            │
│  - By Name/Email/Employee Code              │
└─────────────────┬───────────────────────────┘
                  │
                  ↓
┌─────────────────────────────────────────────┐
│  View Current Roles                         │
│  - admin ✓                                  │
│  - manager ✗                                │
│  - hr ✗                                     │
└─────────────────┬───────────────────────────┘
                  │
                  ↓
┌─────────────────────────────────────────────┐
│  Assign New Role                            │
│  [Select Role ▼] [Assign Button]           │
└─────────────────┬───────────────────────────┘
                  │
                  ↓
┌─────────────────────────────────────────────┐
│  POST /api/admin/roles/users/:id/roles      │
│  Body: {"roleKey": "manager"}               │
└─────────────────┬───────────────────────────┘
                  │
                  ↓
┌─────────────────────────────────────────────┐
│  Database Update                            │
│  INSERT INTO user_roles (...)               │
│  ON DUPLICATE KEY UPDATE ...                │
└─────────────────┬───────────────────────────┘
                  │
                  ↓
┌─────────────────────────────────────────────┐
│  Employee Can Now Access                    │
│  - Operations KPI Dashboard                 │
│  - Team Performance Reports                 │
│  - Employee Management (within scope)       │
└─────────────────────────────────────────────┘
```

---

## 🔧 Troubleshooting

### **Issue 1: User Can't See Operations KPI Dashboard**

**Diagnosis:**
```sql
-- Check user's roles
SELECT ur.role_key, r.role_name, ur.active_status
FROM user_roles ur
JOIN roles r ON r.role_key = ur.role_key
WHERE ur.user_id = 'user-uuid';
```

**Solution:**
```bash
# Assign manager role
curl -X POST http://localhost:5055/api/admin/roles/users/USER_UUID/roles \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -d '{"roleKey": "manager"}'
```

### **Issue 2: Role Assignment Returns 404**

**Possible Causes:**
1. Role doesn't exist in `roles` table
2. User ID is invalid

**Fix:**
```sql
-- Check if role exists
SELECT * FROM roles WHERE role_key = 'manager';

-- If missing, insert it
INSERT INTO roles (id, role_key, role_name, description, active_status)
VALUES (UUID(), 'manager', 'Team Manager', 'Manages team performance and KPIs', 1);
```

### **Issue 3: Page Still Showing 403 After Role Assignment**

**Cause:** Frontend hasn't refreshed user's role cache

**Solution:**
1. Logout and login again
2. Or: Clear localStorage and refresh
3. Or: Force token refresh

---

## ✅ Summary

### **YES - You Have This Functionality!**

✅ **Role Assignment API** - Fully implemented  
✅ **Frontend UI** - Multiple pages (UnifiedAccessControl, SuperAdminAccessControl)  
✅ **Database Schema** - Complete with audit trail  
✅ **Middleware Protection** - Routes protected by roles  
✅ **Bulk Assignment** - Assign multiple roles at once  
✅ **Audit Logging** - Track who assigned/revoked what and when  
✅ **Designation Mapping** - Auto-assign roles by job title  
✅ **Page-Level Permissions** - Granular control (View, Create, Edit, Delete, Export)

### **How to Enable Operations KPI for an Employee:**

```bash
# Quick command:
curl -X POST http://localhost:5055/api/admin/roles/users/EMPLOYEE_USER_ID/roles \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"roleKey": "manager"}'
```

**Or via UI:**
1. Login as Admin
2. Go to `/access-control` or `/super-admin-access-control`
3. Find employee
4. Assign "manager" or "process_manager" role
5. Done! Employee can now access Operations KPI Dashboard

---

**Files to Reference:**
- Backend: `backend/src/modules/admin/role-assignment.routes.ts`
- Frontend: `src/pages/UnifiedAccessControl.tsx`
- Middleware: `backend/src/middleware/requireRole.ts`

**Database Tables:**
- `user_roles` - Role assignments
- `roles` - Available roles
- `role_page_access` - Page permissions per role

---

**Last Updated:** June 15, 2026  
**Status:** ✅ Production-Ready
