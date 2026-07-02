# ATS Complete Journey - Implementation Plan

**Status**: In Progress  
**Date**: 2026-06-13  
**Scope**: Full ATS journey from candidate registration to employee code generation

---

## ✅ Completed

### 1. Database Schema
- Created `138_ats_complete_journey.sql` migration
- Enhanced `ats_candidate` table structure
- Created tables:
  - `ats_recruiter_assignment_log`
  - `ats_interview_result`
  - `ats_candidate_portal_login`
  - `ats_bgv_initiation`
  - `ats_payroll_hr_validation`
  - `ats_branch_head_approval`
  - `employee_code_generation_log`
  - `employee_code_sequence`
  - `cost_centre_master`
  - `module_access_control`
  - `module_access_audit_log`
  - `portal_notification`

### 2. Backend Services
- Created `ats.enhanced.service.ts` with:
  - Branch alias resolution
  - Recruiter availability checking (via biometric)
  - Smart recruiter assignment logic
  - Token generation (branch-wise, day-wise)
  - Employee code generation with locking
  - Assignment logging

---

## 🚧 Implementation Roadmap

### Phase 1: Candidate Registration (Priority 1)
**Files to Create/Modify:**
1. `backend/src/modules/ats/registration.service.ts`
   - Branch alias dropdown
   - Recruiter list by branch + department + designation filter
   - Photo capture/upload handling
   - Resume parsing (PDF/DOC/DOCX)
   - Registration submission
   - Token generation
   - Recruiter assignment

2. `backend/src/modules/ats/registration.routes.ts`
   - POST `/api/ats/registration/submit`
   - GET `/api/ats/registration/branch-aliases`
   - GET `/api/ats/registration/recruiters/:branchName`
   - POST `/api/ats/registration/upload-photo`
   - POST `/api/ats/registration/upload-resume`
   - POST `/api/ats/registration/parse-resume`

3. `src/pages/NativeCandidateRegistration.tsx`
   - Modern form UI
   - Branch display name dropdown (Trapezoid, Okaya, Jaldarshan, Dialdesk)
   - Recruiter dropdown filtered by branch
   - Camera capture component
   - Resume upload + parsing
   - Live preview
   - Validation

### Phase 2: Email Notifications (Priority 1)
**Files to Create/Modify:**
1. `backend/src/modules/ats/email.templates.ts`
   - Candidate success HTML email
   - Recruiter arrival notification
   - Selection congratulations email
   - Onboarding login credentials email
   - BGV completion notification
   - Payroll HR notification
   - Branch head approval request

2. `backend/src/modules/ats/notification.service.ts`
   - Email sending logic
   - In-portal notification creation
   - Notification logging

### Phase 3: Live Queue Portal (Priority 1)
**Files to Create/Modify:**
1. `backend/src/modules/ats/queue.enhanced.service.ts`
   - Real-time queue fetching
   - Queue status updates
   - Next candidate logic
   - Waiting time calculation

2. `src/pages/NativeLiveQueue.tsx`
   - Real-time queue display
   - Filters (branch, date, status, recruiter)
   - Search (name, mobile, candidate ID, token)
   - Status badges
   - Auto-refresh/WebSocket
   - Sound notifications

### Phase 4: Recruiter Interview Portal (Priority 2)
**Files to Create/Modify:**
1. `backend/src/modules/ats/interview.service.ts`
   - Assigned candidates list
   - Interview result submission
   - Rating calculations
   - Status transitions

2. `backend/src/modules/ats/interview.routes.ts`
   - GET `/api/ats/interview/assigned-candidates`
   - POST `/api/ats/interview/submit-result`
   - GET `/api/ats/interview/candidate/:id/history`

3. `src/pages/NativeRecruiterPortal.tsx`
   - Assigned candidates list
   - Candidate full profile view
   - Interview result form
   - Ratings (communication, stability, salary/shift/location/role fit)
   - Rejection reasons
   - Submit button

### Phase 5: Candidate Portal + Onboarding (Priority 2)
**Files to Create/Modify:**
1. `backend/src/modules/ats/candidate-auth.service.ts`
   - Generate login credentials
   - Temporary password generation
   - Authentication
   - Password reset

2. `backend/src/modules/ats/onboarding.enhanced.service.ts`
   - Auto-populate fields
   - Save draft
   - Submit onboarding
   - Document upload
   - Validation

3. `src/pages/CandidatePortal/Login.tsx`
   - Login form (email + temp password)
   - Password reset

4. `src/pages/CandidatePortal/OnboardingForm.tsx`
   - Personal details
   - Identity details (Aadhaar, PAN, etc.)
   - Education details
   - Employment history
   - Bank details
   - Emergency contact
   - Nominee details
   - Document uploads (Aadhaar, PAN, photo, resume, etc.)
   - Declarations
   - Save draft / Submit

### Phase 6: BGV Integration (Priority 3)
**Files to Create/Modify:**
1. `backend/src/modules/ats/bgv.service.ts`
   - BGV initiation
   - Vendor API integration layer
   - Status tracking
   - Webhook/callback handler
   - Manual update fallback

2. `backend/src/modules/ats/bgv.routes.ts`
   - POST `/api/ats/bgv/initiate`
   - GET `/api/ats/bgv/status/:candidateId`
   - POST `/api/ats/bgv/webhook`
   - POST `/api/ats/bgv/manual-update`

3. `src/pages/CandidatePortal/BGVInitiation.tsx`
   - BGV initiation button
   - Status display
   - Consent checkbox

### Phase 7: Payroll HR Validation (Priority 3)
**Files to Create/Modify:**
1. `backend/src/modules/ats/payroll-hr.service.ts`
   - Fetch BGV-completed candidates
   - Salary slab assignment
   - Salary component validation
   - Compliance checks
   - Submit for branch head approval

2. `backend/src/modules/ats/payroll-hr.routes.ts`
   - GET `/api/ats/payroll-hr/pending-candidates`
   - POST `/api/ats/payroll-hr/validate`
   - POST `/api/ats/payroll-hr/assign-salary`

3. `src/pages/NativePayrollHRValidation.tsx`
   - Pending candidates list
   - Full candidate details + documents
   - Salary slab dropdown
   - Salary component editor
   - Compliance alerts
   - Employment type (onroll/offrole)
   - Company, designation, department, process, cost centre
   - Reporting manager
   - Joining date
   - Submit button

### Phase 8: Branch Head Approval (Priority 3)
**Files to Create/Modify:**
1. `backend/src/modules/ats/branch-head.service.ts`
   - Fetch pending approvals
   - Approve/Reject/Send back
   - Generate employee code on approval
   - Convert candidate to employee

2. `backend/src/modules/ats/branch-head.routes.ts`
   - GET `/api/ats/branch-head/pending-approvals`
   - POST `/api/ats/branch-head/approve`
   - POST `/api/ats/branch-head/reject`

3. `src/pages/NativeBranchHeadApproval.tsx`
   - Pending approvals list
   - Review summary
   - Approve/Reject/Send back buttons

### Phase 9: Super Admin Module Access (Priority 4)
**Files to Create/Modify:**
1. `backend/src/modules/admin/module-access.service.ts`
   - Search employees
   - Get current access
   - Assign module access
   - Remove access
   - Audit log

2. `backend/src/modules/admin/module-access.routes.ts`
   - GET `/api/admin/module-access/search`
   - GET `/api/admin/module-access/:employeeId`
   - POST `/api/admin/module-access/assign`
   - POST `/api/admin/module-access/remove`
   - GET `/api/admin/module-access/audit`

3. `src/pages/SuperAdminModuleAccess.tsx`
   - Employee search
   - Current access display
   - Module assignment UI
   - Audit log

**Middleware:**
- Route guard for module access checking
- API permission middleware

### Phase 10: Cost Centre Master (Priority 4)
**Files to Create/Modify:**
1. `backend/src/modules/org/cost-centre.service.ts`
   - CRUD operations
   - Validation (prevent deletion if in use)
   - Search/filter

2. `backend/src/modules/org/cost-centre.routes.ts`
   - Standard CRUD endpoints

3. `src/pages/CostCentreMaster.tsx`
   - List/Create/Edit/Delete
   - Search/filter
   - Status toggle
   - Same UI quality as other masters

### Phase 11: ATS Command Centre (Priority 2)
**Files to Create/Modify:**
1. `backend/src/modules/ats/command-centre.service.ts`
   - Funnel metrics (registered, interviewed, selected, etc.)
   - Live queue count
   - Average wait time
   - Recruiter productivity
   - Branch-wise productivity
   - Pending bottlenecks
   - Aging report

2. `backend/src/modules/ats/command-centre.routes.ts`
   - GET `/api/ats/command-centre/metrics`
   - GET `/api/ats/command-centre/funnel`
   - GET `/api/ats/command-centre/recruiter-performance`
   - GET `/api/ats/command-centre/branch-performance`

3. `src/pages/NativeATSCommandCentre.tsx` (enhance existing)
   - Connect all components to real data
   - Filters (today/WTD/MTD, branch, process, role, recruiter)
   - Live funnel
   - Recruiter productivity table
   - Branch productivity
   - Bottleneck alerts
   - Auto-refresh

---

## 📋 Critical Dependencies

### 1. Branch Mapping
| Backend Actual | Display Name |
|----------------|-------------|
| NOIDA | Trapezoid |
| NOIDA-2 / Noida 1 | Okaya |
| AHEMDABAD JALDARSHAN / Ahmedabad Jaldarshan | Jaldarshan |
| NOIDA-DIALDESK / NOIDA-DD | Dialdesk |

### 2. Recruiter Criteria
- Department: `Human Resource`
- Designation: `Executive`
- Branch: Same as candidate selected branch
- Attendance: Present today (checked via `wfm_daily_attendance` WHERE `clock_in_time IS NOT NULL`)

### 3. Employee Code Logic
- **MAS** prefix: Mascallnet company
- **IDC** prefix: Ispark Data Connect company
- **Ends with C**: Offrole/contractual (no PF/ESI deduction)
- Must be unique, sequential, transaction-safe

### 4. Super Admin
- Employee Code: **MAS47814**
- Full access to module_access_control system

---

## 🎨 UI/UX Requirements

1. **Modern, Clean Design**
   - Professional spacing
   - Clear status badges (use SmartHR colors)
   - Responsive
   - Good empty/loading/error states

2. **Email Templates**
   - HTML with company logo
   - Professional styling
   - Clear CTAs
   - Mobile-friendly

3. **Photo Capture**
   - Live camera preview
   - Capture/retake
   - Crop/fit
   - Upload fallback
   - Camera permission handling

4. **Resume Parsing**
   - Support PDF/DOC/DOCX
   - Extract: name, mobile, email, education, experience, skills, company, designation, address
   - Show parsed values in editable fields
   - Don't block if parsing fails
   - Store original + parsed JSON

---

## 🔒 Security

1. **Access Control**
   - Recruiter can only modify assigned candidates
   - Branch users see only their branch
   - Candidate portal shows only own data
   - Backend permission checks on all APIs

2. **Data Protection**
   - Secure file uploads
   - Hashed passwords
   - Temp password requires reset
   - Audit logs for sensitive actions

---

## ✅ Testing Checklist

1. Candidate registration with branch alias
2. Recruiter list filtered by branch + HR + Executive
3. Recruiter availability through biometric
4. Preferred recruiter assignment
5. Fallback when preferred recruiter unavailable
6. Token generation (branch-wise, day-wise)
7. Candidate success email
8. Recruiter notification email
9. Live queue updates
10. Interview result submission
11. Selection email + onboarding login
12. Candidate portal login
13. Onboarding form auto-population
14. Document uploads
15. BGV initiation
16. Payroll HR notification
17. Salary validation
18. Branch head approval
19. Employee code generation
20. Super admin module access
21. Cost centre CRUD
22. Command centre live data

---

## 📦 Files Created

### Backend
- `backend/sql/138_ats_complete_journey.sql` ✅
- `backend/src/modules/ats/ats.enhanced.service.ts` ✅
- `backend/src/modules/ats/registration.service.ts` (TODO)
- `backend/src/modules/ats/registration.routes.ts` (TODO)
- `backend/src/modules/ats/email.templates.ts` (TODO)
- `backend/src/modules/ats/notification.service.ts` (TODO)
- `backend/src/modules/ats/queue.enhanced.service.ts` (TODO)
- `backend/src/modules/ats/interview.service.ts` (TODO)
- `backend/src/modules/ats/interview.routes.ts` (TODO)
- `backend/src/modules/ats/candidate-auth.service.ts` (TODO)
- `backend/src/modules/ats/onboarding.enhanced.service.ts` (TODO)
- `backend/src/modules/ats/bgv.service.ts` (TODO)
- `backend/src/modules/ats/bgv.routes.ts` (TODO)
- `backend/src/modules/ats/payroll-hr.service.ts` (TODO)
- `backend/src/modules/ats/payroll-hr.routes.ts` (TODO)
- `backend/src/modules/ats/branch-head.service.ts` (TODO)
- `backend/src/modules/ats/branch-head.routes.ts` (TODO)
- `backend/src/modules/ats/command-centre.service.ts` (TODO)
- `backend/src/modules/ats/command-centre.routes.ts` (TODO)
- `backend/src/modules/admin/module-access.service.ts` (TODO)
- `backend/src/modules/admin/module-access.routes.ts` (TODO)
- `backend/src/modules/org/cost-centre.service.ts` (TODO)
- `backend/src/modules/org/cost-centre.routes.ts` (TODO)

### Frontend
- `src/pages/NativeCandidateRegistration.tsx` (TODO)
- `src/pages/NativeLiveQueue.tsx` (TODO)
- `src/pages/NativeRecruiterPortal.tsx` (TODO)
- `src/pages/CandidatePortal/Login.tsx` (TODO)
- `src/pages/CandidatePortal/OnboardingForm.tsx` (TODO)
- `src/pages/CandidatePortal/BGVInitiation.tsx` (TODO)
- `src/pages/NativePayrollHRValidation.tsx` (TODO)
- `src/pages/NativeBranchHeadApproval.tsx` (TODO)
- `src/pages/SuperAdminModuleAccess.tsx` (TODO)
- `src/pages/CostCentreMaster.tsx` (TODO)
- `src/pages/NativeATSCommandCentre.tsx` (ENHANCE)

### Components
- `src/components/ats/PhotoCapture.tsx` (TODO)
- `src/components/ats/ResumeParser.tsx` (TODO)
- `src/components/ats/RecruiterDropdown.tsx` (TODO)
- `src/components/ats/BranchAliasDropdown.tsx` (TODO)

---

**Status**: Foundation laid. Ready for phased implementation.  
**Next Steps**: Implement Phase 1 (Registration) → Phase 2 (Emails) → Phase 3 (Queue) in priority order.  
**Estimated Time**: 80-120 hours for complete implementation + testing.
