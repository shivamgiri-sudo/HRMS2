# Supabase Removal — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all Supabase database queries and storage calls from the frontend by wiring every affected hook and page to existing or new Express/MySQL endpoints — so Supabase can be fully removed without any feature regression.

**Architecture:** Each Supabase-backed frontend hook/page is redirected to an hrmsApi call targeting an Express endpoint backed by MySQL. Files are not refactored — only the data-fetch layer inside each hook/page is replaced. No new abstractions; one targeted change per file.

**Tech Stack:** React 18 + TypeScript + hrmsApi (fetch wrapper) · Express + TypeScript + mysql2 · MySQL `mas_hrms`

---

## What Already Exists (Do NOT rebuild)

These backends are **already implemented in MySQL** — only the frontend needs updating:

| Frontend file | Existing backend endpoint |
|---|---|
| `Settings.tsx` leave_types CRUD | `GET/POST /api/leave/types`, `PUT /api/leave/types/:id`, `DELETE /api/leave/types/:id` |
| `Settings.tsx` departments CRUD | `GET/POST/PUT/DELETE /api/org/departments` |
| `useAssets.ts` | `GET /api/assets-mgmt`, `POST /api/assets-mgmt`, `GET /api/assets-mgmt/:id`, `PUT /api/assets-mgmt/:id`, `POST /api/assets-mgmt/:id/assign`, `POST /api/assets-mgmt/:id/return` |
| `UnifiedAccessControl.tsx` module/page access | Need new endpoints (Task 6) |
| `useUserRole.ts` Supabase fallback | `GET /api/access/me` already MySQL — Task 1 removes the fallback |

---

## Task 1 — Remove Supabase fallback from `useUserRole.ts`

**Files:**
- Modify: `src/hooks/useUserRole.ts` (lines 103–150)

The MySQL path (`/api/access/me`) runs when `hrms_access_token` is present. The Supabase fallback at lines 103–150 runs for sessions with no MySQL token. Goal: make the absence of `hrms_access_token` return an unauthenticated state instead of falling through to Supabase.

- [ ] **Step 1: Read the current fallback block**

Open `src/hooks/useUserRole.ts` lines 80–160. Locate the block starting with `const [{ data: roleRows...` — this is the Supabase fallback that runs when no MySQL token exists.

- [ ] **Step 2: Replace the Supabase fallback with a null return**

Replace the entire Supabase fallback block (everything after the `if (localStorage.getItem('hrms_access_token'))` block closes) with:

```typescript
      // No MySQL token — unauthenticated; do not fall back to Supabase
      return {
        roles: [],
        roleKeys: ["employee"],
        primaryRole: "employee" as AppRole,
        employeeId: null,
        employeeCode: null,
        employeeName: null,
        scopes: [],
        pages: [],
      };
```

- [ ] **Step 3: Remove the supabase import from useUserRole.ts**

Delete the line:
```typescript
import { supabase } from "@/integrations/supabase/client";
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1
npm run build 2>&1 | grep -E "error|warning" | head -20
```

Expected: no errors in `useUserRole.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useUserRole.ts
git commit -m "fix(rbac): remove Supabase role fallback from useUserRole — unauthenticated returns empty roles"
```

---

## Task 2 — Wire `Settings.tsx` to MySQL endpoints

**Files:**
- Modify: `src/pages/Settings.tsx` (lines 33–200)

Leave types and departments both have full CRUD in MySQL already. The page currently calls Supabase directly. Replace all four Supabase calls with `hrmsApi`.

- [ ] **Step 1: Replace leave_types SELECT**

Find (around line 45):
```typescript
const { data, error } = await supabase
  .from('leave_types')
  .select(...)
```

Replace with:
```typescript
const res = await hrmsApi.get<{ data: any[] }>('/api/leave/types');
const data = res.data ?? [];
```

- [ ] **Step 2: Replace leave_types INSERT**

Find (around line 150):
```typescript
const { error } = await supabase.from('leave_types').insert({...})
```

Replace with:
```typescript
await hrmsApi.post('/api/leave/types', {
  leaveCode: newLeaveType.leave_code,
  leaveName: newLeaveType.leave_name,
  maxDaysPerYear: newLeaveType.max_days_per_year,
  carryForward: newLeaveType.carry_forward,
  requiresApproval: newLeaveType.requires_approval,
  paidLeave: newLeaveType.paid_leave,
});
```

- [ ] **Step 3: Replace leave_types UPDATE**

Find (around line 171):
```typescript
const { error } = await supabase.from('leave_types').update({...}).eq('id', id)
```

Replace with:
```typescript
await hrmsApi.put(`/api/leave/types/${id}`, {
  leave_name: updatedLeaveType.leave_name,
  max_days_per_year: updatedLeaveType.max_days_per_year,
  carry_forward: updatedLeaveType.carry_forward,
  requires_approval: updatedLeaveType.requires_approval,
  paid_leave: updatedLeaveType.paid_leave,
});
```

- [ ] **Step 4: Replace leave_types DELETE**

Find (around line 193):
```typescript
const { error } = await supabase.from('leave_types').delete().eq('id', id)
```

Replace with:
```typescript
await hrmsApi.delete(`/api/leave/types/${id}`);
```

- [ ] **Step 5: Replace departments INSERT**

Find (around line 96):
```typescript
const { error } = await supabase.from('departments').insert({...})
```

Replace with:
```typescript
await hrmsApi.post('/api/org/departments', {
  dept_name: newDept.name,
  dept_code: newDept.code,
  description: newDept.description,
});
```

- [ ] **Step 6: Replace departments UPDATE**

Find (around line 115):
```typescript
const { error } = await supabase.from('departments').update({...}).eq('id', id)
```

Replace with:
```typescript
await hrmsApi.put(`/api/org/departments/${id}`, {
  dept_name: editingDept.name,
  description: editingDept.description,
});
```

- [ ] **Step 7: Replace departments DELETE**

Find (around line 135):
```typescript
const { error } = await supabase.from('departments').delete().eq('id', id)
```

Replace with:
```typescript
await hrmsApi.delete(`/api/org/departments/${id}`);
```

- [ ] **Step 8: Remove supabase import from Settings.tsx**

Delete:
```typescript
import { supabase } from "@/integrations/supabase/client";
```

Add if not present:
```typescript
import { hrmsApi } from "@/lib/hrmsApi";
```

- [ ] **Step 9: Verify build**

```bash
npm run build 2>&1 | grep -E "error" | grep "Settings" | head -10
```

Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/pages/Settings.tsx
git commit -m "fix(settings): replace Supabase leave-types and departments CRUD with MySQL endpoints"
```

---

## Task 3 — Wire `useAssets.ts` to MySQL backend

**Files:**
- Modify: `src/hooks/useAssets.ts` (full rewrite of data layer)

The assets backend is fully implemented at `/api/assets-mgmt`. The hook uses Supabase with a different table/column shape (`assets` table with camelCase interface). The backend uses `asset_master` table with snake_case columns.

- [ ] **Step 1: Replace useAssets query**

Replace the `useAssets` function body — keep the `Asset` interface and query key, replace the Supabase fetch:

```typescript
export function useAssets() {
  return useQuery({
    queryKey: ["assets"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: any[] }>("/api/assets-mgmt");
      return (res.data ?? []).map((a: any): Asset => ({
        id: a.id,
        name: a.asset_name,
        type: a.asset_category as Asset["type"],
        serialNumber: a.serial_number ?? "",
        purchaseDate: a.purchase_date ?? "",
        cost: Number(a.purchase_cost ?? 0),
        status: a.status as Asset["status"],
        notes: a.notes ?? undefined,
        assignedTo: a.current_assignment
          ? { name: a.current_assignment.employee_id }
          : undefined,
      }));
    },
  });
}
```

- [ ] **Step 2: Replace useAssetStats**

```typescript
export function useAssetStats() {
  return useQuery({
    queryKey: ["asset-stats"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: any[] }>("/api/assets-mgmt");
      const all = res.data ?? [];
      return {
        total: all.length,
        available: all.filter((a: any) => a.status === "available").length,
        assigned: all.filter((a: any) => a.status === "assigned").length,
        maintenance: all.filter((a: any) => a.status === "maintenance" || a.status === "repair").length,
      };
    },
  });
}
```

- [ ] **Step 3: Replace useCreateAsset**

```typescript
export function useCreateAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<Asset>) => {
      const res = await hrmsApi.post<{ data: any }>("/api/assets-mgmt", {
        asset_code: `AST-${Date.now()}`,
        asset_name: data.name,
        asset_category: data.type,
        serial_number: data.serialNumber,
        purchase_date: data.purchaseDate,
        purchase_cost: data.cost,
        notes: data.notes,
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      queryClient.invalidateQueries({ queryKey: ["asset-stats"] });
    },
  });
}
```

- [ ] **Step 4: Replace useAssignAsset**

```typescript
export function useAssignAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ assetId, employeeId }: { assetId: string; employeeId: string }) => {
      return hrmsApi.post(`/api/assets-mgmt/${assetId}/assign`, { employee_id: employeeId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      queryClient.invalidateQueries({ queryKey: ["asset-stats"] });
    },
  });
}
```

- [ ] **Step 5: Replace useReturnAsset**

```typescript
export function useReturnAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ assetId, condition }: { assetId: string; condition?: string }) => {
      return hrmsApi.post(`/api/assets-mgmt/${assetId}/return`, { condition: condition ?? "good" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      queryClient.invalidateQueries({ queryKey: ["asset-stats"] });
    },
  });
}
```

- [ ] **Step 6: Replace useUpdateAsset and useDeleteAsset**

```typescript
export function useUpdateAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: Partial<Asset> & { id: string }) => {
      return hrmsApi.put(`/api/assets-mgmt/${id}`, {
        asset_name: data.name,
        status: data.status,
        notes: data.notes,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assets"] }),
  });
}

export function useDeleteAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => hrmsApi.delete(`/api/assets-mgmt/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assets"] }),
  });
}
```

- [ ] **Step 7: Remove Supabase import, add hrmsApi**

Remove:
```typescript
import { supabase } from "@/integrations/supabase/client";
```
Add:
```typescript
import { hrmsApi } from "@/lib/hrmsApi";
```

- [ ] **Step 8: Verify build**

```bash
npm run build 2>&1 | grep -E "error" | grep "useAssets" | head -10
```

- [ ] **Step 9: Commit**

```bash
git add src/hooks/useAssets.ts
git commit -m "fix(assets): replace Supabase queries with MySQL /api/assets-mgmt endpoints"
```

---

## Task 4 — Wire `useEmployeeDocuments.ts` to MySQL + file upload endpoint

**Files:**
- Modify: `src/hooks/useEmployeeDocuments.ts`
- Create: `backend/src/modules/employees/employee.documents.routes.ts`
- Modify: `backend/src/app.ts` (mount new route)

The `employee_documents` table already exists in MySQL (`002_employees.sql`). The hook needs a documents list, upload (metadata only — file upload via multipart), and delete endpoint.

- [ ] **Step 1: Add employee documents routes in backend**

Create `backend/src/modules/employees/employee.documents.routes.ts`:

```typescript
import { Router } from "express";
import { randomUUID } from "crypto";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

const router = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// GET /api/employee-docs/:employeeId
router.get("/:employeeId", h(async (req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT id, employee_id, doc_type AS document_type, doc_name AS document_name, file_url, verified, created_at AS uploaded_at FROM employee_documents WHERE employee_id = ? ORDER BY created_at DESC",
    [req.params.employeeId]
  );
  res.json({ success: true, data: rows });
}));

// POST /api/employee-docs/:employeeId — register a document record (file URL provided by caller)
router.post("/:employeeId", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { document_type, document_name, file_url } = req.body as {
    document_type: string;
    document_name: string;
    file_url: string;
  };
  if (!document_type || !file_url) return res.status(400).json({ error: "document_type and file_url required" });
  const id = randomUUID();
  await db.execute(
    "INSERT INTO employee_documents (id, employee_id, doc_type, doc_name, file_url, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)",
    [id, req.params.employeeId, document_type, document_name ?? null, file_url, req.authUser!.id]
  );
  const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM employee_documents WHERE id = ? LIMIT 1", [id]);
  res.status(201).json({ success: true, data: (rows as RowDataPacket[])[0] });
}));

// DELETE /api/employee-docs/:employeeId/:docId
router.delete("/:employeeId/:docId", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  await db.execute(
    "DELETE FROM employee_documents WHERE id = ? AND employee_id = ?",
    [req.params.docId, req.params.employeeId]
  );
  res.json({ success: true });
}));

export { router as employeeDocsRouter };
```

- [ ] **Step 2: Mount in app.ts**

In `backend/src/app.ts`, after the existing `import { assetsRouter }...` line, add:

```typescript
import { employeeDocsRouter } from "./modules/employees/employee.documents.routes.js";
```

And after `app.use("/api/assets-mgmt", assetsRouter);`, add:

```typescript
app.use("/api/employee-docs", employeeDocsRouter);
```

- [ ] **Step 3: Replace useEmployeeDocuments query in frontend**

In `src/hooks/useEmployeeDocuments.ts`, replace the query function:

```typescript
import { hrmsApi } from "@/lib/hrmsApi";

export function useEmployeeDocuments(employeeId: string | undefined) {
  return useQuery({
    queryKey: ["employee-documents", employeeId],
    queryFn: async () => {
      if (!employeeId) return [];
      const res = await hrmsApi.get<{ data: EmployeeDocument[] }>(`/api/employee-docs/${employeeId}`);
      return res.data ?? [];
    },
    enabled: !!employeeId,
  });
}
```

- [ ] **Step 4: Replace useUploadDocument**

File upload goes to Supabase Storage. For Phase 1, store the file URL as-is (Supabase URL) but persist metadata to MySQL only. File storage migration is Phase 2.

```typescript
export function useUploadDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ employeeId, file, documentType }: { employeeId: string; file: File; documentType: string }) => {
      // Phase 1: still uploads binary to Supabase Storage (file storage is Phase 2)
      // but NOW persists metadata to MySQL instead of Supabase DB
      const { supabase: sb } = await import("@/integrations/supabase/client");
      const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
      const fileName = `${employeeId}/${Date.now()}-${safeName}`;
      const { error: uploadError } = await (sb as any).storage.from("employee-documents").upload(fileName, file);
      if (uploadError) throw uploadError;
      const publicUrl = (sb as any).storage.from("employee-documents").getPublicUrl(fileName).data.publicUrl;

      // Persist metadata to MySQL
      const res = await hrmsApi.post<{ data: EmployeeDocument }>(`/api/employee-docs/${employeeId}`, {
        document_type: documentType,
        document_name: file.name,
        file_url: publicUrl,
      });
      return res.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["employee-documents", variables.employeeId] });
      toast.success("Document uploaded successfully");
    },
    onError: (error: any) => {
      toast.error("Failed to upload document: " + error.message);
    },
  });
}
```

- [ ] **Step 5: Replace useDeleteDocument**

```typescript
export function useDeleteDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ documentId, fileUrl, employeeId }: { documentId: string; fileUrl: string; employeeId: string }) => {
      await hrmsApi.delete(`/api/employee-docs/${employeeId}/${documentId}`);
      // Phase 1: also clean up Supabase Storage file if it's a Supabase URL
      if (fileUrl && fileUrl.includes("supabase")) {
        try {
          const { supabase: sb } = await import("@/integrations/supabase/client");
          const path = fileUrl.split("/employee-documents/")[1];
          if (path) await (sb as any).storage.from("employee-documents").remove([path]);
        } catch { /* non-fatal */ }
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["employee-documents", variables.employeeId] });
      toast.success("Document deleted successfully");
    },
    onError: (error: any) => {
      toast.error("Failed to delete document: " + error.message);
    },
  });
}
```

- [ ] **Step 6: Remove top-level supabase import from useEmployeeDocuments.ts**

The file previously had `import { supabase } from "@/integrations/supabase/client"` at the top. Remove it — the dynamic imports inside mutation functions are Phase 1 transitional and will be removed in Phase 2.

- [ ] **Step 7: Verify build**

```bash
npm run build 2>&1 | grep "error" | head -20
```

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/employees/employee.documents.routes.ts backend/src/app.ts src/hooks/useEmployeeDocuments.ts
git commit -m "fix(documents): migrate employee_documents metadata to MySQL — retain Supabase Storage for binary (Phase 1)"
```

---

## Task 5 — Wire `NativeLMSCoordinator.tsx` to MySQL

**Files:**
- Create: `backend/sql/063_lms_classroom_master.sql`
- Modify: `backend/src/modules/lms/lms.routes.ts`
- Modify: `src/pages/NativeLMSCoordinator.tsx` (lines 1–30)

`lms_classroom_master` table does not yet exist in MySQL. Create it, add endpoints, update frontend.

- [ ] **Step 1: Create migration SQL**

Create `backend/sql/063_lms_classroom_master.sql`:

```sql
CREATE TABLE IF NOT EXISTS lms_classroom_master (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  classroom_code VARCHAR(50)  NOT NULL UNIQUE,
  classroom_name VARCHAR(255) NOT NULL,
  active_status  TINYINT(1)   NOT NULL DEFAULT 1,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_lms_class_code (classroom_code)
);
```

- [ ] **Step 2: Add classroom endpoints to lms.routes.ts**

Append to `backend/src/modules/lms/lms.routes.ts` before the `export` line:

```typescript
// GET /api/lms/classrooms
router.get("/classrooms", requireRole("admin", "hr", "trainer"), h(async (_req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT id, classroom_code, classroom_name, active_status, created_at FROM lms_classroom_master ORDER BY created_at DESC"
  );
  res.json({ success: true, data: rows });
}));

// POST /api/lms/classrooms
router.post("/classrooms", requireRole("admin", "hr", "trainer"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { classroom_code, classroom_name } = req.body as { classroom_code: string; classroom_name: string };
  if (!classroom_code || !classroom_name) return res.status(400).json({ error: "classroom_code and classroom_name required" });
  const id = randomUUID();
  await db.execute(
    "INSERT INTO lms_classroom_master (id, classroom_code, classroom_name) VALUES (?, ?, ?)",
    [id, classroom_code.trim(), classroom_name.trim()]
  );
  const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM lms_classroom_master WHERE id = ? LIMIT 1", [id]);
  res.status(201).json({ success: true, data: (rows as RowDataPacket[])[0] });
}));
```

Also add the missing imports at the top of `lms.routes.ts`:
```typescript
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
```

- [ ] **Step 3: Replace Supabase calls in NativeLMSCoordinator.tsx**

Find lines 10–25 where classrooms are fetched and created. Replace:

```typescript
// BEFORE (Supabase):
const { data, error } = await supabase.from("lms_classroom_master").select(...);
const { error } = await supabase.from("lms_classroom_master").insert({...});
```

With:
```typescript
import { hrmsApi } from "@/lib/hrmsApi";

// fetch classrooms
const res = await hrmsApi.get<{ data: any[] }>("/api/lms/classrooms");
const data = res.data ?? [];

// create classroom
await hrmsApi.post("/api/lms/classrooms", {
  classroom_code: code.trim(),
  classroom_name: name.trim(),
});
```

- [ ] **Step 4: Remove supabase import from NativeLMSCoordinator.tsx**

Delete: `import { supabase } from "@/integrations/supabase/client";`

- [ ] **Step 5: Verify build**

```bash
npm run build 2>&1 | grep "error" | grep -i "lms\|classroom" | head -10
```

- [ ] **Step 6: Commit**

```bash
git add backend/sql/063_lms_classroom_master.sql backend/src/modules/lms/lms.routes.ts src/pages/NativeLMSCoordinator.tsx
git commit -m "fix(lms): migrate lms_classroom_master to MySQL — new table + endpoints + frontend wired"
```

---

## Task 6 — Wire `UnifiedAccessControl.tsx` role/page access to MySQL

**Files:**
- Modify: `backend/src/modules/access/access.routes.ts`
- Modify: `src/pages/UnifiedAccessControl.tsx` (lines 25–50)

`role_page_access` exists in MySQL (`003_access_control.sql`). Need to expose it via GET endpoint. `role_module_access` does not exist in MySQL — expose what exists and remove module access tab dependency.

- [ ] **Step 1: Add page access list endpoint to access.routes.ts**

Append before the export in `backend/src/modules/access/access.routes.ts`:

```typescript
// GET /api/access/page-access — all role_page_access entries (admin)
router.get("/page-access", requireRole("admin"), h(async (_req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status FROM role_page_access ORDER BY role_key, page_code"
  );
  res.json({ data: rows });
}));
```

Add missing import at top of `access.routes.ts`:
```typescript
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
```

- [ ] **Step 2: Replace Supabase module access query in UnifiedAccessControl.tsx**

The `moduleAccess` tab queries `role_module_access` which doesn't exist in MySQL. Replace it with an empty array and a note:

```typescript
// Module access tab — not yet in MySQL; show placeholder
const { data: moduleAccess = [] } = useQuery({
  queryKey: ["role-module-access-admin"],
  queryFn: async () => [] as any[],
});
```

- [ ] **Step 3: Replace Supabase page access query**

```typescript
const { data: pageAccess = [] } = useQuery({
  queryKey: ["role-page-access-admin"],
  queryFn: async () => {
    const res = await hrmsApi.get<{ data: any[] }>("/api/access/page-access");
    return res.data ?? [];
  },
});
```

- [ ] **Step 4: Remove supabase import from UnifiedAccessControl.tsx**

Delete: `import { supabase } from "@/integrations/supabase/client";`

- [ ] **Step 5: Verify build**

```bash
npm run build 2>&1 | grep "error" | head -10
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/access/access.routes.ts src/pages/UnifiedAccessControl.tsx
git commit -m "fix(access): wire role_page_access to MySQL endpoint, remove Supabase from UnifiedAccessControl"
```

---

## Task 7 — Remove Supabase from `NativeMigrationConsole.tsx` (Security)

**Files:**
- Modify: `src/pages/NativeMigrationConsole.tsx` (lines 7–9)

The file contains a hardcoded Supabase service role key. Remove it entirely. The migration console's Supabase-dependent features should degrade gracefully.

- [ ] **Step 1: Read lines 1–30 of NativeMigrationConsole.tsx**

Identify the service role key constant and what function uses it.

- [ ] **Step 2: Remove the hardcoded key and any Supabase-dependent feature**

Replace any block that uses the service role key with a disabled state:

```typescript
// Supabase direct access removed — service role key revoked.
// Legacy Supabase sync features are disabled. Use MySQL migration endpoints instead.
const supabaseSyncAvailable = false;
```

For any UI element that called those features, wrap with `supabaseSyncAvailable` check and show a "Feature removed — use MySQL migration endpoints" message.

- [ ] **Step 3: Remove supabase import if now unused**

Delete: `import { supabase } from "@/integrations/supabase/client";` if no other calls remain.

- [ ] **Step 4: Verify build**

```bash
npm run build 2>&1 | grep "error" | grep -i "migration" | head -10
```

- [ ] **Step 5: Commit**

```bash
git add src/pages/NativeMigrationConsole.tsx
git commit -m "security: remove hardcoded Supabase service role key from NativeMigrationConsole"
```

---

## Task 8 — Final build verification and push

- [ ] **Step 1: Full frontend build**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1
npm run build 2>&1 | tail -20
```

Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 2: Full backend TypeScript check**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1/backend
npm run build 2>&1 | tail -20
```

Expected: Compiles without errors.

- [ ] **Step 3: Verify supabase import count has dropped**

```bash
grep -r "from \"@/integrations/supabase/client\"" /c/Users/shivamg/Desktop/HRMS/HRMS1/src --include="*.ts" --include="*.tsx" -l | wc -l
```

Expected: should be significantly fewer than 44.

- [ ] **Step 4: Push to upstream**

```bash
git fetch upstream
git rebase upstream/main
git push upstream main
git push origin main
```

---

## Scope NOT in Phase 1 (deferred to Phase 2)

| Item | Reason deferred |
|---|---|
| Supabase Storage file upload replacement | Needs S3/MinIO or backend file storage endpoint first |
| `Onboarding.tsx` employee creation | Complex 15+ Supabase call page, separate task |
| `BulkUploadHub.tsx` | Requires file upload backend |
| `usePushNotifications.ts` | Low priority, fire-and-forget |
| `DocumentViewerDialog.tsx`, `TaxDocumentsViewer.tsx` | Depends on file storage migration |
| Edge Function notification calls | Need backend notification system first |
| `useOnboardingRequest.ts` | Needs onboarding requests table in MySQL |
| `EmployeeReport.tsx` leave queries | Already partially served by MySQL leave endpoints |
