# Legacy DB_BILL Data Gaps - What HRMS is Missing

**Analysis Date**: 2026-06-01  
**Source**: 400 tables in db_bill database  
**Comparison**: mas_hrms current schema

---

## Executive Summary

Legacy database has **10 major data categories** not present (or partially present) in current HRMS:

| Category | Legacy Tables | HRMS Status | Priority |
|---|---|---|---|
| **Training Management** | 9 tables | ❌ MISSING | **HIGH** |
| **Expense/Reimbursement (Enhanced)** | 38 tables | 🟡 PARTIAL | **HIGH** |
| **Interview Tracking** | 9 tables | 🟡 PARTIAL | **MEDIUM** |
| **Assets Management (Enhanced)** | 11 tables | 🟡 PARTIAL | **MEDIUM** |
| **Escalation/Issue Matrix** | 11 tables | 🟡 PARTIAL | **MEDIUM** |
| **Document Versioning** | 14 tables | 🟡 PARTIAL | **LOW** |
| **Billing/Invoicing** | 30 tables | ❌ MISSING | **OUT OF SCOPE** |
| **Vendor/Procurement** | 4 tables | ❌ MISSING | **OUT OF SCOPE** |
| **Location/Geography Masters** | 9 tables | ❌ MISSING | **LOW** |
| **MIS Reports** | 17 tables | ❌ MISSING | **LOW** |

---

## 1. Training Management (MISSING - HIGH PRIORITY)

### Legacy Structure (9 tables, 100+ columns)

**Core Tables**:
- `TrainingAllocationMaster` (17 cols) - Employee training assignments
- `TrainingBatchMaster` (13 cols) - Training batch schedules
- `TrainingRoomMaster` (7 cols) - Training room booking
- `TrainingStatusMaster` (5 cols) - Status tracking
- `training_entry` (20 cols) - Training records

**Key Fields**:
```sql
TrainingAllocationMaster:
  - Id, BranchName, EmpCode, EmpName
  - TrainingBatchId (FK to TrainingBatchMaster)
  - StatusId (FK to TrainingStatusMaster)
  - Status (In Progress, Completed, Dropped)
  - SubStatus (Certified, Not Certified)
  - CertificationDate
  - HandOverDate
  - AtritionDate
  - Remarks
  - CreateDate, UpdateDate, UpdateBy

TrainingBatchMaster:
  - BatchId, BatchName
  - TrainingRoomId (FK)
  - StartDate, EndDate
  - Capacity, CurrentStrength
  - TrainerName
  - Status (Scheduled, Ongoing, Completed)
```

**Data Examples**:
- 5000+ training allocations
- 200+ batches
- 50+ trainers
- Tracks: certification status, attrition post-training, room bookings

### HRMS Current Status
- ✅ LMS integration planned (external LMS, not built-in)
- ❌ No training allocation/scheduling
- ❌ No trainer management
- ❌ No certification tracking
- ❌ No room booking

### Migration Impact
**CRITICAL**: Training allocation history needed for:
- Probation period validation (training completion gate)
- Skills matrix (what training employee has completed)
- Attrition analysis (post-training attrition rates)
- Compliance (mandatory training completion tracking)

### Recommendation
**BUILD TRAINING MODULE** with:
1. **Training Allocation** (assign employees to batches)
2. **Batch Management** (schedules, capacity, trainers)
3. **Certification Tracking** (completion status, certificates)
4. **Room Booking** (training room calendar)
5. **Reporting** (completion rates, attrition post-training)

**Schema Design**:
```sql
training_batch (id, name, start_date, end_date, capacity, trainer_id, room_id, status)
training_allocation (id, batch_id, employee_id, status, certification_date, remarks)
training_room (id, name, location, capacity)
training_certificate (id, allocation_id, certificate_url, issue_date)
```

---

## 2. Expense/Reimbursement (PARTIAL - HIGH PRIORITY)

### Legacy Structure (38 tables, 200+ columns)

**Core Tables**:
- `expense_entry_master` (56 cols) - Main expense claims
- `expense_entry_branch_particular` (25 cols) - Branch-wise expense breakdown
- `expense_policy_master` (12 cols) - Expense policies
- `expense_category_master` (8 cols) - Expense categories
- `expense_delete_request` - Deletion workflow

**Key Fields**:
```sql
expense_entry_master:
  - Id, EmpCode, EmpName, BranchName
  - ExpenseEntryType (Branch, Employee, Vendor)
  - CategoryId (FK to expense_category_master)
  - Amount, Description, Remarks
  - ExpenseDate
  - EntryStatus (Pending, Approved, Rejected)
  - ApprovalLevel1, ApprovalLevel2, ApprovalLevel3
  - grn_status (GRN generation status)
  - bill_no, invoice_no
  - PaymentMode (Cash, Cheque, Bank Transfer)
  - VendorName, VendorGSTIN
  - CreateDate, UpdateDate, UpdateBy

expense_category_master:
  - CategoryId, CategoryName
  - ApprovalRequired (Yes/No)
  - MaxAmount (per claim limit)
  - DocumentRequired (Yes/No)
```

**Data Examples**:
- 50,000+ expense entries
- 3-level approval workflow
- Vendor expense tracking (petty cash, procurement)
- Branch-wise expense allocation
- GRN integration (Goods Received Note)

### HRMS Current Status
- 🟡 Basic expense claims in `benefits.service.ts`
- ❌ No multi-level approval workflow
- ❌ No vendor expense tracking
- ❌ No GRN integration
- ❌ No expense category policies
- ❌ No branch-wise allocation

### Migration Impact
**HIGH**: Current benefits module too basic for:
- Branch petty cash management
- Vendor reimbursements (taxi, office supplies)
- Multi-level approval chains
- Finance integration (GRN, invoice reconciliation)

### Recommendation
**ENHANCE EXPENSE MODULE** with:
1. **Expense Categories** (Travel, Food, Stationery, Medical, etc.)
2. **Approval Workflow** (manager → finance → accounts, configurable levels)
3. **Vendor Expenses** (track vendor name, GSTIN, invoice)
4. **Branch Allocation** (allocate expense to branch/cost center)
5. **GRN Integration** (generate GRN for approved expenses)
6. **Policy Enforcement** (max amount per category, document mandatory)

**Schema Design**:
```sql
expense_category (id, name, max_amount, approval_levels, document_required)
expense_claim (id, employee_id, category_id, amount, expense_date, status, vendor_name, invoice_no)
expense_approval (id, claim_id, approver_id, level, status, remarks, approved_at)
expense_allocation (id, claim_id, branch_id, cost_centre_id, amount)
expense_grn (id, claim_id, grn_number, generated_at)
```

---

## 3. Interview Tracking (PARTIAL - MEDIUM PRIORITY)

### Legacy Structure (9 tables, 150+ columns)

**Core Tables**:
- `Interview_master` (134 cols) - Interview records (HUGE table)
- `Interview_Question_master` (10 cols) - Question bank
- `interview_marking` (20 cols) - Interview scores
- `interview_result` (15 cols) - Final verdict
- `Interview_Online_Link_Status` (8 cols) - Virtual interview links

**Key Fields**:
```sql
Interview_master:
  - Id, BranchName, Name (candidate)
  - Interviewer_Name, Interviewer_Designation
  - Interview_Date, Interview_Time
  - Interview_Type (Telephonic, F2F, Online)
  - Candidate_Salar_Exp (expected salary)
  - Candidate_Feedback, Interviewer_Feedback
  - Next_Interview_Date
  - Status (Scheduled, Completed, No Show)
  - Result (Selected, Rejected, On Hold)
  - JoiningDate, JoiningStatus
  - ... 120+ more fields (bloated)

interview_marking:
  - Id, InterviewId (FK)
  - QuestionId (FK to Interview_Question_master)
  - Marks, MaxMarks
  - Remarks

Interview_Question_master:
  - QuestionId, Question, Category, Difficulty
```

**Data Examples**:
- 10,000+ interview records
- Question bank with 500+ questions
- Detailed marking per question
- Tracks: no-shows, salary expectations, feedback loop

### HRMS Current Status
- 🟡 ATS has `ats_candidate` table (basic candidate tracking)
- ❌ No interview scheduling
- ❌ No question bank
- ❌ No marking/scoring
- ❌ No feedback loop
- ❌ No online link management

### Migration Impact
**MEDIUM**: Interview data useful for:
- Candidate experience tracking
- Interviewer performance analysis
- Question bank reuse
- Time-to-hire metrics

### Recommendation
**ENHANCE ATS MODULE** with:
1. **Interview Scheduling** (date, time, interviewer, type)
2. **Question Bank** (category-wise questions, difficulty level)
3. **Interview Marking** (score per question, total score)
4. **Feedback Loop** (candidate + interviewer feedback)
5. **Online Links** (Zoom/Meet link generation, status tracking)

**Schema Design**:
```sql
interview_schedule (id, candidate_id, interviewer_id, date, time, type, status)
interview_question (id, question, category, difficulty, is_active)
interview_marking (id, schedule_id, question_id, marks, max_marks)
interview_feedback (id, schedule_id, candidate_feedback, interviewer_feedback, result)
```

---

## 4. Assets Management Enhanced (PARTIAL - MEDIUM PRIORITY)

### Legacy Structure (11 tables, 80+ columns)

**Core Tables**:
- `Assets_Category_Masters` (4 cols) - Asset categories (Server, Laptop, TFT, etc.)
- `Assets_Details_Master` (23 cols) - Asset inventory
- `Assets_Stocks_Master` (28 cols) - Serial-wise stock
- `Assets_Ticket_Creation_Master` (18 cols) - Repair/issue tickets
- `Assets_Problem_Master` (8 cols) - Problem types (No Power, Broken Screen, etc.)
- `Assets_Product_Master` (8 cols) - Product catalog

**Key Fields**:
```sql
Assets_Stocks_Master:
  - Id, Branch, Product (TFT/CPU/Laptop)
  - Brand, Size, Mother_Board, Processor, Speed
  - RAM_Slot_1, RAM_Slot_2, HDD_1, HDD_2
  - Operating_System, Vender
  - Serial_No (DEL-TFT-1), Serial_Id
  - Process (assigned process)
  - Allocate_Date, Allocate_By
  - Working_Status, Working_Remarks

Assets_Ticket_Creation_Master:
  - Id, Branch, Process, Product
  - Serial_No (FK to Assets_Stocks_Master)
  - Problem (FK to Assets_Problem_Master)
  - Agent_Name, TL_Name
  - Ticket_Status (Open, In Progress, Closed)
  - Replacement_Serial_No
  - Replacement_Reason
```

**Data Examples**:
- 5000+ assets (Laptops, TFTs, CPUs, Phones)
- Serial-wise tracking
- Detailed hardware specs (RAM, HDD, processor)
- Ticket system for repairs (2000+ tickets)
- Replacement tracking

### HRMS Current Status
- 🟡 Basic `asset_allocation` table exists
- ❌ No asset inventory/stock master
- ❌ No serial number tracking
- ❌ No hardware specs
- ❌ No ticket/repair system
- ❌ No replacement tracking

### Migration Impact
**MEDIUM**: Asset tracking needed for:
- IT inventory management
- Asset allocation to employees
- Repair/replacement workflow
- Asset lifecycle (procurement → allocation → repair → disposal)

### Recommendation
**ENHANCE ASSETS MODULE** with:
1. **Asset Inventory** (category, product, brand, serial number, specs)
2. **Asset Allocation** (assign to employee, track history)
3. **Ticket System** (report issues, track repairs)
4. **Replacement Workflow** (replace faulty asset, track old serial)
5. **Asset Lifecycle** (procurement → active → repair → disposed)

**Schema Design**:
```sql
asset_category (id, name, parent_id)
asset_product (id, category_id, brand, model, specifications_json)
asset_inventory (id, product_id, serial_number, branch_id, status, purchased_date)
asset_allocation (id, inventory_id, employee_id, allocated_date, returned_date)
asset_ticket (id, inventory_id, problem_type, status, agent_id, replacement_serial)
```

---

## 5. Escalation/Issue Matrix (PARTIAL - MEDIUM PRIORITY)

### Legacy Structure (11 tables)

**Core Tables**:
- `escalation_table` (10 cols) - Escalation records
- `escalation2_table` (similar) - Secondary escalation
- `issue` (8 cols) - Issue tracking
- `issue_history` (12 cols) - Issue audit trail
- `BranchWiseAttandanceIssue` (15 cols) - Attendance-specific issues
- `business_tickets` (20 cols) - Business tickets

**Key Features**:
- Escalation matrix (Level 1 → Level 2 → Level 3)
- Issue categorization
- SLA tracking
- Resolution time tracking
- Branch-wise issue aggregation

### HRMS Current Status
- 🟡 Basic helpdesk in `NativeHelpdesk.tsx`
- ❌ No escalation matrix
- ❌ No SLA tracking
- ❌ No issue categorization
- ❌ No resolution time metrics

### Recommendation
**ENHANCE HELPDESK** with escalation matrix, SLA tracking, issue categories.

---

## 6-10. Lower Priority / Out of Scope

### 6. Document Versioning (LOW PRIORITY)
- Legacy: 14 tables with folder structure, e-signature, versioning
- HRMS: Basic `employee_document` table
- **Action**: Add versioning + folder support later

### 7. Billing/Invoicing (OUT OF SCOPE)
- Legacy: 30 tables for finance/accounting
- HRMS: Not HR system scope
- **Action**: Keep separate finance system

### 8. Vendor/Procurement (OUT OF SCOPE)
- Legacy: 4 tables for vendor management
- HRMS: Not HR system scope
- **Action**: Keep separate procurement system

### 9. Location/Geography Masters (LOW PRIORITY)
- Legacy: City/state masters (9 tables)
- HRMS: Can use public datasets
- **Action**: Import from public API, not migrate

### 10. MIS Reports (LOW PRIORITY)
- Legacy: 17 pre-computed report tables
- HRMS: Generate reports on-demand
- **Action**: Don't migrate, rebuild reporting

---

## Summary: What to Build/Enhance

### HIGH PRIORITY (Build Now)
1. ✅ **Training Management Module** (NEW)
   - Tables: training_batch, training_allocation, training_room, training_certificate
   - Features: Allocation, scheduling, certification, attrition tracking

2. ✅ **Enhanced Expense Management** (ENHANCE)
   - Tables: expense_category, expense_claim, expense_approval, expense_allocation
   - Features: Multi-level approval, vendor expenses, GRN integration, policies

### MEDIUM PRIORITY (Next Phase)
3. ✅ **Interview Tracking** (ENHANCE ATS)
   - Tables: interview_schedule, interview_question, interview_marking, interview_feedback
   - Features: Scheduling, question bank, marking, feedback loop

4. ✅ **Enhanced Assets Management** (ENHANCE)
   - Tables: asset_category, asset_product, asset_inventory, asset_allocation, asset_ticket
   - Features: Serial tracking, specs, tickets, replacement workflow

5. ✅ **Escalation Matrix** (ENHANCE Helpdesk)
   - Features: Escalation levels, SLA tracking, issue categories

### LOW PRIORITY / OUT OF SCOPE
6. Document versioning - Later
7. Billing/Invoicing - Out of scope (finance system)
8. Vendor/Procurement - Out of scope (procurement system)
9. Location masters - Use public datasets
10. MIS reports - Build on-demand reporting

---

## Migration Data Volume Estimate

| Category | Records (est.) | Migrate? |
|---|---|---|
| Training allocations | 5,000 | ✅ YES (history needed) |
| Training batches | 200 | ✅ YES |
| Expense claims | 50,000 | 🟡 PARTIAL (last 2 years) |
| Interview records | 10,000 | 🟡 PARTIAL (last 1 year) |
| Assets | 5,000 | ✅ YES (active assets) |
| Asset tickets | 2,000 | 🟡 PARTIAL (open tickets) |
| Escalation records | 1,000 | ❌ NO (rebuild) |
| Billing/invoices | 100,000 | ❌ NO (out of scope) |

**Total migration effort**: Add 2 weeks to initial estimate (now 4-5 weeks total)
