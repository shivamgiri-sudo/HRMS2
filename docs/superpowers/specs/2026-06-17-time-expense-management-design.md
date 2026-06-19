# Time & Expense Management Module - Design Specification

**Project:** MAS Callnet PeopleOS / HRMS  
**Module:** Time & Expense Management  
**Version:** 1.0  
**Date:** 2026-06-17  
**Author:** Claude (AI Assistant)  
**Status:** Design Complete - Pending Implementation

---

## Executive Summary

This document specifies the design for a comprehensive Time & Expense Management module for the HRMS system. The module enables employees to submit expense claims with receipts, managers to approve team expenses, and finance teams to process reimbursements. It follows the existing HRMS architecture patterns with process-scoped multi-tenant support.

**Key Features:**
- Employee expense claim submission with receipt uploads
- Single-level approval workflow (Manager → Finance)
- Standard corporate expense categories (Travel, Accommodation, Meals, Fuel, etc.)
- Process-scoped access control
- Manual payment processing with CSV export
- Comprehensive reporting and analytics

**Timeline:** 2-3 weeks for MVP implementation

---

## Table of Contents

1. [Business Context](#business-context)
2. [System Architecture](#system-architecture)
3. [Database Design](#database-design)
4. [API Specification](#api-specification)
5. [Frontend Design](#frontend-design)
6. [Business Logic & Rules](#business-logic--rules)
7. [Security & Access Control](#security--access-control)
8. [Testing Strategy](#testing-strategy)
9. [Deployment Plan](#deployment-plan)
10. [Future Enhancements](#future-enhancements)

---

## 1. Business Context

### Problem Statement
The HRMS system currently lacks expense management functionality, requiring employees to use manual processes (email, spreadsheets) for expense claims and reimbursements. This creates inefficiency, delays, and audit challenges.

### Solution
A dedicated expense management module integrated into the existing HRMS platform, providing:
- Self-service expense submission for employees
- Streamlined approval workflows
- Automated notifications
- Audit trails and reporting
- Secure receipt storage

### Success Criteria
- Expense processing time reduced from weeks to < 7 days
- 80%+ employee adoption within 3 months
- Finance team efficiency improved by 50%
- Zero data breaches or security incidents
- 99.5%+ system uptime

### User Roles
| Role | Responsibilities |
|------|------------------|
| **Employee** | Submit expense claims, upload receipts, view claim status |
| **Manager** | Approve/reject direct reports' claims |
| **Finance** | Approve for payment, export payment files, mark as paid |
| **Admin** | Configure categories, view reports, system administration |

---

## 2. System Architecture

### Approach: Standalone Expense Module

Following the established HRMS pattern (similar to `leave`, `payroll`, `ats` modules):

```
backend/src/modules/expenses/
├── expense.controller.ts       # REST API endpoints
├── expense.service.ts          # Business logic
├── expense.routes.ts           # Route definitions
├── expense.model.ts            # TypeScript interfaces/types
├── expenseCategory.service.ts  # Category management
├── expensePolicy.service.ts    # Policy rules (future)
└── expenseReport.service.ts    # Reporting and exports
```

### Technology Stack

**Backend:**
- Express.js + TypeScript
- MySQL (`mas_hrms` database)
- Supabase Auth (existing)
- Supabase Storage (receipt files)

**Frontend:**
- React 18 + TypeScript
- Vite build tool
- Tailwind CSS + shadcn/ui components
- React Hook Form + Zod validation
- TanStack Query for data fetching

### Integration Points

| System | Integration Purpose |
|--------|---------------------|
| Employee Module | Get employee details, reporting manager |
| Process Module | Multi-tenant scoping, access control |
| Access Control | Role-based permissions |
| Supabase Storage | Receipt file uploads |
| Communication Module | Email notifications on status changes |
| Payroll Module | Future: Auto-add to payroll (post-MVP) |

---

## 3. Database Design

All tables in `mas_hrms` database.

### 3.1 expense_categories

Master data for expense types.

```sql
CREATE TABLE expense_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

**Seed Data:**
- Travel (Flights, trains, buses, taxis)
- Accommodation (Hotels, lodging)
- Meals & Entertainment (Client meals, team dinners)
- Fuel/Mileage (Personal vehicle usage)
- Office Supplies (Stationery, equipment)
- Communication (Mobile, internet charges)
- Other (Miscellaneous expenses)

### 3.2 expense_claims

Main claims table.

```sql
CREATE TABLE expense_claims (
  id INT AUTO_INCREMENT PRIMARY KEY,
  claim_number VARCHAR(50) UNIQUE NOT NULL,
  employee_id INT NOT NULL,
  process_id INT NOT NULL,
  branch_id INT NOT NULL,
  total_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
  currency VARCHAR(3) DEFAULT 'INR',
  status ENUM('DRAFT', 'SUBMITTED', 'MANAGER_APPROVED', 'FINANCE_APPROVED', 'PAID', 'REJECTED') DEFAULT 'DRAFT',
  submitted_date TIMESTAMP NULL,
  manager_approved_date TIMESTAMP NULL,
  finance_approved_date TIMESTAMP NULL,
  paid_date TIMESTAMP NULL,
  rejection_reason TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (process_id) REFERENCES process_master(id),
  FOREIGN KEY (branch_id) REFERENCES branch_master(id),
  INDEX idx_employee (employee_id),
  INDEX idx_status (status),
  INDEX idx_process (process_id),
  INDEX idx_manager_queue (status, submitted_date)
);
```

**Claim Number Format:** `EXP-YYYY-MM-NNNN` (e.g., EXP-2026-06-0001)

**Status Flow:**
```
DRAFT → SUBMITTED → MANAGER_APPROVED → FINANCE_APPROVED → PAID
   ↓         ↓              ↓
REJECTED  REJECTED      REJECTED
```

### 3.3 expense_items

Line items within a claim.

```sql
CREATE TABLE expense_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  expense_claim_id INT NOT NULL,
  category_id INT NOT NULL,
  expense_date DATE NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  description TEXT NOT NULL,
  vendor_name VARCHAR(100),
  receipt_file_path VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (expense_claim_id) REFERENCES expense_claims(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES expense_categories(id),
  INDEX idx_claim (expense_claim_id)
);
```

### 3.4 expense_approvals

Audit trail for all approval actions.

```sql
CREATE TABLE expense_approvals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  expense_claim_id INT NOT NULL,
  approver_id INT NOT NULL,
  approval_type ENUM('MANAGER', 'FINANCE') NOT NULL,
  action ENUM('APPROVED', 'REJECTED') NOT NULL,
  comments TEXT,
  action_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (expense_claim_id) REFERENCES expense_claims(id),
  FOREIGN KEY (approver_id) REFERENCES employees(id),
  INDEX idx_claim (expense_claim_id)
);
```

### 3.5 expense_payments

Payment tracking.

```sql
CREATE TABLE expense_payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  expense_claim_id INT NOT NULL,
  payment_reference VARCHAR(100) NOT NULL,
  payment_date DATE NOT NULL,
  payment_method VARCHAR(50) NOT NULL,
  processed_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (expense_claim_id) REFERENCES expense_claims(id),
  FOREIGN KEY (processed_by) REFERENCES employees(id)
);
```

### 3.6 Indexes for Performance

```sql
CREATE INDEX idx_expense_claims_employee ON expense_claims(employee_id);
CREATE INDEX idx_expense_claims_status ON expense_claims(status);
CREATE INDEX idx_expense_claims_process ON expense_claims(process_id);
CREATE INDEX idx_expense_items_claim ON expense_items(expense_claim_id);
CREATE INDEX idx_expense_approvals_claim ON expense_approvals(expense_claim_id);
CREATE INDEX idx_manager_queue ON expense_claims(status, submitted_date);
```

---

## 4. API Specification

### Base URL: `/api/expenses`

### 4.1 Employee Endpoints

#### Create Draft Claim
```
POST /api/expenses/claims
Auth: Employee role
Body: { process_id: number, branch_id: number }
Response: { claim_id: number, claim_number: string, status: "DRAFT" }
```

#### Add Line Item to Claim
```
POST /api/expenses/claims/:claim_id/items
Auth: Employee (own claims only)
Body: {
  category_id: number,
  expense_date: string, // YYYY-MM-DD
  amount: number,
  description: string,
  vendor_name?: string
}
Response: { item_id: number }
```

#### Upload Receipt
```
POST /api/expenses/claims/:claim_id/items/:item_id/receipt
Auth: Employee (own claims only)
Content-Type: multipart/form-data
File: receipt (JPG/PNG/PDF, max 10MB)
Response: { receipt_url: string }
```

**File Storage:**
- Bucket: `expense-receipts`
- Path: `{process_id}/{employee_id}/{claim_id}/{item_id}/receipt.{ext}`
- Uploaded to Supabase Storage
- URL saved in `expense_items.receipt_file_path`

#### Submit Claim for Approval
```
POST /api/expenses/claims/:claim_id/submit
Auth: Employee (own claims only)
Validation: All items must have receipts
Response: { status: "SUBMITTED", submitted_date: string }
Actions:
- Update status: DRAFT → SUBMITTED
- Notify reporting manager via email
- Insert pending approval record
```

#### View Own Claims
```
GET /api/expenses/claims/my-claims
Auth: Employee
Query: ?status=SUBMITTED&page=1&limit=20
Response: {
  claims: [{ id, claim_number, total_amount, status, submitted_date, ... }],
  pagination: { page, limit, total, pages }
}
```

#### View Claim Details
```
GET /api/expenses/claims/:claim_id
Auth: Employee (own), Manager (team), Finance (all)
Response: {
  claim: { id, claim_number, employee, total_amount, status, ... },
  items: [{ id, category, amount, description, receipt_url, ... }],
  approvals: [{ approver, type, action, comments, date, ... }],
  payment: { payment_reference, payment_date, ... } // if paid
}
```

### 4.2 Manager Endpoints

#### View Team Claims Pending Approval
```
GET /api/expenses/claims/pending-approval
Auth: Manager role
Response: [{ claim, employee, items_count, total_amount, submitted_date, ... }]
Filter: Direct reports only (reporting_manager_id = current user)
Filter: Same process_id
```

#### Approve Claim
```
POST /api/expenses/claims/:claim_id/manager-approve
Auth: Manager (reporting team only)
Body: { comments?: string }
Response: { status: "MANAGER_APPROVED" }
Actions:
- Update status: SUBMITTED → MANAGER_APPROVED
- Record approval in expense_approvals
- Notify finance team
- Notify employee
```

#### Reject Claim
```
POST /api/expenses/claims/:claim_id/reject
Auth: Manager or Finance
Body: { rejection_reason: string }
Response: { status: "REJECTED" }
Actions:
- Update status → REJECTED
- Record rejection in expense_approvals
- Notify employee with reason
```

### 4.3 Finance Endpoints

#### View Finance Queue
```
GET /api/expenses/claims/finance-queue
Auth: Finance role
Query: ?status=MANAGER_APPROVED&process_id=123&page=1&limit=20
Response: Paginated list of claims awaiting finance action
```

#### Finance Approve (Ready for Payment)
```
POST /api/expenses/claims/:claim_id/finance-approve
Auth: Finance role
Body: { comments?: string }
Response: { status: "FINANCE_APPROVED" }
Actions:
- Update status: MANAGER_APPROVED → FINANCE_APPROVED
- Record approval in expense_approvals
```

#### Export for Payment
```
GET /api/expenses/claims/export-for-payment
Auth: Finance role
Query: ?status=FINANCE_APPROVED&start_date=2026-06-01&end_date=2026-06-17
Response: CSV file
Columns: employee_name, employee_code, bank_name, account_number, ifsc_code, amount, claim_number, expense_date
```

#### Mark as Paid
```
POST /api/expenses/claims/:claim_id/mark-paid
Auth: Finance role
Body: {
  payment_reference: string,
  payment_date: string, // YYYY-MM-DD
  payment_method: string // "Bank Transfer", "Cash", "Payroll"
}
Response: { status: "PAID" }
Actions:
- Update status: FINANCE_APPROVED → PAID
- Insert into expense_payments
- Notify employee
```

### 4.4 Admin/Reports Endpoints

#### Expense Summary Report
```
GET /api/expenses/reports/summary
Auth: Admin or Finance
Query: ?process_id=123&start_date=2026-06-01&end_date=2026-06-30&group_by=category
Response: {
  total_amount: number,
  claim_count: number,
  avg_claim_amount: number,
  by_category: [{ category, amount, count, ... }],
  by_status: [{ status, count, ... }]
}
```

#### Manage Categories
```
GET /api/expenses/categories
POST /api/expenses/categories
PUT /api/expenses/categories/:id
DELETE /api/expenses/categories/:id (soft delete: is_active = false)
Auth: Admin role
```

### 4.5 Error Responses

**Standard Error Format:**
```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "All expense items must have receipts",
    "details": {
      "missingReceipts": [12, 15]
    }
  }
}
```

**HTTP Status Codes:**
- 200: Success
- 201: Created
- 400: Validation failed
- 403: Access denied (wrong process, not reporting manager)
- 404: Resource not found
- 409: Invalid status transition
- 413: File too large (> 10MB)
- 415: Unsupported file type
- 500: Server error

---

## 5. Frontend Design

### 5.1 Component Structure

```
src/
├── pages/
│   └── expenses/
│       ├── MyExpenses.tsx          # Employee: view own claims
│       ├── NewExpenseClaim.tsx     # Employee: create/edit claim
│       ├── ExpenseApprovals.tsx    # Manager: approve team claims
│       ├── FinanceQueue.tsx        # Finance: process payments
│       └── ExpenseReports.tsx      # Admin/Finance: analytics
└── components/
    └── expenses/
        ├── ExpenseClaimCard.tsx        # Display claim summary
        ├── ExpenseItemForm.tsx         # Add/edit line item
        ├── ExpenseItemsList.tsx        # List items in claim
        ├── ReceiptUpload.tsx           # File upload component
        ├── ReceiptViewer.tsx           # View/download receipt
        ├── ExpenseStatusBadge.tsx      # Status indicator
        ├── ExpenseApprovalActions.tsx  # Approve/Reject buttons
        └── ExpenseSummary.tsx          # Total calculations
```

### 5.2 Page Designs

#### MyExpenses.tsx (Employee View)
- Table/Card view of all own claims
- Columns: Claim Number, Submitted Date, Total Amount, Status
- Filters: Status dropdown (All, Draft, Submitted, Approved, Paid, Rejected)
- Actions: "New Claim" button, "View Details" per claim
- Pagination: 20 claims per page
- Uses existing table component pattern (shadcn/ui)

#### NewExpenseClaim.tsx (Multi-step Form)

**Step 1: Basic Information**
- Process dropdown (auto-filled from employee context)
- Branch dropdown (auto-filled)
- Start date (optional - for trip expenses)

**Step 2: Add Expense Items**
- Category dropdown (from expense_categories)
- Date picker (react-day-picker)
- Amount input (₹, positive numbers only)
- Description textarea (10-500 chars)
- Vendor name input (optional, max 100 chars)
- Receipt upload (drag-drop or click)
  - File types: JPG, PNG, PDF
  - Max size: 10MB
  - Preview thumbnail after upload
- "Add Another Item" button
- List of added items with edit/delete actions

**Step 3: Review & Submit**
- Summary of all items
- Total amount calculation
- Editable items list
- "Save as Draft" button (can return later)
- "Submit for Approval" button (validates all items have receipts)

**Form Validation (Zod):**
```typescript
const expenseItemSchema = z.object({
  category_id: z.number().int().positive(),
  expense_date: z.date().max(new Date(), 'Future dates not allowed'),
  amount: z.number().positive().max(1000000),
  description: z.string().min(10).max(500).trim(),
  vendor_name: z.string().max(100).trim().optional()
});
```

#### ExpenseApprovals.tsx (Manager View)
- List of pending claims from direct reports
- Grouped by employee
- Each claim shows:
  - Employee photo + name
  - Claim number + date
  - Total amount
  - Items count
- Expandable detail view:
  - All line items with descriptions
  - Receipt thumbnails (click to view full)
- Actions per claim:
  - "Approve" button (green)
  - "Reject" button (red) → Opens modal for rejection reason
- Success/error toasts (sonner)
- Empty state: "No pending approvals"

#### FinanceQueue.tsx (Finance View)

**Three Tabs:**
1. **Pending Approval** (MANAGER_APPROVED status)
2. **Approved for Payment** (FINANCE_APPROVED status)
3. **Paid** (PAID status - historical view)

**Table Columns:**
- Claim Number
- Employee Name
- Submitted Date
- Manager Approved Date
- Total Amount
- Actions

**Actions:**
- "Approve for Payment" button
- "Export for Payment" button (CSV download)
- "Mark as Paid" button → Opens modal:
  - Payment reference input
  - Payment date picker
  - Payment method dropdown (Bank Transfer, Cash, Payroll)

**Filters:**
- Process dropdown
- Branch dropdown
- Date range picker

#### ExpenseReports.tsx (Admin/Finance Analytics)

**Dashboard Widgets:**
1. **KPI Cards** (Top row)
   - Total Expenses This Month
   - Pending Claims Count
   - Avg Processing Time
   - Rejection Rate %

2. **Charts** (using recharts)
   - Monthly Expense Trends (Line chart)
   - Category Breakdown (Pie chart)
   - Top Spenders (Bar chart)
   - Process-wise Comparison (Grouped bar chart)

3. **Recent Activity Table**
   - Latest approved/rejected claims
   - Click to view details

**Export Options:**
- Export to Excel (xlsx)
- Date range selector
- Process/Branch filters

### 5.3 Key UI Components

**ExpenseStatusBadge:**
```typescript
const statusVariants = {
  DRAFT: { color: 'gray', label: 'Draft' },
  SUBMITTED: { color: 'blue', label: 'Pending Approval' },
  MANAGER_APPROVED: { color: 'yellow', label: 'Manager Approved' },
  FINANCE_APPROVED: { color: 'green', label: 'Approved for Payment' },
  PAID: { color: 'green', label: 'Paid' },
  REJECTED: { color: 'red', label: 'Rejected' }
};
```

**ReceiptUpload:**
- Drag-and-drop zone
- File input click fallback
- Preview thumbnail after upload
- Progress indicator during upload
- Error handling for oversized/wrong-format files
- Uses Supabase Storage client

**ReceiptViewer:**
- Modal with full image preview
- PDF viewer for PDF receipts
- Download button
- Close/ESC to dismiss

### 5.4 Navigation Integration

Add to existing sidebar navigation:

```typescript
{
  title: "Expenses",
  icon: <Receipt />, // from lucide-react
  children: [
    { 
      title: "My Claims", 
      href: "/expenses/my-claims",
      roles: ["employee", "manager", "finance", "admin"]
    },
    { 
      title: "New Claim", 
      href: "/expenses/new",
      roles: ["employee", "manager", "finance", "admin"]
    },
    { 
      title: "Approvals", 
      href: "/expenses/approvals",
      roles: ["manager"],
      badge: pendingCount // dynamic count
    },
    { 
      title: "Finance Queue", 
      href: "/expenses/finance",
      roles: ["finance", "admin"],
      badge: financeQueueCount
    },
    { 
      title: "Reports", 
      href: "/expenses/reports",
      roles: ["finance", "admin"]
    }
  ]
}
```

### 5.5 Mobile Responsiveness

- All pages responsive (Tailwind breakpoints: sm:, md:, lg:)
- Tables convert to cards on mobile (< 768px)
- Receipt upload optimized for mobile camera
- Touch-friendly action buttons (min 44px tap target)
- Drawer/Sheet components for modals on mobile
- Sticky headers for long lists

### 5.6 UI Patterns (Reusing Existing)

| Pattern | Existing Example | Usage |
|---------|------------------|-------|
| Forms | ATS onboarding | NewExpenseClaim form |
| Tables | Employee listing | MyExpenses, FinanceQueue |
| Modals | Leave approval | Approve/Reject dialogs |
| File Upload | Profile photo | ReceiptUpload |
| Status Badges | Leave status | ExpenseStatusBadge |
| Date Pickers | Leave dates | Expense date selection |
| Toasts | Global notifications | Success/error messages |
| Charts | Dashboard | ExpenseReports analytics |

---

## 6. Business Logic & Rules

### 6.1 Claim Creation & Editing

**Rules:**
- Employees can only create/edit their own claims
- Only DRAFT claims can be edited
- Must have at least 1 line item to submit
- All line items must have receipts before submission
- `total_amount` auto-calculated from sum of line items
- `claim_number` auto-generated on first save: `EXP-YYYY-MM-NNNN` format
  - Example: EXP-2026-06-0001
  - Sequence resets monthly

**Service Method:**
```typescript
async createDraftClaim(employeeId: number, processId: number, branchId: number) {
  const claimNumber = await generateClaimNumber(); // EXP-YYYY-MM-NNNN
  const claim = await db.insert('expense_claims', {
    claim_number: claimNumber,
    employee_id: employeeId,
    process_id: processId,
    branch_id: branchId,
    status: 'DRAFT',
    total_amount: 0
  });
  return claim;
}
```

### 6.2 Approval Logic

**Manager Approval:**
- Can only approve direct reports' claims
- Query filters:
  ```sql
  SELECT ec.* FROM expense_claims ec
  JOIN employees e ON ec.employee_id = e.id
  WHERE e.reporting_manager_id = :managerId
    AND e.process_id = :processId
    AND ec.status = 'SUBMITTED'
  ```
- Same process_id required (process-scoped access)
- Records action in `expense_approvals` table

**Finance Approval:**
- Can approve claims from any process they have access to
- Access checked via access control module
- Can reject at any stage (SUBMITTED or MANAGER_APPROVED)
- Records action in `expense_approvals` table

**Rejection Rules:**
- Manager or Finance can reject
- Rejection reason is mandatory (min 10 chars)
- Rejected claims revert to DRAFT status
- Employee can edit and resubmit
- Previous approval history preserved in `expense_approvals`

### 6.3 Payment Processing

**Rules:**
- Only FINANCE_APPROVED claims can be marked as PAID
- Payment reference is mandatory
- Payment date cannot be future date
- Employee bank details fetched from `employee_bank_detail` table
- If bank details missing, warning shown to finance user

**CSV Export Format:**
```csv
Employee Name,Employee Code,Bank Name,Account Number,IFSC Code,Amount,Claim Number,Expense Date
John Doe,EMP001,HDFC Bank,1234567890,HDFC0001234,5000.00,EXP-2026-06-0001,2026-06-15
```

### 6.4 Validation Rules

| Field | Validation |
|-------|-----------|
| Amount | > 0, max 1,000,000 |
| Expense Date | Not future, not > 6 months old |
| Receipt File | JPG/PNG/PDF, max 10MB |
| Description | 10-500 characters |
| Vendor Name | Optional, max 100 characters |
| Rejection Reason | Min 10 characters |
| Payment Reference | Required, max 100 characters |

### 6.5 Process Scoping (Multi-Tenant)

**Access Control:**
```typescript
// Middleware checks user's process access
const userProcessIds = await getEmployeeProcessAccess(userId);

// Filter claims by process
WHERE expense_claims.process_id IN (:userProcessIds)

// Manager approval: same process as employee
AND employees.process_id = expense_claims.process_id
AND employees.reporting_manager_id = :managerId
```

**Tenant Isolation:**
- All queries filtered by `process_id`
- Receipts stored in process-specific folders
- Reports scoped to user's accessible processes
- No cross-process data leakage

### 6.6 Notification Rules

| Event | Recipient | Notification |
|-------|-----------|--------------|
| Claim Submitted | Reporting Manager | "New expense claim EXP-XXX from {employee} awaits approval" |
| Manager Approved | Finance Team + Employee | "Claim EXP-XXX approved by manager" |
| Finance Approved | Employee | "Claim EXP-XXX approved for payment" |
| Claim Rejected | Employee | "Claim EXP-XXX rejected: {reason}" |
| Payment Processed | Employee | "Reimbursement of ₹{amount} processed for claim EXP-XXX" |

**Notification Channels:**
- Email (via communication module)
- In-app notifications (future: inbox module)
- SMS (optional, for high-value claims)

### 6.7 Data Flow Examples

**Example 1: Employee Submits Claim**
```
1. Employee creates draft → INSERT expense_claims (status: DRAFT)
2. Employee adds items → INSERT expense_items (multiple)
3. Employee uploads receipts → Supabase Storage → UPDATE expense_items.receipt_file_path
4. Employee clicks submit → 
   - Validate: all items have receipts
   - UPDATE expense_claims SET status='SUBMITTED', submitted_date=NOW()
   - Calculate total_amount = SUM(expense_items.amount)
   - Send email to reporting manager
   - INSERT expense_approvals (approval_type: MANAGER, action: PENDING)
```

**Example 2: Manager Approves**
```
1. Manager views pending → SELECT with reporting_manager_id filter
2. Manager clicks approve →
   - UPDATE expense_claims SET status='MANAGER_APPROVED', manager_approved_date=NOW()
   - UPDATE expense_approvals SET action='APPROVED', action_date=NOW()
   - Send email to finance team
   - Send notification to employee
```

**Example 3: Finance Processes Payment**
```
1. Finance approves → UPDATE expense_claims SET status='FINANCE_APPROVED'
2. Finance exports CSV → SELECT with employee bank details JOIN
3. Finance processes payment externally (bank transfer)
4. Finance marks as paid →
   - UPDATE expense_claims SET status='PAID', paid_date=NOW()
   - INSERT expense_payments (payment_reference, payment_date, payment_method)
   - Send notification to employee: "Your reimbursement of ₹{amount} has been processed"
```

---

## 7. Security & Access Control

### 7.1 Authentication & Authorization

**Route-Level Protection:**
```typescript
// expense.routes.ts
router.post('/claims', 
  authenticate, // Supabase auth check
  requireRole(['employee', 'manager', 'finance', 'admin']),
  expenseController.createClaim
);

router.post('/claims/:id/manager-approve',
  authenticate,
  requireRole(['manager']),
  checkManagerAccess, // custom middleware
  expenseController.managerApprove
);

router.get('/claims/finance-queue',
  authenticate,
  requireRole(['finance', 'admin']),
  expenseController.getFinanceQueue
);
```

**Row-Level Security:**
```typescript
// checkManagerAccess middleware
async function checkManagerAccess(req, res, next) {
  const claim = await getClaim(req.params.id);
  const employee = await getEmployee(claim.employee_id);
  
  if (employee.reporting_manager_id !== req.user.employee_id) {
    return res.status(403).json({ 
      error: 'Not authorized to approve this claim' 
    });
  }
  
  if (employee.process_id !== req.user.process_id) {
    return res.status(403).json({ 
      error: 'Process access denied' 
    });
  }
  
  next();
}
```

### 7.2 File Storage Security

**Supabase Storage Configuration:**
- Bucket: `expense-receipts`
- Public: No (private bucket)
- Path structure: `{process_id}/{employee_id}/{claim_id}/{item_id}/receipt.{ext}`

**Storage Policies:**
```typescript
// Upload: Authenticated users, own employee_id only
CREATE POLICY "Users can upload own receipts"
ON storage.objects FOR INSERT
WITH CHECK (
  auth.uid() = (SELECT user_id FROM employees WHERE id = SPLIT_PART(name, '/', 2)::int)
);

// Download: Users with claim access
CREATE POLICY "Users can download accessible receipts"
ON storage.objects FOR SELECT
USING (
  -- Employee: own claims
  -- Manager: direct reports
  -- Finance: process access
  -- Admin: all
);
```

### 7.3 Input Validation & Sanitization

**Zod Schemas:**
```typescript
const expenseItemSchema = z.object({
  category_id: z.number().int().positive(),
  expense_date: z.date().max(new Date(), 'Future dates not allowed'),
  amount: z.number().positive().max(1000000, 'Amount too large'),
  description: z.string().min(10).max(500).trim(),
  vendor_name: z.string().max(100).trim().optional()
});

const rejectClaimSchema = z.object({
  rejection_reason: z.string().min(10).max(500).trim()
});

const markPaidSchema = z.object({
  payment_reference: z.string().min(1).max(100).trim(),
  payment_date: z.date().max(new Date()),
  payment_method: z.enum(['Bank Transfer', 'Cash', 'Payroll'])
});
```

### 7.4 SQL Injection Prevention

**Always use parameterized queries:**
```typescript
// Good ✅
db.query('SELECT * FROM expense_claims WHERE id = ?', [claimId]);

// Bad ❌
db.query(`SELECT * FROM expense_claims WHERE id = ${claimId}`);
```

### 7.5 Rate Limiting

```typescript
// Rate limits per user
- File uploads: 10 per minute
- API calls: 100 per minute
- Submit claim: 5 per hour (prevent spam)
- Export CSV: 10 per hour
```

### 7.6 Audit Logging

**Log all sensitive operations:**
- Claim submission
- Approvals/rejections
- Status changes
- Payment processing
- File uploads/downloads
- Admin actions (category changes)

**Log Format:**
```json
{
  "timestamp": "2026-06-17T10:30:00Z",
  "user_id": 123,
  "action": "CLAIM_APPROVED",
  "resource": "expense_claim",
  "resource_id": 456,
  "ip_address": "192.168.1.1",
  "user_agent": "Mozilla/5.0...",
  "details": { "comments": "Approved", "amount": 5000 }
}
```

### 7.7 Data Privacy

**PII Protection:**
- Employee bank details encrypted at rest
- Receipts may contain PII (redact before sharing externally)
- Access logs for compliance audits
- GDPR/DPDP compliance for data retention

**Data Retention Policy:**
- Active claims: Forever
- Paid claims: 7 years (tax compliance)
- Rejected claims: 1 year (then archive)
- Receipt files: Same as claims

---

## 8. Testing Strategy

### 8.1 Unit Tests (Backend - Vitest)

**Target: 80%+ code coverage**

```typescript
// expense.service.test.ts
describe('ExpenseService', () => {
  describe('createDraftClaim', () => {
    it('creates claim with DRAFT status', async () => {
      const claim = await expenseService.createDraftClaim(1, 1, 1);
      expect(claim.status).toBe('DRAFT');
      expect(claim.claim_number).toMatch(/EXP-\d{4}-\d{2}-\d{4}/);
    });
  });

  describe('submitClaim', () => {
    it('fails without receipts', async () => {
      await expect(expenseService.submitClaim(claimId))
        .rejects.toThrow('All items must have receipts');
    });

    it('calculates total amount correctly', async () => {
      // Add 3 items: 1000, 2000, 3000
      const claim = await expenseService.submitClaim(claimId);
      expect(claim.total_amount).toBe(6000);
    });
  });

  describe('managerApprove', () => {
    it('fails for non-direct-reports', async () => {
      await expect(expenseApprovalService.managerApprove(claimId, wrongManagerId))
        .rejects.toThrow('Not authorized');
    });

    it('transitions status correctly', async () => {
      const claim = await expenseApprovalService.managerApprove(claimId, managerId);
      expect(claim.status).toBe('MANAGER_APPROVED');
      expect(claim.manager_approved_date).toBeDefined();
    });
  });
});
```

### 8.2 Integration Tests (API)

```typescript
describe('Expense API', () => {
  describe('POST /api/expenses/claims', () => {
    it('creates draft claim', async () => {
      const res = await request(app)
        .post('/api/expenses/claims')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({ process_id: 1, branch_id: 1 })
        .expect(201);
      
      expect(res.body.status).toBe('DRAFT');
      expect(res.body.claim_number).toMatch(/EXP-/);
    });

    it('requires authentication', async () => {
      await request(app)
        .post('/api/expenses/claims')
        .send({ process_id: 1, branch_id: 1 })
        .expect(401);
    });
  });

  describe('POST /api/expenses/claims/:id/finance-approve', () => {
    it('fails without manager approval', async () => {
      await request(app)
        .post(`/api/expenses/claims/${submittedClaimId}/finance-approve`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(409); // Conflict - wrong status
    });

    it('succeeds with manager-approved claim', async () => {
      await request(app)
        .post(`/api/expenses/claims/${managerApprovedClaimId}/finance-approve`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(200);
    });
  });
});
```

### 8.3 E2E Tests (Playwright)

```typescript
test('Complete expense claim flow', async ({ page }) => {
  // Login as employee
  await loginAs(page, 'employee@example.com');
  
  // Create new claim
  await page.goto('/expenses/new');
  
  // Add expense item
  await page.selectOption('[name="category"]', 'Travel');
  await page.fill('[name="amount"]', '5000');
  await page.fill('[name="expense_date"]', '2026-06-15');
  await page.fill('[name="description"]', 'Client visit to Mumbai for project meeting');
  await page.fill('[name="vendor_name"]', 'IndiGo Airlines');
  
  // Upload receipt
  await page.setInputFiles('[name="receipt"]', 'tests/fixtures/receipt.jpg');
  await page.click('button:has-text("Add Item")');
  
  // Verify item added
  await expect(page.locator('.expense-item')).toHaveCount(1);
  
  // Submit claim
  await page.click('button:has-text("Submit for Approval")');
  await expect(page.locator('.toast')).toContainText('Claim submitted successfully');
  
  // Get claim number
  const claimNumber = await page.locator('.claim-number').textContent();
  
  // Login as manager
  await loginAs(page, 'manager@example.com');
  await page.goto('/expenses/approvals');
  
  // Find and approve claim
  await page.click(`[data-claim="${claimNumber}"]`);
  await page.click('button:has-text("Approve")');
  await expect(page.locator('.toast')).toContainText('Claim approved');
  
  // Login as finance
  await loginAs(page, 'finance@example.com');
  await page.goto('/expenses/finance');
  
  // Finance approve
  await page.click(`[data-claim="${claimNumber}"] button:has-text("Approve for Payment")`);
  
  // Mark as paid
  await page.click(`[data-claim="${claimNumber}"] button:has-text("Mark as Paid")`);
  await page.fill('[name="payment_reference"]', 'TXN123456');
  await page.fill('[name="payment_date"]', '2026-06-17');
  await page.selectOption('[name="payment_method"]', 'Bank Transfer');
  await page.click('button:has-text("Confirm Payment")');
  
  // Verify final status
  await expect(page.locator(`[data-claim="${claimNumber}"] .status`)).toHaveText('Paid');
});

test('Rejection flow', async ({ page }) => {
  await loginAs(page, 'manager@example.com');
  await page.goto('/expenses/approvals');
  
  await page.click('[data-claim-id="123"] button:has-text("Reject")');
  await page.fill('[name="rejection_reason"]', 'Missing valid receipt for fuel expense');
  await page.click('button:has-text("Confirm Rejection")');
  
  await expect(page.locator('.toast')).toContainText('Claim rejected');
  
  // Verify employee sees rejection
  await loginAs(page, 'employee@example.com');
  await page.goto('/expenses/my-claims');
  
  await expect(page.locator('[data-claim-id="123"] .status')).toHaveText('Rejected');
  await page.click('[data-claim-id="123"]');
  await expect(page.locator('.rejection-reason')).toContainText('Missing valid receipt');
});
```

### 8.4 Test Coverage Targets

| Layer | Target | Critical Paths |
|-------|--------|----------------|
| Unit Tests | 80%+ | 100% for approval logic, payment processing |
| API Endpoints | 100% | All endpoints tested |
| E2E Tests | Happy path + rejection | Complete flows |
| Security Tests | All auth/authz paths | Access control edge cases |

### 8.5 Performance Tests

```typescript
describe('Performance', () => {
  it('handles 1000 concurrent claim submissions', async () => {
    const promises = Array(1000).fill(null).map(() => 
      expenseService.createDraftClaim(randomEmployeeId(), 1, 1)
    );
    
    const start = Date.now();
    await Promise.all(promises);
    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(5000); // < 5 seconds
  });

  it('manager queue loads under 500ms', async () => {
    const start = Date.now();
    await expenseApprovalService.getManagerPendingClaims(managerId);
    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(500);
  });
});
```

---

## 9. Deployment Plan

### 9.1 Database Migration

**File:** `backend/sql/migrations/XXX_create_expense_tables.sql`

```sql
-- See Section 3 for full SQL schema
CREATE TABLE expense_categories (...);
CREATE TABLE expense_claims (...);
CREATE TABLE expense_items (...);
CREATE TABLE expense_approvals (...);
CREATE TABLE expense_payments (...);

-- Indexes
CREATE INDEX idx_expense_claims_employee ON expense_claims(employee_id);
-- ... (see Section 3.6 for all indexes)

-- Seed categories
INSERT INTO expense_categories (name, description) VALUES
('Travel', 'Flights, trains, buses, taxis'),
-- ... (see Section 3.1 for all categories)
```

**Migration Steps:**
1. Run migration on staging database first
2. Verify schema with `DESCRIBE` commands
3. Test seed data
4. Backup production database
5. Run migration on production during maintenance window
6. Verify production schema

### 9.2 Supabase Storage Setup

```bash
# Via Supabase Dashboard
1. Go to Storage
2. Create new bucket: "expense-receipts"
3. Settings:
   - Public: No (Private)
   - File size limit: 10MB
   - Allowed MIME types: image/jpeg, image/png, application/pdf
4. Set policies (see Section 7.2)
```

### 9.3 Backend Deployment

```bash
# 1. Install dependencies (if any new ones)
cd backend
npm install

# 2. Run migrations
npm run migrate

# 3. Build backend
npm run build

# 4. Test health endpoint
curl http://localhost:5055/api/health

# 5. Deploy to production
# (follow existing deployment process)
```

**Add to backend/src/app.ts:**
```typescript
import expenseRoutes from './modules/expenses/expense.routes';

// After other routes
app.use('/api/expenses', expenseRoutes);
```

### 9.4 Frontend Deployment

```bash
# 1. Add new routes to routing config
# (see Section 5.2)

# 2. Add navigation items
# (see Section 5.4)

# 3. Build frontend
npm run build

# 4. Test build
npm run preview

# 5. Deploy to production
# (follow existing deployment process)
```

### 9.5 Rollout Strategy

**Phase 1: Internal Testing (Week 1)**
- Deploy to staging environment
- Create 5-10 test user accounts
- Test all workflows:
  - Employee: Create, submit claim
  - Manager: Approve/reject
  - Finance: Process payment
- Verify receipt uploads to Supabase
- Check email notifications
- Fix critical bugs

**Phase 2: Pilot Launch (Week 2)**
- Deploy to production
- Enable for single process/branch (10-20 users)
- Announce to pilot group via email
- Provide quick start guide
- Monitor for 1 week:
  - API errors in logs
  - User feedback
  - Performance metrics
- Hot-fix any issues

**Phase 3: Phased Rollout (Week 3)**
- Enable for 3-5 additional processes
- Continue monitoring
- Gather feedback
- Iterate on UX improvements

**Phase 4: Full Rollout (Week 4)**
- Enable for all processes
- Organization-wide announcement
- Conduct training sessions:
  - 30-min session for employees
  - 45-min session for managers/finance
- Provide video tutorials
- Set up support channel (Slack/email)

**Phase 5: Optimization (Ongoing)**
- Weekly metrics review:
  - Claim processing time
  - Adoption rate
  - Rejection rate
  - User satisfaction
- Monthly feature enhancements
- Quarterly roadmap review

### 9.6 Monitoring Setup

**Application Metrics:**
```typescript
// Track in monitoring dashboard
- Total claims submitted (daily/monthly)
- Average approval time (hours)
- Claims by status (gauge)
- Rejection rate (%)
- Average claim amount
- Top expense categories
- Finance queue depth
- API response times
- Error rates
```

**Alerts:**
```typescript
// Set up alerts (email/Slack)
- Claims pending > 7 days (SLA breach)
- Finance queue > 50 claims (backlog)
- Failed file uploads > 10/hour
- API error rate > 5%
- Database query time > 2 seconds
- Disk space < 10% (receipt storage)
```

**Health Checks:**
```typescript
// Add to existing health endpoint
GET /api/health
Response: {
  status: 'healthy',
  services: {
    database: 'up',
    supabase_storage: 'up',
    expense_module: 'up'
  }
}
```

### 9.7 Rollback Plan

**If critical issues found:**
1. Disable expense routes in backend (comment out in app.ts)
2. Hide navigation items in frontend
3. Announce downtime to users
4. Investigate and fix issue
5. Redeploy and re-test
6. Re-enable module

**Data Safety:**
- No data deleted during rollback
- Claims remain in database
- Receipts remain in Supabase Storage
- Can resume where users left off

---

## 10. Future Enhancements

### Post-MVP Feature Roadmap

**Priority 1: Policy Engine (Q3 2026)**
- Amount limits per category (e.g., max ₹5,000 for meals)
- Approval routing based on amount thresholds
- Auto-rejection for policy violations
- Custom expense policies per process
- Policy compliance reporting

**Priority 2: OCR for Receipt Scanning (Q4 2026)**
- Auto-extract amount, date, vendor from receipt images
- Uses Google Vision API or AWS Textract
- Employee reviews and confirms extracted data
- Reduces manual data entry errors
- Cost: ~$1-3 per 1000 receipts

**Priority 3: Advance Payment Tracking (Q4 2026)**
- Employees request travel advance before trip
- Manager approval for advances
- Actual expenses adjust against advance
- Track outstanding advances
- Alert for advance settlement deadline

**Priority 4: Multi-Currency Support (Q1 2027)**
- International travel expenses
- Currency selection per item
- Real-time currency conversion rates (API integration)
- Finance sees amounts in base currency (INR)
- Exchange rate audit trail

**Priority 5: Payroll Integration (Q1 2027)**
- Auto-add approved expenses to next payroll cycle
- Seamless reimbursement with salary
- Payroll summary includes expense reimbursements
- Requires integration with existing payroll module

**Priority 6: Mobile App Features (Q2 2027)**
- Native mobile apps (iOS/Android) or PWA
- Snap receipt with camera
- Submit expense on-the-go
- Push notifications for approvals
- Offline mode (sync when online)
- GPS-based mileage tracking

**Priority 7: Advanced Analytics (Q2 2027)**
- Spending patterns by department
- Budget vs. actual analysis
- Anomaly detection (unusual expenses)
- Predictive expense forecasting
- Benchmark comparisons across processes
- Executive dashboards

**Priority 8: Mileage Tracking (Q3 2027)**
- GPS-based distance calculation
- Per-km rate configuration (by vehicle type)
- Route map visualization
- Start/end location logging
- Integration with Google Maps API

**Priority 9: Credit Card Integration (Q3 2027)**
- Import transactions from corporate cards
- Auto-create expense items
- Match receipts to transactions
- Card spend reconciliation
- Integration with card providers

**Priority 10: Approval Delegation (Q4 2027)**
- Managers delegate approval authority when OOO
- Temporary delegation with date range
- Audit trail of delegated approvals
- Notification to delegatee

---

## Appendix A: SQL Migration Script

**File:** `backend/sql/migrations/001_create_expense_tables.sql`

```sql
-- Expense Categories Master Table
CREATE TABLE expense_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Expense Claims Table
CREATE TABLE expense_claims (
  id INT AUTO_INCREMENT PRIMARY KEY,
  claim_number VARCHAR(50) UNIQUE NOT NULL,
  employee_id INT NOT NULL,
  process_id INT NOT NULL,
  branch_id INT NOT NULL,
  total_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
  currency VARCHAR(3) DEFAULT 'INR',
  status ENUM('DRAFT', 'SUBMITTED', 'MANAGER_APPROVED', 'FINANCE_APPROVED', 'PAID', 'REJECTED') DEFAULT 'DRAFT',
  submitted_date TIMESTAMP NULL,
  manager_approved_date TIMESTAMP NULL,
  finance_approved_date TIMESTAMP NULL,
  paid_date TIMESTAMP NULL,
  rejection_reason TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (process_id) REFERENCES process_master(id),
  FOREIGN KEY (branch_id) REFERENCES branch_master(id)
);

-- Expense Items Table
CREATE TABLE expense_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  expense_claim_id INT NOT NULL,
  category_id INT NOT NULL,
  expense_date DATE NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  description TEXT NOT NULL,
  vendor_name VARCHAR(100),
  receipt_file_path VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (expense_claim_id) REFERENCES expense_claims(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES expense_categories(id)
);

-- Expense Approvals Audit Table
CREATE TABLE expense_approvals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  expense_claim_id INT NOT NULL,
  approver_id INT NOT NULL,
  approval_type ENUM('MANAGER', 'FINANCE') NOT NULL,
  action ENUM('APPROVED', 'REJECTED') NOT NULL,
  comments TEXT,
  action_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (expense_claim_id) REFERENCES expense_claims(id),
  FOREIGN KEY (approver_id) REFERENCES employees(id)
);

-- Expense Payments Table
CREATE TABLE expense_payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  expense_claim_id INT NOT NULL,
  payment_reference VARCHAR(100) NOT NULL,
  payment_date DATE NOT NULL,
  payment_method VARCHAR(50) NOT NULL,
  processed_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (expense_claim_id) REFERENCES expense_claims(id),
  FOREIGN KEY (processed_by) REFERENCES employees(id)
);

-- Indexes for Performance
CREATE INDEX idx_expense_claims_employee ON expense_claims(employee_id);
CREATE INDEX idx_expense_claims_status ON expense_claims(status);
CREATE INDEX idx_expense_claims_process ON expense_claims(process_id);
CREATE INDEX idx_expense_items_claim ON expense_items(expense_claim_id);
CREATE INDEX idx_expense_approvals_claim ON expense_approvals(expense_claim_id);
CREATE INDEX idx_manager_queue ON expense_claims(status, submitted_date);

-- Seed Expense Categories
INSERT INTO expense_categories (name, description) VALUES
('Travel', 'Flights, trains, buses, taxis, and other transportation'),
('Accommodation', 'Hotels, lodging, and overnight stays'),
('Meals & Entertainment', 'Client meals, team dinners, and business entertainment'),
('Fuel/Mileage', 'Personal vehicle usage for business purposes'),
('Office Supplies', 'Stationery, equipment, and office materials'),
('Communication', 'Mobile charges, internet, and communication expenses'),
('Other', 'Miscellaneous expenses not covered by other categories');
```

---

## Appendix B: TypeScript Interfaces

```typescript
// expense.model.ts

export enum ExpenseStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  MANAGER_APPROVED = 'MANAGER_APPROVED',
  FINANCE_APPROVED = 'FINANCE_APPROVED',
  PAID = 'PAID',
  REJECTED = 'REJECTED'
}

export enum ApprovalType {
  MANAGER = 'MANAGER',
  FINANCE = 'FINANCE'
}

export enum ApprovalAction {
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED'
}

export interface ExpenseCategory {
  id: number;
  name: string;
  description: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface ExpenseClaim {
  id: number;
  claim_number: string;
  employee_id: number;
  process_id: number;
  branch_id: number;
  total_amount: number;
  currency: string;
  status: ExpenseStatus;
  submitted_date?: Date;
  manager_approved_date?: Date;
  finance_approved_date?: Date;
  paid_date?: Date;
  rejection_reason?: string;
  created_at: Date;
  updated_at: Date;
  
  // Relations
  employee?: Employee;
  process?: Process;
  branch?: Branch;
  items?: ExpenseItem[];
  approvals?: ExpenseApproval[];
  payment?: ExpensePayment;
}

export interface ExpenseItem {
  id: number;
  expense_claim_id: number;
  category_id: number;
  expense_date: Date;
  amount: number;
  description: string;
  vendor_name?: string;
  receipt_file_path?: string;
  created_at: Date;
  updated_at: Date;
  
  // Relations
  category?: ExpenseCategory;
}

export interface ExpenseApproval {
  id: number;
  expense_claim_id: number;
  approver_id: number;
  approval_type: ApprovalType;
  action: ApprovalAction;
  comments?: string;
  action_date: Date;
  
  // Relations
  approver?: Employee;
}

export interface ExpensePayment {
  id: number;
  expense_claim_id: number;
  payment_reference: string;
  payment_date: Date;
  payment_method: string;
  processed_by: number;
  created_at: Date;
  
  // Relations
  processor?: Employee;
}

// DTOs (Data Transfer Objects)
export interface CreateExpenseClaimDto {
  process_id: number;
  branch_id: number;
}

export interface AddExpenseItemDto {
  category_id: number;
  expense_date: string; // YYYY-MM-DD
  amount: number;
  description: string;
  vendor_name?: string;
}

export interface ApproveClaimDto {
  comments?: string;
}

export interface RejectClaimDto {
  rejection_reason: string;
}

export interface MarkPaidDto {
  payment_reference: string;
  payment_date: string; // YYYY-MM-DD
  payment_method: string;
}

export interface ExpenseReportQuery {
  process_id?: number;
  branch_id?: number;
  start_date?: string;
  end_date?: string;
  group_by?: 'category' | 'employee' | 'branch' | 'process';
}
```

---

## Appendix C: Success Metrics Dashboard

**KPIs to Track:**

| Metric | Target | Measurement |
|--------|--------|-------------|
| Claim Processing Time | < 7 days | submitted_date → paid_date |
| Employee Adoption | > 80% in 3 months | Active users / Total employees |
| Manager Response Time | < 2 days | submitted_date → manager_approved_date |
| Finance Processing Time | < 3 days | manager_approved_date → paid_date |
| Rejection Rate | < 10% | Rejected claims / Total submitted |
| API Response Time | < 500ms (p95) | Monitoring dashboard |
| System Uptime | > 99.5% | Monitoring dashboard |
| User Satisfaction | > 4/5 stars | Survey after 1 month |

---

## Appendix D: Glossary

| Term | Definition |
|------|------------|
| **Claim** | A collection of expense items submitted together for reimbursement |
| **Line Item** | A single expense entry within a claim (e.g., one taxi ride, one meal) |
| **Receipt** | Supporting documentation for an expense (image or PDF) |
| **Process** | Multi-tenant organizational unit (client/division) in HRMS |
| **Approval Workflow** | Sequential steps for claim approval (Manager → Finance) |
| **Reimbursement** | Payment back to employee for approved expenses |
| **Draft** | Claim being created but not yet submitted |
| **Submitted** | Claim sent for manager approval |
| **Finance Queue** | List of claims awaiting finance processing |
| **Payment Reference** | Bank transaction ID or check number for payment |

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-06-17 | Claude (AI Assistant) | Initial design specification |

---

**End of Design Specification**
