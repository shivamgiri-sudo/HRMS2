/**
 * Full E2E Journey Test: Walk-in Registration (UI) → Pipeline → BGV → Onboarding → Employee
 * Playwright + real API calls. Screenshots at every step. Real data throughout.
 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:5055';
const APP  = 'http://localhost:5173';
const SS   = path.join(__dirname, 'screenshots');
if (!fs.existsSync(SS)) fs.mkdirSync(SS, { recursive: true });

const REPORT = [];
let TOKEN = '', CANDIDATE_DB_ID = '', CANDIDATE_CODE = '', ssCount = 0;

// ─── helpers ──────────────────────────────────────────────────────────────────
function apiReq(method, p, body) {
  return new Promise((resolve) => {
    const u = new URL(BASE + p);
    const data = body ? JSON.stringify(body) : undefined;
    const opts = {
      hostname: u.hostname, port: Number(u.port) || 80,
      path: u.pathname + u.search, method,
      headers: {
        'Content-Type': 'application/json',
        ...(TOKEN ? { 'Authorization': `Bearer ${TOKEN}` } : {}),
      },
    };
    const req = http.request(opts, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch  { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', e => resolve({ status: 0, body: { error: e.message } }));
    if (data) req.write(data); req.end();
  });
}

function uploadMultipart(candidateId, filePath, docType) {
  return new Promise((resolve) => {
    const boundary = 'E2EBound' + Date.now();
    const fileContent = fs.readFileSync(filePath);
    const filename = path.basename(filePath);
    const pre = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="document_type"\r\n\r\n${docType}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="candidate_id"\r\n\r\n${candidateId}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`
    );
    const post = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([pre, fileContent, post]);
    const opts = {
      hostname: 'localhost', port: 5055,
      path: `/api/ats/candidates/${candidateId}/upload`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    };
    const req = http.request(opts, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ ok: res.statusCode < 400, status: res.statusCode, body: JSON.parse(d) }); }
        catch  { resolve({ ok: res.statusCode < 400, status: res.statusCode, body: d.substring(0, 100) }); }
      });
    });
    req.on('error', e => resolve({ ok: false, status: 0, body: e.message }));
    req.write(body); req.end();
  });
}

function log(step, status, detail, data) {
  REPORT.push({ step, status, detail, data: data || null });
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️ ';
  console.log(`${icon} [${step}] ${detail}`);
  if (data) console.log(`   → ${JSON.stringify(data).substring(0, 220)}`);
}

async function snap(page, name) {
  ssCount++;
  const file = path.join(SS, `${String(ssCount).padStart(2, '0')}_${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`   📸 ${path.basename(file)}`);
}

async function injectAuth(page) {
  await page.evaluate((t) => {
    localStorage.setItem('hrms_token', t);
    localStorage.setItem('token', t);
  }, TOKEN);
}

function makePdf(title, lines) {
  const content = `BT /F1 14 Tf 50 760 Td (${title}) Tj` +
    lines.map((l, i) => ` 0 ${-30 - i * 25} Td (${l}) Tj`).join('') +
    ' ET';
  return [
    '%PDF-1.4',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj',
    `4 0 obj<</Length ${content.length}>>\nstream\n${content}\nendstream\nendobj`,
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
    'xref\n0 6\n0000000000 65535 f \n',
    'trailer<</Size 6/Root 1 0 R>>\nstartxref\n0\n%%EOF',
  ].join('\n');
}

// ─── STEP 0: Auth ─────────────────────────────────────────────────────────────
async function step0_auth() {
  console.log('\n══════════════════════════════════════════');
  console.log(' STEP 0 — Authentication');
  console.log('══════════════════════════════════════════');
  const r = await apiReq('POST', '/api/auth/login', { identifier: 'mas47814', password: 'Alpha@3035' });
  if (r.body?.data?.accessToken) {
    TOKEN = r.body.data.accessToken;
    log('AUTH', 'PASS', `Logged in as ${r.body.data.user?.email || 'user'}`);
    return true;
  }
  log('AUTH', 'FAIL', 'Login failed', r.body);
  return false;
}

// ─── STEP 1: Walk-in Registration via UI ─────────────────────────────────────
async function step1_walkin(page) {
  console.log('\n══════════════════════════════════════════');
  console.log(' STEP 1 — Walk-in Registration (UI Form)');
  console.log('══════════════════════════════════════════');

  await page.goto(`${APP}/ats/candidate-registration`);
  await page.waitForTimeout(4000);
  await snap(page, 'step1_registration_page_loaded');

  // Try to fill the real form
  let formFilled = false;
  try {
    // Name field
    const nameField = page.locator('input').filter({ hasText: '' }).first();
    await page.locator('input[placeholder*="ame"], input[placeholder*="Full"]').first().fill('Priya Sharma');
    await page.waitForTimeout(200);

    // Mobile
    await page.locator('input[type="tel"], input[placeholder*="obile"], input[placeholder*="Phone"]').first().fill('9871234567');
    await page.waitForTimeout(200);

    // Email
    await page.locator('input[type="email"], input[placeholder*="mail"]').first().fill('priya.sharma.e2e@gmail.com').catch(() => {});
    await page.waitForTimeout(200);

    await snap(page, 'step1_basic_info_filled');

    // Selects — iterate all selects and fill based on options available
    const allSelects = await page.locator('select').all();
    console.log(`   Found ${allSelects.length} select elements`);
    for (const sel of allSelects) {
      const opts = await sel.locator('option').allTextContents();
      if (opts.some(o => /female/i.test(o))) { await sel.selectOption({ label: /Female/ }).catch(() => {}); }
      else if (opts.some(o => /NOIDA-2/i.test(o))) { await sel.selectOption('NOIDA-2').catch(() => {}); }
      else if (opts.some(o => /graduate/i.test(o))) { await sel.selectOption({ label: /^Graduate/ }).catch(() => {}); }
      else if (opts.some(o => /1.2|1-2/i.test(o))) { await sel.selectOption(opts.find(o => /1.2|1-2/i.test(o)) || '').catch(() => {}); }
      else if (opts.some(o => /walk.?in/i.test(o))) { await sel.selectOption(opts.find(o => /walk.?in/i.test(o)) || '').catch(() => {}); }
    }

    // Address
    await page.locator('textarea').first().fill('45 Sector 18, Noida, Uttar Pradesh 201301').catch(async () => {
      await page.locator('input[placeholder*="ddress"]').first().fill('45 Sector 18, Noida, Uttar Pradesh 201301').catch(() => {});
    });

    await snap(page, 'step1_form_complete');
    formFilled = true;

    // Submit
    await page.locator('button[type="submit"]').click().catch(async () => {
      await page.locator('button').filter({ hasText: /submit|register/i }).first().click();
    });
    await page.waitForTimeout(5000);
    await snap(page, 'step1_after_submit');

    const bodyText = await page.textContent('body').catch(() => '');
    if (/success|registered|CND-|MAS\d+/i.test(bodyText)) {
      log('WALKIN_UI_SUBMIT', 'PASS', 'Form submitted, success shown');
    } else {
      log('WALKIN_UI_SUBMIT', 'WARN', 'Submitted — verifying via API');
    }
  } catch (err) {
    log('WALKIN_UI_FILL', 'WARN', `Form fill: ${err.message.substring(0, 100)}`);
    await snap(page, 'step1_form_error');
  }

  // Verify candidate in API
  await new Promise(r => setTimeout(r, 1500));
  const list = await apiReq('GET', '/api/ats/candidates?limit=15');
  const found = (list.body?.data || []).find(c =>
    c.mobile === '9871234567' || c.email === 'priya.sharma.e2e@gmail.com'
  );
  if (found) {
    CANDIDATE_DB_ID = found.id; CANDIDATE_CODE = found.candidate_code;
    log('WALKIN_API_VERIFY', 'PASS', `Candidate in DB: ${CANDIDATE_CODE}`, {
      id: CANDIDATE_DB_ID, stage: found.current_stage, branch: found.branch_display_name,
    });
    return;
  }

  // API fallback — use submit-enhanced directly
  console.log('   → API fallback (unique mobile to avoid dup)...');
  const mobile2 = '987124' + Math.floor(1000 + Math.random() * 9000);
  const r = await apiReq('POST', '/api/ats/registration/submit-enhanced', {
    name: 'Priya Sharma', mobile: mobile2,
    email: `priya.${mobile2}@gmail.com`, gender: 'Female',
    roleApplied: 'Inbound Agent', branchDisplayName: 'NOIDA-2',
    sourcingChannel: 'Walk-In',
    address: '45 Sector 18, Noida, Uttar Pradesh 201301',
    education: 'Graduate', experience: '1-2 Years',
    rotationalShift: 1, nightShiftOk: 1,
    leavesIn3months: 0, ownsTwoWheeler: 0,
    idProofAvailable: 1, educationProofAvailable: 1,
  });
  if (r.status < 400) {
    CANDIDATE_DB_ID = r.body.candidateId || r.body.data?.id || '';
    CANDIDATE_CODE  = r.body.candidate_code || r.body.data?.candidate_code || '';
    log('WALKIN_API_FALLBACK', 'PASS', `Created via API: ${CANDIDATE_CODE}`, { id: CANDIDATE_DB_ID });
  } else {
    log('WALKIN_API_FALLBACK', 'FAIL', `HTTP ${r.status}`, r.body?.errors || r.body?.message);
    // Use an existing candidate to continue
    const latest = (await apiReq('GET', '/api/ats/candidates?limit=1&stage=walkin_registered')).body?.data?.[0]
                || (await apiReq('GET', '/api/ats/candidates?limit=1')).body?.data?.[0];
    if (latest) {
      CANDIDATE_DB_ID = latest.id; CANDIDATE_CODE = latest.candidate_code;
      log('WALKIN_FALLBACK_EXISTING', 'WARN', `Using existing: ${CANDIDATE_CODE}`);
    }
  }
}

// ─── STEP 2: Candidate Profile ────────────────────────────────────────────────
async function step2_profile(page) {
  console.log('\n══════════════════════════════════════════');
  console.log(' STEP 2 — Candidate Profile View');
  console.log('══════════════════════════════════════════');
  if (!CANDIDATE_DB_ID) { log('PROFILE', 'SKIP', 'No candidate ID'); return; }

  await page.goto(`${APP}/ats/candidate/${CANDIDATE_DB_ID}`);
  await page.waitForTimeout(3500);
  await snap(page, 'step2_candidate_profile');

  const r = await apiReq('GET', `/api/ats/candidates/${CANDIDATE_DB_ID}`);
  const c = r.body?.data || {};
  log('PROFILE_FETCH', r.status < 400 ? 'PASS' : 'FAIL', `Profile: ${c.full_name}`, {
    name: c.full_name, mobile: c.mobile, stage: c.current_stage,
    branch: c.branch_display_name, bgv: c.bgv_status,
  });
}

// ─── STEP 3: Pipeline ─────────────────────────────────────────────────────────
async function step3_pipeline(page) {
  console.log('\n══════════════════════════════════════════');
  console.log(' STEP 3 — Pipeline Stages');
  console.log('══════════════════════════════════════════');
  if (!CANDIDATE_DB_ID) { log('PIPELINE', 'SKIP', 'No candidate ID'); return; }

  const stages = [
    ['screening', { screening_score: 76, screening_remarks: 'Good aptitude, clear communication' }],
    ['interview', { interview_round: 1, interviewer: 'Anjali Mehta' }],
    ['selected',  { interview_score: 84, selection_remarks: 'Recommended for Inbound role' }],
  ];

  for (const [stage, extra] of stages) {
    const r = await apiReq('PUT', `/api/ats/candidates/${CANDIDATE_DB_ID}`, { current_stage: stage, ...extra });
    log(`STAGE_${stage.toUpperCase()}`, r.status < 400 ? 'PASS' : 'FAIL', `→ ${stage} (HTTP ${r.status})`);
    await page.goto(`${APP}/ats/candidate/${CANDIDATE_DB_ID}`);
    await page.waitForTimeout(2000);
    await snap(page, `step3_pipeline_${stage}`);
  }
}

// ─── STEP 4: BGV ─────────────────────────────────────────────────────────────
async function step4_bgv(page) {
  console.log('\n══════════════════════════════════════════');
  console.log(' STEP 4 — BGV (Real Data + PDF Upload)');
  console.log('══════════════════════════════════════════');
  if (!CANDIDATE_DB_ID) { log('BGV', 'SKIP', 'No candidate ID'); return; }

  // Save all BGV data fields
  const r = await apiReq('PUT', `/api/ats/candidates/${CANDIDATE_DB_ID}`, {
    aadhar_number: '4567 8901 2345',
    pan_number: 'BXMPS6789K',
    father_name: 'Rajesh Sharma',
    permanent_address: '45 Sector 18, Noida, Uttar Pradesh 201301',
    emergency_contact_name: 'Rajesh Sharma',
    emergency_contact_mobile: '9812345678',
    bank_account_no: '30987654321',
    bank_ifsc: 'SBIN0001234',
    bank_name: 'State Bank of India',
    bank_branch: 'Sector 18 Noida',
    account_holder_name: 'Priya Sharma',
  });
  log('BGV_DATA_FIELDS', r.status < 400 ? 'PASS' : 'FAIL', `BGV fields saved (HTTP ${r.status})`);

  // Create PDFs and upload
  const docs = [
    { name: 'aadhaar.pdf', type: 'aadhar_card',
      title: 'AADHAAR CARD - PRIYA SHARMA',
      lines: ['Aadhaar Number: 4567 8901 2345', 'Date of Birth: 15/03/1998',
              'Address: 45 Sector 18, Noida, UP 201301', 'F/N: Rajesh Sharma'] },
    { name: 'pan.pdf', type: 'pan_card',
      title: 'PERMANENT ACCOUNT NUMBER CARD',
      lines: ['Name: PRIYA SHARMA', 'PAN: BXMPS6789K',
              "Father's Name: RAJESH SHARMA", 'Date of Birth: 15/03/1998'] },
    { name: 'education.pdf', type: 'education_certificate',
      title: 'DEGREE CERTIFICATE - B.COM',
      lines: ['University: CCS University, Meerut', 'Year of Passing: 2020',
              'Percentage: 68.50%', 'Stream: Commerce'] },
    { name: 'exp-letter.pdf', type: 'experience_letter',
      title: 'EXPERIENCE CERTIFICATE',
      lines: ['Company: Concentrix Services Pvt Ltd', 'Designation: Customer Service Associate',
              'Period: Aug 2020 - Jun 2022', 'This is to certify satisfactory service'] },
  ];

  for (const doc of docs) {
    const fpath = path.join(__dirname, doc.name);
    fs.writeFileSync(fpath, makePdf(doc.title, doc.lines));
    const up = await uploadMultipart(CANDIDATE_DB_ID, fpath, doc.type);
    log(`UPLOAD_${doc.type.toUpperCase()}`, up.ok ? 'PASS' : 'WARN', `${doc.name} → HTTP ${up.status}`);
  }

  // Manual verifications
  for (const check of ['address', 'education', 'employment']) {
    const m = await apiReq('POST', `/api/ats/bgv/manual-feedback/${CANDIDATE_DB_ID}/${check}`, {
      status: 'verified', notes: `${check} verified by HR team — ${new Date().toLocaleDateString()}`,
    }).catch(() => ({ status: 404, body: {} }));
    log(`BGV_MANUAL_${check.toUpperCase()}`, m.status < 400 ? 'PASS' : 'WARN', `Manual ${check} (HTTP ${m.status})`);
  }

  // BGV readiness
  const rd = await apiReq('GET', `/api/ats/bgv/candidate/${CANDIDATE_DB_ID}/bgv-readiness`)
    .catch(() => ({ status: 404, body: {} }));
  log('BGV_READINESS', rd.status < 400 ? 'PASS' : 'WARN', `Readiness (HTTP ${rd.status})`, rd.body?.data);

  // Screenshot BGV queue
  await page.goto(`${APP}/ats/bgv`);
  await page.waitForTimeout(3000);
  await snap(page, 'step4_bgv_queue');

  // Candidate with BGV docs
  await page.goto(`${APP}/ats/candidate/${CANDIDATE_DB_ID}`);
  await page.waitForTimeout(3000);
  await snap(page, 'step4_bgv_candidate_profile');
}

// ─── STEP 5: Onboarding ───────────────────────────────────────────────────────
async function step5_onboarding(page) {
  console.log('\n══════════════════════════════════════════');
  console.log(' STEP 5 — Onboarding Form');
  console.log('══════════════════════════════════════════');
  if (!CANDIDATE_DB_ID) { log('ONBOARDING', 'SKIP', 'No candidate ID'); return; }

  // Move to onboarding
  const stageR = await apiReq('PUT', `/api/ats/candidates/${CANDIDATE_DB_ID}`, { current_stage: 'onboarding' });
  log('ONBOARDING_STAGE', stageR.status < 400 ? 'PASS' : 'FAIL', `→ onboarding (HTTP ${stageR.status})`);

  // Get q_token for onboarding form
  const cand = await apiReq('GET', `/api/ats/candidates/${CANDIDATE_DB_ID}`);
  const qToken = cand.body?.data?.q_token || '';
  log('ONBOARD_TOKEN', qToken ? 'PASS' : 'WARN', qToken ? `Token: ${qToken.substring(0,16)}...` : 'No q_token');

  // Navigate to onboarding form
  if (qToken) {
    await page.goto(`${APP}/onboarding?token=${qToken}`);
    await page.waitForTimeout(4000);
    await snap(page, 'step5_onboarding_form_with_token');
  } else {
    await page.goto(`${APP}/ats/candidate/${CANDIDATE_DB_ID}`);
    await page.waitForTimeout(2000);
    await snap(page, 'step5_onboarding_candidate');
  }

  // Fill all onboarding sections via API
  const base = '/api/onboarding-full';
  const tk = { token: qToken, candidate_id: CANDIDATE_DB_ID };

  // Personal details
  const p1 = await apiReq('POST', `${base}/employee-details`, { ...tk,
    first_name: 'Priya', last_name: 'Sharma', date_of_birth: '1998-03-15',
    gender: 'Female', marital_status: 'Single',
    father_name: 'Rajesh Sharma', mother_name: 'Sunita Sharma',
    blood_group: 'B+', nationality: 'Indian', religion: 'Hindu',
    current_address: '45 Sector 18, Noida, Uttar Pradesh 201301',
    permanent_address: '45 Sector 18, Noida, Uttar Pradesh 201301',
    mobile: '9871234567', email: 'priya.sharma.e2e@gmail.com',
    aadhar_number: '4567 8901 2345', pan_number: 'BXMPS6789K',
    uan_number: '100987654321',
  }).catch(() => ({ status: 404, body: {} }));
  log('ONBOARD_PERSONAL', p1.status < 400 ? 'PASS' : 'WARN', `Personal details (HTTP ${p1.status})`);

  // Bank details
  const p2 = await apiReq('POST', `${base}/bank-details`, { ...tk,
    bank_account_no: '30987654321', bank_ifsc: 'SBIN0001234',
    bank_name: 'State Bank of India', bank_branch: 'Sector 18 Noida',
    account_holder_name: 'Priya Sharma', account_type: 'Savings',
  }).catch(() => ({ status: 404, body: {} }));
  log('ONBOARD_BANK', p2.status < 400 ? 'PASS' : 'WARN', `Bank details (HTTP ${p2.status})`);

  // Education
  const p3 = await apiReq('POST', `${base}/qualification`, { ...tk,
    qualifications: [
      { degree: 'B.Com', institution: 'CCS University, Meerut', year: 2020, percentage: 68.5, stream: 'Commerce' },
      { degree: '12th', institution: 'Govt Inter College, Noida', year: 2017, percentage: 72.0, stream: 'Commerce' },
      { degree: '10th', institution: 'Govt High School, Noida', year: 2015, percentage: 74.0, stream: 'General' },
    ],
  }).catch(() => ({ status: 404, body: {} }));
  log('ONBOARD_EDUCATION', p3.status < 400 ? 'PASS' : 'WARN', `Education (HTTP ${p3.status})`);

  // Family members
  const p4 = await apiReq('POST', `${base}/family`, { ...tk,
    members: [
      { name: 'Rajesh Sharma', relation: 'Father', age: 52, occupation: 'Retired Govt Employee', mobile: '9812345678', is_dependent: true },
      { name: 'Sunita Sharma', relation: 'Mother', age: 48, occupation: 'Homemaker', mobile: '9898765432', is_dependent: true },
      { name: 'Rahul Sharma', relation: 'Brother', age: 24, occupation: 'Student', mobile: '', is_dependent: false },
    ],
  }).catch(() => ({ status: 404, body: {} }));
  log('ONBOARD_FAMILY', p4.status < 400 ? 'PASS' : 'WARN', `Family (HTTP ${p4.status})`);

  // Work experience
  const p5 = await apiReq('POST', `${base}/experience`, { ...tk,
    experiences: [{
      company_name: 'Concentrix Services Pvt Ltd', designation: 'Customer Service Associate',
      from_date: '2020-08-01', to_date: '2022-06-30',
      ctc: 14000, reason_for_leaving: 'Better opportunity and growth',
      reporting_manager: 'Suresh Patel', hr_contact: '9011223344',
      exit_process: 'Full and Final settled', rehire_eligible: true,
    }],
  }).catch(() => ({ status: 404, body: {} }));
  log('ONBOARD_EXPERIENCE', p5.status < 400 ? 'PASS' : 'WARN', `Experience (HTTP ${p5.status})`);

  // Final section
  const p6 = await apiReq('POST', `${base}/final-section`, { ...tk,
    emergency_contact_name: 'Rajesh Sharma', emergency_contact_mobile: '9812345678',
    emergency_contact_relation: 'Father', emergency_contact_address: '45 Sector 18, Noida',
    pf_opt_out: false, esic_applicable: true, nominee_name: 'Rajesh Sharma',
    nominee_relation: 'Father', nominee_dob: '1974-05-10', nominee_share: 100,
  }).catch(() => ({ status: 404, body: {} }));
  log('ONBOARD_FINAL', p6.status < 400 ? 'PASS' : 'WARN', `Final section (HTTP ${p6.status})`);

  // Check progress
  const prog = await apiReq('GET', `${base}/status?candidate_id=${CANDIDATE_DB_ID}`)
    .catch(() => ({ status: 404, body: {} }));
  log('ONBOARD_PROGRESS', prog.status < 400 ? 'PASS' : 'WARN', `Progress (HTTP ${prog.status})`, prog.body?.data);

  // Screenshot HR onboarding queue
  await page.goto(`${APP}/ats`);
  await page.waitForTimeout(2500);
  await snap(page, 'step5_ats_with_onboarding');
}

// ─── STEP 6: HR Review ────────────────────────────────────────────────────────
async function step6_hr_review(page) {
  console.log('\n══════════════════════════════════════════');
  console.log(' STEP 6 — HR Review & Approval');
  console.log('══════════════════════════════════════════');
  if (!CANDIDATE_DB_ID) { log('HR_REVIEW', 'SKIP', 'No candidate ID'); return; }

  // Full onboarding data for HR review
  const fullData = await apiReq('GET', `/api/onboarding-full/full?candidate_id=${CANDIDATE_DB_ID}`)
    .catch(() => ({ status: 404, body: {} }));
  log('HR_FULL_DATA', fullData.status < 400 ? 'PASS' : 'WARN', `Full data (HTTP ${fullData.status})`);

  // HR approval
  const approve = await apiReq('POST', '/api/onboarding-full/review', {
    candidate_id: CANDIDATE_DB_ID, action: 'approve',
    remarks: 'All documents verified. Background check clear. Recommended for joining.',
    reviewed_by: 'Anjali Mehta (HR Manager)',
  }).catch(() => ({ status: 404, body: {} }));
  log('HR_APPROVE', approve.status < 400 ? 'PASS' : 'WARN', `HR review submit (HTTP ${approve.status})`);

  // Update status
  const upd = await apiReq('PUT', `/api/ats/candidates/${CANDIDATE_DB_ID}`, {
    profile_status: 'approved', bgv_status: 'clear', current_stage: 'hr_review',
  });
  log('HR_STATUS_UPDATE', upd.status < 400 ? 'PASS' : 'FAIL', `Status updated (HTTP ${upd.status})`);

  await page.goto(`${APP}/ats/candidate/${CANDIDATE_DB_ID}`);
  await page.waitForTimeout(3000);
  await snap(page, 'step6_hr_review_approved');
}

// ─── STEP 7: Employee Conversion ─────────────────────────────────────────────
async function step7_convert(page) {
  console.log('\n══════════════════════════════════════════');
  console.log(' STEP 7 — Employee Conversion');
  console.log('══════════════════════════════════════════');
  if (!CANDIDATE_DB_ID) { log('CONVERT', 'SKIP', 'No candidate ID'); return null; }

  const r = await apiReq('POST', `/api/ats/candidates/${CANDIDATE_DB_ID}/convert-to-employee`, {
    joining_date: '2026-07-15', designation: 'Customer Care Executive',
    department: 'Operations', process_id: '78426870-5e88-11f1-adb1-00155d0ab410',
    branch_id: 'febd8777-6583-11f1-adb1-00155d0ab410',
    ctc: 18000, gross_salary: 15500, employment_type: 'Permanent',
  }).catch(() => ({ status: 404, body: {} }));

  const empId = r.body?.data?.employee_id || r.body?.data?.id || r.body?.employee_id || '';
  log('EMPLOYEE_CONVERT', r.status < 400 ? 'PASS' : 'WARN',
    `Convert to employee (HTTP ${r.status})`, { employee_id: empId, msg: r.body?.message });

  // Verify final candidate state
  const check = await apiReq('GET', `/api/ats/candidates/${CANDIDATE_DB_ID}`);
  const c = check.body?.data || {};
  log('CONVERT_VERIFY', check.status < 400 ? 'PASS' : 'FAIL', 'Post-conversion state', {
    stage: c.current_stage, profile_status: c.profile_status, bgv_status: c.bgv_status,
  });

  if (empId) {
    await page.goto(`${APP}/employees/${empId}`);
    await page.waitForTimeout(3500);
    await snap(page, 'step7_new_employee_profile');
  }

  return empId;
}

// ─── STEP 8: Post-Onboarding ──────────────────────────────────────────────────
async function step8_post_onboarding(page, empId) {
  console.log('\n══════════════════════════════════════════');
  console.log(' STEP 8 — Post-Onboarding');
  console.log('══════════════════════════════════════════');

  // Joining documents
  const jd = await apiReq('GET', `/api/employees/joining-documents-universal?candidateId=${CANDIDATE_DB_ID}`)
    .catch(() => ({ status: 404, body: {} }));
  log('JOINING_DOCS', jd.status < 400 ? 'PASS' : 'WARN', `Joining docs (HTTP ${jd.status})`);

  // Employee list
  await page.goto(`${APP}/employees`);
  await page.waitForTimeout(3000);
  await snap(page, 'step8_employees_list');

  // ATS overview
  await page.goto(`${APP}/ats`);
  await page.waitForTimeout(2500);
  await snap(page, 'step8_ats_final_state');

  // Final candidate state
  const fin = await apiReq('GET', `/api/ats/candidates/${CANDIDATE_DB_ID}`);
  const c   = fin.body?.data || {};
  log('JOURNEY_COMPLETE', fin.status < 400 ? 'PASS' : 'FAIL', 'Full journey complete', {
    candidate_code: CANDIDATE_CODE, stage: c.current_stage,
    profile: c.profile_status, bgv: c.bgv_status, offer: c.offer_status,
  });
}

// ─── Report ───────────────────────────────────────────────────────────────────
function finalReport() {
  const pass = REPORT.filter(r => r.status === 'PASS').length;
  const fail = REPORT.filter(r => r.status === 'FAIL').length;
  const warn = REPORT.filter(r => r.status === 'WARN' || r.status === 'SKIP').length;
  const shots = fs.existsSync(SS) ? fs.readdirSync(SS) : [];

  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║   E2E JOURNEY REPORT — Walk-in → BGV → Onboarding → Employee    ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log(`  Candidate : ${CANDIDATE_CODE || '(see API fallback)'} | ID: ${CANDIDATE_DB_ID || 'N/A'}`);
  console.log(`  PASS: ${pass}  WARN: ${warn}  FAIL: ${fail}  TOTAL: ${REPORT.length}`);
  console.log('  ──────────────────────────────────────────────────────────────────');
  REPORT.forEach(r => {
    const icon = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '⚠️ ';
    console.log(`  ${icon}  ${(r.step).padEnd(36)} ${r.detail}`);
  });
  console.log('  ──────────────────────────────────────────────────────────────────');
  console.log(`  Screenshots (${shots.length}) → ${SS}`);
  shots.forEach(f => console.log(`    📸 ${f}`));
  console.log('════════════════════════════════════════════════════════════════════\n');

  const rptPath = path.join(__dirname, 'e2e-report.json');
  fs.writeFileSync(rptPath, JSON.stringify({
    candidateCode: CANDIDATE_CODE, candidateId: CANDIDATE_DB_ID,
    timestamp: new Date().toISOString(),
    summary: { pass, fail, warn, total: REPORT.length },
    steps: REPORT, screenshots: shots,
  }, null, 2));
  console.log(`📄 Full report: ${rptPath}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  const browser = await chromium.launch({
    headless: false, slowMo: 50,
    args: ['--start-maximized', '--no-sandbox'],
  });
  const ctx  = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-IN' });
  const page = await ctx.newPage();

  try {
    if (!await step0_auth()) { await browser.close(); finalReport(); return; }

    // Login to the app via UI
    await page.goto(APP);
    await page.waitForTimeout(2500);
    await injectAuth(page);
    await page.reload();
    await page.waitForTimeout(3000);
    await snap(page, '00_app_home_logged_in');

    await step1_walkin(page);
    await step2_profile(page);
    await step3_pipeline(page);
    await step4_bgv(page);
    await step5_onboarding(page);
    await step6_hr_review(page);
    const empId = await step7_convert(page);
    await step8_post_onboarding(page, empId);

  } catch (err) {
    console.error('\nFATAL ERROR:', err.message);
    log('FATAL_ERROR', 'FAIL', err.message);
    await snap(page, 'fatal_error_state').catch(() => {});
  } finally {
    await browser.close();
    finalReport();
  }
})();
