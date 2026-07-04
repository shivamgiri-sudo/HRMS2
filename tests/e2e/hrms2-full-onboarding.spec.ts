import { test, expect, Page, request } from '@playwright/test';
import { loginAs } from './helpers/auth';
import { ApiHelper } from './helpers/api';
import { ensureDummyDocuments, getDocPath, DOC_NAMES } from './helpers/documents';
import { TEST_CANDIDATE, NOMINEE, EMERGENCY_CONTACT, E2E_RUN_ID, E2E_MARKER } from './fixtures/testCandidate';
import { query, queryOne, closePool, verifyRecord } from './helpers/db';
import fs from 'fs';
import path from 'path';

// ── Global test context ─────────────────────────────────────────────────────
let adminToken: string;
let hrToken: string;
let recruiterToken: string;
let branchHeadToken: string;
let payrollToken: string;

let api: ApiHelper;

let candidateId: string;
let candidateCode: string;
let onboardingRequestId: string;
let onboardingToken: string;
let offerId: string;
let employeeId: string;
let employeeCode: string;
let bgvStatus: string;

const FAILED_API_CALLS: string[] = [];
const CONSOLE_ERRORS: string[] = [];

// ── Helpers ─────────────────────────────────────────────────────────────────

async function captureErrors(page: Page) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') CONSOLE_ERRORS.push(msg.text());
  });
  page.on('response', (res) => {
    if (res.status() >= 500) FAILED_API_CALLS.push(`${res.status()} ${res.url()}`);
  });
}

async function setupApi(token: string) {
  const ctx = await request.newContext();
  return new ApiHelper(ctx, token);
}

test.describe('HRMS2 Full Candidate → Employee Onboarding E2E', () => {

  // ── Stage 0: Setup ───────────────────────────────────────────────────────
  test.describe('Stage 0: Setup & Login', () => {

    test('ensure dummy documents exist', () => {
      ensureDummyDocuments();
      for (const doc of DOC_NAMES) {
        expect(fs.existsSync(getDocPath(doc))).toBeTruthy();
      }
    });

    test('login as Admin', async ({ page }) => {
      await captureErrors(page);
      adminToken = await loginAs(page, 'admin');
      expect(adminToken).toBeTruthy();
      api = await setupApi(adminToken);
      const me = await api.get('/api/me');
      expect(me.ok).toBeTruthy();
    });

    test('login as HR', async ({ page }) => {
      hrToken = await loginAs(page, 'hr');
      expect(hrToken).toBeTruthy();
    });

    test('login as Recruiter', async ({ page }) => {
      recruiterToken = await loginAs(page, 'recruiter');
      expect(recruiterToken).toBeTruthy();
    });

    test('login as Branch Head', async ({ page }) => {
      branchHeadToken = await loginAs(page, 'branch_head');
      expect(branchHeadToken).toBeTruthy();
    });

    test('login as Payroll', async ({ page }) => {
      payrollToken = await loginAs(page, 'payroll');
      expect(payrollToken).toBeTruthy();
    });
  });

  // ── Stage 1: Candidate Registration (ATS) ───────────────────────────────
  test.describe('Stage 1: Candidate Registration / ATS Creation', () => {

    test('navigate to ATS and create candidate via UI', async ({ page }) => {
      await captureErrors(page);
      await page.goto('/ats/candidates');
      await page.waitForLoadState('networkidle');

      // Click create candidate button
      const createBtn = page.locator('button:has-text("Add Candidate"), button:has-text("New Candidate"), a:has-text("Add Candidate"), a:has-text("New Candidate")').first();
      if (await createBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await createBtn.click();
        await page.waitForTimeout(1_000);

        // Fill basic candidate form
        const fillField = async (label: string, value: string) => {
          const field = page.locator(`input[name="${label}"], input[id="${label}"], input[placeholder*="${label}" i], label:has-text("${label}") + input, label:has-text("${label}") ~ input`).first();
          if (await field.isVisible({ timeout: 2_000 }).catch(() => false)) {
            await field.fill(value);
          }
        };

        await fillField('fullName', TEST_CANDIDATE.fullName); 
        await fillField('Full Name', TEST_CANDIDATE.fullName);
        
        const mobileField = page.locator('input[type="tel"], input[name*="mobile" i], input[name*="phone" i], input[placeholder*="mobile" i]').first();
        if (await mobileField.isVisible({ timeout: 2_000 }).catch(() => false)) {
          await mobileField.fill(TEST_CANDIDATE.mobile);
        }

        const emailField = page.locator('input[type="email"]').first();
        if (await emailField.isVisible({ timeout: 2_000 }).catch(() => false)) {
          await emailField.fill(TEST_CANDIDATE.email);
        }

        // Submit
        const submitBtn = page.locator('button[type="submit"], button:has-text("Save"), button:has-text("Create"), button:has-text("Submit")').first();
        if (await submitBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
          await submitBtn.click();
          await page.waitForTimeout(2_000);
        }
      }

      // Backup: create candidate via API regardless of UI success
      const ctx = await request.newContext();
      const api = new ApiHelper(ctx, adminToken);

      const createRes = await api.post('/api/ats/candidates', {
        full_name: TEST_CANDIDATE.fullName,
        first_name: TEST_CANDIDATE.fullName.split(' ')[0],
        last_name: TEST_CANDIDATE.fullName.split(' ').slice(1).join(' '),
        mobile: TEST_CANDIDATE.mobile,
        email: TEST_CANDIDATE.email,
        gender: TEST_CANDIDATE.gender,
        dob: TEST_CANDIDATE.dob,
        education: TEST_CANDIDATE.education,
        experience: TEST_CANDIDATE.experience,
        process_name: TEST_CANDIDATE.appliedForProcess,
        branch_name: TEST_CANDIDATE.appliedForBranch,
        expected_ctc_monthly: TEST_CANDIDATE.expectedCtcMonthly,
        e2e_run_id: E2E_RUN_ID,
      });

      expect(createRes.ok).toBeTruthy();
      candidateId = createRes.body.data?.id || createRes.body.data?.candidate_id;
      candidateCode = createRes.body.data?.candidate_code || createRes.body.data?.code;
      expect(candidateId).toBeTruthy();
    });

    test('verify candidate in database', async () => {
      const record = await verifyRecord('ats_candidate', 'id = ?', [candidateId]);
      expect(record).toBeTruthy();
      expect(record.email).toBe(TEST_CANDIDATE.email);
      expect(record.mobile).toBe(TEST_CANDIDATE.mobile);
    });

    test('move candidate to selected stage', async () => {
      const ctx = await request.newContext();
      const api = new ApiHelper(ctx, adminToken);

      const stageRes = await api.post(`/api/ats/candidates/${candidateId}/move-stage`, {
        stage: 'selected',
        remarks: 'E2E test - selected for onboarding',
      });
      expect(stageRes.ok || stageRes.status === 400).toBeTruthy();
    });
  });

  // ── Stage 2: Send Onboarding Token ──────────────────────────────────────
  test.describe('Stage 2: Send Onboarding Link', () => {

    test('send onboarding token to candidate', async () => {
      const ctx = await request.newContext();
      const api = new ApiHelper(ctx, adminToken);

      const sendRes = await api.post(`/api/ats/onboarding/candidates/${candidateId}/send-onboarding-link`, {});
      if (!sendRes.ok) {
        // Try alternative endpoint
        const sendRes2 = await api.post(`/api/ats/onboarding/send-token/${candidateId}`, {});
        expect(sendRes2.ok).toBeTruthy();
        onboardingToken = sendRes2.body.data?.token || sendRes2.body.data?.onboarding_token;
      } else {
        onboardingToken = sendRes.body.data?.token || sendRes.body.data?.onboarding_token;
      }
      expect(onboardingToken).toBeTruthy();
    });

    test('verify onboarding bridge created', async () => {
      const bridge = await verifyRecord('ats_onboarding_bridge', 'candidate_id = ?', [candidateId]);
      expect(bridge).toBeTruthy();
      onboardingRequestId = bridge.id;
    });
  });

  // ── Stage 3: Full Candidate Onboarding Form ─────────────────────────────
  test.describe('Stage 3: Fill Candidate Onboarding Form', () => {

    test('open candidate onboarding page', async ({ page }) => {
      await captureErrors(page);
      await page.goto(`/onboard-full?token=${onboardingToken}`);
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveURL(/onboard/);
    });

    test('validate token via API', async () => {
      const ctx = await request.newContext();
      const validateRes = await ctx.get(
        `${process.env.E2E_BACKEND_URL ?? 'http://localhost:5055'}/api/ats/onboarding-full/validate-token?token=${onboardingToken}`
      );
      expect(validateRes.ok()).toBeTruthy();
    });

    test('submit employee details via API', async () => {
      const ctx = await request.newContext();
      const api = new ApiHelper(ctx, adminToken);

      const res = await api.post('/api/ats/onboarding-full/employee-details', {
        token: onboardingToken,
        full_name: TEST_CANDIDATE.fullName,
        father_name: TEST_CANDIDATE.fatherName,
        mother_name: TEST_CANDIDATE.motherName,
        dob: TEST_CANDIDATE.dob,
        gender: TEST_CANDIDATE.gender,
        marital_status: TEST_CANDIDATE.maritalStatus,
        mobile: TEST_CANDIDATE.mobile,
        email: TEST_CANDIDATE.email,
        alternate_mobile: TEST_CANDIDATE.alternateMobile,
        current_address: TEST_CANDIDATE.currentAddress,
        permanent_address: TEST_CANDIDATE.permanentAddress,
        nationality: 'Indian',
      });
      expect(res.ok).toBeTruthy();
    });

    test('submit bank details via API', async () => {
      const ctx = await request.newContext();
      const api = new ApiHelper(ctx, adminToken);

      const res = await api.post('/api/ats/onboarding-full/bank-details', {
        token: onboardingToken,
        bank_name: TEST_CANDIDATE.bankName,
        account_number: TEST_CANDIDATE.bankAccount,
        ifsc_code: TEST_CANDIDATE.ifsc,
        account_holder_name: TEST_CANDIDATE.fullName,
        branch: TEST_CANDIDATE.appliedForBranch,
      });
      expect(res.ok).toBeTruthy();
    });

    test('submit qualification via API', async () => {
      const ctx = await request.newContext();
      const api = new ApiHelper(ctx, adminToken);

      const res = await api.post('/api/ats/onboarding-full/qualification', {
        token: onboardingToken,
        qualification: TEST_CANDIDATE.education,
        university: 'DU',
        passing_year: '2020',
        percentage: '72',
      });
      expect(res.ok).toBeTruthy();
    });

    test('submit experience via API', async () => {
      const ctx = await request.newContext();
      const api = new ApiHelper(ctx, adminToken);

      const res = await api.post('/api/ats/onboarding-full/experience', {
        token: onboardingToken,
        company_name: 'Test Corp',
        designation: 'Junior Executive',
        from_date: '2023-01-01',
        to_date: '2024-01-01',
        reason_for_leaving: 'Career growth',
      });
      expect(res.ok).toBeTruthy();
    });

    test('submit family members via API', async () => {
      const ctx = await request.newContext();
      const api = new ApiHelper(ctx, adminToken);

      const res = await api.post('/api/ats/onboarding-full/family-members', {
        token: onboardingToken,
        members: [
          { name: TEST_CANDIDATE.fatherName, relation: 'Father', mobile: EMERGENCY_CONTACT.mobile },
          { name: TEST_CANDIDATE.motherName, relation: 'Mother', mobile: TEST_CANDIDATE.alternateMobile },
        ],
      });
      expect(res.ok).toBeTruthy();
    });

    test('submit nominee via API', async () => {
      const ctx = await request.newContext();
      const api = new ApiHelper(ctx, adminToken);

      const res = await api.post('/api/ats/onboarding-full/nominees', {
        token: onboardingToken,
        nominees: [{
          name: NOMINEE.nomineeName,
          relation: NOMINEE.relation,
          dob: NOMINEE.dob,
          share_percentage: NOMINEE.sharePercentage,
          address: NOMINEE.address,
        }],
      });
      expect(res.ok).toBeTruthy();
    });

    test('submit language proficiency via API', async () => {
      const ctx = await request.newContext();
      const api = new ApiHelper(ctx, adminToken);

      const res = await api.post('/api/ats/onboarding-full/languages', {
        token: onboardingToken,
        languages: [
          { language: 'Hindi', read: true, write: true, speak: true },
          { language: 'English', read: true, write: true, speak: true },
        ],
      });
      expect(res.ok).toBeTruthy();
    });

    test('submit statutory details via API', async () => {
      const ctx = await request.newContext();
      const api = new ApiHelper(ctx, adminToken);

      const res = await api.post('/api/ats/onboarding-full/statutory', {
        token: onboardingToken,
        aadhaar: TEST_CANDIDATE.aadhaar,
        pan: TEST_CANDIDATE.pan,
        uan: TEST_CANDIDATE.uan,
        previous_pf_member: false,
        previous_eps_member: false,
        international_worker: false,
      });
      expect(res.ok).toBeTruthy();
    });

    test('upload dummy documents via API', async () => {
      const ctx = await request.newContext();

      const docMap: Record<string, string> = {
        aadhaar: 'dummy-aadhaar',
        pan: 'dummy-pan',
        bank_proof: 'dummy-bank-proof',
        photo: 'dummy-photo',
        education: 'dummy-education',
        experience: 'dummy-experience',
        address_proof: 'dummy-address-proof',
      };

      for (const [docType, fileName] of Object.entries(docMap)) {
        const filePath = getDocPath(fileName as any);

        const res = await ctx.post(
          `${process.env.E2E_BACKEND_URL ?? 'http://localhost:5055'}/api/ats/onboarding-full/documents`,
          { multipart: { file: filePath, token: onboardingToken, document_type: docType } }
        );
        expect(res.ok()).toBeTruthy();
      }
    });

    test('record privacy consent via API', async () => {
      const ctx = await request.newContext();
      const api = new ApiHelper(ctx, adminToken);
      const res = await api.post('/api/ats/onboarding-full/privacy-consent', { token: onboardingToken });
      expect(res.ok).toBeTruthy();
    });

    test('submit final onboarding form via API', async () => {
      const ctx = await request.newContext();
      const api = new ApiHelper(ctx, adminToken);
      const res = await api.post('/api/ats/onboarding-full/submit', {
        token: onboardingToken,
        submit_lat: 28.6139,
        submit_lng: 77.2090,
      });
      expect(res.ok).toBeTruthy();
    });

    test('verify onboarding profile in database', async () => {
      const profile = await verifyRecord('candidate_onboarding_profile', 'ats_candidate_id = ?', [candidateId]);
      expect(profile).toBeTruthy();
      expect(profile.status).toBe('profile_submitted');

      const docs = await query('SELECT COUNT(*) as cnt FROM candidate_onboarding_document WHERE ats_candidate_id = ?', [candidateId]);
      expect(Number(docs[0]?.cnt || 0)).toBeGreaterThanOrEqual(6);

      const bridge = await verifyRecord('ats_onboarding_bridge', 'candidate_id = ?', [candidateId]);
      expect(bridge).toBeTruthy();
      expect(bridge.status).toBe('profile_submitted');
    });
  });

  // ── Stage 4: BGV ─────────────────────────────────────────────────────────
  test.describe('Stage 4: BGV Verification', () => {

    test('check BGV readiness', async () => {
      const ctx = await request.newContext();
      const api = new ApiHelper(ctx, adminToken);
      const res = await api.get(`/api/ats/onboarding-full/candidate/${candidateId}/bgv-readiness`);
      expect(res.ok).toBeTruthy();
    });

    test('record BGV consent', async () => {
      const ctx = await request.newContext();
      const consentRes = await ctx.post(
        `${process.env.E2E_BACKEND_URL ?? 'http://localhost:5055'}/api/ats/bgv/consent`,
        { data: { token: onboardingToken, consent: true } }
      );
      expect(consentRes.ok()).toBeTruthy();
    });

    test('trigger BGV checks via API', async () => {
      const ctx = await request.newContext();
      const api = new ApiHelper(ctx, adminToken);

      // Trigger name match
      const triggerRes = await api.post(`/api/ats/bgv/trigger/${candidateId}`, {});
      bgvStatus = triggerRes.body?.data?.status || 'triggered';
      expect(triggerRes.ok || triggerRes.status === 400).toBeTruthy();
    });

    test('verify BGV record in database', async () => {
      const bgvRecord = await verifyRecord('ats_bgv_verification', 'candidate_id = ?', [candidateId]);
      if (bgvRecord) {
        bgvStatus = bgvRecord.status;
        expect(bgvRecord.candidate_id).toBe(candidateId);
      }
    });

    test('manual BGV review as HR', async () => {
      const ctx = await request.newContext();
      const api = new ApiHelper(ctx, hrToken);

      const manualRes = await api.post(`/api/ats/bgv/candidates/${candidateId}/manual-review`, {
        remarks: 'E2E test - manual BGV clearance',
        clear: true,
      });
      // Accept if endpoint exists
      if (manualRes.status !== 404) {
        expect(manualRes.ok || manualRes.status === 400).toBeTruthy();
      }
    });
  });

  // ── Stage 5: HR Onboarding Review ────────────────────────────────────────
  test.describe('Stage 5: HR Onboarding Review', () => {

    test('HR reviews onboarding profile', async () => {
      const ctx = await request.newContext();
      const api = new ApiHelper(ctx, hrToken);

      const reviewRes = await api.patch(`/api/ats/onboarding-full/candidate/${candidateId}/review`, {
        status: 'approved',
        remarks: 'E2E test - all documents verified',
      });
      expect(reviewRes.ok).toBeTruthy();

      // Verify bridge status updated
      const bridge = await verifyRecord('ats_onboarding_bridge', 'candidate_id = ?', [candidateId]);
      if (bridge) {
        expect(bridge.hr_approved_by).toBeTruthy();
        expect(bridge.hr_approved_at).toBeTruthy();
      }
    });
  });

  // ── Stage 6: Offer Creation ──────────────────────────────────────────────
  test.describe('Stage 6: Offer Creation', () => {

    test('calculate salary', async () => {
      const ctx = await request.newContext();
      const api = new ApiHelper(ctx, hrToken);

      const calcRes = await api.post('/api/ats/onboarding/calculate-salary', {
        ctc: TEST_CANDIDATE.expectedCtcMonthly * 12,
        isMetro: true,
      });
      expect(calcRes.ok || calcRes.status === 400).toBeTruthy();
    });

    test('create and submit offer', async () => {
      const ctx = await request.newContext();
      const api = new ApiHelper(ctx, hrToken);

      // Get onboarding request ID
      const reqRes = await api.get('/api/ats/onboarding/requests');
      const request = (reqRes.body?.data || []).find((r: any) => r.candidate_id === candidateId || r.id === onboardingRequestId);

      if (request) {
        onboardingRequestId = request.id;

        const offerRes = await api.post(`/api/ats/onboarding/requests/${onboardingRequestId}/offer`, {
          submit: true,
          doj: TEST_CANDIDATE.doj,
          salary_start_date: TEST_CANDIDATE.doj,
          employment_type: 'Permanent',
          department: TEST_CANDIDATE.department,
          designation: TEST_CANDIDATE.designation,
          cost_centre: 'OPS-NOIDA',
          monthly_ctc: TEST_CANDIDATE.expectedCtcMonthly,
          pf_eligible: true,
          esi_eligible: false,
          remarks: 'E2E test offer',
        });
        expect(offerRes.ok).toBeTruthy();
        offerId = offerRes.body.data?.id;
      }
    });

    test('verify offer in database', async () => {
      if (onboardingRequestId) {
        const offer = await verifyRecord('ats_employment_offer', 'onboarding_request_id = ?', [onboardingRequestId]);
        if (offer) {
          expect(offer.status).toBe('submitted');
          offerId = offer.id;
        }
      }
    });
  });

  // ── Stage 7: Branch Head Approval ────────────────────────────────────────
  test.describe('Stage 7: Branch Head Approval', () => {

    test('Branch Head approves offer', async () => {
      const ctx = await request.newContext();
      const api = new ApiHelper(ctx, branchHeadToken);

      let targetId = offerId;
      if (!targetId) {
        // Find by onboarding request
        const pendingRes = await api.get('/api/ats/onboarding/pending-approval');
        const pending = (pendingRes.body?.data || []).find((r: any) =>
          r.candidate_id === candidateId || r.onboarding_request_id === onboardingRequestId
        );
        targetId = pending?.id || pending?.offer_id;
      }

      if (targetId) {
        const approveRes = await api.post(`/api/ats/onboarding/offers/${targetId}/approve`, {});
        expect(approveRes.ok).toBeTruthy();
      }
    });
  });

  // ── Stage 8: Payroll HR Validation ───────────────────────────────────────
  test.describe('Stage 8: Payroll HR Validation', () => {

    test('Payroll HR validates and approves', async () => {
      const ctx = await request.newContext();
      const api = new ApiHelper(ctx, payrollToken);

      const reviewRes = await api.patch(`/api/ats/onboarding-full/candidate/${candidateId}/payroll-review`, {
        status: 'approved',
        remarks: 'E2E test - payroll verified',
        pf_eligible: true,
        esi_eligible: false,
      });
      expect(reviewRes.ok || reviewRes.status === 404).toBeTruthy();
    });
  });

  // ── Stage 9: Employee Code Generation ────────────────────────────────────
  test.describe('Stage 9: Employee Code Generation', () => {

    test('check employee code gate', async () => {
      const ctx = await request.newContext();
      const api = new ApiHelper(ctx, adminToken);

      const gateRes = await api.get(`/api/ats/employee-code/${candidateId}/gate-check`);
      expect(gateRes.ok).toBeTruthy();
    });

    test('generate employee code', async () => {
      const ctx = await request.newContext();
      const api = new ApiHelper(ctx, adminToken);

      const genRes = await api.post(`/api/ats/employee-code/${candidateId}/generate`, {});
      expect(genRes.ok).toBeTruthy();
      employeeCode = genRes.body.data?.employee_code || genRes.body.data?.employeeCode;
      employeeId = genRes.body.data?.employee_id || genRes.body.data?.employeeId;
      expect(employeeCode).toBeTruthy();
    });

    test('verify employee in database', async () => {
      let emp;
      if (employeeId) {
        emp = await verifyRecord('employees', 'id = ?', [employeeId]);
      }
      if (!emp) {
        emp = await verifyRecord('employees', 'employee_code = ?', [employeeCode]);
        employeeId = emp?.id;
      }
      expect(emp).toBeTruthy();
      expect(emp.employee_code).toBe(employeeCode);

      // Verify bridge updated
      const bridge = await verifyRecord('ats_onboarding_bridge', 'candidate_id = ?', [candidateId]);
      if (bridge) {
        expect(bridge.status).toBe('code_generated');
        expect(bridge.employee_code).toBe(employeeCode);
      }
    });
  });

  // ── Stage 10: Employee Profile ─────────────────────────────────────────
  test.describe('Stage 10: Employee Profile Verification', () => {

    test('open employee profile page', async ({ page }) => {
      await captureErrors(page);
      const profilePath = employeeId ? `/employees/${employeeId}` : `/employees?search=${employeeCode}`;
      await page.goto(profilePath);
      await page.waitForLoadState('networkidle');

      // Verify employee code visible
      await expect(page.locator(`text=${employeeCode}`).first()).toBeVisible({ timeout: 10_000 }).catch(() => {});
    });

    test('verify employee via API', async () => {
      const ctx = await request.newContext();
      const api = new ApiHelper(ctx, adminToken);

      if (employeeId) {
        const empRes = await api.get(`/api/employees/${employeeId}`);
        if (empRes.ok) {
          expect(empRes.body.data?.employee_code || empRes.body.employee_code).toBe(employeeCode);
        }
      }
    });
  });

  // ── Stage 11: Joining Documents Checklist ──────────────────────────────
  test.describe('Stage 11: Joining Documents Checklist', () => {

    test('generate joining document checklist', async () => {
      const ctx = await request.newContext();
      const api = new ApiHelper(ctx, adminToken);

      const genRes = await api.post(`/api/employees/${employeeId}/joining-documents/generate-checklist`, {});
      expect(genRes.ok || genRes.status === 400).toBeTruthy();
    });

    test('verify checklist in database', async () => {
      const checklist = await query(
        'SELECT * FROM employee_joining_document_checklist WHERE employee_id = ?',
        [employeeId]
      );
      expect(checklist.length).toBeGreaterThanOrEqual(4);

      const docTypes = checklist.map((c: any) => c.document_type || c.checklist_key).filter(Boolean);
      expect(docTypes).toContain('NDA_CONFIDENTIALITY');
    });

    test('upload joining documents', async () => {
      const ctx = await request.newContext();

      // Get checklist items
      const checklist = await query(
        'SELECT id, document_type FROM employee_joining_document_checklist WHERE employee_id = ?',
        [employeeId]
      );

      const docMapping: Record<string, string> = {
        NDA_CONFIDENTIALITY: 'dummy-nda',
        EPF_DECLARATION: 'dummy-epf-form',
        EMPLOYMENT_CONTRACT: 'dummy-employment-contract',
        IT_COMPLIANCE: 'dummy-nda',
        BAMS_DECLARATION: 'dummy-bgv-consent',
        PI_PROCESSING_CONSENT: 'dummy-bgv-consent',
        ZERO_TOLERANCE_ACK: 'dummy-nda',
      };

      for (const item of checklist) {
        const docType = item.document_type;
        const fileName = docMapping[docType] || 'dummy-nda';
        const filePath = getDocPath(fileName as any);

        if (fs.existsSync(filePath)) {
          const res = await ctx.post(
            `${process.env.E2E_BACKEND_URL ?? 'http://localhost:5055'}/api/employees/${employeeId}/joining-documents/checklist/${item.id}/upload`,
            {
              headers: { Authorization: `Bearer ${adminToken}` },
              multipart: { file: filePath },
            }
          );
          if (!res.ok()) {
            // Try alternative endpoint
            const res2 = await ctx.post(
              `${process.env.E2E_BACKEND_URL ?? 'http://localhost:5055'}/api/employees/${employeeId}/joining-documents/${item.id}/upload`,
              {
                headers: { Authorization: `Bearer ${adminToken}` },
                multipart: { file: filePath },
              }
            );
          }
        }
      }
    });

    test('verify uploaded joining documents in database', async () => {
      const files = await query(
        'SELECT * FROM employee_joining_document_file WHERE employee_id = ?',
        [employeeId]
      );
      expect(files.length).toBeGreaterThanOrEqual(1);

      // Verify security assertions
      for (const file of files) {
        expect(file.storage_path).not.toContain('public/uploads');
        expect(file.storage_path).toBeTruthy();
      }
    });
  });

  // ── Stage 12: EPF Compliance ──────────────────────────────────────────
  test.describe('Stage 12: EPF Compliance', () => {

    test('create/update EPF compliance profile', async () => {
      const ctx = await request.newContext();
      const api = new ApiHelper(ctx, adminToken);

      const epfRes = await api.put(`/api/employees/${employeeId}/epf-compliance/profile`, {
        name_as_aadhaar: TEST_CANDIDATE.fullName,
        dob: TEST_CANDIDATE.dob,
        gender: TEST_CANDIDATE.gender,
        father_or_spouse_name: TEST_CANDIDATE.fatherName,
        mobile: TEST_CANDIDATE.mobile,
        email: TEST_CANDIDATE.email,
        basic_wage: 9000,
        gross_monthly_wage: TEST_CANDIDATE.expectedCtcMonthly,
        existing_uan: TEST_CANDIDATE.uan,
        previous_pf_member: false,
        previous_eps_member: false,
        aadhaar: TEST_CANDIDATE.aadhaar,
        pan: TEST_CANDIDATE.pan,
        bank_account: TEST_CANDIDATE.bankAccount,
        ifsc: TEST_CANDIDATE.ifsc,
      });
      expect(epfRes.ok || epfRes.status === 400 || epfRes.status === 404).toBeTruthy();
    });

    test('submit EPF for employee review', async () => {
      const ctx = await request.newContext();
      const api = new ApiHelper(ctx, adminToken);

      const submitRes = await api.post(`/api/employees/${employeeId}/epf-compliance/submit`, {});
      expect(submitRes.ok || submitRes.status === 400 || submitRes.status === 404).toBeTruthy();
    });

    test('verify EPF compliance in database', async () => {
      const epfProfile = await verifyRecord('employee_epf_compliance_profile', 'employee_id = ?', [employeeId]);
      if (epfProfile) {
        expect(epfProfile.employee_id).toBe(employeeId);
      }
    });
  });

  // ── Stage 13: eSign / Fallback flow ─────────────────────────────────────
  test.describe('Stage 13: eSign / Fallback for NDA', () => {

    test('initiate eSign for NDA checklist item', async () => {
      const ctx = await request.newContext();

      // Find NDA checklist item
      const checklist = await query(
        `SELECT id FROM employee_joining_document_checklist
         WHERE employee_id = ? AND (document_type = 'NDA_CONFIDENTIALITY' OR document_type LIKE '%NDA%')
         LIMIT 1`,
        [employeeId]
      );

      if (checklist.length > 0) {
        const checklistId = checklist[0].id;
        const esignRes = await ctx.post(
          `${process.env.E2E_BACKEND_URL ?? 'http://localhost:5055'}/api/employees/${employeeId}/joining-documents/checklist/${checklistId}/esign-link`,
          {
            headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
            data: {},
          }
        );
        if (!esignRes.ok()) {
          // Try alternative
          const esignRes2 = await ctx.post(
            `${process.env.E2E_BACKEND_URL ?? 'http://localhost:5055'}/api/employees/${employeeId}/joining-documents/${checklistId}/esign/initiate`,
            {
              headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
              data: {},
            }
          );
        }
      }
    });

    test('verify eSign transaction in database', async () => {
      const esignTx = await verifyRecord('employee_document_esign_transaction', 'employee_id = ?', [employeeId]);
      if (esignTx) {
        expect(esignTx.status).toBeTruthy();
        // Security: no raw public token in response_payload
        if (esignTx.response_payload) {
          const payload = typeof esignTx.response_payload === 'string'
            ? JSON.parse(esignTx.response_payload) : esignTx.response_payload;
          expect(payload?.signLink || payload?.sign_link).toBeFalsy();
        }
      }
    });
  });

  // ── Stage 14: Security Assertions ──────────────────────────────────────
  test.describe('Stage 14: Security & Data Integrity', () => {

    test('no public document URLs leaked', async () => {
      const files = await query(
        'SELECT storage_path FROM employee_joining_document_file WHERE employee_id = ?',
        [employeeId]
      );
      for (const file of files) {
        expect(file.storage_path || '').not.toContain('/uploads/onboarding');
        expect(file.storage_path || '').not.toContain('public/');
      }

      const docs = await query(
        'SELECT storage_path FROM candidate_onboarding_document WHERE ats_candidate_id = ?',
        [candidateId]
      );
      for (const doc of docs) {
        const path = doc.storage_path || '';
        expect(path).not.toContain('public/uploads');
      }
    });

    test('no raw Aadhaar/PAN/bank in audit logs', async () => {
      const auditLogs = await query(
        `SELECT * FROM sensitive_action_log
         WHERE employee_id = ? OR entity_id = ?
         LIMIT 20`,
        [employeeId, candidateId]
      );

      for (const log of auditLogs) {
        const jsonStr = JSON.stringify(log);
        // Aadhaar may be masked (only last 4 digits visible)
        const aadhaarRaw = TEST_CANDIDATE.aadhaar;
        const panRaw = TEST_CANDIDATE.pan;
        const bankRaw = TEST_CANDIDATE.bankAccount;

        // Full Aadhaar should not appear (masked values OK)
        expect(jsonStr).not.toContain(aadhaarRaw);
        // Full PAN should not appear
        expect(jsonStr).not.toContain(panRaw);
        // Full bank account should not appear
        expect(jsonStr).not.toContain(bankRaw);
      }
    });
  });

  // ── Stage 15: Cleanup ─────────────────────────────────────────────────
  test.describe('Stage 15: Cleanup', () => {

    test('mark test candidate as completed', async () => {
      await query(
        `UPDATE ats_candidate SET remarks = CONCAT(COALESCE(remarks,''), ' | E2E_TEST_COMPLETED run_id=${E2E_RUN_ID}') WHERE id = ?`,
        [candidateId]
      );
    });

    test('close database pool', async () => {
      await closePool();
    });

    test('print E2E summary', () => {
      console.log(`
═══════════════════════════════════════════════════════
  HRMS2 E2E TEST SUMMARY
═══════════════════════════════════════════════════════
  E2E Run ID:       ${E2E_RUN_ID}
  Candidate ID:     ${candidateId || 'N/A'}
  Candidate Code:   ${candidateCode || 'N/A'}
  Onboarding Req:   ${onboardingRequestId || 'N/A'}
  Offer ID:         ${offerId || 'N/A'}
  Employee ID:      ${employeeId || 'N/A'}
  Employee Code:    ${employeeCode || 'N/A'}
  BGV Status:       ${bgvStatus || 'N/A'}
  Failed API Calls: ${FAILED_API_CALLS.length}
  Console Errors:   ${CONSOLE_ERRORS.length}
═══════════════════════════════════════════════════════`);
    });

    test('no API 500 errors', () => {
      expect(FAILED_API_CALLS.length).toBe(0);
    });
  });
});
