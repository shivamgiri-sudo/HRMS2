# Pending Work - ATS Journey

**Last Updated**: 2026-06-13  
**Current Progress**: 4/11 phases complete (36%)

---

## ✅ **Completed (Ready to Use)**

### Backend + Frontend Complete:
1. **Phase 7: Payroll HR Validation** ✅
   - Backend: 6 API endpoints
   - Frontend: NativePayrollHRValidation.tsx
   - Feature: salary_start_date management
   - Status: 100% working

### Backend Complete (Frontend Pending):
2. **Phase 1: Registration** ✅
   - Backend: 4 API endpoints
   - Services: Branch aliases, recruiter assignment, tokens
   - Frontend: NativeATSCandidateRegistration.tsx exists but needs enhancement

3. **Phase 2: Email System** ✅
   - 6 HTML email templates
   - All email functions working
   - Integrated with registration and interview

4. **Phase 4: Interview Portal** ✅
   - Backend: 6 API endpoints
   - Services: Interview submission, ratings, performance metrics
   - Frontend: Need to create NativeRecruiterPortal.tsx

---

## 🚧 **Pending Work - Prioritized**

### **Priority 1: Critical Path (30-40 hours)**

#### 1. Phase 3: Live Queue Portal
**Estimated Time:** 10-12 hours

**Backend Needed:**
- [ ] `queue.enhanced.service.ts` (200 lines)
  - Real-time queue fetching with filters
  - Queue status updates
  - Next candidate logic
  - Waiting time calculation
  - WebSocket or polling support

- [ ] `queue.routes.ts` (100 lines)
  - GET `/api/ats/queue/live` - Live queue data
  - POST `/api/ats/queue/update-status` - Update queue status
  - GET `/api/ats/queue/metrics` - Queue metrics
  - WebSocket endpoint for real-time updates

**Frontend Needed:**
- [ ] Enhance `NativeWalkinQueue.tsx` (existing file)
  - Real-time updates (WebSocket or 5s polling)
  - Advanced filters (branch, date, status, recruiter)
  - Search (name, mobile, candidate ID, token)
  - Status badges with colors
  - Next candidate button
  - Sound notifications

**Key Features:**
- Real-time queue display
- Recruiter can see assigned candidates
- Status transitions (waiting → called → in_interview → completed)
- Queue metrics (wait time, active interviews)

---

#### 2. Frontend Integration for Completed Backend APIs
**Estimated Time:** 15-20 hours

**A. Registration Form Enhancement** (5-6 hours)
- [ ] Update `NativeATSCandidateRegistration.tsx`
- [ ] Integrate `/api/ats/registration/branch-aliases` for dropdown
- [ ] Integrate `/api/ats/registration/recruiters/:branchName` for recruiter dropdown
- [ ] Use `/api/ats/registration/submit-enhanced` for submission
- [ ] Show success message with token number
- [ ] Email confirmation display

**B. Recruiter Interview Portal** (8-10 hours)
- [ ] Create `NativeRecruiterPortal.tsx`
- [ ] Assigned candidates list (GET `/api/ats/interview/assigned-candidates`)
- [ ] Candidate details view (GET `/api/ats/interview/candidate/:id`)
- [ ] Interview result form
  - Communication rating (1-5 stars)
  - Stability rating (1-5 stars)
  - Fit scores (checkboxes: salary, shift, location, role)
  - Interview status selector
  - Rejection reason (if rejected)
  - Remarks textarea
- [ ] Submit button (POST `/api/ats/interview/submit-result`)
- [ ] Performance metrics dashboard (GET `/api/ats/interview/performance`)
- [ ] Queue status update buttons (POST `/api/ats/interview/update-queue-status`)

**C. Add Routes** (2 hours)
- [ ] Add `/payroll-hr-validation` route
- [ ] Add `/recruiter-portal` route
- [ ] Add `/live-queue` route
- [ ] Add navigation links in sidebar

---

### **Priority 2: Core Features (25-30 hours)**

#### 3. Phase 5: Candidate Portal + Onboarding
**Estimated Time:** 12-15 hours

**Backend Needed:**
- [ ] `candidate-auth.service.ts` (150 lines)
  - Login authentication
  - Password reset flow
  - Session management

- [ ] `onboarding.enhanced.service.ts` (200 lines)
  - Auto-populate fields from candidate data
  - Save draft functionality
  - Submit onboarding
  - Document upload handling
  - Validation

**Frontend Needed:**
- [ ] Create `CandidatePortal/Login.tsx`
  - Login form (email + temp password)
  - Password reset link
  - First-time password change

- [ ] Enhance `CandidateOnboardingFullPage.tsx` (existing)
  - Multi-step form (personal, identity, education, bank, etc.)
  - Document uploads (Aadhaar, PAN, photo, resume)
  - Save draft button
  - Progress indicator
  - Submit button

**Status:** Partial (existing onboarding pages need enhancement)

---

#### 4. Phase 11: ATS Command Centre
**Estimated Time:** 10-12 hours

**Backend Needed:**
- [ ] `command-centre.service.ts` (250 lines)
  - Funnel metrics (registered → interviewed → selected → joined)
  - Live queue count
  - Average wait time
  - Recruiter productivity
  - Branch-wise productivity
  - Pending bottlenecks

- [ ] `command-centre.routes.ts` (100 lines)
  - GET `/api/ats/command-centre/metrics`
  - GET `/api/ats/command-centre/funnel`
  - GET `/api/ats/command-centre/recruiter-performance`
  - GET `/api/ats/command-centre/branch-performance`

**Frontend Needed:**
- [ ] Enhance `NativeATSCommandCentre.tsx` (existing)
  - Connect to real data APIs
  - Filters (today/WTD/MTD, branch, process)
  - Live funnel chart
  - Recruiter productivity table
  - Branch comparison
  - Auto-refresh (30s)

**Status:** Partial (existing command centre needs API integration)

---

### **Priority 3: Workflow Completion (20-25 hours)**

#### 5. Phase 6: BGV Integration
**Estimated Time:** 8-10 hours

**Backend Needed:**
- [ ] Enhance `bgv-verification.service.ts` (existing)
  - Vendor API integration layer
  - Status tracking
  - Webhook handler
  - Manual update fallback

**Frontend Needed:**
- [ ] Create `CandidatePortal/BGVInitiation.tsx`
  - BGV initiation button
  - Status display
  - Consent checkbox
  - Progress tracker

**Status:** Partial (bgv service exists, needs completion)

---

#### 6. Phase 8: Branch Head Approval
**Estimated Time:** 8-10 hours

**Backend Needed:**
- [ ] `branch-head.service.ts` (200 lines)
  - Fetch pending approvals
  - Approve/Reject/Send back actions
  - Generate employee code on approval
  - Convert candidate to employee
  - Log approval audit trail

- [ ] `branch-head.routes.ts` (100 lines)
  - GET `/api/ats/branch-head/pending-approvals`
  - POST `/api/ats/branch-head/approve`
  - POST `/api/ats/branch-head/reject`
  - POST `/api/ats/branch-head/send-back`

**Frontend Needed:**
- [ ] Create `NativeBranchHeadApproval.tsx`
  - Pending approvals list
  - Candidate summary view
  - Salary details review
  - Approve/Reject/Send back buttons
  - Employee code display after approval

**Key Feature:**
- On approval, triggers employee code generation
- Converts candidate to employee
- Sends welcome email

---

### **Priority 4: Admin Features (10-15 hours)**

#### 7. Phase 9: Super Admin Module Access
**Estimated Time:** 6-8 hours

**Backend Needed:**
- [ ] `admin/module-access.service.ts` (150 lines)
  - Search employees
  - Get current module access
  - Assign module access
  - Remove access
  - Audit log

- [ ] `admin/module-access.routes.ts` (80 lines)
  - GET `/api/admin/module-access/search`
  - GET `/api/admin/module-access/:employeeId`
  - POST `/api/admin/module-access/assign`
  - POST `/api/admin/module-access/remove`
  - GET `/api/admin/module-access/audit`

- [ ] Middleware for access control

**Frontend Needed:**
- [ ] Create `SuperAdminModuleAccess.tsx`
  - Employee search
  - Current access display
  - Module assignment UI (checkboxes)
  - Save button
  - Audit log viewer

**Super Admin:** MAS47814

---

#### 8. Phase 10: Cost Centre Master
**Estimated Time:** 5-6 hours

**Backend Needed:**
- [ ] `org/cost-centre.service.ts` (120 lines)
  - CRUD operations
  - Validation (prevent deletion if in use)
  - Search/filter

- [ ] `org/cost-centre.routes.ts` (80 lines)
  - Standard CRUD endpoints

**Frontend Needed:**
- [ ] Create `CostCentreMaster.tsx`
  - List with pagination
  - Create/Edit form modal
  - Delete confirmation
  - Search/filter
  - Status toggle
  - Same UI as other masters

---

## 📊 **Summary by Work Type**

### Backend Services to Create:
- [ ] queue.enhanced.service.ts (200 lines)
- [ ] queue.routes.ts (100 lines)
- [ ] candidate-auth.service.ts (150 lines)
- [ ] onboarding.enhanced.service.ts (200 lines)
- [ ] command-centre.service.ts (250 lines)
- [ ] command-centre.routes.ts (100 lines)
- [ ] branch-head.service.ts (200 lines)
- [ ] branch-head.routes.ts (100 lines)
- [ ] admin/module-access.service.ts (150 lines)
- [ ] admin/module-access.routes.ts (80 lines)
- [ ] org/cost-centre.service.ts (120 lines)
- [ ] org/cost-centre.routes.ts (80 lines)

**Total Backend:** ~1,730 lines

### Frontend Pages to Create/Enhance:
- [ ] NativeATSCandidateRegistration.tsx (enhance)
- [ ] NativeRecruiterPortal.tsx (create)
- [ ] NativeWalkinQueue.tsx (enhance)
- [ ] CandidatePortal/Login.tsx (create)
- [ ] CandidateOnboardingFullPage.tsx (enhance)
- [ ] CandidatePortal/BGVInitiation.tsx (create)
- [ ] NativeBranchHeadApproval.tsx (create)
- [ ] SuperAdminModuleAccess.tsx (create)
- [ ] CostCentreMaster.tsx (create)
- [ ] NativeATSCommandCentre.tsx (enhance)

**Total Frontend:** ~3,000-4,000 lines

### Routes & Navigation:
- [ ] Add 10 new routes
- [ ] Update sidebar/menu
- [ ] Add role-based route guards

---

## ⏱️ **Time Estimates**

| Priority | Work | Backend | Frontend | Total |
|----------|------|---------|----------|-------|
| **P1** | Queue + Integrations | 10h | 20h | 30h |
| **P2** | Onboarding + Command | 15h | 10h | 25h |
| **P3** | BGV + Approval | 10h | 10h | 20h |
| **P4** | Admin Features | 8h | 7h | 15h |
| **TOTAL** | | **43h** | **47h** | **90h** |

---

## 🎯 **Recommended Next Steps**

### Option 1: Complete Critical Path (30-40 hours)
**Focus:** Get core hiring flow working end-to-end
1. Live Queue Portal (10h)
2. Recruiter Interview Portal frontend (10h)
3. Registration form enhancement (5h)
4. Routes and navigation (2h)
5. End-to-end testing (5h)

**Result:** Complete hiring flow from registration to interview selection

### Option 2: Complete Workflow (50-60 hours)
**Focus:** Full candidate journey to employee
1. Critical Path (30h)
2. Candidate Portal + Onboarding (12h)
3. Branch Head Approval (8h)
4. End-to-end testing (10h)

**Result:** Complete flow from candidate to employee

### Option 3: Feature Completion (90+ hours)
**Focus:** All 11 phases fully functional
1. Critical Path (30h)
2. Workflow Completion (20h)
3. Admin Features (15h)
4. Command Centre (10h)
5. Testing & Polish (15h)

**Result:** Production-ready ATS system

---

## 🚀 **Quick Wins (2-4 hours each)**

These can be done quickly for immediate value:

### 1. Add Routes (2 hours)
- Add payroll-hr-validation route
- Add navigation links
- Test existing completed pages

### 2. Registration Form Enhancement (4 hours)
- Add branch alias dropdown
- Add recruiter dropdown
- Test with backend APIs

### 3. Command Centre Data Integration (3 hours)
- Connect existing charts to real APIs
- Add filters
- Add auto-refresh

### 4. Queue Real-time Updates (3 hours)
- Add 5-second polling
- Update status badges
- Add sound notification

---

## 📝 **Current Status**

**Completed:**
- ✅ 4/11 phases (36%)
- ✅ 22 API endpoints
- ✅ 1 frontend page (Payroll HR)
- ✅ All email templates
- ✅ All documentation

**Pending:**
- ⏳ 7/11 phases (64%)
- ⏳ ~28 API endpoints
- ⏳ ~10 frontend pages
- ⏳ Routes and navigation
- ⏳ End-to-end testing

**Estimated Remaining:** 90 hours (2-3 weeks full-time)

---

## 💡 **Recommendation**

**Start with Option 1 (Critical Path)** to get immediate value:
1. Build Live Queue Portal (highest priority)
2. Build Recruiter Interview Portal frontend
3. Enhance Registration form
4. Add routes and test

This gives you a **working hiring flow** in 30-40 hours.

Then decide whether to:
- Continue to full workflow (Option 2)
- Add admin features (Option 3)
- Or stop and test what you have

---

**Next Immediate Task:** Build Live Queue Portal (backend + frontend, ~10 hours)
