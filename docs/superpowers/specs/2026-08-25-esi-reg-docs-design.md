# ESI Registration Documents — Design Spec

**Date:** 2026-08-25  
**Module:** Payroll → PF/EPFO Management → ESI Reg. Docs tab  
**Roles allowed:** `payroll_branch`, `payroll_head`, `super_admin`

---

## Overview

Add a new **"ESI Reg. Docs"** tab inside the existing `PfManagement.tsx` page. The tab lets authorised payroll staff download the three documents required to register employees on the ESIC portal:

1. PAN Card (scanned document file from onboarding/DigiLocker)
2. Photograph (employee profile photo)
3. Bank Information (formatted PDF generated from `employee_bank_detail`)

The feature surfaces doc-readiness per employee, supports single-employee ZIP download, bulk ZIP download, and a structured CSV export.

---

## Scope

### In scope
- ESI-eligible employee list with per-employee PAN / Photo / Bank readiness chips
- Single-employee ZIP download
- Bulk ZIP download (selected employees)
- CSV export (PAN number, masked bank account, IFSC, ESIC number)
- Right-side slide-over drawer (drill-down) per employee showing full ESI registration detail
- Backend role enforcement: `payroll_branch`, `payroll_head`, `super_admin`
- Audit log entry for every download action

### Out of scope
- Uploading documents to the ESIC portal directly (external portal integration)
- Editing PAN / bank / photo records (handled by employee profile / onboarding flows)
- Any new standalone page

---

## Data Sources

| Document | Source table / column |
|---|---|
| PAN Card file | `employee_documents` WHERE `doc_category = 'pan'` AND `document_status IN ('verified','uploaded')` — file served via `/api/files/employee-documents/:filename` |
| Photograph | `employees.photo_url` or `employees.avatar_url` → `/api/files/employee-photos/:filename` |
| Bank Information | `employee_bank_detail` (canonical) — `account_number`, `bank_name`, `ifsc_code`, `account_type`; fallback: `employees.bank_account_number` |
| ESIC number | `employees.esic_number` |
| ESI eligibility | `employees` JOIN payroll logic: `esi_eligible = 1` OR last payroll wage ≤ ₹21,000 |
| PAN number (for CSV) | `employees.pan_number` (decrypt via `syncPiiEncryption` for authorised roles) |

---

## Backend

### New route file
`backend/src/modules/payroll/esi-reg-docs.routes.ts`

Mounted in `backend/src/app.ts` under `/api/payroll` (same prefix as other payroll routes).

### Endpoints

#### `GET /api/payroll/esi-reg-docs`
- **Auth:** `requireRole("payroll_branch", "payroll_head", "super_admin")`
- **Query params:** `branch_id?`, `search?` (name / emp code), `page`, `limit`
- **Response:** Paginated list of ESI-eligible employees with readiness flags:
  ```json
  {
    "employees": [{
      "employee_id": "...",
      "emp_code": "EMP001",
      "name": "...",
      "branch": "...",
      "esic_number": "...",
      "pan_ready": true,
      "photo_ready": true,
      "bank_ready": true,
      "pan_doc_id": "...",
      "photo_url": "..."
    }],
    "total": 120,
    "page": 1
  }
  ```

#### `GET /api/payroll/esi-reg-docs/:employeeId/download`
- **Auth:** `requireRole("payroll_branch", "payroll_head", "super_admin")`
- **Response:** `application/zip` — ZIP file named `ESI_Docs_<EmpCode>_<date>.zip` containing:
  - `PAN_Card.<ext>` — original file from `employee_documents`
  - `Photo.<ext>` — employee photo
  - `Bank_Information.pdf` — generated PDF with bank details
- **Audit:** Writes a row to `payroll_audit_trail` (action: `esi_reg_doc_download`, target: employee_id)

#### `POST /api/payroll/esi-reg-docs/bulk-download`
- **Auth:** `requireRole("payroll_branch", "payroll_head", "super_admin")`
- **Body:** `{ employee_ids: string[] }` (max 200)
- **Response:** `application/zip` — ZIP named `ESI_Bulk_Docs_<date>.zip`; sub-folder per employee: `<EmpCode>_<Name>/`
- **Audit:** Single audit row with `employee_ids` JSON array in `details`

#### `GET /api/payroll/esi-reg-docs/export-csv`
- **Auth:** `requireRole("payroll_branch", "payroll_head", "super_admin")`
- **Query params:** `branch_id?`
- **Response:** `text/csv` — UTF-8 BOM CSV with columns:
  `Emp Code, Name, Branch, ESIC Number, PAN Number, Bank Name, Account Number (masked), IFSC Code, Account Type, PAN Ready, Photo Ready, Bank Ready`
- **PAN field:** Decrypted from `pan_number_encrypted` using `syncPiiEncryption.decrypt()` — only for these three authorised roles
- **Account number:** Masked — last 4 digits visible, rest replaced with `****`

---

## Frontend

### Tab addition — `PfManagement.tsx`
Add a fifth tab after "Establishments":
```tsx
<TabsTrigger value="esi-reg">ESI Reg. Docs</TabsTrigger>
...
<TabsContent value="esi-reg">
  <EsiRegDocsTab />
</TabsContent>
```

### New component: `EsiRegDocsTab.tsx`
`src/pages/payroll/EsiRegDocsTab.tsx`

**Layout:**
1. **Toolbar** — branch filter dropdown, search input, "Export CSV" button, "Bulk Download ZIP" button (disabled until ≥1 row selected)
2. **Employee table** — columns: Emp Code, Name, Branch, ESIC No., PAN ✓/✗, Photo ✓/✗, Bank ✓/✗, Actions
3. **Row checkbox** — for bulk selection
4. **Actions cell** — "Download ZIP" button per row + row-click opens drill-down drawer

**Readiness chips:**
- Green check badge = document available
- Red X badge = document missing (clicking shows tooltip: "Upload PAN / Photo in employee profile")

**Drill-down drawer** (`max-w-2xl`, full height, slide-over):
- Header: Emp Code, Name, Status badge, Close button
- Section: ESI Details (ESIC number, eligibility status, wage band)
- Section: Document Readiness (PAN, Photo, Bank — each with status + view link if available)
- Section: Bank Information (bank name, masked account, IFSC, account type)
- Section: Download Actions (single-employee ZIP button, bank info PDF button)
- Section: Audit Trail (last 5 download actions for this employee)

### Role guard
Wrap the tab content with a role check using `useWorkforceAccess` (or equivalent hook). If the user lacks the required role, render a "Access restricted" message instead of the tab content — the tab itself remains visible for navigation consistency.

---

## Security & Audit

- PAN decryption only occurs server-side for the three authorised roles; raw `pan_number_encrypted` is never sent to the frontend
- Every download (single, bulk, CSV) writes to `payroll_audit_trail`:
  - `action`: `esi_reg_doc_download` / `esi_bulk_doc_download` / `esi_reg_csv_export`
  - `performed_by`: authenticated user ID
  - `target_employee_id` (single) or `details` JSON (bulk/CSV)
  - `timestamp`
- File serving reuses the existing document-vault token pattern where files are in `employee-documents/`; photos served via existing `/api/files/employee-photos/` route

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Employee has no PAN doc | ZIP omits PAN file; `manifest.txt` inside ZIP notes "PAN document not available" |
| Employee has no photo | ZIP omits photo; manifest notes "Photo not available" |
| Bank detail missing | ZIP includes `Bank_Information.pdf` with "Bank details not on record" |
| Bulk request > 200 employees | 400 Bad Request: "Maximum 200 employees per bulk download" |
| User lacks role | 403 Forbidden on all endpoints |

---

## Migration

No new database tables required. All data already exists. A single audit trail entry type is added (`esi_reg_doc_download`) — compatible with existing `payroll_audit_trail` schema.

---

## Rollback

All changes are additive:
- New route file (can be unmounted from `app.ts`)
- New frontend tab component (can be removed from `PfManagement.tsx`)
- No schema changes, no data mutations
