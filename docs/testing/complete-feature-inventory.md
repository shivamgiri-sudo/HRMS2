# MAS-CallNet HRMS: Complete Feature Inventory for Testing

**Date**: 2026-06-01  
**Purpose**: Comprehensive list of ALL features/pages/functions requiring testing

---

## Authentication & Account Control

### Password Management
- [ ] **Forgot Password Flow** (Supabase Auth)
  - [ ] Request reset email from login page
  - [ ] Receive email with reset link
  - [ ] Click link → redirect to `/reset-password`
  - [ ] Set new password (min 6 chars)
  - [ ] Password mismatch validation
  - [ ] Invalid/expired link handling
  - [ ] Success → redirect to dashboard

- [ ] **Admin-Initiated Password Reset** (Admin/HR only)
  - [ ] POST `/api/account-control/reset-request` with userId
  - [ ] Force password change via `/force-change`
  - [ ] Audit log tracks who initiated reset

- [ ] **Account Lock/Unlock** (Admin only)
  - [ ] Lock account via `/api/account-control/lock`
  - [ ] Unlock via `/unlock`
  - [ ] Locked user cannot login
  - [ ] Audit log tracks lock/unlock actions

- [ ] **Account Disable/Enable** (Admin only)
  - [ ] Disable via `/api/account-control/disable`
  - [ ] Enable via `/enable`
  - [ ] Disabled user shows as inactive

- [ ] **Session Revoke** (Admin only)
  - [ ] Revoke active sessions via `/revoke-session`
  - [ ] User logged out immediately

- [ ] **Account Audit Log** (Admin/HR)
  - [ ] GET `/api/account-control/audit-log/:userId`
  - [ ] View all account control actions (reset, lock, disable, revoke)

---

## ATS: Recruitment Journey

### 1. Candidate Registration (Public)
- [ ] **NativeATSCandidateRegistration.tsx**
  - [ ] Public registration form (no auth)
  - [ ] Capture: Name, Email, Phone, Position Applied
  - [ ] Upload resume (if enabled)
  - [ ] Submit → Create candidate record
  - [ ] Duplicate email validation
  - [ ] Confirmation message/email

### 2. Walk-in Queue Management
- [ ] **NativeWalkinQueue.tsx** (HR/Recruiter)
  - [ ] View all walk-in candidates (sorted by arrival time)
  - [ ] Filter by: Date, Status, Position
  - [ ] Mark candidate as "Interviewed" / "Waiting" / "Rejected"
  - [ ] Move to next stage
  - [ ] VOC (Voice of Customer) capture
  - [ ] Queue statistics (total waiting, interviewed today)

- [ ] **NativeATSWaitingQueue.tsx** (alternative view)
  - [ ] Similar to walk-in queue
  - [ ] Filter by branch/process
  - [ ] Bulk actions (move multiple candidates)

### 3. Candidate Master
- [ ] **NativeATSCandidateMaster.tsx** (HR/Recruiter)
  - [ ] List all candidates (paginated)
  - [ ] Search by: Name, Email, Phone, Position
  - [ ] Filter by: Status, Stage, Source
  - [ ] View candidate detail
  - [ ] Edit candidate info
  - [ ] Delete candidate (soft delete)
  - [ ] Export candidate list (CSV/Excel)

### 4. Recruiter Workspace
- [ ] **NativeATSRecruiterWorkspace.tsx** (HR/Recruiter)
  - [ ] My assigned candidates
  - [ ] Candidate pipeline (stages: Screening → Interview → Offer → Joining)
  - [ ] Drag-and-drop stage movement
  - [ ] Add interview notes
  - [ ] Schedule interview
  - [ ] Send email/SMS to candidate
  - [ ] Activity timeline per candidate

### 5. ATS Dashboards
- [ ] **NativeATSDashboard.tsx** (HR/Recruiter)
  - [ ] Candidate funnel (count per stage)
  - [ ] Conversion rates (stage-to-stage)
  - [ ] Time-to-hire metrics
  - [ ] Source effectiveness (walk-in, referral, portal)
  - [ ] Pending actions (interviews today, offers pending)

- [ ] **NativeATSDashboardV2.tsx** (alternative dashboard)
  - [ ] Enhanced visualizations (charts, graphs)
  - [ ] Date range filters
  - [ ] Export reports

- [ ] **NativeATSDashboardReplica.tsx** (replica for testing)

- [ ] **NativeATSRecruiterDashboard.tsx** (Recruiter-specific)
  - [ ] My candidates only
  - [ ] My interview schedule
  - [ ] My conversion rate

### 6. Offer Management
- [ ] **NativeATSExtensions.tsx** (HR/Recruiter)
  - [ ] Create offer letter (template-based)
  - [ ] Set CTC, joining date, designation
  - [ ] Send offer via email
  - [ ] Candidate accepts/rejects offer digitally
  - [ ] Offer status tracking (Sent → Accepted → Joined / Rejected)
  - [ ] Offer expiry date

### 7. Onboarding Bridge
- [ ] **NativeATSOnboardingBridge.tsx** (HR)
  - [ ] Candidate accepted offer → Convert to employee
  - [ ] Pre-joining checklist (documents, verification)
  - [ ] Joining date confirmation
  - [ ] Generate employee code (MAS00001+)
  - [ ] Create employee record in `employees` table
  - [ ] Link onboarding tasks

### 8. Sourcing Analysis
- [ ] **NativeATSSourcingAnalysis.tsx** (HR)
  - [ ] Source-wise candidate breakdown (Walk-in, Referral, Portal, LinkedIn)
  - [ ] Cost-per-hire by source
  - [ ] Quality-of-hire by source (retention, performance)
  - [ ] Date range filters

---

## Onboarding

### Document Verification
- [ ] **Employee Documents** (`NativeOnboarding.tsx` or similar)
  - [ ] Upload documents (Aadhaar, PAN, Degree, Bank proof)
  - [ ] Document type dropdown (Aadhaar, PAN, Passport, Degree, etc.)
  - [ ] HR verifies document (Verified/Rejected/Pending)
  - [ ] Expiry date tracking (Passport, DL)
  - [ ] Alert for expiring documents
  - [ ] Document re-upload if rejected

### Onboarding Checklist
- [ ] **Pre-joining Tasks**
  - [ ] Document submission
  - [ ] Background verification
  - [ ] Health checkup
  - [ ] Contract signing
  - [ ] Asset allocation

- [ ] **First-day Tasks**
  - [ ] IT setup (email, laptop, access)
  - [ ] Induction training
  - [ ] Badge issuance
  - [ ] HR orientation

- [ ] **Probation Tracking**
  - [ ] Probation period (default 3 months)
  - [ ] Probation extension
  - [ ] Confirmation after probation
  - [ ] Probation review meeting

---

## Attendance & WFM

### Real-time Attendance
- [ ] **Attendance.tsx** (All roles)
  - [ ] Clock-in button (capture time + location if enabled)
  - [ ] Break start/end (break duration tracked)
  - [ ] Clock-out button
  - [ ] Today's attendance status (Present, Absent, Half-day, WFH)
  - [ ] Weekly/monthly attendance summary
  - [ ] Attendance calendar view

### Regularization
- [ ] **AttendanceRegularization.tsx** (Employee/Manager)
  - [ ] Request regularization (missed clock-in/out)
  - [ ] Select date, reason, attachment (if needed)
  - [ ] Manager approves/rejects
  - [ ] HR overrides manager decision (if needed)
  - [ ] Regularization history

### Roster Management
- [ ] **NativeWFMRoster.tsx** (HR/Manager)
  - [ ] Create roster plan (weekly/monthly)
  - [ ] Assign shifts to employees
  - [ ] Week-off assignment (fixed or rotational)
  - [ ] Shift swap requests (employee-initiated)
  - [ ] Bulk upload roster (CSV)
  - [ ] Export roster (PDF/Excel)

- [ ] **Roster Governance** (`NativeWFMGovernance.tsx` or similar)
  - [ ] Shift master (create/edit shifts)
  - [ ] Shift timings (start, end, break duration)
  - [ ] Roster templates (save and reuse)
  - [ ] Auto-roster rules (if implemented)

---

## Leave Management

### Leave Policies
- [ ] **Leave Types**
  - [ ] Casual Leave (CL)
  - [ ] Sick Leave (SL)
  - [ ] Earned Leave (EL)
  - [ ] Comp-off
  - [ ] LWP (Leave Without Pay)
  - [ ] Maternity/Paternity

- [ ] **Leave Rules**
  - [ ] Max days per type
  - [ ] Carry forward rules
  - [ ] Encashment eligibility
  - [ ] Approval levels (Manager → HR)

### Leave Requests
- [ ] **Leaves.tsx** (Employee)
  - [ ] Apply leave (select type, dates, reason)
  - [ ] Half-day leave option
  - [ ] Multiple-day leave
  - [ ] Emergency leave (mark as urgent)
  - [ ] Attachment upload (medical certificate)
  - [ ] Cancel pending leave
  - [ ] View leave history

- [ ] **Leave Approvals** (Manager/HR)
  - [ ] Pending leave requests
  - [ ] Approve/reject with remarks
  - [ ] Team leave calendar (see who's on leave)
  - [ ] Leave balance view (employee-wise)

### Leave Balance
- [ ] **Leave Balance Ledger**
  - [ ] Opening balance (yearly allocation)
  - [ ] Credit (accrual, carry forward)
  - [ ] Debit (consumed leave)
  - [ ] Closing balance
  - [ ] Encashment calculation

### Company Calendar
- [ ] **CompanyCalendar.tsx** (All roles)
  - [ ] View holidays (national, regional)
  - [ ] Week-off calendar
  - [ ] Team leave view
  - [ ] Export calendar (iCal)

---

## Payroll

### Payroll Run
- [ ] **Payroll.tsx** (HR/Admin)
  - [ ] Create payroll run (select month, cycle)
  - [ ] Auto-fetch working days from attendance
  - [ ] Auto-calculate LWP, LOP
  - [ ] Apply salary structures to employees
  - [ ] Preview payroll (before finalization)
  - [ ] Lock payroll (prevent changes)
  - [ ] Unlock payroll (if errors found)

### Payslip
- [ ] **NativePayslipCenter.tsx** (Employee)
  - [ ] View payslips (month-wise)
  - [ ] Download payslip (PDF)
  - [ ] Acknowledge payslip (confirmation)
  - [ ] Payslip breakup (Earnings, Deductions, Net Pay)
  - [ ] YTD summary (Year-to-date earnings)

- [ ] **Payslip Distribution** (HR)
  - [ ] Bulk send payslips (email)
  - [ ] Track acknowledgment (who acknowledged)
  - [ ] Re-send to non-acknowledged employees

### Salary Structures
- [ ] **Salary Structure Master** (HR/Admin)
  - [ ] Create salary structure (name, effective date)
  - [ ] Add components (Basic, HRA, DA, Conveyance, etc.)
  - [ ] Set calculation type (Fixed, Percentage, Formula)
  - [ ] Assign structure to employee
  - [ ] Revision history (track salary changes)

### Salary Components
- [ ] **Component Master** (Admin)
  - [ ] Create components (Basic, HRA, PF, ESIC, etc.)
  - [ ] Component type (Earning, Deduction, Employer Contribution)
  - [ ] Taxable/Non-taxable flag
  - [ ] Statutory flag (PF, ESIC, PT)
  - [ ] Calculation formula (if dynamic)

### Advances & Loans
- [ ] **Salary Advances** (Employee)
  - [ ] Request advance (amount, reason, repayment months)
  - [ ] Manager approves
  - [ ] HR processes advance
  - [ ] Auto-deduct from salary (monthly installment)
  - [ ] Advance balance tracking

### Statutory Exports
- [ ] **PF ECR Export** (HR)
  - [ ] Generate PF ECR file (text format)
  - [ ] Month-wise PF contribution summary
  - [ ] Employee-wise PF breakdown
  - [ ] Export for upload to EPFO portal

- [ ] **ESIC Challan Export** (HR)
  - [ ] Generate ESIC challan (CSV/Excel)
  - [ ] Month-wise ESIC contribution
  - [ ] Upload to ESIC portal

- [ ] **PT Deduction** (HR)
  - [ ] Auto-deduct PT based on state slabs
  - [ ] PT summary report (monthly/yearly)

- [ ] **TDS Calculation** (HR)
  - [ ] Compute TDS based on tax regime (Old/New)
  - [ ] Apply investment declarations
  - [ ] Generate Form 16 (yearly)
  - [ ] Quarterly TDS filing (Form 24Q)

### NEFT File Generation
- [ ] **Bank Transfer** (HR/Admin)
  - [ ] Generate NEFT-ready CSV (bank account, IFSC, amount)
  - [ ] Export for bank upload
  - [ ] Payment mode filter (Bank only, exclude Cash/Cheque)

---

## Performance Management

### Goals & KRA
- [ ] **NativeGoalsAppraisal.tsx** (All roles)
  - [ ] Set annual goals (employee + manager)
  - [ ] Define KRAs (Key Result Areas)
  - [ ] Assign weightage to each KRA
  - [ ] Track progress (quarterly review)
  - [ ] Self-assessment (employee rates self)
  - [ ] Manager assessment (manager rates employee)
  - [ ] Final rating (S/A/B/C/D)

### Performance Reviews
- [ ] **PerformanceReviews.tsx** (Manager/HR)
  - [ ] Initiate review cycle (quarterly/annual)
  - [ ] Review form (competency, behavior, achievement)
  - [ ] Coaching notes (manager feedback)
  - [ ] Development plan (training needs)
  - [ ] Review history

### Feedback
- [ ] **NativePerformanceFeedback.tsx** (All roles)
  - [ ] Give feedback to peer/manager/direct report
  - [ ] Feedback type (Positive, Constructive, Developmental)
  - [ ] Anonymous feedback (optional)
  - [ ] Feedback inbox (received feedback)

---

## Quality Management

### Quality Dashboard
- [ ] **NativeQualityDashboard.tsx** (QA/Manager)
  - [ ] Quality score (employee-wise, team-wise)
  - [ ] Defect breakdown (Fatal, Critical, Major, Minor)
  - [ ] Trend analysis (improving/declining)
  - [ ] Coaching required alerts

### Coaching Sessions
- [ ] **Coaching Module** (Manager/QA)
  - [ ] Schedule coaching session
  - [ ] Attach audit/call recording
  - [ ] Coaching notes
  - [ ] Action items (follow-up)
  - [ ] Coaching effectiveness tracking

### Training Needs Identification (TNI)
- [ ] **TNI Module** (Manager/QA)
  - [ ] Identify skill gaps from audits
  - [ ] Recommend training
  - [ ] Track training completion
  - [ ] Post-training performance improvement

---

## Assets Management

### Asset Allocation
- [ ] **Assets.tsx** (Employee/HR)
  - [ ] View assigned assets (laptop, phone, ID card)
  - [ ] Asset details (serial number, model, brand)
  - [ ] Condition (Good, Fair, Damaged)
  - [ ] Allocation date
  - [ ] Return date (on exit)

- [ ] **Asset Master** (Admin)
  - [ ] Add asset (category, brand, model, serial)
  - [ ] Asset status (Available, Allocated, Repair, Disposed)
  - [ ] Bulk upload assets (CSV)

### Asset Requests
- [ ] **Request Asset** (Employee)
  - [ ] Request new asset (laptop, headset, etc.)
  - [ ] Justification
  - [ ] Manager approves
  - [ ] IT allocates asset

---

## Exit Management

### Resignation
- [ ] **NativeExitManagement.tsx** (Employee)
  - [ ] Submit resignation (reason, last working date)
  - [ ] Attach resignation letter
  - [ ] Manager acknowledges
  - [ ] HR initiates exit process

### Exit Checklist
- [ ] **Exit Tasks** (HR)
  - [ ] Asset return (laptop, ID, access card)
  - [ ] Handover completion
  - [ ] Final settlement (F&F)
  - [ ] Exit interview
  - [ ] No-dues clearance
  - [ ] Relieving letter generation

### Full & Final Settlement
- [ ] **F&F Calculation** (HR)
  - [ ] Pending salary (working days)
  - [ ] Leave encashment (unused leave)
  - [ ] Bonus/incentives
  - [ ] Deductions (notice pay recovery, advance recovery)
  - [ ] Net F&F amount
  - [ ] Payment via NEFT

---

## Client Portal

### Client Dashboard
- [ ] **Portal Dashboard** (Client user)
  - [ ] Process-scoped KPIs (only assigned processes)
  - [ ] Target vs Actual metrics
  - [ ] Quality score
  - [ ] SLA compliance

### KPI Scorecards
- [ ] **NativeClientKPI.tsx** (Client)
  - [ ] KPI cards (AHT, FCR, CSAT, etc.)
  - [ ] Date range filter
  - [ ] Export KPI report (PDF/Excel)

### Glidepath Charts
- [ ] **Glidepath Visualization** (Client)
  - [ ] Committed vs Target trend
  - [ ] Month-over-month comparison
  - [ ] Performance gaps highlighted

### Action Plans
- [ ] **Action Plan Tracker** (Client)
  - [ ] View action items (assigned to MAS team)
  - [ ] Status (Planned, In Progress, Done, Delayed)
  - [ ] Due date tracking
  - [ ] Comments/attachments

---

## Communication Module

### Template Management
- [ ] **NativeTemplateManager.tsx** (HR/Admin)
  - [ ] Create email/SMS/WhatsApp templates
  - [ ] Handlebars variable picker ({{employee.name}}, {{payslip.month}})
  - [ ] Template categories (Onboarding, Payroll, Attendance, Performance)
  - [ ] Preview template with sample data
  - [ ] Edit/delete templates

### Dispatch Center
- [ ] **NativeDispatchCenter.tsx** (HR/Admin)
  - [ ] Send message (select template, recipients, channel)
  - [ ] Bulk send (filter by branch, department, role)
  - [ ] Schedule send (date/time)
  - [ ] Test send (to self first)

### Dispatch History
- [ ] **NativeDispatchHistory.tsx** (HR/Admin)
  - [ ] View sent messages (date, template, channel, status)
  - [ ] Retry failed messages
  - [ ] Stats (sent, delivered, failed, pending)

### Notification Preferences
- [ ] **NativeNotificationPreferences.tsx** (Employee)
  - [ ] Per-category channel selection (email/SMS/WhatsApp)
  - [ ] Enable/disable categories (Onboarding, Payroll, Attendance, etc.)
  - [ ] Save preferences

---

## System Settings (Admin Only)

### Organization Masters
- [ ] **Branch Master** (`NativeOrgMasters.tsx`)
  - [ ] Add/edit/delete branches
  - [ ] Branch code, name, location, GSTIN
  - [ ] Active/inactive flag

- [ ] **Client Master** (`NativeClientMaster.tsx`)
  - [ ] Add/edit/delete clients
  - [ ] Client code, name, contact, industry

- [ ] **Process Master**
  - [ ] Add/edit/delete processes
  - [ ] Process code, name, client mapping

- [ ] **LOB Master**
  - [ ] Add/edit/delete LOBs (Line of Business)
  - [ ] LOB code, name, description

- [ ] **Cost Centre Master**
  - [ ] Add/edit/delete cost centres
  - [ ] Cost centre code, name, manager

- [ ] **Designation Master**
  - [ ] Add/edit/delete designations
  - [ ] Designation code, name, grade

### Role Management
- [ ] **User Roles** (Admin)
  - [ ] Assign roles (Admin, HR, Manager, Employee, Client)
  - [ ] Role permissions (CRUD per module)
  - [ ] Role hierarchy (Manager can approve up to X amount)

### System Configuration
- [ ] **System Settings** (Admin)
  - [ ] Company name, logo, GSTIN
  - [ ] Financial year settings
  - [ ] Date formats, timezone
  - [ ] Email/SMS provider credentials

---

## DPDP Compliance

### Consent Management
- [ ] **NativeDPDPCompliance.tsx** (HR/Admin)
  - [ ] Track consent records (who consented to what)
  - [ ] Consent categories (Data processing, Marketing, Third-party)
  - [ ] Consent coverage statistics
  - [ ] Revoke consent option

### Data Rights Requests
- [ ] **Data Subject Requests** (HR)
  - [ ] Access request (employee wants their data)
  - [ ] Correction request (employee wants to fix data)
  - [ ] Erasure request (employee wants data deleted)
  - [ ] Portability request (export data in machine-readable format)

### Retention Policy
- [ ] **Data Retention** (Admin)
  - [ ] Configure retention periods per data type
  - [ ] Auto-delete expired data
  - [ ] Retention audit log

### Breach Register
- [ ] **Data Breach Tracking** (Admin)
  - [ ] Log data breaches
  - [ ] Breach severity, impact, remediation
  - [ ] Notification to affected users

---

## Reports & Analytics

### Pre-built Reports
- [ ] **NativeAdvancedReports.tsx** (HR/Admin)
  - [ ] Attendance report (daily, weekly, monthly)
  - [ ] Payroll report (month-wise, employee-wise)
  - [ ] Leave report (consumed, balance, pending requests)
  - [ ] Asset report (allocated, available, disposed)
  - [ ] Headcount report (joiners, leavers, attrition)

### Export Functionality
- [ ] **Export Options**
  - [ ] CSV export
  - [ ] Excel export
  - [ ] PDF export
  - [ ] Scheduled exports (weekly/monthly)

---

## Integration Hub

### Connectors
- [ ] **NativeIntegrationHub.tsx** (Admin)
  - [ ] Manual upload (CSV/Excel)
  - [ ] SQL connector (query remote DB)
  - [ ] API connector (REST/GraphQL)
  - [ ] Header mapping (map source columns to HRMS fields)
  - [ ] Validation rules (email format, phone format, etc.)
  - [ ] Sync logs (success, failed, skipped records)

### Scheduled Sync
- [ ] **Cron Jobs** (Admin)
  - [ ] Schedule daily/weekly/monthly sync
  - [ ] Sync source (Biometric device, ERP, CRM)
  - [ ] Error notifications (if sync fails)

---

## Helpdesk

### Ticket Management
- [ ] **NativeHelpdesk.tsx** (Employee/HR)
  - [ ] Raise ticket (category, priority, description)
  - [ ] Attach screenshot/document
  - [ ] Ticket assignment (auto-assign to HR/IT)
  - [ ] Ticket status (Open, In Progress, Resolved, Closed)
  - [ ] Ticket history (comments, status changes)
  - [ ] Ticket escalation (if not resolved in X hours)

---

## Expense/Reimbursement

### Expense Claims
- [ ] **NativeBenefitsClaims.tsx** (Employee)
  - [ ] Raise expense claim (category, amount, date, receipt)
  - [ ] Expense categories (Travel, Food, Stationery, Medical)
  - [ ] Attach bills (PDF/image)
  - [ ] Manager approves
  - [ ] Finance processes payment
  - [ ] Payment via NEFT or payroll integration

---

## Tax Declaration

### Investment Declaration
- [ ] **NativeTaxDeclaration.tsx** (Employee)
  - [ ] Declare investments (80C, 80D, HRA, etc.)
  - [ ] Upload proofs (LIC policy, rent receipt, medical bills)
  - [ ] Tax regime selection (Old/New)
  - [ ] Compute tax liability
  - [ ] HR verifies proofs
  - [ ] Auto-adjust TDS in payroll

---

## Departments & Org Structure

### Department Management
- [ ] **Departments.tsx** (Admin)
  - [ ] Add/edit/delete departments
  - [ ] Department head assignment
  - [ ] Department hierarchy (parent-child)
  - [ ] Headcount per department

---

## Privacy Policy & Terms

### Legal Pages
- [ ] **PrivacyPolicy.tsx** (Public)
  - [ ] Privacy policy text
  - [ ] DPDP compliance disclosure
  - [ ] Data processing details

- [ ] **Terms & Conditions** (Public)
  - [ ] Platform usage terms
  - [ ] User agreement

---

## Total Feature Count

| Category | Feature Count | Pages | API Routes |
|----------|--------------|-------|------------|
| Authentication | 7 | 2 | 8 |
| ATS | 8 modules | 12 | 15+ |
| Onboarding | 3 | 2 | 5 |
| Attendance/WFM | 3 | 5 | 10 |
| Leave | 4 | 4 | 8 |
| Payroll | 8 | 6 | 20+ |
| Performance | 3 | 3 | 10 |
| Quality | 3 | 2 | 8 |
| Assets | 2 | 2 | 6 |
| Exit | 2 | 2 | 5 |
| Client Portal | 4 | 5 | 10 |
| Communication | 4 | 4 | 8 |
| System Settings | 7 | 3 | 15 |
| DPDP | 4 | 1 | 8 |
| Reports | 2 | 1 | 5 |
| Integration Hub | 2 | 1 | 10 |
| Helpdesk | 1 | 1 | 5 |
| Expense | 1 | 1 | 5 |
| Tax | 1 | 1 | 5 |
| Departments | 1 | 1 | 5 |
| **TOTAL** | **70+** | **80+** | **200+** |

---

## Testing Priority

**P0 (Critical)**: Login, Employee CRUD, Attendance, Payroll Run, Statutory exports  
**P1 (High)**: ATS journey, Leave, Performance, RBAC validation  
**P2 (Medium)**: Assets, Exit, Client Portal, Communication  
**P3 (Low)**: Reports, Integration Hub, DPDP, Helpdesk

---

**Next Step**: Map each feature to role access matrix + create detailed test cases per feature.
