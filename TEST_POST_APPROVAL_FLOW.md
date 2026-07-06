# Post-Approval Flow Testing Guide

**Date:** 2026-07-06  
**Branch:** main  
**Backend:** http://localhost:5055  
**Frontend:** http://localhost:5173  

## Changes Implemented

### 1. Branch Head Approval Flow Fix
- ✅ Removed joining-doc redirect after approval
- ✅ In-page success banner with employee code
- ✅ Payroll HR email notification auto-sent
- ✅ All accessibility issues fixed (labels, aria-labels, focus rings, tap targets)
- ✅ Design tokens enforced (emerald-600 success, rose-600 errors, rounded-xl, text-3xl h1)

### 2. IT Provisioning Structured Forms
- ✅ IT task requires: Official Email (mandatory), Domain Account (mandatory), Asset Tag (optional)
- ✅ Backend validation: blocks submit without email+domain
- ✅ Admin task: two checkboxes (Biometric enrolled, ID card printed) — submit always allowed
- ✅ All labels associated via htmlFor/id
- ✅ 44px tap targets on all buttons

### 3. Candidate Report Panel
- ✅ Click any employee row → Sheet opens with full report
- ✅ Shows: employee identity, placement, provisioning status, official_email, domain_account, asset_tag, biometric, ID card
- ✅ Error state with retry if fetch fails
- ✅ Keyboard accessible (button in table cell with focus ring)

### 4. Bulk IT Upload
- ✅ CSV template download (columns: employee_code, official_email, domain_account, asset_tag)
- ✅ Preview table before submit
- ✅ Backend validates: email+domain required per row
- ✅ Returns success count + per-row results

### 5. BGV Provider Activated
- ✅ `BGV_PROVIDER=befisc_luckpay` in .env
- ✅ `LUCKPAY_WEBHOOK_SECRET=mas-luckpay-webhook-2026` set
- ✅ PAN, bank, UAN, DigiLocker now hit Luckpay staging
- ✅ Aadhaar/court remain manual_review (vendor creds not yet configured)

### 6. Database Migration
- ✅ Migration 362 applied: `official_email`, `domain_account`, `asset_tag`, `biometric_enrolled`, `id_card_printed` columns added to `it_provisioning_request`

---

## Test Plan

### Test 1: Branch Head Approval (No Offers Currently — Create One First)

**Setup:** Create a test offer via HR Onboarding Requests page, or use existing pending offer.

**Steps:**
1. Navigate to `/ats/branch-head-approval`
2. Verify page H1 is large (text-3xl font-black)
3. Verify "Refresh" button is 44px tap target
4. If offer exists:
   - Enter remarks (optional)
   - Click "Approve & Activate"
   - **Expected:** Green success banner appears IN PAGE (no redirect)
   - Banner shows: "Offer Approved — Employee Code EMP-XXX"
   - Message: "Payroll HR has been notified to issue joining documents"
   - Offer disappears from list
5. Verify Payroll HR received email (check `ats_email_log` for type = 'payroll_hr_notification')
6. Verify 4 provisioning tasks created in `it_provisioning_request` for new employee

**Pass Criteria:**
- ✅ No redirect to joining-docs page
- ✅ Success banner visible with employee code
- ✅ Payroll HR notification logged in DB
- ✅ 4 tasks created (IT, Admin, WFM, HR)

---

### Test 2: IT Provisioning — Structured Form Submission

**Setup:** At least one pending IT task exists (query: `SELECT * FROM it_provisioning_request WHERE task_code = 'IT_EMAIL_DOMAIN_ASSET' AND status = 'pending' LIMIT 1`)

**Steps:**
1. Navigate to `/provisioning/it`
2. Verify page shows "IT Provisioning Queue" title
3. Verify "Bulk Upload" button visible (44px tap target)
4. Click any employee row
   - **Expected:** Candidate Report Sheet opens
   - Shows: employee name, code, branch, process, DOJ, mobile (masked), official_email (if set), domain_account (if set), biometric/ID card status
   - Close sheet
5. Click "Submit Details" button on a pending task
   - **Expected:** Dialog opens with task-specific form
   - Form shows 4 fields:
     - Official Email ID Created * (required, red asterisk)
     - Domain Account / AD Username * (required)
     - Asset Tag (optional)
     - Additional Notes (optional)
6. Try submitting with empty required fields
   - **Expected:** Toast error: "Official Email and Domain Account are required"
7. Fill valid data:
   - Official Email: `john.doe@masgroup.in`
   - Domain Account: `john.d`
   - Asset Tag: `LAP-0123`
   - Notes: `Laptop issued from IT store`
8. Click "Submit & Mark Done"
   - **Expected:** Dialog closes, toast success, task status changes to "actioned"
9. Verify in DB:
   ```sql
   SELECT official_email, domain_account, asset_tag, status, evidence_note 
   FROM it_provisioning_request 
   WHERE task_code = 'IT_EMAIL_DOMAIN_ASSET' 
   ORDER BY updated_at DESC LIMIT 1;
   ```
   - official_email = `john.doe@masgroup.in`
   - domain_account = `john.d`
   - asset_tag = `LAP-0123`
   - status = `actioned`
   - evidence_note contains email

**Pass Criteria:**
- ✅ Candidate report opens on row click
- ✅ Structured IT form enforces required fields
- ✅ Data persisted correctly to DB
- ✅ Email/Domain visible in table "Email / Domain" column

---

### Test 3: Admin Provisioning — Checkbox Form

**Setup:** At least one pending Admin task exists (query: `SELECT * FROM it_provisioning_request WHERE task_code = 'ADMIN_BIOMETRIC_ID_CARD' AND status = 'pending' LIMIT 1`)

**Steps:**
1. Navigate to `/provisioning/admin`
2. Verify page shows "Admin Provisioning Queue" title
3. Click "Mark Done" on a pending task
   - **Expected:** Dialog opens with admin-specific form
   - Shows: "Check off completed actions:"
   - Two checkboxes with labels:
     - "Biometric enrollment completed"
     - "Employee ID card printed and issued"
   - Optional notes textarea
4. Check both checkboxes
5. Add note: `Biometric enrolled at HQ, ID card printed on 2026-07-06`
6. Click "Save Status"
   - **Expected:** Dialog closes, task status → "actioned"
7. Verify in DB:
   ```sql
   SELECT biometric_enrolled, id_card_printed, status, evidence_note 
   FROM it_provisioning_request 
   WHERE task_code = 'ADMIN_BIOMETRIC_ID_CARD' 
   ORDER BY updated_at DESC LIMIT 1;
   ```
   - biometric_enrolled = 1
   - id_card_printed = 1
   - status = `actioned`
8. Verify in table "Biometric / ID" column shows: "Bio: Done · ID: Done" (green text)

**Pass Criteria:**
- ✅ Admin form uses checkboxes (not text fields)
- ✅ Submit allowed even with both unchecked (no mandatory fields for Admin)
- ✅ Checkbox states persisted to DB
- ✅ Table column shows "Done"/"Pending" text (not emoji)

---

### Test 4: Bulk IT Upload

**Steps:**
1. Navigate to `/provisioning/it`
2. Click "Bulk Upload" button
   - **Expected:** Dialog opens: "Bulk IT Provisioning Upload"
3. Click "Download CSV Template"
   - **Expected:** File downloads with header: `employee_code,official_email,domain_account,asset_tag`
4. Create test CSV:
   ```csv
   employee_code,official_email,domain_account,asset_tag
   EMP001,test1@masgroup.in,test1,LAP-0001
   EMP002,test2@masgroup.in,test2,
   INVALID,,domain-only,LAP-0002
   ```
5. Upload CSV
   - **Expected:** Preview table shows 3 rows (top 10 if >10)
6. Click "Submit 3 Rows"
   - **Expected:** Backend processes each row
   - EMP001: success (all fields present)
   - EMP002: success (asset_tag optional)
   - INVALID: error (missing employee_code or no pending IT task found)
7. Toast shows: "Bulk upload: 2 / 3 tasks completed"
8. Verify tasks for EMP001 and EMP002 now have `status = 'actioned'` and structured fields populated

**Pass Criteria:**
- ✅ CSV template download works
- ✅ Preview shows parsed rows
- ✅ Backend validates per-row
- ✅ Partial success handled (some rows pass, some fail)
- ✅ Results reported in toast

---

### Test 5: Keyboard Navigation & Accessibility

**Steps:**
1. `/ats/branch-head-approval`:
   - Tab through page
   - Verify focus ring visible on all interactive elements (buttons, inputs, dismiss button)
   - Verify "Approve" button has aria-label with candidate name
   - Screen reader: verify success banner announced as status
2. `/provisioning/it`:
   - Tab to search input → verify focus ring
   - Tab to filter Selects → verify focus ring + keyboard open (Enter/Space)
   - Tab to employee row button → press Enter → candidate report opens
   - Tab to action buttons → verify aria-label announces employee name
   - Open IT form dialog → Tab through all fields → verify label/input associations (clicking label focuses input)
3. Mobile viewport (375px width):
   - Verify all buttons are 44px tap target (not 32px)
   - Verify table scrolls horizontally (no layout break)
   - Verify filters wrap to multiple rows

**Pass Criteria:**
- ✅ All interactive elements keyboard accessible
- ✅ Focus rings visible (2px blue ring)
- ✅ Labels announce correctly
- ✅ 44px minimum tap targets on mobile
- ✅ No horizontal overflow (scrollable table only)

---

### Test 6: BGV Provider Activation (Onboarding Flow)

**Setup:** Start a new candidate onboarding or resume existing Step 5 (BGV Consent).

**Steps:**
1. Navigate to candidate onboarding Step 5 (BGV)
2. Grant BGV consent
3. Attempt PAN verification
   - **Expected:** Backend log shows `[luckpay]` (not `[mock]`)
   - Luckpay staging API hit: `https://staging-api-banking.luckpay.in/apibanking/api/v1/...`
4. Attempt Bank verification (penny-less)
   - **Expected:** Luckpay staging API hit
5. Attempt DigiLocker (Step 3)
   - **Expected:** Redirect URL includes `luckpay.in` domain (not local mock)
6. Check backend logs for BGV provider confirmation:
   ```bash
   grep -i "bgv.*befisc_luckpay\|luckpay.*pan\|luckpay.*bank" /tmp/backend.log | tail -20
   ```

**Pass Criteria:**
- ✅ Backend uses `befisc_luckpay` provider (not mock)
- ✅ Luckpay staging API called for PAN/bank/DigiLocker
- ✅ Aadhaar/court checks log as `manual_review` (expected — vendor creds not configured)

---

## Rollback Plan

If issues found:

1. **Branch head redirect regression:**
   ```bash
   git diff src/pages/NativeBranchHeadApproval.tsx
   # Revert specific lines if needed
   ```

2. **IT provisioning validation too strict:**
   - Comment out validation block in `backend/src/modules/it-provisioning/it-provisioning.routes.ts` lines ~270-276

3. **DB migration breaks existing data:**
   - Columns are nullable — no data loss risk
   - To revert:
     ```sql
     ALTER TABLE it_provisioning_request
       DROP COLUMN official_email,
       DROP COLUMN domain_account,
       DROP COLUMN asset_tag,
       DROP COLUMN biometric_enrolled,
       DROP COLUMN id_card_printed;
     ```

4. **BGV provider causes errors:**
   - Set `BGV_PROVIDER=` (empty) in `.env` to revert to mock mode
   - Restart backend

---

## Current State (2026-07-06 15:30 IST)

- ✅ All code changes committed locally (not pushed)
- ✅ Backend running on port 5055
- ✅ Frontend dev server ready (port 5173)
- ✅ Migration 362 applied to dev DB (192.168.10.6)
- ✅ 18 pending provisioning tasks available for testing
- ⚠️ 0 pending offers — need to create one via HR onboarding request flow to test approval
- ✅ Design system audit passed — all HIGH/MEDIUM issues fixed
- ✅ TypeScript: both frontend and backend compile clean

**Next Steps:**
1. Test IT provisioning structured form (18 tasks available)
2. Test Admin provisioning checkboxes
3. Test candidate report panel
4. Test bulk upload
5. Create a test offer to verify branch head approval flow end-to-end
6. Verify Payroll HR email sent
7. Full keyboard/accessibility pass with Tab navigation
8. Mobile viewport testing (375px, 768px, 1024px)
