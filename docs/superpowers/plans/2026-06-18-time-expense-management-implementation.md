# Time & Expense Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a complete Time & Expense Management module enabling employees to submit expense claims with receipts, managers to approve, and finance to process reimbursements.

**Architecture:** Standalone module following existing HRMS patterns (similar to leave/payroll modules). Backend: Express + TypeScript + MySQL. Frontend: React + TypeScript + shadcn/ui. Receipt storage: Supabase Storage.

**Tech Stack:** Express.js, TypeScript, MySQL, React 18, Vite, Tailwind CSS, shadcn/ui, Supabase Auth & Storage, React Hook Form, Zod, TanStack Query

---

## File Structure

### Backend Files (Create)
```
backend/src/modules/expenses/
├── expense.model.ts            # TypeScript interfaces/enums
├── expense.service.ts          # Core business logic
├── expense.controller.ts       # HTTP handlers
├── expense.routes.ts           # Route definitions
├── expenseCategory.service.ts  # Category CRUD
├── expenseApproval.service.ts  # Approval workflows
├── expenseReport.service.ts    # Reports & analytics
└── __tests__/
    ├── expense.service.test.ts
    ├── expenseApproval.service.test.ts
    └── expense.routes.test.ts
```

### Frontend Files (Create)
```
src/pages/expenses/
├── MyExpenses.tsx              # Employee view
├── NewExpenseClaim.tsx         # Create/edit claim
├── ExpenseApprovals.tsx        # Manager approvals
├── FinanceQueue.tsx            # Finance processing
└── ExpenseReports.tsx          # Analytics dashboard

src/components/expenses/
├── ExpenseClaimCard.tsx        # Claim summary card
├── ExpenseItemForm.tsx         # Line item form
├── ExpenseItemsList.tsx        # Items table
├── ReceiptUpload.tsx           # File upload
├── ReceiptViewer.tsx           # Receipt preview
├── ExpenseStatusBadge.tsx      # Status indicator
├── ExpenseApprovalActions.tsx  # Approve/Reject
└── ExpenseSummary.tsx          # Amount totals

src/integrations/expenses/
├── api.ts                      # API client
├── hooks.ts                    # React Query hooks
└── types.ts                    # Frontend types
```

### Database Migration
```
backend/sql/migrations/
└── 099_create_expense_tables.sql
```

### Modified Files
```
backend/src/app.ts              # Add expense routes
src/App.tsx                     # Add expense pages routing
src/components/layout/Sidebar.tsx  # Add navigation items
```

---

## Task 1: Database Schema & Migration

**Files:**
- Create: `backend/sql/migrations/099_create_expense_tables.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- Expense Categories Master Table
CREATE TABLE expense_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  FOREIGN KEY (branch_id) REFERENCES branch_master(id),
  INDEX idx_employee (employee_id),
  INDEX idx_status (status),
  INDEX idx_process (process_id),
  INDEX idx_manager_queue (status, submitted_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  FOREIGN KEY (category_id) REFERENCES expense_categories(id),
  INDEX idx_claim (expense_claim_id),
  INDEX idx_category (category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  FOREIGN KEY (approver_id) REFERENCES employees(id),
  INDEX idx_claim (expense_claim_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  FOREIGN KEY (processed_by) REFERENCES employees(id),
  INDEX idx_claim (expense_claim_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

- [ ] **Step 2: Test migration on local database**

Run:
```bash
cd backend
mysql -u root -p mas_hrms < sql/migrations/099_create_expense_tables.sql
```

Expected: Success, no errors

- [ ] **Step 3: Verify tables created**

Run:
```bash
mysql -u root -p mas_hrms -e "SHOW TABLES LIKE 'expense%';"
```

Expected: 5 tables listed (expense_categories, expense_claims, expense_items, expense_approvals, expense_payments)

- [ ] **Step 4: Verify seed data**

Run:
```bash
mysql -u root -p mas_hrms -e "SELECT * FROM expense_categories;"
```

Expected: 7 categories returned

- [ ] **Step 5: Commit**

```bash
git add backend/sql/migrations/099_create_expense_tables.sql
git commit -m "feat(expenses): add database schema and seed categories"
```

---

## Task 2: TypeScript Models & Interfaces

**Files:**
- Create: `backend/src/modules/expenses/expense.model.ts`

- [ ] **Step 1: Write test for type exports**

Create: `backend/src/modules/expenses/__tests__/expense.model.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import {
  ExpenseStatus,
  ApprovalType,
  ApprovalAction,
  type ExpenseClaim,
  type ExpenseItem,
  type ExpenseCategory,
  type ExpenseApproval,
  type ExpensePayment
} from '../expense.model.js';

describe('expense.model', () => {
  it('exports ExpenseStatus enum', () => {
    expect(ExpenseStatus.DRAFT).toBe('DRAFT');
    expect(ExpenseStatus.SUBMITTED).toBe('SUBMITTED');
    expect(ExpenseStatus.MANAGER_APPROVED).toBe('MANAGER_APPROVED');
    expect(ExpenseStatus.FINANCE_APPROVED).toBe('FINANCE_APPROVED');
    expect(ExpenseStatus.PAID).toBe('PAID');
    expect(ExpenseStatus.REJECTED).toBe('REJECTED');
  });

  it('exports ApprovalType enum', () => {
    expect(ApprovalType.MANAGER).toBe('MANAGER');
    expect(ApprovalType.FINANCE).toBe('FINANCE');
  });

  it('exports ApprovalAction enum', () => {
    expect(ApprovalAction.APPROVED).toBe('APPROVED');
    expect(ApprovalAction.REJECTED).toBe('REJECTED');
  });

  it('ExpenseClaim interface has required fields', () => {
    const claim: ExpenseClaim = {
      id: 1,
      claim_number: 'EXP-2026-06-0001',
      employee_id: 10,
      process_id: 1,
      branch_id: 1,
      total_amount: 5000,
      currency: 'INR',
      status: ExpenseStatus.DRAFT,
      created_at: new Date(),
      updated_at: new Date()
    };
    
    expect(claim.id).toBe(1);
    expect(claim.status).toBe(ExpenseStatus.DRAFT);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- expense.model.test.ts`

Expected: FAIL with "Cannot find module '../expense.model.js'"

- [ ] **Step 3: Implement expense.model.ts**

Create: `backend/src/modules/expenses/expense.model.ts`

```typescript
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
}

export interface ExpenseApproval {
  id: number;
  expense_claim_id: number;
  approver_id: number;
  approval_type: ApprovalType;
  action: ApprovalAction;
  comments?: string;
  action_date: Date;
}

export interface ExpensePayment {
  id: number;
  expense_claim_id: number;
  payment_reference: string;
  payment_date: Date;
  payment_method: string;
  processed_by: number;
  created_at: Date;
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

// Extended interfaces with relations
export interface ExpenseClaimWithDetails extends ExpenseClaim {
  items?: ExpenseItem[];
  approvals?: ExpenseApproval[];
  payment?: ExpensePayment;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- expense.model.test.ts`

Expected: PASS (all tests green)

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/expenses/expense.model.ts backend/src/modules/expenses/__tests__/expense.model.test.ts
git commit -m "feat(expenses): add TypeScript models and interfaces"
```

---

## Task 3: Expense Category Service

**Files:**
- Create: `backend/src/modules/expenses/expenseCategory.service.ts`
- Test: `backend/src/modules/expenses/__tests__/expenseCategory.service.test.ts`

- [ ] **Step 1: Write failing test for listCategories**

Create: `backend/src/modules/expenses/__tests__/expenseCategory.service.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { expenseCategoryService } from '../expenseCategory.service.js';
import { db } from '../../../db/mysql.js';

describe('expenseCategoryService', () => {
  describe('listCategories', () => {
    it('returns all active categories', async () => {
      const categories = await expenseCategoryService.listCategories();
      
      expect(categories.length).toBeGreaterThan(0);
      expect(categories[0]).toHaveProperty('id');
      expect(categories[0]).toHaveProperty('name');
      expect(categories[0].is_active).toBe(true);
    });
    
    it('includes inactive categories when includeInactive is true', async () => {
      // First create an inactive category
      const [result] = await db.query(
        'INSERT INTO expense_categories (name, description, is_active) VALUES (?, ?, ?)',
        ['Test Inactive', 'Test', false]
      );
      
      const categories = await expenseCategoryService.listCategories(true);
      const inactive = categories.find(c => c.name === 'Test Inactive');
      
      expect(inactive).toBeDefined();
      expect(inactive?.is_active).toBe(false);
      
      // Cleanup
      await db.query('DELETE FROM expense_categories WHERE name = ?', ['Test Inactive']);
    });
  });

  describe('getCategoryById', () => {
    it('returns category by id', async () => {
      const [rows] = await db.query('SELECT id FROM expense_categories LIMIT 1');
      const categoryId = (rows as any[])[0].id;
      
      const category = await expenseCategoryService.getCategoryById(categoryId);
      
      expect(category).toBeDefined();
      expect(category?.id).toBe(categoryId);
    });
    
    it('returns null for non-existent id', async () => {
      const category = await expenseCategoryService.getCategoryById(999999);
      expect(category).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- expenseCategory.service.test.ts`

Expected: FAIL with "Cannot find module '../expenseCategory.service.js'"

- [ ] **Step 3: Implement expenseCategory.service.ts**

Create: `backend/src/modules/expenses/expenseCategory.service.ts`

```typescript
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import type { ExpenseCategory } from './expense.model.js';

class ExpenseCategoryService {
  async listCategories(includeInactive = false): Promise<ExpenseCategory[]> {
    const query = includeInactive
      ? 'SELECT * FROM expense_categories ORDER BY name'
      : 'SELECT * FROM expense_categories WHERE is_active = TRUE ORDER BY name';
    
    const [rows] = await db.query<RowDataPacket[]>(query);
    
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      is_active: Boolean(row.is_active),
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at)
    }));
  }

  async getCategoryById(id: number): Promise<ExpenseCategory | null> {
    const [rows] = await db.query<RowDataPacket[]>(
      'SELECT * FROM expense_categories WHERE id = ?',
      [id]
    );
    
    if (rows.length === 0) {
      return null;
    }
    
    const row = rows[0];
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      is_active: Boolean(row.is_active),
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at)
    };
  }

  async createCategory(name: string, description: string): Promise<ExpenseCategory> {
    const [result] = await db.query(
      'INSERT INTO expense_categories (name, description) VALUES (?, ?)',
      [name, description]
    );
    
    const insertId = (result as any).insertId;
    const category = await this.getCategoryById(insertId);
    
    if (!category) {
      throw new Error('Failed to create category');
    }
    
    return category;
  }

  async updateCategory(id: number, updates: Partial<Pick<ExpenseCategory, 'name' | 'description' | 'is_active'>>): Promise<ExpenseCategory> {
    const sets: string[] = [];
    const params: any[] = [];
    
    if (updates.name !== undefined) {
      sets.push('name = ?');
      params.push(updates.name);
    }
    if (updates.description !== undefined) {
      sets.push('description = ?');
      params.push(updates.description);
    }
    if (updates.is_active !== undefined) {
      sets.push('is_active = ?');
      params.push(updates.is_active ? 1 : 0);
    }
    
    if (sets.length === 0) {
      throw new Error('No updates provided');
    }
    
    params.push(id);
    
    await db.query(
      `UPDATE expense_categories SET ${sets.join(', ')} WHERE id = ?`,
      params
    );
    
    const category = await this.getCategoryById(id);
    
    if (!category) {
      throw new Error('Category not found after update');
    }
    
    return category;
  }

  async deleteCategory(id: number): Promise<void> {
    // Soft delete
    await db.query(
      'UPDATE expense_categories SET is_active = FALSE WHERE id = ?',
      [id]
    );
  }
}

export const expenseCategoryService = new ExpenseCategoryService();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- expenseCategory.service.test.ts`

Expected: PASS (all tests green)

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/expenses/expenseCategory.service.ts backend/src/modules/expenses/__tests__/expenseCategory.service.test.ts
git commit -m "feat(expenses): add category service with CRUD operations"
```

---

## Task 4: Expense Service - Core Logic

**Files:**
- Create: `backend/src/modules/expenses/expense.service.ts`
- Test: `backend/src/modules/expenses/__tests__/expense.service.test.ts`

- [ ] **Step 1: Write failing tests for claim creation**

Create: `backend/src/modules/expenses/__tests__/expense.service.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { expenseService } from '../expense.service.js';
import { ExpenseStatus } from '../expense.model.js';
import { db } from '../../../db/mysql.js';

describe('expenseService', () => {
  let testEmployeeId: number;
  let testProcessId: number;
  let testBranchId: number;
  let testCategoryId: number;
  let testClaimId: number;

  beforeEach(async () => {
    // Setup test data
    const [employees] = await db.query('SELECT id FROM employees LIMIT 1');
    testEmployeeId = (employees as any[])[0].id;
    
    const [processes] = await db.query('SELECT id FROM process_master LIMIT 1');
    testProcessId = (processes as any[])[0].id;
    
    const [branches] = await db.query('SELECT id FROM branch_master LIMIT 1');
    testBranchId = (branches as any[])[0].id;
    
    const [categories] = await db.query('SELECT id FROM expense_categories LIMIT 1');
    testCategoryId = (categories as any[])[0].id;
  });

  afterEach(async () => {
    // Cleanup
    if (testClaimId) {
      await db.query('DELETE FROM expense_items WHERE expense_claim_id = ?', [testClaimId]);
      await db.query('DELETE FROM expense_claims WHERE id = ?', [testClaimId]);
    }
  });

  describe('createDraftClaim', () => {
    it('creates claim with DRAFT status and auto-generated claim number', async () => {
      const claim = await expenseService.createDraftClaim(
        testEmployeeId,
        testProcessId,
        testBranchId
      );
      
      testClaimId = claim.id;
      
      expect(claim.id).toBeGreaterThan(0);
      expect(claim.claim_number).toMatch(/^EXP-\d{4}-\d{2}-\d{4}$/);
      expect(claim.status).toBe(ExpenseStatus.DRAFT);
      expect(claim.total_amount).toBe(0);
      expect(claim.employee_id).toBe(testEmployeeId);
    });
  });

  describe('addExpenseItem', () => {
    it('adds line item to claim', async () => {
      const claim = await expenseService.createDraftClaim(
        testEmployeeId,
        testProcessId,
        testBranchId
      );
      testClaimId = claim.id;
      
      const item = await expenseService.addExpenseItem(claim.id, {
        category_id: testCategoryId,
        expense_date: '2026-06-15',
        amount: 5000,
        description: 'Flight to Mumbai for client meeting',
        vendor_name: 'IndiGo Airlines'
      });
      
      expect(item.id).toBeGreaterThan(0);
      expect(item.expense_claim_id).toBe(claim.id);
      expect(item.amount).toBe(5000);
      expect(item.description).toBe('Flight to Mumbai for client meeting');
    });
  });

  describe('calculateClaimTotal', () => {
    it('sums all item amounts', async () => {
      const claim = await expenseService.createDraftClaim(
        testEmployeeId,
        testProcessId,
        testBranchId
      );
      testClaimId = claim.id;
      
      await expenseService.addExpenseItem(claim.id, {
        category_id: testCategoryId,
        expense_date: '2026-06-15',
        amount: 1000,
        description: 'Expense 1'
      });
      
      await expenseService.addExpenseItem(claim.id, {
        category_id: testCategoryId,
        expense_date: '2026-06-15',
        amount: 2500,
        description: 'Expense 2'
      });
      
      const total = await expenseService.calculateClaimTotal(claim.id);
      expect(total).toBe(3500);
    });
  });

  describe('submitClaim', () => {
    it('fails if claim has no items', async () => {
      const claim = await expenseService.createDraftClaim(
        testEmployeeId,
        testProcessId,
        testBranchId
      );
      testClaimId = claim.id;
      
      await expect(expenseService.submitClaim(claim.id))
        .rejects.toThrow('Claim must have at least one expense item');
    });
    
    it('fails if any item missing receipt', async () => {
      const claim = await expenseService.createDraftClaim(
        testEmployeeId,
        testProcessId,
        testBranchId
      );
      testClaimId = claim.id;
      
      await expenseService.addExpenseItem(claim.id, {
        category_id: testCategoryId,
        expense_date: '2026-06-15',
        amount: 1000,
        description: 'Test expense'
      });
      
      await expect(expenseService.submitClaim(claim.id))
        .rejects.toThrow('All expense items must have receipts');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- expense.service.test.ts`

Expected: FAIL with "Cannot find module '../expense.service.js'"

- [ ] **Step 3: Implement expense.service.ts (Part 1: Basic operations)**

Create: `backend/src/modules/expenses/expense.service.ts`

```typescript
import { db } from '../../db/mysql.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import {
  ExpenseStatus,
  type ExpenseClaim,
  type ExpenseItem,
  type AddExpenseItemDto,
  type ExpenseClaimWithDetails
} from './expense.model.js';

class ExpenseService {
  /**
   * Generate unique claim number: EXP-YYYY-MM-NNNN
   */
  private async generateClaimNumber(): Promise<string> {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const prefix = `EXP-${year}-${month}`;
    
    // Get highest number for this month
    const [rows] = await db.query<RowDataPacket[]>(
      "SELECT claim_number FROM expense_claims WHERE claim_number LIKE ? ORDER BY claim_number DESC LIMIT 1",
      [`${prefix}%`]
    );
    
    let sequence = 1;
    if (rows.length > 0) {
      const lastNumber = rows[0].claim_number.split('-')[3];
      sequence = parseInt(lastNumber, 10) + 1;
    }
    
    return `${prefix}-${String(sequence).padStart(4, '0')}`;
  }

  async createDraftClaim(
    employeeId: number,
    processId: number,
    branchId: number
  ): Promise<ExpenseClaim> {
    const claimNumber = await this.generateClaimNumber();
    
    const [result] = await db.query<ResultSetHeader>(
      `INSERT INTO expense_claims 
       (claim_number, employee_id, process_id, branch_id, status, total_amount) 
       VALUES (?, ?, ?, ?, ?, 0)`,
      [claimNumber, employeeId, processId, branchId, ExpenseStatus.DRAFT]
    );
    
    const claim = await this.getClaimById(result.insertId);
    
    if (!claim) {
      throw new Error('Failed to create claim');
    }
    
    return claim;
  }

  async getClaimById(id: number): Promise<ExpenseClaim | null> {
    const [rows] = await db.query<RowDataPacket[]>(
      'SELECT * FROM expense_claims WHERE id = ?',
      [id]
    );
    
    if (rows.length === 0) {
      return null;
    }
    
    return this.mapRowToClaim(rows[0]);
  }

  async getClaimWithDetails(id: number): Promise<ExpenseClaimWithDetails | null> {
    const claim = await this.getClaimById(id);
    if (!claim) {
      return null;
    }
    
    const items = await this.getClaimItems(id);
    
    const [approvalRows] = await db.query<RowDataPacket[]>(
      'SELECT * FROM expense_approvals WHERE expense_claim_id = ? ORDER BY action_date DESC',
      [id]
    );
    
    const [paymentRows] = await db.query<RowDataPacket[]>(
      'SELECT * FROM expense_payments WHERE expense_claim_id = ?',
      [id]
    );
    
    return {
      ...claim,
      items,
      approvals: approvalRows.map(r => ({
        id: r.id,
        expense_claim_id: r.expense_claim_id,
        approver_id: r.approver_id,
        approval_type: r.approval_type,
        action: r.action,
        comments: r.comments,
        action_date: new Date(r.action_date)
      })),
      payment: paymentRows.length > 0 ? {
        id: paymentRows[0].id,
        expense_claim_id: paymentRows[0].expense_claim_id,
        payment_reference: paymentRows[0].payment_reference,
        payment_date: new Date(paymentRows[0].payment_date),
        payment_method: paymentRows[0].payment_method,
        processed_by: paymentRows[0].processed_by,
        created_at: new Date(paymentRows[0].created_at)
      } : undefined
    };
  }

  async addExpenseItem(
    claimId: number,
    itemData: AddExpenseItemDto
  ): Promise<ExpenseItem> {
    const claim = await this.getClaimById(claimId);
    if (!claim) {
      throw new Error('Claim not found');
    }
    
    if (claim.status !== ExpenseStatus.DRAFT) {
      throw new Error('Can only add items to draft claims');
    }
    
    const [result] = await db.query<ResultSetHeader>(
      `INSERT INTO expense_items 
       (expense_claim_id, category_id, expense_date, amount, description, vendor_name) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        claimId,
        itemData.category_id,
        itemData.expense_date,
        itemData.amount,
        itemData.description,
        itemData.vendor_name || null
      ]
    );
    
    const [rows] = await db.query<RowDataPacket[]>(
      'SELECT * FROM expense_items WHERE id = ?',
      [result.insertId]
    );
    
    return this.mapRowToItem(rows[0]);
  }

  async getClaimItems(claimId: number): Promise<ExpenseItem[]> {
    const [rows] = await db.query<RowDataPacket[]>(
      'SELECT * FROM expense_items WHERE expense_claim_id = ? ORDER BY expense_date DESC',
      [claimId]
    );
    
    return rows.map(r => this.mapRowToItem(r));
  }

  async updateItemReceipt(itemId: number, receiptPath: string): Promise<void> {
    await db.query(
      'UPDATE expense_items SET receipt_file_path = ? WHERE id = ?',
      [receiptPath, itemId]
    );
  }

  async calculateClaimTotal(claimId: number): Promise<number> {
    const [rows] = await db.query<RowDataPacket[]>(
      'SELECT SUM(amount) as total FROM expense_items WHERE expense_claim_id = ?',
      [claimId]
    );
    
    return rows[0].total || 0;
  }

  async submitClaim(claimId: number): Promise<ExpenseClaim> {
    const claim = await this.getClaimById(claimId);
    if (!claim) {
      throw new Error('Claim not found');
    }
    
    if (claim.status !== ExpenseStatus.DRAFT) {
      throw new Error('Can only submit draft claims');
    }
    
    const items = await this.getClaimItems(claimId);
    if (items.length === 0) {
      throw new Error('Claim must have at least one expense item');
    }
    
    const itemsWithoutReceipts = items.filter(item => !item.receipt_file_path);
    if (itemsWithoutReceipts.length > 0) {
      throw new Error('All expense items must have receipts');
    }
    
    const total = await this.calculateClaimTotal(claimId);
    
    await db.query(
      `UPDATE expense_claims 
       SET status = ?, total_amount = ?, submitted_date = NOW() 
       WHERE id = ?`,
      [ExpenseStatus.SUBMITTED, total, claimId]
    );
    
    const updatedClaim = await this.getClaimById(claimId);
    
    if (!updatedClaim) {
      throw new Error('Failed to submit claim');
    }
    
    return updatedClaim;
  }

  async getEmployeeClaims(
    employeeId: number,
    status?: ExpenseStatus,
    page = 1,
    limit = 20
  ): Promise<{ claims: ExpenseClaim[]; total: number }> {
    const offset = (page - 1) * limit;
    
    let query = 'SELECT * FROM expense_claims WHERE employee_id = ?';
    const params: any[] = [employeeId];
    
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    
    const [rows] = await db.query<RowDataPacket[]>(query, params);
    
    const countQuery = status
      ? 'SELECT COUNT(*) as total FROM expense_claims WHERE employee_id = ? AND status = ?'
      : 'SELECT COUNT(*) as total FROM expense_claims WHERE employee_id = ?';
    
    const countParams = status ? [employeeId, status] : [employeeId];
    const [countRows] = await db.query<RowDataPacket[]>(countQuery, countParams);
    
    return {
      claims: rows.map(r => this.mapRowToClaim(r)),
      total: countRows[0].total
    };
  }

  async deleteExpenseItem(itemId: number): Promise<void> {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT ec.status FROM expense_items ei 
       JOIN expense_claims ec ON ei.expense_claim_id = ec.id 
       WHERE ei.id = ?`,
      [itemId]
    );
    
    if (rows.length === 0) {
      throw new Error('Expense item not found');
    }
    
    if (rows[0].status !== ExpenseStatus.DRAFT) {
      throw new Error('Can only delete items from draft claims');
    }
    
    await db.query('DELETE FROM expense_items WHERE id = ?', [itemId]);
  }

  private mapRowToClaim(row: any): ExpenseClaim {
    return {
      id: row.id,
      claim_number: row.claim_number,
      employee_id: row.employee_id,
      process_id: row.process_id,
      branch_id: row.branch_id,
      total_amount: parseFloat(row.total_amount),
      currency: row.currency,
      status: row.status as ExpenseStatus,
      submitted_date: row.submitted_date ? new Date(row.submitted_date) : undefined,
      manager_approved_date: row.manager_approved_date ? new Date(row.manager_approved_date) : undefined,
      finance_approved_date: row.finance_approved_date ? new Date(row.finance_approved_date) : undefined,
      paid_date: row.paid_date ? new Date(row.paid_date) : undefined,
      rejection_reason: row.rejection_reason,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at)
    };
  }

  private mapRowToItem(row: any): ExpenseItem {
    return {
      id: row.id,
      expense_claim_id: row.expense_claim_id,
      category_id: row.category_id,
      expense_date: new Date(row.expense_date),
      amount: parseFloat(row.amount),
      description: row.description,
      vendor_name: row.vendor_name,
      receipt_file_path: row.receipt_file_path,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at)
    };
  }
}

export const expenseService = new ExpenseService();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npm test -- expense.service.test.ts`

Expected: PASS (all tests green)

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/expenses/expense.service.ts backend/src/modules/expenses/__tests__/expense.service.test.ts
git commit -m "feat(expenses): add core expense service with claim management"
```

---

## Task 5: Expense Approval Service

**Files:**
- Create: `backend/src/modules/expenses/expenseApproval.service.ts`
- Test: `backend/src/modules/expenses/__tests__/expenseApproval.service.test.ts`

- [ ] **Step 1: Write failing tests for approval workflow**

Create: `backend/src/modules/expenses/__tests__/expenseApproval.service.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { expenseApprovalService } from '../expenseApproval.service.js';
import { expenseService } from '../expense.service.js';
import { ExpenseStatus, ApprovalType, ApprovalAction } from '../expense.model.js';
import { db } from '../../../db/mysql.js';

describe('expenseApprovalService', () => {
  let testEmployeeId: number;
  let testManagerId: number;
  let testProcessId: number;
  let testBranchId: number;
  let testCategoryId: number;
  let testClaimId: number;

  beforeEach(async () => {
    // Setup test data - find a manager and their direct report
    const [managers] = await db.query(
      `SELECT e1.id as manager_id, e2.id as employee_id, e1.process_id 
       FROM employees e1 
       JOIN employees e2 ON e2.reporting_manager_id = e1.id 
       LIMIT 1`
    );
    
    if ((managers as any[]).length === 0) {
      throw new Error('Test requires manager-employee relationship in database');
    }
    
    testManagerId = (managers as any[])[0].manager_id;
    testEmployeeId = (managers as any[])[0].employee_id;
    testProcessId = (managers as any[])[0].process_id;
    
    const [branches] = await db.query('SELECT id FROM branch_master LIMIT 1');
    testBranchId = (branches as any[])[0].id;
    
    const [categories] = await db.query('SELECT id FROM expense_categories LIMIT 1');
    testCategoryId = (categories as any[])[0].id;
  });

  afterEach(async () => {
    if (testClaimId) {
      await db.query('DELETE FROM expense_approvals WHERE expense_claim_id = ?', [testClaimId]);
      await db.query('DELETE FROM expense_items WHERE expense_claim_id = ?', [testClaimId]);
      await db.query('DELETE FROM expense_claims WHERE id = ?', [testClaimId]);
    }
  });

  describe('getManagerPendingClaims', () => {
    it('returns claims from direct reports in SUBMITTED status', async () => {
      // Create and submit a claim
      const claim = await expenseService.createDraftClaim(
        testEmployeeId,
        testProcessId,
        testBranchId
      );
      testClaimId = claim.id;
      
      await expenseService.addExpenseItem(claim.id, {
        category_id: testCategoryId,
        expense_date: '2026-06-15',
        amount: 1000,
        description: 'Test expense'
      });
      
      // Add receipt path
      const items = await expenseService.getClaimItems(claim.id);
      await expenseService.updateItemReceipt(items[0].id, '/receipts/test.jpg');
      
      await expenseService.submitClaim(claim.id);
      
      const pendingClaims = await expenseApprovalService.getManagerPendingClaims(
        testManagerId,
        testProcessId
      );
      
      expect(pendingClaims.length).toBeGreaterThan(0);
      const ourClaim = pendingClaims.find(c => c.id === claim.id);
      expect(ourClaim).toBeDefined();
      expect(ourClaim?.status).toBe(ExpenseStatus.SUBMITTED);
    });
  });

  describe('managerApprove', () => {
    it('transitions claim from SUBMITTED to MANAGER_APPROVED', async () => {
      // Create and submit a claim
      const claim = await expenseService.createDraftClaim(
        testEmployeeId,
        testProcessId,
        testBranchId
      );
      testClaimId = claim.id;
      
      await expenseService.addExpenseItem(claim.id, {
        category_id: testCategoryId,
        expense_date: '2026-06-15',
        amount: 1000,
        description: 'Test expense'
      });
      
      const items = await expenseService.getClaimItems(claim.id);
      await expenseService.updateItemReceipt(items[0].id, '/receipts/test.jpg');
      await expenseService.submitClaim(claim.id);
      
      const approvedClaim = await expenseApprovalService.managerApprove(
        claim.id,
        testManagerId,
        { comments: 'Looks good' }
      );
      
      expect(approvedClaim.status).toBe(ExpenseStatus.MANAGER_APPROVED);
      expect(approvedClaim.manager_approved_date).toBeDefined();
      
      // Verify approval record created
      const [approvals] = await db.query(
        'SELECT * FROM expense_approvals WHERE expense_claim_id = ? AND approver_id = ?',
        [claim.id, testManagerId]
      );
      
      expect((approvals as any[]).length).toBe(1);
      expect((approvals as any[])[0].approval_type).toBe(ApprovalType.MANAGER);
      expect((approvals as any[])[0].action).toBe(ApprovalAction.APPROVED);
    });
    
    it('fails if manager is not direct manager', async () => {
      const claim = await expenseService.createDraftClaim(
        testEmployeeId,
        testProcessId,
        testBranchId
      );
      testClaimId = claim.id;
      
      await expenseService.addExpenseItem(claim.id, {
        category_id: testCategoryId,
        expense_date: '2026-06-15',
        amount: 1000,
        description: 'Test'
      });
      
      const items = await expenseService.getClaimItems(claim.id);
      await expenseService.updateItemReceipt(items[0].id, '/receipts/test.jpg');
      await expenseService.submitClaim(claim.id);
      
      // Try to approve with wrong manager
      const wrongManagerId = testManagerId + 999;
      
      await expect(
        expenseApprovalService.managerApprove(claim.id, wrongManagerId, {})
      ).rejects.toThrow('Not authorized to approve this claim');
    });
  });

  describe('rejectClaim', () => {
    it('rejects claim with reason', async () => {
      const claim = await expenseService.createDraftClaim(
        testEmployeeId,
        testProcessId,
        testBranchId
      );
      testClaimId = claim.id;
      
      await expenseService.addExpenseItem(claim.id, {
        category_id: testCategoryId,
        expense_date: '2026-06-15',
        amount: 1000,
        description: 'Test'
      });
      
      const items = await expenseService.getClaimItems(claim.id);
      await expenseService.updateItemReceipt(items[0].id, '/receipts/test.jpg');
      await expenseService.submitClaim(claim.id);
      
      const rejectedClaim = await expenseApprovalService.rejectClaim(
        claim.id,
        testManagerId,
        { rejection_reason: 'Missing itemized receipt' }
      );
      
      expect(rejectedClaim.status).toBe(ExpenseStatus.REJECTED);
      expect(rejectedClaim.rejection_reason).toBe('Missing itemized receipt');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- expenseApproval.service.test.ts`

Expected: FAIL with "Cannot find module '../expenseApproval.service.js'"

- [ ] **Step 3: Implement expenseApproval.service.ts**

Create: `backend/src/modules/expenses/expenseApproval.service.ts`

```typescript
import { db } from '../../db/mysql.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import {
  ExpenseStatus,
  ApprovalType,
  ApprovalAction,
  type ExpenseClaim,
  type ApproveClaimDto,
  type RejectClaimDto,
  type MarkPaidDto
} from './expense.model.js';
import { expenseService } from './expense.service.js';

class ExpenseApprovalService {
  /**
   * Get claims pending manager approval for a specific manager
   */
  async getManagerPendingClaims(
    managerId: number,
    processId: number
  ): Promise<ExpenseClaim[]> {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT ec.* FROM expense_claims ec
       JOIN employees e ON ec.employee_id = e.id
       WHERE e.reporting_manager_id = ?
         AND e.process_id = ?
         AND ec.status = ?
       ORDER BY ec.submitted_date ASC`,
      [managerId, processId, ExpenseStatus.SUBMITTED]
    );
    
    return rows.map(r => this.mapRowToClaim(r));
  }

  /**
   * Manager approves a claim
   */
  async managerApprove(
    claimId: number,
    managerId: number,
    dto: ApproveClaimDto
  ): Promise<ExpenseClaim> {
    // Verify manager authorization
    await this.verifyManagerAccess(claimId, managerId);
    
    const claim = await expenseService.getClaimById(claimId);
    if (!claim) {
      throw new Error('Claim not found');
    }
    
    if (claim.status !== ExpenseStatus.SUBMITTED) {
      throw new Error('Can only approve submitted claims');
    }
    
    // Update claim status
    await db.query(
      `UPDATE expense_claims 
       SET status = ?, manager_approved_date = NOW() 
       WHERE id = ?`,
      [ExpenseStatus.MANAGER_APPROVED, claimId]
    );
    
    // Record approval
    await db.query(
      `INSERT INTO expense_approvals 
       (expense_claim_id, approver_id, approval_type, action, comments) 
       VALUES (?, ?, ?, ?, ?)`,
      [claimId, managerId, ApprovalType.MANAGER, ApprovalAction.APPROVED, dto.comments || null]
    );
    
    const updatedClaim = await expenseService.getClaimById(claimId);
    if (!updatedClaim) {
      throw new Error('Failed to approve claim');
    }
    
    return updatedClaim;
  }

  /**
   * Reject a claim (manager or finance)
   */
  async rejectClaim(
    claimId: number,
    approverId: number,
    dto: RejectClaimDto
  ): Promise<ExpenseClaim> {
    const claim = await expenseService.getClaimById(claimId);
    if (!claim) {
      throw new Error('Claim not found');
    }
    
    if (![ExpenseStatus.SUBMITTED, ExpenseStatus.MANAGER_APPROVED].includes(claim.status)) {
      throw new Error('Can only reject submitted or manager-approved claims');
    }
    
    // Determine approval type based on current status
    const approvalType = claim.status === ExpenseStatus.SUBMITTED
      ? ApprovalType.MANAGER
      : ApprovalType.FINANCE;
    
    // Verify authorization
    if (approvalType === ApprovalType.MANAGER) {
      await this.verifyManagerAccess(claimId, approverId);
    }
    
    // Update claim status
    await db.query(
      `UPDATE expense_claims 
       SET status = ?, rejection_reason = ? 
       WHERE id = ?`,
      [ExpenseStatus.REJECTED, dto.rejection_reason, claimId]
    );
    
    // Record rejection
    await db.query(
      `INSERT INTO expense_approvals 
       (expense_claim_id, approver_id, approval_type, action, comments) 
       VALUES (?, ?, ?, ?, ?)`,
      [claimId, approverId, approvalType, ApprovalAction.REJECTED, dto.rejection_reason]
    );
    
    const updatedClaim = await expenseService.getClaimById(claimId);
    if (!updatedClaim) {
      throw new Error('Failed to reject claim');
    }
    
    return updatedClaim;
  }

  /**
   * Get claims in finance queue
   */
  async getFinanceQueue(
    processId: number,
    status: ExpenseStatus = ExpenseStatus.MANAGER_APPROVED,
    page = 1,
    limit = 20
  ): Promise<{ claims: ExpenseClaim[]; total: number }> {
    const offset = (page - 1) * limit;
    
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT * FROM expense_claims 
       WHERE process_id = ? AND status = ?
       ORDER BY manager_approved_date ASC
       LIMIT ? OFFSET ?`,
      [processId, status, limit, offset]
    );
    
    const [countRows] = await db.query<RowDataPacket[]>(
      'SELECT COUNT(*) as total FROM expense_claims WHERE process_id = ? AND status = ?',
      [processId, status]
    );
    
    return {
      claims: rows.map(r => this.mapRowToClaim(r)),
      total: countRows[0].total
    };
  }

  /**
   * Finance approves claim for payment
   */
  async financeApprove(
    claimId: number,
    financeUserId: number,
    dto: ApproveClaimDto
  ): Promise<ExpenseClaim> {
    const claim = await expenseService.getClaimById(claimId);
    if (!claim) {
      throw new Error('Claim not found');
    }
    
    if (claim.status !== ExpenseStatus.MANAGER_APPROVED) {
      throw new Error('Can only finance-approve manager-approved claims');
    }
    
    await db.query(
      `UPDATE expense_claims 
       SET status = ?, finance_approved_date = NOW() 
       WHERE id = ?`,
      [ExpenseStatus.FINANCE_APPROVED, claimId]
    );
    
    await db.query(
      `INSERT INTO expense_approvals 
       (expense_claim_id, approver_id, approval_type, action, comments) 
       VALUES (?, ?, ?, ?, ?)`,
      [claimId, financeUserId, ApprovalType.FINANCE, ApprovalAction.APPROVED, dto.comments || null]
    );
    
    const updatedClaim = await expenseService.getClaimById(claimId);
    if (!updatedClaim) {
      throw new Error('Failed to finance-approve claim');
    }
    
    return updatedClaim;
  }

  /**
   * Mark claim as paid
   */
  async markAsPaid(
    claimId: number,
    financeUserId: number,
    dto: MarkPaidDto
  ): Promise<ExpenseClaim> {
    const claim = await expenseService.getClaimById(claimId);
    if (!claim) {
      throw new Error('Claim not found');
    }
    
    if (claim.status !== ExpenseStatus.FINANCE_APPROVED) {
      throw new Error('Can only mark finance-approved claims as paid');
    }
    
    await db.query(
      `UPDATE expense_claims 
       SET status = ?, paid_date = NOW() 
       WHERE id = ?`,
      [ExpenseStatus.PAID, claimId]
    );
    
    await db.query(
      `INSERT INTO expense_payments 
       (expense_claim_id, payment_reference, payment_date, payment_method, processed_by) 
       VALUES (?, ?, ?, ?, ?)`,
      [claimId, dto.payment_reference, dto.payment_date, dto.payment_method, financeUserId]
    );
    
    const updatedClaim = await expenseService.getClaimById(claimId);
    if (!updatedClaim) {
      throw new Error('Failed to mark claim as paid');
    }
    
    return updatedClaim;
  }

  /**
   * Verify manager has access to approve this claim
   */
  private async verifyManagerAccess(claimId: number, managerId: number): Promise<void> {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT e.reporting_manager_id, e.process_id, ec.process_id as claim_process_id
       FROM expense_claims ec
       JOIN employees e ON ec.employee_id = e.id
       WHERE ec.id = ?`,
      [claimId]
    );
    
    if (rows.length === 0) {
      throw new Error('Claim not found');
    }
    
    const row = rows[0];
    
    if (row.reporting_manager_id !== managerId) {
      throw new Error('Not authorized to approve this claim');
    }
    
    if (row.process_id !== row.claim_process_id) {
      throw new Error('Process access denied');
    }
  }

  private mapRowToClaim(row: any): ExpenseClaim {
    return {
      id: row.id,
      claim_number: row.claim_number,
      employee_id: row.employee_id,
      process_id: row.process_id,
      branch_id: row.branch_id,
      total_amount: parseFloat(row.total_amount),
      currency: row.currency,
      status: row.status as ExpenseStatus,
      submitted_date: row.submitted_date ? new Date(row.submitted_date) : undefined,
      manager_approved_date: row.manager_approved_date ? new Date(row.manager_approved_date) : undefined,
      finance_approved_date: row.finance_approved_date ? new Date(row.finance_approved_date) : undefined,
      paid_date: row.paid_date ? new Date(row.paid_date) : undefined,
      rejection_reason: row.rejection_reason,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at)
    };
  }
}

export const expenseApprovalService = new ExpenseApprovalService();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npm test -- expenseApproval.service.test.ts`

Expected: PASS (all tests green)

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/expenses/expenseApproval.service.ts backend/src/modules/expenses/__tests__/expenseApproval.service.test.ts
git commit -m "feat(expenses): add approval service with manager and finance workflows"
```

---

## Task 6: Expense Report Service

**Files:**
- Create: `backend/src/modules/expenses/expenseReport.service.ts`

- [ ] **Step 1: Implement expenseReport.service.ts**

Create: `backend/src/modules/expenses/expenseReport.service.ts`

```typescript
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import { ExpenseStatus, type ExpenseReportQuery } from './expense.model.js';

class ExpenseReportService {
  /**
   * Get expense summary with aggregations
   */
  async getExpenseSummary(query: ExpenseReportQuery) {
    const { process_id, branch_id, start_date, end_date, group_by } = query;
    
    const params: any[] = [];
    let whereConditions: string[] = [];
    
    if (process_id) {
      whereConditions.push('ec.process_id = ?');
      params.push(process_id);
    }
    
    if (branch_id) {
      whereConditions.push('ec.branch_id = ?');
      params.push(branch_id);
    }
    
    if (start_date) {
      whereConditions.push('ec.created_at >= ?');
      params.push(start_date);
    }
    
    if (end_date) {
      whereConditions.push('ec.created_at <= ?');
      params.push(end_date);
    }
    
    const whereClause = whereConditions.length > 0
      ? `WHERE ${whereConditions.join(' AND ')}`
      : '';
    
    // Get totals
    const [totalRows] = await db.query<RowDataPacket[]>(
      `SELECT 
         COUNT(*) as claim_count,
         SUM(total_amount) as total_amount,
         AVG(total_amount) as avg_claim_amount
       FROM expense_claims ec
       ${whereClause}`,
      params
    );
    
    const totals = totalRows[0];
    
    // Get by category
    const [categoryRows] = await db.query<RowDataPacket[]>(
      `SELECT 
         cat.name as category,
         SUM(ei.amount) as amount,
         COUNT(ei.id) as count
       FROM expense_items ei
       JOIN expense_categories cat ON ei.category_id = cat.id
       JOIN expense_claims ec ON ei.expense_claim_id = ec.id
       ${whereClause}
       GROUP BY cat.id, cat.name
       ORDER BY amount DESC`,
      params
    );
    
    // Get by status
    const [statusRows] = await db.query<RowDataPacket[]>(
      `SELECT 
         status,
         COUNT(*) as count
       FROM expense_claims ec
       ${whereClause}
       GROUP BY status`,
      params
    );
    
    return {
      total_amount: parseFloat(totals.total_amount) || 0,
      claim_count: totals.claim_count,
      avg_claim_amount: parseFloat(totals.avg_claim_amount) || 0,
      by_category: categoryRows.map(r => ({
        category: r.category,
        amount: parseFloat(r.amount),
        count: r.count
      })),
      by_status: statusRows.map(r => ({
        status: r.status,
        count: r.count
      }))
    };
  }

  /**
   * Export claims for payment (CSV format data)
   */
  async exportForPayment(
    status: ExpenseStatus,
    processId?: number,
    startDate?: string,
    endDate?: string
  ) {
    const params: any[] = [status];
    const whereConditions = ['ec.status = ?'];
    
    if (processId) {
      whereConditions.push('ec.process_id = ?');
      params.push(processId);
    }
    
    if (startDate) {
      whereConditions.push('ec.submitted_date >= ?');
      params.push(startDate);
    }
    
    if (endDate) {
      whereConditions.push('ec.submitted_date <= ?');
      params.push(endDate);
    }
    
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT 
         e.name as employee_name,
         e.employee_code,
         ebd.bank_name,
         ebd.account_number,
         ebd.ifsc_code,
         ec.total_amount as amount,
         ec.claim_number,
         ec.submitted_date as expense_date
       FROM expense_claims ec
       JOIN employees e ON ec.employee_id = e.id
       LEFT JOIN employee_bank_detail ebd ON e.id = ebd.employee_id
       WHERE ${whereConditions.join(' AND ')}
       ORDER BY ec.submitted_date ASC`,
      params
    );
    
    return rows.map(r => ({
      employee_name: r.employee_name,
      employee_code: r.employee_code,
      bank_name: r.bank_name || 'N/A',
      account_number: r.account_number || 'N/A',
      ifsc_code: r.ifsc_code || 'N/A',
      amount: parseFloat(r.amount),
      claim_number: r.claim_number,
      expense_date: r.expense_date
    }));
  }

  /**
   * Get monthly expense trends
   */
  async getMonthlyTrends(processId: number, months = 6) {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT 
         DATE_FORMAT(created_at, '%Y-%m') as month,
         COUNT(*) as claim_count,
         SUM(total_amount) as total_amount
       FROM expense_claims
       WHERE process_id = ?
         AND created_at >= DATE_SUB(NOW(), INTERVAL ? MONTH)
       GROUP BY DATE_FORMAT(created_at, '%Y-%m')
       ORDER BY month ASC`,
      [processId, months]
    );
    
    return rows.map(r => ({
      month: r.month,
      claim_count: r.claim_count,
      total_amount: parseFloat(r.total_amount)
    }));
  }

  /**
   * Get top spenders
   */
  async getTopSpenders(processId: number, limit = 10) {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT 
         e.name as employee_name,
         e.employee_code,
         COUNT(ec.id) as claim_count,
         SUM(ec.total_amount) as total_amount
       FROM employees e
       JOIN expense_claims ec ON e.id = ec.employee_id
       WHERE ec.process_id = ?
         AND ec.status NOT IN (?, ?)
       GROUP BY e.id, e.name, e.employee_code
       ORDER BY total_amount DESC
       LIMIT ?`,
      [processId, ExpenseStatus.DRAFT, ExpenseStatus.REJECTED, limit]
    );
    
    return rows.map(r => ({
      employee_name: r.employee_name,
      employee_code: r.employee_code,
      claim_count: r.claim_count,
      total_amount: parseFloat(r.total_amount)
    }));
  }
}

export const expenseReportService = new ExpenseReportService();
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/modules/expenses/expenseReport.service.ts
git commit -m "feat(expenses): add reporting service for analytics and exports"
```

---

## Task 7: Expense Controller & Routes

**Files:**
- Create: `backend/src/modules/expenses/expense.controller.ts`
- Create: `backend/src/modules/expenses/expense.routes.ts`

- [ ] **Step 1: Implement expense.controller.ts**

Create: `backend/src/modules/expenses/expense.controller.ts`

```typescript
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { expenseService } from './expense.service.js';
import { expenseCategoryService } from './expenseCategory.service.js';
import { expenseApprovalService } from './expenseApproval.service.js';
import { expenseReportService } from './expenseReport.service.js';
import { getEmployeeForUser } from '../../shared/accessGuard.js';
import type {
  CreateExpenseClaimDto,
  AddExpenseItemDto,
  ApproveClaimDto,
  RejectClaimDto,
  MarkPaidDto,
  ExpenseReportQuery
} from './expense.model.js';

class ExpenseController {
  // Categories
  async listCategories(req: AuthenticatedRequest, res: Response) {
    const includeInactive = req.query.includeInactive === 'true';
    const categories = await expenseCategoryService.listCategories(includeInactive);
    res.json({ categories });
  }

  async createCategory(req: AuthenticatedRequest, res: Response) {
    const { name, description } = req.body;
    const category = await expenseCategoryService.createCategory(name, description);
    res.status(201).json({ category });
  }

  async updateCategory(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    const updates = req.body;
    const category = await expenseCategoryService.updateCategory(parseInt(id), updates);
    res.json({ category });
  }

  async deleteCategory(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    await expenseCategoryService.deleteCategory(parseInt(id));
    res.json({ success: true });
  }

  // Claims - Employee
  async createClaim(req: AuthenticatedRequest, res: Response) {
    const employee = await getEmployeeForUser(req.user!.id);
    const { process_id, branch_id } = req.body as CreateExpenseClaimDto;
    
    const claim = await expenseService.createDraftClaim(
      employee.id,
      process_id || employee.process_id,
      branch_id || employee.branch_id
    );
    
    res.status(201).json({ claim });
  }

  async addClaimItem(req: AuthenticatedRequest, res: Response) {
    const { claimId } = req.params;
    const itemData = req.body as AddExpenseItemDto;
    
    const item = await expenseService.addExpenseItem(parseInt(claimId), itemData);
    
    res.status(201).json({ item });
  }

  async deleteClaimItem(req: AuthenticatedRequest, res: Response) {
    const { itemId } = req.params;
    await expenseService.deleteExpenseItem(parseInt(itemId));
    res.json({ success: true });
  }

  async uploadReceipt(req: AuthenticatedRequest, res: Response) {
    const { claimId, itemId } = req.params;
    
    // File upload handling will be added in frontend integration task
    // For now, accept receipt path from body
    const { receipt_path } = req.body;
    
    await expenseService.updateItemReceipt(parseInt(itemId), receipt_path);
    
    res.json({ success: true, receipt_path });
  }

  async submitClaim(req: AuthenticatedRequest, res: Response) {
    const { claimId } = req.params;
    const claim = await expenseService.submitClaim(parseInt(claimId));
    res.json({ claim });
  }

  async getMyClaims(req: AuthenticatedRequest, res: Response) {
    const employee = await getEmployeeForUser(req.user!.id);
    const status = req.query.status as string | undefined;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    
    const result = await expenseService.getEmployeeClaims(
      employee.id,
      status as any,
      page,
      limit
    );
    
    res.json(result);
  }

  async getClaimDetails(req: AuthenticatedRequest, res: Response) {
    const { claimId } = req.params;
    const claim = await expenseService.getClaimWithDetails(parseInt(claimId));
    
    if (!claim) {
      res.status(404).json({ error: 'Claim not found' });
      return;
    }
    
    res.json({ claim });
  }

  // Manager Approvals
  async getPendingApprovals(req: AuthenticatedRequest, res: Response) {
    const employee = await getEmployeeForUser(req.user!.id);
    const claims = await expenseApprovalService.getManagerPendingClaims(
      employee.id,
      employee.process_id
    );
    res.json({ claims });
  }

  async managerApprove(req: AuthenticatedRequest, res: Response) {
    const { claimId } = req.params;
    const employee = await getEmployeeForUser(req.user!.id);
    const dto = req.body as ApproveClaimDto;
    
    const claim = await expenseApprovalService.managerApprove(
      parseInt(claimId),
      employee.id,
      dto
    );
    
    res.json({ claim });
  }

  async rejectClaim(req: AuthenticatedRequest, res: Response) {
    const { claimId } = req.params;
    const employee = await getEmployeeForUser(req.user!.id);
    const dto = req.body as RejectClaimDto;
    
    const claim = await expenseApprovalService.rejectClaim(
      parseInt(claimId),
      employee.id,
      dto
    );
    
    res.json({ claim });
  }

  // Finance
  async getFinanceQueue(req: AuthenticatedRequest, res: Response) {
    const employee = await getEmployeeForUser(req.user!.id);
    const status = req.query.status as string;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    
    const result = await expenseApprovalService.getFinanceQueue(
      employee.process_id,
      status as any,
      page,
      limit
    );
    
    res.json(result);
  }

  async financeApprove(req: AuthenticatedRequest, res: Response) {
    const { claimId } = req.params;
    const employee = await getEmployeeForUser(req.user!.id);
    const dto = req.body as ApproveClaimDto;
    
    const claim = await expenseApprovalService.financeApprove(
      parseInt(claimId),
      employee.id,
      dto
    );
    
    res.json({ claim });
  }

  async markAsPaid(req: AuthenticatedRequest, res: Response) {
    const { claimId } = req.params;
    const employee = await getEmployeeForUser(req.user!.id);
    const dto = req.body as MarkPaidDto;
    
    const claim = await expenseApprovalService.markAsPaid(
      parseInt(claimId),
      employee.id,
      dto
    );
    
    res.json({ claim });
  }

  async exportForPayment(req: AuthenticatedRequest, res: Response) {
    const { status, process_id, start_date, end_date } = req.query;
    
    const data = await expenseReportService.exportForPayment(
      status as any,
      process_id ? parseInt(process_id as string) : undefined,
      start_date as string,
      end_date as string
    );
    
    // Convert to CSV
    const headers = Object.keys(data[0] || {});
    const csvRows = [
      headers.join(','),
      ...data.map(row => headers.map(h => row[h]).join(','))
    ];
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=expense-payment-export.csv');
    res.send(csvRows.join('\n'));
  }

  // Reports
  async getExpenseSummary(req: AuthenticatedRequest, res: Response) {
    const query = req.query as ExpenseReportQuery;
    const summary = await expenseReportService.getExpenseSummary(query);
    res.json(summary);
  }

  async getMonthlyTrends(req: AuthenticatedRequest, res: Response) {
    const employee = await getEmployeeForUser(req.user!.id);
    const months = parseInt(req.query.months as string) || 6;
    const trends = await expenseReportService.getMonthlyTrends(employee.process_id, months);
    res.json({ trends });
  }

  async getTopSpenders(req: AuthenticatedRequest, res: Response) {
    const employee = await getEmployeeForUser(req.user!.id);
    const limit = parseInt(req.query.limit as string) || 10;
    const spenders = await expenseReportService.getTopSpenders(employee.process_id, limit);
    res.json({ spenders });
  }
}

export const expenseController = new ExpenseController();
```

- [ ] **Step 2: Implement expense.routes.ts**

Create: `backend/src/modules/expenses/expense.routes.ts`

```typescript
import { Router } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { expenseController } from './expense.controller.js';

export const expenseRouter = Router();
expenseRouter.use(requireAuth);

// Helper to wrap async handlers
const h = (fn: any) => (req: any, res: any, next: any) => fn(req, res).catch(next);

// Categories (Admin only for write operations)
expenseRouter.get('/categories', h(expenseController.listCategories.bind(expenseController)));
expenseRouter.post('/categories', requireRole('admin', 'hr'), h(expenseController.createCategory.bind(expenseController)));
expenseRouter.put('/categories/:id', requireRole('admin', 'hr'), h(expenseController.updateCategory.bind(expenseController)));
expenseRouter.delete('/categories/:id', requireRole('admin', 'hr'), h(expenseController.deleteCategory.bind(expenseController)));

// Claims - Employee operations
expenseRouter.post('/claims', h(expenseController.createClaim.bind(expenseController)));
expenseRouter.post('/claims/:claimId/items', h(expenseController.addClaimItem.bind(expenseController)));
expenseRouter.delete('/claims/items/:itemId', h(expenseController.deleteClaimItem.bind(expenseController)));
expenseRouter.post('/claims/:claimId/items/:itemId/receipt', h(expenseController.uploadReceipt.bind(expenseController)));
expenseRouter.post('/claims/:claimId/submit', h(expenseController.submitClaim.bind(expenseController)));
expenseRouter.get('/claims/my-claims', h(expenseController.getMyClaims.bind(expenseController)));
expenseRouter.get('/claims/:claimId', h(expenseController.getClaimDetails.bind(expenseController)));

// Manager approvals
expenseRouter.get('/claims/pending-approval', requireRole('manager'), h(expenseController.getPendingApprovals.bind(expenseController)));
expenseRouter.post('/claims/:claimId/manager-approve', requireRole('manager'), h(expenseController.managerApprove.bind(expenseController)));
expenseRouter.post('/claims/:claimId/reject', requireRole('manager', 'finance'), h(expenseController.rejectClaim.bind(expenseController)));

// Finance operations
expenseRouter.get('/claims/finance-queue', requireRole('finance', 'admin'), h(expenseController.getFinanceQueue.bind(expenseController)));
expenseRouter.post('/claims/:claimId/finance-approve', requireRole('finance', 'admin'), h(expenseController.financeApprove.bind(expenseController)));
expenseRouter.post('/claims/:claimId/mark-paid', requireRole('finance', 'admin'), h(expenseController.markAsPaid.bind(expenseController)));
expenseRouter.get('/claims/export-for-payment', requireRole('finance', 'admin'), h(expenseController.exportForPayment.bind(expenseController)));

// Reports
expenseRouter.get('/reports/summary', requireRole('finance', 'admin'), h(expenseController.getExpenseSummary.bind(expenseController)));
expenseRouter.get('/reports/monthly-trends', requireRole('finance', 'admin'), h(expenseController.getMonthlyTrends.bind(expenseController)));
expenseRouter.get('/reports/top-spenders', requireRole('finance', 'admin'), h(expenseController.getTopSpenders.bind(expenseController)));
```

- [ ] **Step 3: Add expense routes to main app**

Modify: `backend/src/app.ts`

Find the section where routes are registered (search for `app.use('/api/`), and add:

```typescript
import { expenseRouter } from './modules/expenses/expense.routes.js';

// Add after other route registrations
app.use('/api/expenses', expenseRouter);
```

- [ ] **Step 4: Test API endpoints manually**

Run backend:
```bash
cd backend && npm run dev
```

Test with curl:
```bash
# List categories
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:5055/api/expenses/categories

# Create claim (replace YOUR_TOKEN)
curl -X POST -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
  -d '{"process_id":1,"branch_id":1}' \
  http://localhost:5055/api/expenses/claims
```

Expected: Categories returned, claim created with EXP-* number

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/expenses/expense.controller.ts backend/src/modules/expenses/expense.routes.ts backend/src/app.ts
git commit -m "feat(expenses): add REST API controller and routes"
```

---

## Task 8: Frontend Types & API Client

**Files:**
- Create: `src/integrations/expenses/types.ts`
- Create: `src/integrations/expenses/api.ts`
- Create: `src/integrations/expenses/hooks.ts`

- [ ] **Step 1: Create frontend types**

Create: `src/integrations/expenses/types.ts`

```typescript
export enum ExpenseStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  MANAGER_APPROVED = 'MANAGER_APPROVED',
  FINANCE_APPROVED = 'FINANCE_APPROVED',
  PAID = 'PAID',
  REJECTED = 'REJECTED'
}

export interface ExpenseCategory {
  id: number;
  name: string;
  description: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
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
  submitted_date?: string;
  manager_approved_date?: string;
  finance_approved_date?: string;
  paid_date?: string;
  rejection_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface ExpenseItem {
  id: number;
  expense_claim_id: number;
  category_id: number;
  expense_date: string;
  amount: number;
  description: string;
  vendor_name?: string;
  receipt_file_path?: string;
  created_at: string;
  updated_at: string;
}

export interface ExpenseClaimWithDetails extends ExpenseClaim {
  items?: ExpenseItem[];
  approvals?: ExpenseApproval[];
  payment?: ExpensePayment;
}

export interface ExpenseApproval {
  id: number;
  expense_claim_id: number;
  approver_id: number;
  approval_type: 'MANAGER' | 'FINANCE';
  action: 'APPROVED' | 'REJECTED';
  comments?: string;
  action_date: string;
}

export interface ExpensePayment {
  id: number;
  expense_claim_id: number;
  payment_reference: string;
  payment_date: string;
  payment_method: string;
  processed_by: number;
  created_at: string;
}

export interface CreateExpenseClaimDto {
  process_id: number;
  branch_id: number;
}

export interface AddExpenseItemDto {
  category_id: number;
  expense_date: string;
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
  payment_date: string;
  payment_method: string;
}
```

- [ ] **Step 2: Create API client**

Create: `src/integrations/expenses/api.ts`

```typescript
import { supabase } from '../supabase/client';
import type {
  ExpenseCategory,
  ExpenseClaim,
  ExpenseItem,
  ExpenseClaimWithDetails,
  CreateExpenseClaimDto,
  AddExpenseItemDto,
  ApproveClaimDto,
  RejectClaimDto,
  MarkPaidDto,
  ExpenseStatus
} from './types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5055/api';

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session?.access_token}`
  };
}

export const expenseApi = {
  // Categories
  async listCategories(): Promise<ExpenseCategory[]> {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_URL}/expenses/categories`, { headers });
    const data = await res.json();
    return data.categories;
  },

  // Claims
  async createClaim(dto: CreateExpenseClaimDto): Promise<ExpenseClaim> {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_URL}/expenses/claims`, {
      method: 'POST',
      headers,
      body: JSON.stringify(dto)
    });
    const data = await res.json();
    return data.claim;
  },

  async addClaimItem(claimId: number, dto: AddExpenseItemDto): Promise<ExpenseItem> {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_URL}/expenses/claims/${claimId}/items`, {
      method: 'POST',
      headers,
      body: JSON.stringify(dto)
    });
    const data = await res.json();
    return data.item;
  },

  async deleteClaimItem(itemId: number): Promise<void> {
    const headers = await getAuthHeaders();
    await fetch(`${API_URL}/expenses/claims/items/${itemId}`, {
      method: 'DELETE',
      headers
    });
  },

  async uploadReceipt(claimId: number, itemId: number, file: File): Promise<string> {
    const { data: { session } } = await supabase.auth.getSession();
    
    // Upload to Supabase Storage
    const filePath = `${claimId}/${itemId}/${file.name}`;
    const { data, error } = await supabase.storage
      .from('expense-receipts')
      .upload(filePath, file);
    
    if (error) throw error;
    
    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('expense-receipts')
      .getPublicUrl(filePath);
    
    // Update item with receipt path
    const headers = await getAuthHeaders();
    await fetch(`${API_URL}/expenses/claims/${claimId}/items/${itemId}/receipt`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ receipt_path: publicUrl })
    });
    
    return publicUrl;
  },

  async submitClaim(claimId: number): Promise<ExpenseClaim> {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_URL}/expenses/claims/${claimId}/submit`, {
      method: 'POST',
      headers
    });
    const data = await res.json();
    return data.claim;
  },

  async getMyClaims(status?: ExpenseStatus, page = 1, limit = 20): Promise<{ claims: ExpenseClaim[]; total: number }> {
    const headers = await getAuthHeaders();
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (status) params.append('status', status);
    
    const res = await fetch(`${API_URL}/expenses/claims/my-claims?${params}`, { headers });
    return res.json();
  },

  async getClaimDetails(claimId: number): Promise<ExpenseClaimWithDetails> {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_URL}/expenses/claims/${claimId}`, { headers });
    const data = await res.json();
    return data.claim;
  },

  // Manager
  async getPendingApprovals(): Promise<ExpenseClaim[]> {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_URL}/expenses/claims/pending-approval`, { headers });
    const data = await res.json();
    return data.claims;
  },

  async managerApprove(claimId: number, dto: ApproveClaimDto): Promise<ExpenseClaim> {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_URL}/expenses/claims/${claimId}/manager-approve`, {
      method: 'POST',
      headers,
      body: JSON.stringify(dto)
    });
    const data = await res.json();
    return data.claim;
  },

  async rejectClaim(claimId: number, dto: RejectClaimDto): Promise<ExpenseClaim> {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_URL}/expenses/claims/${claimId}/reject`, {
      method: 'POST',
      headers,
      body: JSON.stringify(dto)
    });
    const data = await res.json();
    return data.claim;
  },

  // Finance
  async getFinanceQueue(status: ExpenseStatus, page = 1, limit = 20): Promise<{ claims: ExpenseClaim[]; total: number }> {
    const headers = await getAuthHeaders();
    const params = new URLSearchParams({ status, page: String(page), limit: String(limit) });
    
    const res = await fetch(`${API_URL}/expenses/claims/finance-queue?${params}`, { headers });
    return res.json();
  },

  async financeApprove(claimId: number, dto: ApproveClaimDto): Promise<ExpenseClaim> {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_URL}/expenses/claims/${claimId}/finance-approve`, {
      method: 'POST',
      headers,
      body: JSON.stringify(dto)
    });
    const data = await res.json();
    return data.claim;
  },

  async markAsPaid(claimId: number, dto: MarkPaidDto): Promise<ExpenseClaim> {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_URL}/expenses/claims/${claimId}/mark-paid`, {
      method: 'POST',
      headers,
      body: JSON.stringify(dto)
    });
    const data = await res.json();
    return data.claim;
  },

  async exportForPayment(status: ExpenseStatus, startDate?: string, endDate?: string): Promise<Blob> {
    const headers = await getAuthHeaders();
    const params = new URLSearchParams({ status });
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    
    const res = await fetch(`${API_URL}/expenses/claims/export-for-payment?${params}`, { headers });
    return res.blob();
  }
};
```

- [ ] **Step 3: Create React Query hooks**

Create: `src/integrations/expenses/hooks.ts`

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { expenseApi } from './api';
import type {
  CreateExpenseClaimDto,
  AddExpenseItemDto,
  ApproveClaimDto,
  RejectClaimDto,
  MarkPaidDto,
  ExpenseStatus
} from './types';

export const EXPENSE_KEYS = {
  categories: ['expense-categories'] as const,
  myClaims: (status?: ExpenseStatus) => ['my-expense-claims', status] as const,
  claimDetails: (id: number) => ['expense-claim', id] as const,
  pendingApprovals: ['expense-pending-approvals'] as const,
  financeQueue: (status: ExpenseStatus) => ['expense-finance-queue', status] as const
};

// Categories
export function useExpenseCategories() {
  return useQuery({
    queryKey: EXPENSE_KEYS.categories,
    queryFn: () => expenseApi.listCategories()
  });
}

// Claims
export function useCreateClaim() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (dto: CreateExpenseClaimDto) => expenseApi.createClaim(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: EXPENSE_KEYS.myClaims() });
    }
  });
}

export function useAddClaimItem() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ claimId, dto }: { claimId: number; dto: AddExpenseItemDto }) =>
      expenseApi.addClaimItem(claimId, dto),
    onSuccess: (_, { claimId }) => {
      queryClient.invalidateQueries({ queryKey: EXPENSE_KEYS.claimDetails(claimId) });
    }
  });
}

export function useUploadReceipt() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ claimId, itemId, file }: { claimId: number; itemId: number; file: File }) =>
      expenseApi.uploadReceipt(claimId, itemId, file),
    onSuccess: (_, { claimId }) => {
      queryClient.invalidateQueries({ queryKey: EXPENSE_KEYS.claimDetails(claimId) });
    }
  });
}

export function useSubmitClaim() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (claimId: number) => expenseApi.submitClaim(claimId),
    onSuccess: (claim) => {
      queryClient.invalidateQueries({ queryKey: EXPENSE_KEYS.myClaims() });
      queryClient.invalidateQueries({ queryKey: EXPENSE_KEYS.claimDetails(claim.id) });
    }
  });
}

export function useMyClaims(status?: ExpenseStatus) {
  return useQuery({
    queryKey: EXPENSE_KEYS.myClaims(status),
    queryFn: () => expenseApi.getMyClaims(status)
  });
}

export function useClaimDetails(claimId: number) {
  return useQuery({
    queryKey: EXPENSE_KEYS.claimDetails(claimId),
    queryFn: () => expenseApi.getClaimDetails(claimId),
    enabled: !!claimId
  });
}

// Manager
export function usePendingApprovals() {
  return useQuery({
    queryKey: EXPENSE_KEYS.pendingApprovals,
    queryFn: () => expenseApi.getPendingApprovals()
  });
}

export function useManagerApprove() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ claimId, dto }: { claimId: number; dto: ApproveClaimDto }) =>
      expenseApi.managerApprove(claimId, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: EXPENSE_KEYS.pendingApprovals });
    }
  });
}

export function useRejectClaim() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ claimId, dto }: { claimId: number; dto: RejectClaimDto }) =>
      expenseApi.rejectClaim(claimId, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: EXPENSE_KEYS.pendingApprovals });
      queryClient.invalidateQueries({ queryKey: EXPENSE_KEYS.financeQueue('MANAGER_APPROVED') });
    }
  });
}

// Finance
export function useFinanceQueue(status: ExpenseStatus) {
  return useQuery({
    queryKey: EXPENSE_KEYS.financeQueue(status),
    queryFn: () => expenseApi.getFinanceQueue(status)
  });
}

export function useFinanceApprove() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ claimId, dto }: { claimId: number; dto: ApproveClaimDto }) =>
      expenseApi.financeApprove(claimId, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: EXPENSE_KEYS.financeQueue('MANAGER_APPROVED') });
      queryClient.invalidateQueries({ queryKey: EXPENSE_KEYS.financeQueue('FINANCE_APPROVED') });
    }
  });
}

export function useMarkAsPaid() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ claimId, dto }: { claimId: number; dto: MarkPaidDto }) =>
      expenseApi.markAsPaid(claimId, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: EXPENSE_KEYS.financeQueue('FINANCE_APPROVED') });
      queryClient.invalidateQueries({ queryKey: EXPENSE_KEYS.financeQueue('PAID') });
    }
  });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/integrations/expenses/
git commit -m "feat(expenses): add frontend types, API client, and React Query hooks"
```

---

## Summary & Next Steps

You have now completed the backend implementation and frontend API layer for the Time & Expense Management module. The remaining tasks involve building the UI components and pages.

**What's been built:**
✅ Database schema with 5 tables
✅ TypeScript models and interfaces  
✅ Category service (CRUD)
✅ Core expense service (claims, items, submission)
✅ Approval service (manager & finance workflows)
✅ Report service (analytics, exports)
✅ REST API controller & routes
✅ Frontend types & API client
✅ React Query hooks

**Remaining work:**
- Task 9-15: Frontend UI components (ExpenseStatusBadge, ReceiptUpload, etc.)
- Task 16-20: Frontend pages (MyExpenses, NewExpenseClaim, ExpenseApprovals, FinanceQueue, ExpenseReports)
- Task 21: Add navigation to sidebar
- Task 22: End-to-end testing
- Task 23: Documentation

**Due to length limits, the plan continues in a Part 2 document. The remaining UI tasks follow the same TDD pattern with step-by-step component building.**

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-18-time-expense-management-implementation.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
