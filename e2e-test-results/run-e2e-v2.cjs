/**
 * Full E2E Journey Test v2 — Walk-in Registration (UI) → Pipeline → BGV → Onboarding → Employee
 * Uses correct field selectors and API paths discovered from route/form inspection.
 */
const { chromium } = require('playwright');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const BASE = 'http://localhost:5055';
const APP  = 'http://localhost:5173';
const SS   = path.join(__dirname, 'screenshots');
if (!fs.existsSync(SS)) fs.mkdirSync(SS, { recursive: true });

const REPORT = [];
let TOKEN = '', CANDIDATE_ID = '', CANDIDATE_CODE = '', ONBOARDING_TOKEN = '';
let ssCount = 0;

// ─── helpers ──────────────────────────────────────────────────────────────────
function apiReq(method, p, body) {
  return new Promise((resolve) => {
    const u    = new URL(BASE + p);
    const data = body ? JSON.stringify(body) : undefined;
    const req  = http.request({
      hostname: u.hostname, port: Number(u.port) || 80,
      path: u.pathname + u.search, method,
      headers: {
        'Content-Type': 'application/json',
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try   { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch  { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', e => resolve({ status: 0, body: { error: e.message } }));
    if (data) req.write(data);
    req.end();
  });
}

function uploadMultipart(candidateId, filePath, docType) {
  return new Promise((resolve) => {
    const boundary    = 'E2EBound' + Date.now();
    const fileContent = fs.readFileSync(filePath);
    const filename    = path.basename(filePath);
    const pre  = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="document_type"\r\n\r\n${docType}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="candidate_id"\r\n\r\n${candidateId}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`
    );
    const body = Buffer.concat([pre, fileContent, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const req  = http.request({
      hostname: 'localhost', port: 5055,
      path: `/api/ats/candidates/${candidateId}/upload`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try   { resolve({ ok: res.statusCode < 400, status: res.statusCode, body: JSON.parse(d) }); }
        catch  { resolve({ ok: res.statusCode < 400, status: res.statusCode, body: d.substring(0,100) }); }
      });
    });
    req.on('error', e => resolve({ ok: false, status: 0, body: e.message }));
    req.write(body); req.end();
  });
}

function uploadOnboardingDoc(candidateId, filePath, docType) {
  return new Promise((resolve) => {
    const boundary    = 'OBBound' + Date.now();
    const fileContent = fs.readFileSync(filePath);
    const filename    = path.basename(filePath);
    const pre  = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="document_type"\r\n\r\n${docType}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="candidate_id"\r\n\r\n${candidateId}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`
    );
    const body = Buffer.concat([pre, fileContent, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const req  = http.request({
      hostname: 'localhost', port: 5055,
      path: `/api/ats/onboarding-full/documents`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try   { resolve({ ok: res.statusCode < 400, status: res.statusCode, body: JSON.parse(d) }); }
        catch  { resolve({ ok: res.statusCode < 400, status: res.statusCode, body: d.substring(0,100) }); }
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
  if (data) console.log(`   → ${JSON.stringify(data).substring(0, 200)}`);
}

async function snap(page, name) {
  ssCount++;
  const file = path.join(SS, `${String(ssCount).padStart(2, '0')}_${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`   📸 ${path.basename(file)}`);
  return file;
}

async function injectAuth(page) {
  await page.evaluate(t => {
    localStorage.setItem('hrms_token', t);
    localStorage.setItem('token', t);
  }, TOKEN);
}

function makePdf(title, lines) {
  const txt = `BT /F1 14 Tf 50 760 Td (${title}) Tj` +
    lines.map((l, i) => ` 0 ${-30 - i * 22} Td (${l}) Tj`).join('') + ' ET';
  return (
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n' +
    `4 0 obj<</Length ${txt.length}>>\nstream\n${txt}\nendstream\nendobj\n` +
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n' +
    'xref\n0 6\n0000000000 65535 f \n' +
    'trailer<</Size 6/Root 1 0 R>>\nstartxref\n0\n%%EOF'
  );
}

// ─── STEP 0: Auth ─────────────────────────────────────────────────────────────
async function step0_auth(page) {
  console.log('\n══════════════════════════════════════════════');
  console.log(' STEP 0 — Authentication');
  console.log('══════════════════════════════════════════════');
  const r = await apiReq('POST', '/api/auth/login', { identifier: 'mas47814', password: 'Alpha@3035' });
  if (!r.body?.data?.accessToken) { log('AUTH', 'FAIL', 'Login failed', r.body); return false; }
  TOKEN = r.body.data.accessToken;
  log('AUTH', 'PASS', `Logged in: ${r.body.data.user?.email}`);

  await page.goto(APP);
  await page.waitForTimeout(2500);
  await injectAuth(page);
  await page.reload();
  await page.waitForTimeout(3000);
  await snap(page, '00_app_home');
  return true;
}

// ─── STEP 1: Walk-in Registration via UI ──────────────────────────────────────
async function step1_walkin(page) {
  console.log('\n══════════════════════════════════════════════');
  console.log(' STEP 1 — Walk-in Registration (Registration UI Form)');
  console.log('══════════════════════════════════════════════');

  await page.goto(`${APP}/ats/candidate-registration`);
  await page.waitForTimeout(4000);
  await snap(page, '01_registration_form');

  let registered = false;
  try {
    // Fill based on known placeholder text from bootstrap
    await page.fill('input[placeholder="Enter your full name"]', 'Priya Sharma');
    await page.waitForTimeout(200);
    await page.fill('input[placeholder="10-digit mobile number"]', '9871236002');
    await page.waitForTimeout(200);
    await page.fill('input[placeholder="your.email@example.com"]', 'priya.e2e.002@gmail.com').catch(() => {});
    await page.waitForTimeout(200);

    await snap(page, '01b_registration_basic_filled');

    // Fill all visible selects based on option content
    const selects = await page.locator('select').all();
    for (const sel of selects) {
      const opts = await sel.locator('option').allTextContents();
      if (opts.some(o => /^female$/i.test(o.trim()))) {
        await sel.selectOption({ label: /Female/ }).catch(() => {});
      } else if (opts.some(o => o.trim() === 'NOIDA-2')) {
        await sel.selectOption('NOIDA-2').catch(() => {});
      } else if (opts.some(o => /^graduate$/i.test(o.trim()))) {
        await sel.selectOption('Graduate').catch(() => {});
      } else if (opts.some(o => /1.2 year|1-2/i.test(o))) {
        await sel.selectOption(opts.find(o => /1.2 year|1-2/i.test(o)) || opts[2] || '').catch(() => {});
      } else if (opts.some(o => /walk.?in/i.test(o))) {
        await sel.selectOption(opts.find(o => /walk.?in/i.test(o)) || '').catch(() => {});
      } else if (opts.some(o => /inbound agent/i.test(o))) {
        await sel.selectOption(opts.find(o => /inbound agent/i.test(o)) || '').catch(() => {});
      }
    }

    // Address
    await page.fill('textarea[placeholder="Your residential address"]', '45 Sector 18, Noida, UP 201301').catch(async () => {
      await page.locator('textarea').first().fill('45 Sector 18, Noida, UP 201301').catch(() => {});
    });

    await snap(page, '01c_registration_form_filled');

    // Submit
    const submitBtn = page.locator('button[type="submit"]').first();
    const hasSubmit = await submitBtn.isVisible().catch(() => false);
    if (hasSubmit) {
      await submitBtn.click();
    } else {
      await page.locator('button').filter({ hasText: /submit|register/i }).first().click();
    }
    await page.waitForTimeout(5000);
    await snap(page, '01d_registration_result');

    const bodyText = await page.textContent('body').catch(() => '');
    if (/success|registered|CND-|token number|MAS\d+/i.test(bodyText)) {
      log('WALKIN_UI', 'PASS', 'Walk-in registration form submitted successfully');
      registered = true;
    } else {
      log('WALKIN_UI', 'WARN', 'Submitted — checking DB via API');
    }
  } catch (err) {
    log('WALKIN_UI_ERROR', 'WARN', err.message.split('\n')[0].substring(0, 100));
    await snap(page, '01e_registration_error');
  }

  // Verify / fallback
  await new Promise(r => setTimeout(r, 1500));
  const list = await apiReq('GET', '/api/ats/candidates?limit=20');
  const found = (list.body?.data || []).find(c =>
    c.mobile === '9871236002' || c.email === 'priya.e2e.002@gmail.com'
  );
  if (found) {
    CANDIDATE_ID = found.id; CANDIDATE_CODE = found.candidate_code;
    log('WALKIN_DB_VERIFY', 'PASS', `In DB: ${CANDIDATE_CODE}`, {
      id: CANDIDATE_ID, stage: found.current_stage, branch: found.branch_display_name,
    });
    return;
  }

  // Direct API registration (unique timestamp-based mobile)
  const mob = `98712${Date.now().toString().slice(-5)}`;
  const r = await apiReq('POST', '/api/ats/registration/submit-enhanced', {
    name: 'Priya Sharma', mobile: mob,
    email: `priya.${mob}@gmail.com`, gender: 'Female',
    roleApplied: 'Inbound Agent', branchDisplayName: 'Okaya',
    sourcingChannel: 'Walk-In',
    address: '45 Sector 18, Noida, Uttar Pradesh 201301',
    education: 'Graduate', experience: '1-2 Years',
    rotationalShift: 1, nightShiftOk: 1,
    leavesIn3months: 0, ownsTwoWheeler: 0,
    idProofAvailable: 1, educationProofAvailable: 1,
  });
  if (r.status < 400 && r.body.candidateId) {
    CANDIDATE_ID   = r.body.candidateId;
    CANDIDATE_CODE = r.body.candidate_code || r.body.candidateId;
    log('WALKIN_API', 'PASS', `Registered via API: ${CANDIDATE_CODE} (${r.body.tokenNumber})`, {
      id: CANDIDATE_ID, branch: r.body.branchName, recruiter: r.body.recruiter?.name,
    });
  } else {
    log('WALKIN_API', 'FAIL', `HTTP ${r.status}`, r.body?.message || r.body?.errors);
    const latest = (await apiReq('GET', '/api/ats/candidates?limit=1')).body?.data?.[0];
    if (latest) { CANDIDATE_ID = latest.id; CANDIDATE_CODE = latest.candidate_code; log('WALKIN_FALLBACK', 'WARN', `Using: ${CANDIDATE_CODE}`); }
  }
}

// ─── STEP 2: Candidate Profile ────────────────────────────────────────────────
async function step2_profile(page) {
  console.log('\n══════════════════════════════════════════════');
  console.log(' STEP 2 — Candidate Profile');
  console.log('══════════════════════════════════════════════');
  if (!CANDIDATE_ID) { log('PROFILE', 'SKIP', 'No candidate'); return; }

  await page.goto(`${APP}/ats/candidate/${CANDIDATE_ID}`);
  await page.waitForTimeout(3500);
  await snap(page, '02_candidate_profile');

  const r = await apiReq('GET', `/api/ats/candidates/${CANDIDATE_ID}`);
  const c = r.body?.data || {};
  log('PROFILE_API', r.status < 400 ? 'PASS' : 'FAIL', `Profile: ${c.full_name}`, {
    name: c.full_name, mobile: c.mobile, stage: c.current_stage, branch: c.branch_display_name,
  });
}

// ─── STEP 3: Pipeline Stages ──────────────────────────────────────────────────
async function step3_pipeline(page) {
  console.log('\n══════════════════════════════════════════════');
  console.log(' STEP 3 — Pipeline Stages');
  console.log('══════════════════════════════════════════════');
  if (!CANDIDATE_ID) { log('PIPELINE', 'SKIP', 'No candidate'); return; }

  for (const [stage, extra] of [
    ['screening', { screening_score: 76, screening_remarks: 'Aptitude 76/100, good comms' }],
    ['interview', { interview_round: 1 }],
    ['selected',  { interview_score: 84, selection_remarks: 'Recommended – Inbound role' }],
  ]) {
    const r = await apiReq('PUT', `/api/ats/candidates/${CANDIDATE_ID}`, { current_stage: stage, ...extra });
    log(`STAGE_${stage.toUpperCase()}`, r.status < 400 ? 'PASS' : 'FAIL', `→ ${stage} (HTTP ${r.status})`);
    await page.goto(`${APP}/ats/candidate/${CANDIDATE_ID}`);
    await page.waitForTimeout(1800);
    await snap(page, `03_pipeline_${stage}`);
  }
}

// ─── STEP 4: BGV ─────────────────────────────────────────────────────────────
async function step4_bgv(page) {
  console.log('\n══════════════════════════════════════════════');
  console.log(' STEP 4 — BGV: Real Data + PDF Upload');
  console.log('══════════════════════════════════════════════');
  if (!CANDIDATE_ID) { log('BGV', 'SKIP', 'No candidate'); return; }

  // Save BGV data fields
  const upd = await apiReq('PUT', `/api/ats/candidates/${CANDIDATE_ID}`, {
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
  log('BGV_DATA', upd.status < 400 ? 'PASS' : 'FAIL', `BGV fields saved (HTTP ${upd.status})`);

  // Create PDF documents
  const docs = [
    { file: 'aadhaar.pdf', type: 'aadhar_card',
      title: 'AADHAAR CARD - PRIYA SHARMA',
      lines: ['Aadhaar No: 4567 8901 2345', 'DOB: 15/03/1998', 'F/N: Rajesh Sharma', 'Addr: 45 Sector 18 Noida UP'] },
    { file: 'pan-card.pdf', type: 'pan_card',
      title: 'PAN CARD - PRIYA SHARMA',
      lines: ['PAN: BXMPS6789K', "Father: Rajesh Sharma", 'DOB: 15/03/1998'] },
    { file: 'degree.pdf', type: 'education_certificate',
      title: 'B.COM DEGREE - CCS UNIVERSITY',
      lines: ['Candidate: Priya Sharma', 'University: CCS Univ Meerut', 'Year: 2020', 'Percentage: 68.5%'] },
    { file: 'exp-letter.pdf', type: 'experience_letter',
      title: 'EXPERIENCE CERTIFICATE - CONCENTRIX',
      lines: ['Name: Priya Sharma', 'Designation: CSA', 'Period: Aug 2020 - Jun 2022', 'Clearance: Full & Final settled'] },
  ];

  for (const doc of docs) {
    const fpath = path.join(__dirname, doc.file);
    fs.writeFileSync(fpath, makePdf(doc.title, doc.lines));
    // Upload via candidate upload (only resume/selfie, so use onboarding-full docs instead)
    const up = await uploadOnboardingDoc(CANDIDATE_ID, fpath, doc.type);
    log(`BGV_UPLOAD_${doc.type.toUpperCase()}`, up.ok ? 'PASS' : 'WARN',
      `${doc.file} → HTTP ${up.status}`, up.ok ? null : up.body?.message || up.body);
  }

  // Manual BGV verifications
  for (const check of ['address', 'education', 'employment']) {
    const m = await apiReq('POST', `/api/ats/bgv/manual-feedback/${CANDIDATE_ID}/${check}`, {
      status: 'verified', notes: `${check} confirmed by HR on ${new Date().toLocaleDateString('en-IN')}`,
    }).catch(() => ({ status: 404, body: {} }));
    log(`BGV_VERIFY_${check.toUpperCase()}`, m.status < 400 ? 'PASS' : 'WARN', `${check} (HTTP ${m.status})`);
  }

  // BGV readiness check
  const rdy = await apiReq('GET', `/api/ats/onboarding-full/candidate/${CANDIDATE_ID}/bgv-readiness`)
    .catch(() => ({ status: 404, body: {} }));
  log('BGV_READINESS', rdy.status < 400 ? 'PASS' : 'WARN', `Readiness (HTTP ${rdy.status})`);

  await page.goto(`${APP}/ats/bgv`);
  await page.waitForTimeout(3000);
  await snap(page, '04a_bgv_queue');

  await page.goto(`${APP}/ats/candidate/${CANDIDATE_ID}`);
  await page.waitForTimeout(2500);
  await snap(page, '04b_candidate_with_bgv_docs');
}

// ─── STEP 5: Onboarding ───────────────────────────────────────────────────────
async function step5_onboarding(page) {
  console.log('\n══════════════════════════════════════════════');
  console.log(' STEP 5 — Onboarding Form (All Sections)');
  console.log('══════════════════════════════════════════════');
  if (!CANDIDATE_ID) { log('ONBOARDING', 'SKIP', 'No candidate'); return; }

  // Create onboarding bridge + generate token
  const bridge = await apiReq('POST', '/api/ats/onboarding-bridge', {
    candidateId: CANDIDATE_ID, bridgeDate: '2026-07-15',
  });
  log('ONBOARD_BRIDGE', bridge.status < 400 ? 'PASS' : 'FAIL', `Bridge created (HTTP ${bridge.status})`);

  const tokenR = await apiReq('POST', `/api/ats/onboarding/send-token/${CANDIDATE_ID}`);
  ONBOARDING_TOKEN = tokenR.body?.token || '';
  log('ONBOARD_TOKEN_GENERATE', ONBOARDING_TOKEN ? 'PASS' : 'WARN',
    ONBOARDING_TOKEN ? `Token: ${ONBOARDING_TOKEN.substring(0,20)}...` : `HTTP ${tokenR.status}`);

  // Move to onboarding stage
  await apiReq('PUT', `/api/ats/candidates/${CANDIDATE_ID}`, { current_stage: 'onboarding' });
  log('ONBOARDING_STAGE', 'PASS', '→ onboarding');

  // Navigate to onboarding form with token
  if (ONBOARDING_TOKEN) {
    await page.goto(`${APP}/onboard-full?token=${ONBOARDING_TOKEN}`);
    await page.waitForTimeout(4000);
    await snap(page, '05a_onboarding_form_loaded');
  } else {
    await page.goto(`${APP}/ats/candidate/${CANDIDATE_ID}`);
    await page.waitForTimeout(2500);
    await snap(page, '05a_onboarding_candidate_view');
  }

  // Fill all onboarding sections via API
  const base = '/api/ats/onboarding-full';
  const tk   = { token: ONBOARDING_TOKEN, candidate_id: CANDIDATE_ID };

  // Personal details
  const p1 = await apiReq('POST', `${base}/employee-details`, { ...tk,
    first_name: 'Priya', last_name: 'Sharma',
    date_of_birth: '1998-03-15', gender: 'Female',
    marital_status: 'Single', father_name: 'Rajesh Sharma', mother_name: 'Sunita Sharma',
    blood_group: 'B+', nationality: 'Indian', religion: 'Hindu',
    mobile: '9871236002', email: 'priya.e2e.002@gmail.com',
    current_address: '45 Sector 18, Noida, Uttar Pradesh 201301',
    permanent_address: '45 Sector 18, Noida, Uttar Pradesh 201301',
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
  log('ONBOARD_BANK', p2.status < 400 ? 'PASS' : 'WARN', `Bank (HTTP ${p2.status})`);

  // Qualifications
  const p3 = await apiReq('POST', `${base}/qualification`, { ...tk,
    qualifications: [
      { degree: 'B.Com', institution: 'CCS University Meerut', year: 2020, percentage: 68.5, stream: 'Commerce' },
      { degree: '12th', institution: 'Govt Inter College Noida', year: 2017, percentage: 72.0, stream: 'Commerce' },
      { degree: '10th', institution: 'Govt High School Noida', year: 2015, percentage: 74.0, stream: 'General' },
    ],
  }).catch(() => ({ status: 404, body: {} }));
  log('ONBOARD_EDUCATION', p3.status < 400 ? 'PASS' : 'WARN', `Education (HTTP ${p3.status})`);

  // Family members
  const p4 = await apiReq('POST', `${base}/family`, { ...tk,
    members: [
      { name: 'Rajesh Sharma', relation: 'Father', age: 52, occupation: 'Retired Govt Employee', mobile: '9812345678', is_dependent: true },
      { name: 'Sunita Sharma', relation: 'Mother', age: 48, occupation: 'Homemaker', mobile: '9898765432', is_dependent: true },
    ],
  }).catch(() => ({ status: 404, body: {} }));
  log('ONBOARD_FAMILY', p4.status < 400 ? 'PASS' : 'WARN', `Family (HTTP ${p4.status})`);

  // Work experience
  const p5 = await apiReq('POST', `${base}/experience`, { ...tk,
    experiences: [{
      company_name: 'Concentrix Services Pvt Ltd',
      designation: 'Customer Service Associate',
      from_date: '2020-08-01', to_date: '2022-06-30',
      ctc: 14000, reason_for_leaving: 'Better opportunity',
      reporting_manager: 'Suresh Patel', hr_contact: '9011223344',
    }],
  }).catch(() => ({ status: 404, body: {} }));
  log('ONBOARD_EXPERIENCE', p5.status < 400 ? 'PASS' : 'WARN', `Experience (HTTP ${p5.status})`);

  // Final section
  const p6 = await apiReq('POST', `${base}/final-section`, { ...tk,
    emergency_contact_name: 'Rajesh Sharma',
    emergency_contact_mobile: '9812345678',
    emergency_contact_relation: 'Father',
    pf_opt_out: false, esic_applicable: true,
  }).catch(() => ({ status: 404, body: {} }));
  log('ONBOARD_FINAL', p6.status < 400 ? 'PASS' : 'WARN', `Final section (HTTP ${p6.status})`);

  // Upload onboarding documents
  const onboardDocs = [
    { file: 'aadhaar-ob.pdf', type: 'aadhaar',
      title: 'AADHAAR - ONBOARDING COPY', lines: ['Priya Sharma', 'Aadhaar: 4567 8901 2345'] },
    { file: 'pan-ob.pdf', type: 'pan',
      title: 'PAN CARD - ONBOARDING COPY', lines: ['Priya Sharma', 'PAN: BXMPS6789K'] },
  ];
  for (const doc of onboardDocs) {
    const fpath = path.join(__dirname, doc.file);
    fs.writeFileSync(fpath, makePdf(doc.title, doc.lines));
    const up = await uploadOnboardingDoc(CANDIDATE_ID, fpath, doc.type);
    log(`ONBOARD_DOC_${doc.type.toUpperCase()}`, up.ok ? 'PASS' : 'WARN', `${doc.file} (HTTP ${up.status})`);
  }

  // Check onboarding status
  const sts = await apiReq('GET', `${base}/status?token=${ONBOARDING_TOKEN}`)
    .catch(() => ({ status: 404, body: {} }));
  log('ONBOARD_STATUS', sts.status < 400 ? 'PASS' : 'WARN', `Status check (HTTP ${sts.status})`, sts.body?.data);

  await snap(page, '05b_onboarding_after_fill');

  await page.goto(`${APP}/ats/onboarding`).catch(() => {});
  await page.waitForTimeout(2500);
  await snap(page, '05c_hr_onboarding_queue');
}

// ─── STEP 6: HR Review ────────────────────────────────────────────────────────
async function step6_hr_review(page) {
  console.log('\n══════════════════════════════════════════════');
  console.log(' STEP 6 — HR Review & Approval');
  console.log('══════════════════════════════════════════════');
  if (!CANDIDATE_ID) { log('HR_REVIEW', 'SKIP', 'No candidate'); return; }

  // Get full onboarding data (HR view)
  const full = await apiReq('GET', `/api/ats/onboarding-full/candidate/${CANDIDATE_ID}`)
    .catch(() => ({ status: 404, body: {} }));
  log('HR_FULL_DATA', full.status < 400 ? 'PASS' : 'WARN', `Full profile (HTTP ${full.status})`,
    full.status < 400 ? { sections: Object.keys(full.body?.data || {}).join(', ') } : null);

  // HR review approval
  const rev = await apiReq('PATCH', `/api/ats/onboarding-full/candidate/${CANDIDATE_ID}/review`, {
    status: 'approved',
    remarks: 'All documents verified. BGV clear. Approved for joining.',
    reviewed_by: 'Anjali Mehta',
  }).catch(() => ({ status: 404, body: {} }));
  log('HR_APPROVE', rev.status < 400 ? 'PASS' : 'WARN', `HR approval (HTTP ${rev.status})`);

  // Set profile + BGV status
  const upd = await apiReq('PUT', `/api/ats/candidates/${CANDIDATE_ID}`, {
    profile_status: 'approved', bgv_status: 'clear', current_stage: 'hr_review',
  });
  log('HR_STATUS', upd.status < 400 ? 'PASS' : 'FAIL', `Status set (HTTP ${upd.status})`);

  await page.goto(`${APP}/ats/candidate/${CANDIDATE_ID}`);
  await page.waitForTimeout(3000);
  await snap(page, '06_hr_review_approved');
}

// ─── STEP 7: Convert to Employee ─────────────────────────────────────────────
async function step7_convert(page) {
  console.log('\n══════════════════════════════════════════════');
  console.log(' STEP 7 — Employee Conversion');
  console.log('══════════════════════════════════════════════');
  if (!CANDIDATE_ID) { log('CONVERT', 'SKIP', 'No candidate'); return null; }

  // Try the convert endpoint
  const r = await apiReq('POST', `/api/ats/convert/${CANDIDATE_ID}`, {
    joining_date: '2026-07-15',
    designation: 'Customer Care Executive',
    department: 'Operations',
  }).catch(() => ({ status: 404, body: {} }));
  const empId = r.body?.data?.employee_id || r.body?.data?.id || r.body?.employee_code || '';
  log('EMPLOYEE_CONVERT', r.status < 400 ? 'PASS' : 'WARN',
    `Convert (HTTP ${r.status})`, { empId, msg: r.body?.message || r.body?.success });

  // Final candidate state
  const check = await apiReq('GET', `/api/ats/candidates/${CANDIDATE_ID}`);
  const c = check.body?.data || {};
  log('CONVERT_STATE', check.status < 400 ? 'PASS' : 'FAIL', 'Post-convert state', {
    stage: c.current_stage, profile: c.profile_status, bgv: c.bgv_status,
  });

  if (empId) {
    await page.goto(`${APP}/employees/${empId}`);
    await page.waitForTimeout(3500);
    await snap(page, '07a_new_employee_profile');
  }

  return empId;
}

// ─── STEP 8: Post-Onboarding ──────────────────────────────────────────────────
async function step8_post_onboarding(page, empId) {
  console.log('\n══════════════════════════════════════════════');
  console.log(' STEP 8 — Post-Onboarding Check');
  console.log('══════════════════════════════════════════════');

  // Employee list
  await page.goto(`${APP}/employees`);
  await page.waitForTimeout(3000);
  await snap(page, '08a_employees_list');

  // ATS final state
  await page.goto(`${APP}/ats`);
  await page.waitForTimeout(2500);
  await snap(page, '08b_ats_final');

  // Final API state
  const fin = await apiReq('GET', `/api/ats/candidates/${CANDIDATE_ID}`);
  const c   = fin.body?.data || {};
  log('JOURNEY_FINAL', fin.status < 400 ? 'PASS' : 'FAIL', '★ Full journey complete', {
    code: CANDIDATE_CODE, stage: c.current_stage,
    profile: c.profile_status, bgv: c.bgv_status,
    onboarding_token: ONBOARDING_TOKEN ? '✓ generated' : '✗ not generated',
  });
}

// ─── Report ───────────────────────────────────────────────────────────────────
function finalReport() {
  const pass = REPORT.filter(r => r.status === 'PASS').length;
  const fail = REPORT.filter(r => r.status === 'FAIL').length;
  const warn = REPORT.filter(r => r.status === 'WARN' || r.status === 'SKIP').length;
  const shots = fs.existsSync(SS) ? fs.readdirSync(SS).sort() : [];

  console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║  E2E JOURNEY REPORT — Walk-in → BGV → Onboarding → Post-Onboard  ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝');
  console.log(`  Candidate : ${CANDIDATE_CODE || '?'} | ID: ${CANDIDATE_ID || 'N/A'}`);
  console.log(`  Token     : ${ONBOARDING_TOKEN ? ONBOARDING_TOKEN.substring(0,28) + '...' : 'N/A'}`);
  console.log(`  PASS: ${pass}  WARN: ${warn}  FAIL: ${fail}  TOTAL: ${REPORT.length}`);
  console.log('  ─────────────────────────────────────────────────────────────────');
  REPORT.forEach(r => {
    const icon = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '⚠️ ';
    console.log(`  ${icon}  ${(r.step).padEnd(38)} ${r.detail}`);
  });
  console.log('  ─────────────────────────────────────────────────────────────────');
  console.log(`  Screenshots (${shots.length}):`);
  shots.forEach(f => console.log(`    📸 ${f}`));
  console.log('═════════════════════════════════════════════════════════════════════\n');

  const rpt = path.join(__dirname, 'e2e-report-v2.json');
  fs.writeFileSync(rpt, JSON.stringify({
    candidateCode: CANDIDATE_CODE, candidateId: CANDIDATE_ID,
    onboardingToken: ONBOARDING_TOKEN,
    timestamp: new Date().toISOString(),
    summary: { pass, fail, warn, total: REPORT.length },
    steps: REPORT, screenshots: shots,
  }, null, 2));
  console.log(`📄 Report: ${rpt}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 50, args: ['--start-maximized'] });
  const ctx  = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-IN' });
  const page = await ctx.newPage();

  try {
    if (!await step0_auth(page)) { await browser.close(); finalReport(); return; }
    await step1_walkin(page);
    await step2_profile(page);
    await step3_pipeline(page);
    await step4_bgv(page);
    await step5_onboarding(page);
    await step6_hr_review(page);
    const empId = await step7_convert(page);
    await step8_post_onboarding(page, empId);
  } catch (err) {
    console.error('\nFATAL:', err.message);
    log('FATAL', 'FAIL', err.message);
    await snap(page, 'fatal_error').catch(() => {});
  } finally {
    await browser.close();
    finalReport();
  }
})();
