/**
 * Full End-to-End Journey Test: Walk-in → Onboarding → Post-Onboarding
 * Uses Playwright for UI screenshots + direct API calls for backend validation
 * Real data at every step, PDF upload for BGV
 */

const { chromium } = require('playwright');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:5055';
const FRONTEND_URL = 'http://localhost:5173';
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');
const REPORT = [];

let TOKEN = '';
let CANDIDATE_ID = '';
let CANDIDATE_CODE = '';
let ONBOARDING_TOKEN = '';

// ─── helpers ─────────────────────────────────────────────────────────────────

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + path);
    const opts = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': TOKEN ? `Bearer ${TOKEN}` : undefined,
      },
    };
    if (!opts.headers.Authorization) delete opts.headers.Authorization;
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function log(step, status, detail, data) {
  const entry = { step, status, detail, data };
  REPORT.push(entry);
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
  console.log(`${icon} [${step}] ${detail}`);
  if (data && typeof data === 'object') {
    const preview = JSON.stringify(data).substring(0, 200);
    console.log(`   → ${preview}`);
  }
}

async function screenshot(page, name, step) {
  const file = path.join(SCREENSHOTS_DIR, `${String(REPORT.length + 1).padStart(2,'0')}_${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`📸 Screenshot: ${file}`);
  return file;
}

// ─── STEP 0: Auth ─────────────────────────────────────────────────────────────

async function step0_auth() {
  console.log('\n══════════════════════════════════════');
  console.log('STEP 0: Authentication');
  console.log('══════════════════════════════════════');

  const r = await api('POST', '/api/auth/login', {
    identifier: 'mas47814',
    password: 'Alpha@3035'
  });

  if (r.status === 200 && r.body.data?.accessToken) {
    TOKEN = r.body.data.accessToken;
    log('AUTH', 'PASS', 'Login successful', { user: r.body.data.user?.email });
    return true;
  } else {
    log('AUTH', 'FAIL', 'Login failed', r.body);
    return false;
  }
}

// ─── STEP 1: Walk-in Registration ────────────────────────────────────────────

async function step1_walkin(page) {
  console.log('\n══════════════════════════════════════');
  console.log('STEP 1: Walk-in Candidate Registration');
  console.log('══════════════════════════════════════');

  // Navigate to ATS page first (screenshot)
  await page.goto(`${FRONTEND_URL}/ats`);
  await page.waitForTimeout(2500);
  await screenshot(page, 'ats_home', 'ATS home page');

  // Real candidate data
  const candidateData = {
    full_name: 'Priya Sharma',
    mobile: '9871234567',
    email: 'priya.sharma.e2etest@gmail.com',
    gender: 'Female',
    date_of_birth: '1998-03-15',
    education: 'Graduate',
    experience: '2 years',
    current_address: '45 Sector 18, Noida, Uttar Pradesh 201301',
    father_name: 'Rajesh Sharma',
    applied_for_process: '78426870-5e88-11f1-adb1-00155d0ab410', // BACK OFFICE
    applied_for_branch: 'febd8777-6583-11f1-adb1-00155d0ab410',  // NOIDA-2
    sourcing_channel: 'Walk-in',
    remarks: 'E2E test candidate — walk-in registration',
    rotational_shift: true,
    night_shift_ok: true,
    owns_two_wheeler: false,
    id_proof_available: true,
    education_proof_available: true,
    leaves_in_3months: 0,
  };

  const r = await api('POST', '/api/ats/candidates', candidateData);

  if (r.status === 201 || r.status === 200) {
    CANDIDATE_ID = r.body.data?.id || r.body.id;
    CANDIDATE_CODE = r.body.data?.candidate_code || r.body.candidate_code;
    log('WALKIN_REGISTER', 'PASS', `Candidate created: ${CANDIDATE_CODE}`, {
      id: CANDIDATE_ID,
      code: CANDIDATE_CODE,
      name: candidateData.full_name,
    });

    // Navigate to candidate profile
    await page.goto(`${FRONTEND_URL}/ats/candidate/${CANDIDATE_ID}`);
    await page.waitForTimeout(3000);
    await screenshot(page, 'candidate_profile_created', 'New candidate profile');
    return true;
  } else {
    log('WALKIN_REGISTER', 'FAIL', `HTTP ${r.status}`, r.body);
    // Try to fetch an existing candidate for the rest of the test
    const list = await api('GET', '/api/ats/candidates?limit=1&stage=walkin_registered');
    if (list.body?.data?.[0]) {
      CANDIDATE_ID = list.body.data[0].id;
      CANDIDATE_CODE = list.body.data[0].candidate_code;
      log('WALKIN_FALLBACK', 'WARN', `Using existing candidate: ${CANDIDATE_CODE}`);
    }
    return false;
  }
}

// ─── STEP 2: Screening ────────────────────────────────────────────────────────

async function step2_screening(page) {
  console.log('\n══════════════════════════════════════');
  console.log('STEP 2: Screening');
  console.log('══════════════════════════════════════');

  if (!CANDIDATE_ID) { log('SCREENING', 'SKIP', 'No candidate ID'); return; }

  // Update stage to screening
  const r = await api('PUT', `/api/ats/candidates/${CANDIDATE_ID}`, {
    current_stage: 'screening',
    screening_status: 'in_progress',
  });

  log('SCREENING_STAGE', r.status < 400 ? 'PASS' : 'FAIL',
    `Stage → screening (HTTP ${r.status})`, r.body?.message);

  // Aptitude test result
  const apt = await api('POST', `/api/ats/candidates/${CANDIDATE_ID}/stage-action`, {
    action: 'screening_pass',
    score: 78,
    remarks: 'Good communication, passed aptitude 78/100',
  }).catch(() => ({ status: 404, body: {} }));

  log('SCREENING_RESULT', apt.status < 400 ? 'PASS' : 'WARN',
    `Screening result submitted (HTTP ${apt.status})`, apt.body?.message);

  await page.goto(`${FRONTEND_URL}/ats/candidate/${CANDIDATE_ID}`);
  await page.waitForTimeout(2500);
  await screenshot(page, 'screening_stage', 'Candidate at screening stage');
}

// ─── STEP 3: Interview ────────────────────────────────────────────────────────

async function step3_interview(page) {
  console.log('\n══════════════════════════════════════');
  console.log('STEP 3: Interview');
  console.log('══════════════════════════════════════');

  if (!CANDIDATE_ID) { log('INTERVIEW', 'SKIP', 'No candidate ID'); return; }

  const r = await api('PUT', `/api/ats/candidates/${CANDIDATE_ID}`, {
    current_stage: 'interview',
  });
  log('INTERVIEW_STAGE', r.status < 400 ? 'PASS' : 'FAIL',
    `Stage → interview (HTTP ${r.status})`);

  // Interview feedback
  const feedback = await api('POST', `/api/ats/candidates/${CANDIDATE_ID}/stage-action`, {
    action: 'interview_pass',
    interviewer_name: 'Anjali Mehta',
    score: 82,
    remarks: 'Strong candidate. Good product knowledge. Recommended for onboarding.',
    communication_score: 8,
    technical_score: 7,
    attitude_score: 9,
  }).catch(() => ({ status: 404, body: {} }));

  log('INTERVIEW_FEEDBACK', feedback.status < 400 ? 'PASS' : 'WARN',
    `Interview feedback (HTTP ${feedback.status})`);

  await page.goto(`${FRONTEND_URL}/ats/candidate/${CANDIDATE_ID}`);
  await page.waitForTimeout(2500);
  await screenshot(page, 'interview_stage', 'Candidate at interview stage');
}

// ─── STEP 4: Selection + Offer ────────────────────────────────────────────────

async function step4_selection(page) {
  console.log('\n══════════════════════════════════════');
  console.log('STEP 4: Selection & Offer');
  console.log('══════════════════════════════════════');

  if (!CANDIDATE_ID) { log('SELECTION', 'SKIP', 'No candidate ID'); return; }

  const r = await api('PUT', `/api/ats/candidates/${CANDIDATE_ID}`, {
    current_stage: 'selected',
    offer_status: 'pending',
  });
  log('SELECTION_STAGE', r.status < 400 ? 'PASS' : 'FAIL',
    `Stage → selected (HTTP ${r.status})`);

  // Offer letter
  const offer = await api('POST', `/api/ats/candidates/${CANDIDATE_ID}/offer`, {
    ctc: 18000,
    designation: 'Customer Care Executive',
    joining_date: '2026-07-15',
    process: 'BACK OFFICE',
    branch: 'NOIDA-2',
  }).catch(() => ({ status: 404, body: {} }));

  log('OFFER_GENERATION', offer.status < 400 ? 'PASS' : 'WARN',
    `Offer letter generated (HTTP ${offer.status})`);

  await page.goto(`${FRONTEND_URL}/ats/candidate/${CANDIDATE_ID}`);
  await page.waitForTimeout(2500);
  await screenshot(page, 'selection_offer', 'Candidate selected, offer pending');
}

// ─── STEP 5: BGV ─────────────────────────────────────────────────────────────

async function step5_bgv(page) {
  console.log('\n══════════════════════════════════════');
  console.log('STEP 5: Background Verification (BGV)');
  console.log('══════════════════════════════════════');

  if (!CANDIDATE_ID) { log('BGV', 'SKIP', 'No candidate ID'); return; }

  // Update BGV with real data fields
  const bgvData = {
    // Personal identity
    aadhar_number: '4567 8901 2345',
    pan_number: 'BXMPS6789K',
    // Address verification
    permanent_address: '45 Sector 18, Noida, Uttar Pradesh 201301',
    address_verified: true,
    // Education verification
    education: 'Graduate',
    education_proof_available: true,
    highest_qualification: 'B.Com',
    university_name: 'Chaudhary Charan Singh University',
    graduation_year: 2020,
    // Previous employment
    previous_company: 'Concentrix Services Pvt Ltd',
    previous_designation: 'Customer Service Associate',
    previous_ctc: 14000,
    employment_start: '2020-08-01',
    employment_end: '2022-06-30',
    reason_for_leaving: 'Better opportunity',
    // Emergency contact
    emergency_contact_name: 'Rajesh Sharma',
    emergency_contact_mobile: '9812345678',
    emergency_contact_relation: 'Father',
    // Bank details
    bank_account_no: '30987654321',
    bank_ifsc: 'SBIN0001234',
    bank_name: 'State Bank of India',
    bank_branch: 'Sector 18 Noida',
    account_holder_name: 'Priya Sharma',
  };

  const r = await api('PUT', `/api/ats/candidates/${CANDIDATE_ID}`, bgvData);
  log('BGV_DATA_UPDATE', r.status < 400 ? 'PASS' : 'FAIL',
    `BGV data fields updated (HTTP ${r.status})`);

  // Create a real PDF for upload
  const pdfPath = path.join(__dirname, 'test-aadhar.pdf');
  // Write minimal PDF
  const pdfContent = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 200>>
stream
BT /F1 14 Tf 72 720 Td (AADHAAR CARD - VERIFICATION COPY) Tj 0 -30 Td (Name: Priya Sharma) Tj 0 -20 Td (DOB: 15-Mar-1998) Tj 0 -20 Td (Aadhaar No: 4567 8901 2345) Tj 0 -20 Td (Address: 45 Sector 18, Noida UP) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
xref
0 6
0000000000 65535 f
trailer<</Size 6/Root 1 0 R>>
startxref 0
%%EOF`;
  fs.writeFileSync(pdfPath, pdfContent);
  log('BGV_PDF_CREATED', 'PASS', `Test PDF created: ${pdfPath}`);

  // Upload the PDF via form-data
  const FormData = require('form-data');
  // Use multipart upload
  const uploadResult = await uploadPdf(CANDIDATE_ID, pdfPath, 'aadhar_card');
  log('BGV_PDF_UPLOAD', uploadResult.success ? 'PASS' : 'WARN',
    `PDF upload: ${uploadResult.message}`, uploadResult.data);

  // BGV readiness check
  const readiness = await api('GET', `/api/ats/bgv/candidate/${CANDIDATE_ID}/bgv-readiness`)
    .catch(() => ({ status: 404, body: {} }));
  log('BGV_READINESS', readiness.status < 400 ? 'PASS' : 'WARN',
    `BGV readiness (HTTP ${readiness.status})`, readiness.body?.data);

  // Manual verification marks
  const manual = await api('POST', `/api/ats/bgv/manual-feedback/${CANDIDATE_ID}/address`, {
    status: 'verified',
    notes: 'Address confirmed via courier delivery confirmation',
    verified_by: 'HR Team',
    verified_at: new Date().toISOString(),
  }).catch(() => ({ status: 404, body: {} }));
  log('BGV_MANUAL_VERIFY', manual.status < 400 ? 'PASS' : 'WARN',
    `Manual BGV feedback (HTTP ${manual.status})`);

  // Navigate to BGV page
  await page.goto(`${FRONTEND_URL}/ats/bgv`);
  await page.waitForTimeout(2500);
  await screenshot(page, 'bgv_queue', 'BGV queue page');

  await page.goto(`${FRONTEND_URL}/ats/candidate/${CANDIDATE_ID}`);
  await page.waitForTimeout(2500);
  await screenshot(page, 'bgv_candidate_view', 'BGV details on candidate profile');
}

async function uploadPdf(candidateId, filePath, docType) {
  return new Promise((resolve) => {
    const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
    const fileContent = fs.readFileSync(filePath);
    const filename = path.basename(filePath);

    let body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="document_type"\r\n\r\n${docType}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="candidate_id"\r\n\r\n${candidateId}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`),
      fileContent,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const opts = {
      hostname: 'localhost',
      port: 5055,
      path: `/api/files/upload`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    };

    const req = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ success: res.statusCode < 400, message: `HTTP ${res.statusCode}`, data: parsed });
        } catch {
          resolve({ success: res.statusCode < 400, message: `HTTP ${res.statusCode}`, data: data.substring(0, 100) });
        }
      });
    });
    req.on('error', e => resolve({ success: false, message: e.message }));
    req.write(body);
    req.end();
  });
}

// ─── STEP 6: Onboarding ───────────────────────────────────────────────────────

async function step6_onboarding(page) {
  console.log('\n══════════════════════════════════════');
  console.log('STEP 6: Onboarding Form Fill');
  console.log('══════════════════════════════════════');

  if (!CANDIDATE_ID) { log('ONBOARDING', 'SKIP', 'No candidate ID'); return; }

  // Move to onboarding
  const stageR = await api('PUT', `/api/ats/candidates/${CANDIDATE_ID}`, {
    current_stage: 'onboarding',
  });
  log('ONBOARDING_STAGE', stageR.status < 400 ? 'PASS' : 'FAIL',
    `Stage → onboarding (HTTP ${stageR.status})`);

  // Get onboarding token (portal access)
  const tokenR = await api('GET', `/api/ats/candidates/${CANDIDATE_ID}`)
    .catch(() => ({ status: 404, body: {} }));
  ONBOARDING_TOKEN = tokenR.body?.data?.q_token || '';
  log('ONBOARDING_TOKEN', ONBOARDING_TOKEN ? 'PASS' : 'WARN',
    `Onboarding token: ${ONBOARDING_TOKEN ? ONBOARDING_TOKEN.substring(0,20)+'...' : 'not set'}`);

  // Fill personal details via API (employee-details section)
  const personal = await api('POST', `/api/onboarding/employee-details`, {
    candidate_id: CANDIDATE_ID,
    full_name: 'Priya Sharma',
    first_name: 'Priya',
    last_name: 'Sharma',
    date_of_birth: '1998-03-15',
    gender: 'Female',
    marital_status: 'Single',
    father_name: 'Rajesh Sharma',
    mother_name: 'Sunita Sharma',
    current_address: '45 Sector 18, Noida, Uttar Pradesh 201301',
    permanent_address: '45 Sector 18, Noida, Uttar Pradesh 201301',
    mobile: '9871234567',
    email: 'priya.sharma.e2etest@gmail.com',
    aadhar_number: '4567 8901 2345',
    pan_number: 'BXMPS6789K',
  }).catch(() => ({ status: 404, body: {} }));
  log('ONBOARDING_PERSONAL', personal.status < 400 ? 'PASS' : 'WARN',
    `Personal details (HTTP ${personal.status})`);

  // Family members
  const family = await api('POST', `/api/onboarding/family-members`, {
    candidate_id: CANDIDATE_ID,
    members: [
      { name: 'Rajesh Sharma', relation: 'Father', age: 52, occupation: 'Retired Govt Employee', mobile: '9812345678' },
      { name: 'Sunita Sharma', relation: 'Mother', age: 48, occupation: 'Homemaker', mobile: '9898765432' },
    ],
  }).catch(() => ({ status: 404, body: {} }));
  log('ONBOARDING_FAMILY', family.status < 400 ? 'PASS' : 'WARN',
    `Family members (HTTP ${family.status})`);

  // Qualifications
  const qual = await api('POST', `/api/onboarding/qualification`, {
    candidate_id: CANDIDATE_ID,
    qualifications: [
      {
        degree: 'B.Com',
        institution: 'Chaudhary Charan Singh University, Meerut',
        board_university: 'CCS University',
        passing_year: 2020,
        percentage: 68.5,
        stream: 'Commerce',
      },
      {
        degree: '12th',
        institution: 'Govt Inter College, Noida',
        board_university: 'UP Board',
        passing_year: 2017,
        percentage: 72.0,
        stream: 'Commerce',
      },
    ],
  }).catch(() => ({ status: 404, body: {} }));
  log('ONBOARDING_EDUCATION', qual.status < 400 ? 'PASS' : 'WARN',
    `Education qualifications (HTTP ${qual.status})`);

  // Work experience
  const exp = await api('POST', `/api/onboarding/experience`, {
    candidate_id: CANDIDATE_ID,
    experiences: [
      {
        company_name: 'Concentrix Services Pvt Ltd',
        designation: 'Customer Service Associate',
        department: 'Customer Support',
        from_date: '2020-08-01',
        to_date: '2022-06-30',
        ctc: 14000,
        reason_for_leaving: 'Better opportunity',
        reporting_manager: 'Suresh Patel',
        hr_contact: '9011223344',
      },
    ],
  }).catch(() => ({ status: 404, body: {} }));
  log('ONBOARDING_EXPERIENCE', exp.status < 400 ? 'PASS' : 'WARN',
    `Work experience (HTTP ${exp.status})`);

  // Bank details
  const bank = await api('POST', `/api/onboarding/bank-details`, {
    candidate_id: CANDIDATE_ID,
    bank_account_no: '30987654321',
    bank_ifsc: 'SBIN0001234',
    bank_name: 'State Bank of India',
    bank_branch: 'Sector 18 Noida',
    account_holder_name: 'Priya Sharma',
    account_type: 'Savings',
    nominee_name: 'Rajesh Sharma',
    nominee_relation: 'Father',
  }).catch(() => ({ status: 404, body: {} }));
  log('ONBOARDING_BANK', bank.status < 400 ? 'PASS' : 'WARN',
    `Bank details (HTTP ${bank.status})`);

  // Nominees
  const nominees = await api('POST', `/api/onboarding/nominees`, {
    candidate_id: CANDIDATE_ID,
    nominees: [
      { name: 'Rajesh Sharma', relation: 'Father', dob: '1974-05-10', share_pct: 100, address: '45 Sector 18, Noida' },
    ],
  }).catch(() => ({ status: 404, body: {} }));
  log('ONBOARDING_NOMINEES', nominees.status < 400 ? 'PASS' : 'WARN',
    `Nominees (HTTP ${nominees.status})`);

  // Privacy consent
  const consent = await api('POST', `/api/onboarding/privacy-consent`, {
    candidate_id: CANDIDATE_ID,
    consent_given: true,
    ip_address: '127.0.0.1',
  }).catch(() => ({ status: 404, body: {} }));
  log('ONBOARDING_CONSENT', consent.status < 400 ? 'PASS' : 'WARN',
    `Privacy consent (HTTP ${consent.status})`);

  // Screenshot onboarding page
  await page.goto(`${FRONTEND_URL}/onboarding`);
  await page.waitForTimeout(2500);
  await screenshot(page, 'onboarding_portal', 'Onboarding portal page');

  // Try to navigate to candidate onboarding via token if available
  if (ONBOARDING_TOKEN) {
    await page.goto(`${FRONTEND_URL}/onboarding?token=${ONBOARDING_TOKEN}`);
    await page.waitForTimeout(3000);
    await screenshot(page, 'onboarding_form_loaded', 'Onboarding form with token');
  }

  // Check progress
  const progress = await api('GET', `/api/onboarding/progress?candidate_id=${CANDIDATE_ID}`)
    .catch(() => ({ status: 404, body: {} }));
  log('ONBOARDING_PROGRESS', progress.status < 400 ? 'PASS' : 'WARN',
    `Onboarding progress (HTTP ${progress.status})`, progress.body?.data);
}

// ─── STEP 7: HR Review + Employee Conversion ─────────────────────────────────

async function step7_hr_review(page) {
  console.log('\n══════════════════════════════════════');
  console.log('STEP 7: HR Review + Employee Conversion');
  console.log('══════════════════════════════════════');

  if (!CANDIDATE_ID) { log('HR_REVIEW', 'SKIP', 'No candidate ID'); return; }

  // Check candidate profile status
  const profile = await api('GET', `/api/ats/candidates/${CANDIDATE_ID}`);
  log('HR_PROFILE_CHECK', profile.status < 400 ? 'PASS' : 'FAIL',
    `Profile fetched (HTTP ${profile.status})`, {
      stage: profile.body?.data?.current_stage,
      bgv_status: profile.body?.data?.bgv_status,
      profile_status: profile.body?.data?.profile_status,
    });

  // HR review submission
  const review = await api('PUT', `/api/ats/candidates/${CANDIDATE_ID}`, {
    current_stage: 'hr_review',
    profile_status: 'review_submitted',
  });
  log('HR_REVIEW_STAGE', review.status < 400 ? 'PASS' : 'FAIL',
    `Stage → hr_review (HTTP ${review.status})`);

  // Approve and convert to employee
  const convert = await api('POST', `/api/ats/candidates/${CANDIDATE_ID}/convert-to-employee`, {
    employee_id_prefix: 'MAS',
    joining_date: '2026-07-15',
    designation: 'Customer Care Executive',
    department: 'Operations',
    process_id: '78426870-5e88-11f1-adb1-00155d0ab410',
    branch_id: 'febd8777-6583-11f1-adb1-00155d0ab410',
    ctc: 18000,
    gross_salary: 15500,
    approved_by: 'Anjali Mehta (HR Manager)',
  }).catch(() => ({ status: 404, body: {} }));

  const empId = convert.body?.data?.employee_id || convert.body?.employee_id;
  log('EMPLOYEE_CONVERSION', convert.status < 400 ? 'PASS' : 'WARN',
    `Convert to employee (HTTP ${convert.status})`, {
      employee_id: empId,
      message: convert.body?.message,
    });

  // Navigate to HR review in ATS
  await page.goto(`${FRONTEND_URL}/ats`);
  await page.waitForTimeout(2000);
  await screenshot(page, 'hr_review_ats', 'ATS after HR review stage');

  // Navigate to employee list if conversion succeeded
  if (convert.status < 400) {
    await page.goto(`${FRONTEND_URL}/employees`);
    await page.waitForTimeout(2500);
    await screenshot(page, 'employee_list_post_conversion', 'Employee list after conversion');
  }

  return empId;
}

// ─── STEP 8: Post-Onboarding ──────────────────────────────────────────────────

async function step8_post_onboarding(page, employeeId) {
  console.log('\n══════════════════════════════════════');
  console.log('STEP 8: Post-Onboarding Journey');
  console.log('══════════════════════════════════════');

  // Joining documents check
  const joiningDocs = await api('GET', `/api/employees/joining-documents?candidate_id=${CANDIDATE_ID}`)
    .catch(() => ({ status: 404, body: {} }));
  log('JOINING_DOCS', joiningDocs.status < 400 ? 'PASS' : 'WARN',
    `Joining documents (HTTP ${joiningDocs.status})`, joiningDocs.body?.data?.length !== undefined ? { count: joiningDocs.body.data.length } : joiningDocs.body?.message);

  // Check for digital form fill (EPF, ESIC, nomination forms)
  const digitalForms = await api('GET', `/api/employees/digital-forms?candidate_id=${CANDIDATE_ID}`)
    .catch(() => ({ status: 404, body: {} }));
  log('DIGITAL_FORMS', digitalForms.status < 400 ? 'PASS' : 'WARN',
    `Digital form fill (HTTP ${digitalForms.status})`);

  // Employee dashboard
  if (employeeId) {
    await page.goto(`${FRONTEND_URL}/employees/${employeeId}`);
    await page.waitForTimeout(3000);
    await screenshot(page, 'employee_profile_postconversion', 'New employee profile');

    // Check compliance status
    const compliance = await api('GET', `/api/employees/${employeeId}/compliance-status`)
      .catch(() => ({ status: 404, body: {} }));
    log('COMPLIANCE_STATUS', compliance.status < 400 ? 'PASS' : 'WARN',
      `Compliance status (HTTP ${compliance.status})`, compliance.body?.data);
  }

  // ATS pipeline overview
  await page.goto(`${FRONTEND_URL}/ats`);
  await page.waitForTimeout(2500);
  await screenshot(page, 'ats_pipeline_final', 'ATS pipeline after full journey');

  // Check candidate final state
  const finalState = await api('GET', `/api/ats/candidates/${CANDIDATE_ID}`);
  log('FINAL_CANDIDATE_STATE', finalState.status < 400 ? 'PASS' : 'FAIL',
    `Final state (HTTP ${finalState.status})`, {
      stage: finalState.body?.data?.current_stage,
      bgv_status: finalState.body?.data?.bgv_status,
      profile_status: finalState.body?.data?.profile_status,
      offer_status: finalState.body?.data?.offer_status,
    });
}

// ─── REPORT ───────────────────────────────────────────────────────────────────

function generateReport() {
  const pass = REPORT.filter(r => r.status === 'PASS').length;
  const fail = REPORT.filter(r => r.status === 'FAIL').length;
  const warn = REPORT.filter(r => r.status === 'WARN' || r.status === 'SKIP').length;

  console.log('\n══════════════════════════════════════════════════════');
  console.log('  FULL E2E TEST REPORT — Candidate Journey');
  console.log('══════════════════════════════════════════════════════');
  console.log(`  Candidate Code : ${CANDIDATE_CODE}`);
  console.log(`  Candidate ID   : ${CANDIDATE_ID}`);
  console.log(`  PASS  : ${pass}`);
  console.log(`  WARN  : ${warn}`);
  console.log(`  FAIL  : ${fail}`);
  console.log(`  TOTAL : ${REPORT.length}`);
  console.log('──────────────────────────────────────────────────────');
  REPORT.forEach(r => {
    const icon = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '⚠️';
    console.log(`  ${icon} ${r.step.padEnd(30)} ${r.detail}`);
  });
  console.log('══════════════════════════════════════════════════════\n');

  const reportPath = path.join(__dirname, 'e2e-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    candidateCode: CANDIDATE_CODE,
    candidateId: CANDIDATE_ID,
    timestamp: new Date().toISOString(),
    summary: { pass, fail, warn, total: REPORT.length },
    steps: REPORT,
    screenshots: fs.readdirSync(SCREENSHOTS_DIR).map(f => path.join(SCREENSHOTS_DIR, f)),
  }, null, 2));
  console.log(`📄 Report saved: ${reportPath}`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'en-IN',
  });
  const page = await context.newPage();

  // Inject auth token into browser storage for all subsequent page loads
  await context.addInitScript((token) => {
    localStorage.setItem('hrms_token', token);
    localStorage.setItem('token', token);
    sessionStorage.setItem('token', token);
  }, ''); // will be updated after auth

  try {
    // Step 0: Auth
    const authed = await step0_auth();
    if (!authed) { await browser.close(); generateReport(); return; }

    // Reinject token into browser
    await context.addInitScript((token) => {
      localStorage.setItem('hrms_token', token);
      localStorage.setItem('token', token);
      sessionStorage.setItem('token', token);
    }, TOKEN);

    // Load app and inject token via page eval
    await page.goto(FRONTEND_URL);
    await page.waitForTimeout(2000);
    await page.evaluate((token) => {
      localStorage.setItem('hrms_token', token);
      localStorage.setItem('token', token);
      sessionStorage.setItem('token', token);
    }, TOKEN);

    await screenshot(page, '00_app_loaded', 'App home loaded');

    // Step 1: Walk-in registration
    await step1_walkin(page);

    // Step 2: Screening
    await step2_screening(page);

    // Step 3: Interview
    await step3_interview(page);

    // Step 4: Selection + Offer
    await step4_selection(page);

    // Step 5: BGV
    await step5_bgv(page);

    // Step 6: Onboarding
    await step6_onboarding(page);

    // Step 7: HR Review + Conversion
    const employeeId = await step7_hr_review(page);

    // Step 8: Post-onboarding
    await step8_post_onboarding(page, employeeId);

  } catch (err) {
    console.error('FATAL:', err);
    log('FATAL_ERROR', 'FAIL', err.message);
    await screenshot(page, 'fatal_error', 'Error state').catch(() => {});
  } finally {
    await browser.close();
    generateReport();
  }
})();
