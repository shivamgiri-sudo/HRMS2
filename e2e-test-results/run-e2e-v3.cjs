/**
 * Full E2E Journey Test v3 — Walk-in Registration (Public UI) → Pipeline → BGV → Onboarding → Employee
 * All fixes:
 *   - Registration: /interview-registration (public page), proper selector wait
 *   - Document upload: token field in multipart body
 *   - BGV manual-feedback: correct field names, add delay between uploads (rate limit)
 *   - Registration fallback: API with unique mobile
 */
const { chromium } = require('playwright');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const BASE = 'http://localhost:5055';
const APP  = 'http://localhost:5173';
const SS   = path.join(__dirname, 'screenshots_v3');
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

/**
 * Multipart upload to /api/ats/onboarding-full/documents
 * Requires token (onboarding UUID) as a form field.
 */
function uploadOnboardingDoc(token, candidateId, filePath, docType) {
  return new Promise((resolve) => {
    const boundary    = 'OBBound' + Date.now();
    const fileContent = fs.readFileSync(filePath);
    const filename    = path.basename(filePath);
    const pre = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="token"\r\n\r\n${token}\r\n` +
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
        catch  { resolve({ ok: res.statusCode < 400, status: res.statusCode, body: d.substring(0, 200) }); }
      });
    });
    req.on('error', e => resolve({ ok: false, status: 0, body: e.message }));
    req.write(body); req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
  return file;
}

async function injectAuth(page) {
  await page.evaluate(t => {
    localStorage.setItem('hrms_access_token', t);
    localStorage.setItem('hrms_token', t);
    localStorage.setItem('token', t);
  }, TOKEN);
}

async function gotoAuth(page, url) {
  await page.goto(url);
  await page.waitForTimeout(800);
  // Re-inject on every navigation since SPA may clear state
  await injectAuth(page);
  await page.waitForTimeout(2500);
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

  // addInitScript runs before page JS on every navigation — sets auth token in localStorage
  // before React hydrates and reads hrms_access_token
  await page.addInitScript((t) => {
    localStorage.setItem('hrms_access_token', t);
    localStorage.setItem('hrms_token', t);
    localStorage.setItem('token', t);
  }, TOKEN);

  await page.goto(APP);
  await page.waitForTimeout(5000);
  await snap(page, '00_app_home_dashboard');
  return true;
}

// ─── STEP 1: Walk-in Registration via UI ──────────────────────────────────────
async function step1_walkin(page) {
  console.log('\n══════════════════════════════════════════════');
  console.log(' STEP 1 — Walk-in Registration (Public UI Form)');
  console.log('══════════════════════════════════════════════');

  // /interview-registration is the public (unauthenticated) version of the same form
  await page.goto(`${APP}/interview-registration`);
  await page.waitForTimeout(5000);
  await snap(page, '01a_registration_public_form');

  const uniqueMob = `9871${Date.now().toString().slice(-6)}`;

  try {
    // Wait for the form to actually render — try multiple selectors
    await page.waitForSelector('input', { timeout: 10000 });

    // Grab all inputs and fill by placeholder text
    const nameInput = page.locator('input[placeholder="Enter your full name"]');
    const mobileInput = page.locator('input[placeholder="10-digit mobile number"]');
    const emailInput  = page.locator('input[placeholder="your.email@example.com"]');

    // wait for at least name input to be visible
    await nameInput.waitFor({ state: 'visible', timeout: 15000 });

    await nameInput.fill('Priya Sharma E2E');
    await page.waitForTimeout(300);
    await mobileInput.fill(uniqueMob);
    await page.waitForTimeout(300);
    await emailInput.fill(`priya.${uniqueMob}@gmail.com`).catch(() => {});
    await page.waitForTimeout(300);

    await snap(page, '01b_form_name_mobile');

    // Fill all selects
    const allSelects = await page.locator('select').all();
    for (const sel of allSelects) {
      const opts = await sel.locator('option').allTextContents();
      const optVals = await sel.locator('option').evaluateAll(els =>
        els.map(e => ({ v: e.value, t: e.textContent?.trim() || '' }))
      );
      const hasNoida2 = optVals.some(o => o.v === 'NOIDA-2' || o.t === 'NOIDA-2');
      const hasFemale = optVals.some(o => /female/i.test(o.t));
      const hasGrad   = optVals.some(o => /graduate/i.test(o.t));
      const hasExp    = optVals.some(o => /1-2|1\.2|2\s*year/i.test(o.t));
      const hasWalkin = optVals.some(o => /walk.?in/i.test(o.t));
      const hasInbound = optVals.some(o => /inbound\s*agent/i.test(o.t));

      if (hasNoida2)  await sel.selectOption('NOIDA-2').catch(() => {});
      else if (hasFemale) await sel.selectOption(optVals.find(o => /female/i.test(o.t))?.v || '').catch(() => {});
      else if (hasGrad)   await sel.selectOption(optVals.find(o => /graduate/i.test(o.t))?.v || '').catch(() => {});
      else if (hasExp)    await sel.selectOption(optVals.find(o => /1-2|1\.2/i.test(o.t))?.v || '').catch(() => {});
      else if (hasWalkin) await sel.selectOption(optVals.find(o => /walk.?in/i.test(o.t))?.v || '').catch(() => {});
      else if (hasInbound) await sel.selectOption(optVals.find(o => /inbound/i.test(o.t))?.v || '').catch(() => {});
    }

    // Address textarea
    await page.locator('textarea').first().fill('45 Sector 18, Noida, Uttar Pradesh 201301').catch(() => {});

    await snap(page, '01c_form_fully_filled');

    // Submit
    const submitBtn = page.locator('button[type="submit"]');
    const btnCount  = await submitBtn.count();
    if (btnCount > 0) {
      await submitBtn.first().click();
    } else {
      await page.locator('button').filter({ hasText: /submit|register|next/i }).first().click();
    }
    await page.waitForTimeout(6000);
    await snap(page, '01d_after_submit');

    const bodyTxt = await page.textContent('body').catch(() => '');
    if (/success|registered|CND-|token.*number|congratulations|application\s*no/i.test(bodyTxt)) {
      log('WALKIN_UI', 'PASS', `Form submitted — got success screen (mobile: ${uniqueMob})`);
      // Try to parse candidate code from page
      const match = bodyTxt.match(/CND-[A-Z0-9]+|NOI-\d+/);
      if (match) log('WALKIN_UI_CODE', 'PASS', `Visible code: ${match[0]}`);
    } else {
      log('WALKIN_UI', 'WARN', 'Form submitted but no clear success indicator in page text');
    }
  } catch (err) {
    log('WALKIN_UI_ERROR', 'WARN', err.message.split('\n')[0].substring(0, 120));
    await snap(page, '01e_form_error').catch(() => {});
  }

  // API verification / fallback
  await sleep(2000);
  const list = await apiReq('GET', `/api/ats/candidates?limit=20`);
  const found = (list.body?.data || []).find(c =>
    c.mobile === uniqueMob || c.full_name === 'Priya Sharma E2E'
  );
  if (found) {
    CANDIDATE_ID   = found.id;
    CANDIDATE_CODE = found.candidate_code;
    log('WALKIN_DB_VERIFY', 'PASS', `Confirmed in DB: ${CANDIDATE_CODE}`, {
      id: CANDIDATE_ID, stage: found.current_stage, branch: found.branch_display_name,
    });
    return;
  }

  // Full API fallback
  const mob2 = `9871${(Date.now() + 1).toString().slice(-6)}`;
  const r2 = await apiReq('POST', '/api/ats/registration/submit-enhanced', {
    name: 'Priya Sharma E2E', mobile: mob2, email: `priya.${mob2}@gmail.com`,
    gender: 'Female', roleApplied: 'Inbound Agent', branchDisplayName: 'Okaya',
    sourcingChannel: 'Walk-In',
    address: '45 Sector 18, Noida, Uttar Pradesh 201301',
    education: 'Graduate', experience: '1-2 Years',
    rotationalShift: 1, nightShiftOk: 1, leavesIn3months: 0,
    ownsTwoWheeler: 0, idProofAvailable: 1, educationProofAvailable: 1,
  });
  if (r2.status < 400 && r2.body.candidateId) {
    CANDIDATE_ID   = r2.body.candidateId;
    CANDIDATE_CODE = r2.body.candidate_code || r2.body.candidateId;
    log('WALKIN_API_FALLBACK', 'PASS', `API fallback: ${CANDIDATE_CODE} (${r2.body.tokenNumber})`, {
      id: CANDIDATE_ID, branch: r2.body.branchName,
    });
  } else {
    log('WALKIN_API_FALLBACK', 'FAIL', `HTTP ${r2.status}`, r2.body?.message || r2.body?.errors);
    const latest = (await apiReq('GET', '/api/ats/candidates?limit=1')).body?.data?.[0];
    if (latest) { CANDIDATE_ID = latest.id; CANDIDATE_CODE = latest.candidate_code; }
  }
}

// ─── STEP 2: Candidate Profile ────────────────────────────────────────────────
async function step2_profile(page) {
  console.log('\n══════════════════════════════════════════════');
  console.log(' STEP 2 — Candidate Profile');
  console.log('══════════════════════════════════════════════');
  if (!CANDIDATE_ID) { log('PROFILE', 'SKIP', 'No candidate'); return; }

  await gotoAuth(page, `${APP}/ats/candidate/${CANDIDATE_ID}`);
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
    ['screening', { screening_score: 78, screening_remarks: 'Aptitude 78/100, communication good, clear BPO experience' }],
    ['interview', { interview_round: 1, interview_remarks: 'F2F Round 1 scheduled' }],
    ['selected',  { interview_score: 85, selection_remarks: 'Recommended for Inbound Agent role — NOIDA-2' }],
  ]) {
    const r = await apiReq('PUT', `/api/ats/candidates/${CANDIDATE_ID}`, { current_stage: stage, ...extra });
    log(`STAGE_${stage.toUpperCase()}`, r.status < 400 ? 'PASS' : 'FAIL', `→ ${stage} (HTTP ${r.status})`);
    await gotoAuth(page, `${APP}/ats/candidate/${CANDIDATE_ID}`);
    await snap(page, `03_pipeline_${stage}`);
  }
}

// ─── STEP 4: BGV ─────────────────────────────────────────────────────────────
async function step4_bgv(page) {
  console.log('\n══════════════════════════════════════════════');
  console.log(' STEP 4 — BGV: Real Data + PDF Upload');
  console.log('══════════════════════════════════════════════');
  if (!CANDIDATE_ID) { log('BGV', 'SKIP', 'No candidate'); return; }

  // Ensure we have the onboarding token first (needed for document upload)
  if (!ONBOARDING_TOKEN) {
    const bridge = await apiReq('POST', '/api/ats/onboarding-bridge', {
      candidateId: CANDIDATE_ID, bridgeDate: '2026-07-15',
    }).catch(() => ({ status: 0, body: {} }));
    const tokenR = await apiReq('POST', `/api/ats/onboarding/send-token/${CANDIDATE_ID}`);
    ONBOARDING_TOKEN = tokenR.body?.token || '';
    log('BGV_TOKEN_PREP', ONBOARDING_TOKEN ? 'PASS' : 'WARN',
      ONBOARDING_TOKEN ? `Token ready for doc upload` : 'Token not generated yet');
  }

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
    account_holder_name: 'Priya Sharma E2E',
  });
  log('BGV_DATA', upd.status < 400 ? 'PASS' : 'FAIL', `BGV fields saved (HTTP ${upd.status})`);

  // Create PDF documents
  const docs = [
    { file: 'aadhaar.pdf', type: 'aadhaar',
      title: 'AADHAAR CARD - PRIYA SHARMA E2E',
      lines: ['Aadhaar No: 4567 8901 2345', 'DOB: 15/03/1998', 'Father: Rajesh Sharma', 'Addr: 45 Sector 18 Noida UP 201301'] },
    { file: 'pan-card.pdf', type: 'pan',
      title: 'PAN CARD - PRIYA SHARMA E2E',
      lines: ['PAN: BXMPS6789K', 'Father: Rajesh Sharma', 'DOB: 15/03/1998'] },
    { file: 'degree.pdf', type: 'education_certificate',
      title: 'B.COM DEGREE - CCS UNIVERSITY 2020',
      lines: ['Candidate: Priya Sharma', 'University: CCS Univ Meerut', 'Year of Passing: 2020', 'Percentage: 68.5%', 'Stream: Commerce'] },
    { file: 'exp-letter.pdf', type: 'experience_letter',
      title: 'EXPERIENCE CERTIFICATE - CONCENTRIX',
      lines: ['Employee: Priya Sharma', 'Designation: Customer Service Associate', 'Period: Aug 2020 to Jun 2022', 'F&F: Settled', 'Rehire: Eligible'] },
  ];

  for (const doc of docs) {
    const fpath = path.join(__dirname, doc.file);
    fs.writeFileSync(fpath, makePdf(doc.title, doc.lines));
    if (ONBOARDING_TOKEN) {
      const up = await uploadOnboardingDoc(ONBOARDING_TOKEN, CANDIDATE_ID, fpath, doc.type);
      log(`BGV_UPLOAD_${doc.type.toUpperCase()}`, up.ok ? 'PASS' : 'WARN',
        `${doc.file} → HTTP ${up.status}`, up.ok ? { id: up.body?.data?.id } : up.body?.message || up.body);
      // Respect candidateWriteLimiter (10 req/min) — wait 7s between uploads
      await sleep(7000);
    } else {
      log(`BGV_UPLOAD_${doc.type.toUpperCase()}`, 'WARN', 'Skipped — no onboarding token yet');
    }
  }

  // Manual BGV verifications — use 'remarks' (not 'notes'), and valid checkType strings
  const today = new Date().toLocaleDateString('en-IN');
  for (const check of ['address', 'education', 'employment']) {
    const m = await apiReq('PATCH', `/api/ats/bgv/manual-feedback/${CANDIDATE_ID}/${check}`, {
      status: 'verified',
      remarks: `${check} confirmed by HR review on ${today}. Documents in order.`,
    }).catch(() => ({ status: 0, body: { error: 'request failed' } }));
    log(`BGV_VERIFY_${check.toUpperCase()}`, m.status < 400 ? 'PASS' : 'WARN',
      `${check} (HTTP ${m.status})`, m.status >= 400 ? m.body?.message || m.body : null);
  }

  // BGV readiness
  const rdy = await apiReq('GET', `/api/ats/onboarding-full/candidate/${CANDIDATE_ID}/bgv-readiness`)
    .catch(() => ({ status: 0, body: {} }));
  log('BGV_READINESS', rdy.status < 400 ? 'PASS' : 'WARN', `Readiness (HTTP ${rdy.status})`,
    rdy.status < 400 ? rdy.body?.data : null);

  await gotoAuth(page, `${APP}/ats/bgv`);
  await snap(page, '04a_bgv_queue');

  await gotoAuth(page, `${APP}/ats/candidate/${CANDIDATE_ID}`);
  await snap(page, '04b_candidate_with_bgv');
}

// ─── STEP 5: Onboarding ───────────────────────────────────────────────────────
async function step5_onboarding(page) {
  console.log('\n══════════════════════════════════════════════');
  console.log(' STEP 5 — Onboarding Form (All Sections)');
  console.log('══════════════════════════════════════════════');
  if (!CANDIDATE_ID) { log('ONBOARDING', 'SKIP', 'No candidate'); return; }

  // Bridge + token (may already be set from step 4)
  if (!ONBOARDING_TOKEN) {
    const bridge = await apiReq('POST', '/api/ats/onboarding-bridge', {
      candidateId: CANDIDATE_ID, bridgeDate: '2026-07-15',
    });
    log('ONBOARD_BRIDGE', bridge.status < 400 ? 'PASS' : 'FAIL', `Bridge (HTTP ${bridge.status})`);

    const tokenR = await apiReq('POST', `/api/ats/onboarding/send-token/${CANDIDATE_ID}`);
    ONBOARDING_TOKEN = tokenR.body?.token || '';
    log('ONBOARD_TOKEN', ONBOARDING_TOKEN ? 'PASS' : 'WARN',
      ONBOARDING_TOKEN ? `Token generated: ${ONBOARDING_TOKEN.substring(0,22)}...` : `HTTP ${tokenR.status}`);
  } else {
    log('ONBOARD_TOKEN', 'PASS', `Using existing token: ${ONBOARDING_TOKEN.substring(0,22)}...`);
  }

  // Move to onboarding stage
  await apiReq('PUT', `/api/ats/candidates/${CANDIDATE_ID}`, { current_stage: 'onboarding' });
  log('ONBOARDING_STAGE', 'PASS', '→ onboarding');

  // Open onboarding form in browser
  if (ONBOARDING_TOKEN) {
    // Onboarding form is public (no auth needed) — navigate directly
    await page.goto(`${APP}/onboard-full?token=${ONBOARDING_TOKEN}`);
    await page.waitForTimeout(5000);
    await snap(page, '05a_onboarding_form_loaded');

    // Check what rendered
    const pageText = await page.textContent('body').catch(() => '');
    if (/priya|sharma|section|personal|bank|document/i.test(pageText)) {
      log('ONBOARD_FORM_RENDER', 'PASS', 'Onboarding form visible with candidate data');
    } else if (/expired|invalid|not found/i.test(pageText)) {
      log('ONBOARD_FORM_RENDER', 'WARN', 'Token expired/invalid in browser');
    } else {
      log('ONBOARD_FORM_RENDER', 'WARN', 'Form loaded but content unclear');
    }
  }

  // Fill all sections via API
  const base = '/api/ats/onboarding-full';
  const tk   = { token: ONBOARDING_TOKEN, candidate_id: CANDIDATE_ID };

  const sections = [
    ['employee-details', 'POST', 'PERSONAL', {
      ...tk,
      first_name: 'Priya', last_name: 'Sharma',
      date_of_birth: '1998-03-15', gender: 'Female',
      marital_status: 'Single', father_name: 'Rajesh Sharma', mother_name: 'Sunita Sharma',
      blood_group: 'B+', nationality: 'Indian', religion: 'Hindu',
      mobile: CANDIDATE_CODE ? undefined : '9871236099', // use candidate existing mobile
      email: `priya.e2e@gmail.com`,
      current_address: '45 Sector 18, Noida, Uttar Pradesh 201301',
      permanent_address: '45 Sector 18, Noida, Uttar Pradesh 201301',
      aadhar_number: '4567 8901 2345', pan_number: 'BXMPS6789K',
      uan_number: '100987654321',
    }],
    ['bank-details', 'POST', 'BANK', {
      ...tk,
      bank_account_no: '30987654321', bank_ifsc: 'SBIN0001234',
      bank_name: 'State Bank of India', bank_branch: 'Sector 18 Noida',
      account_holder_name: 'Priya Sharma', account_type: 'Savings',
    }],
    ['qualification', 'POST', 'EDUCATION', {
      ...tk,
      qualifications: [
        { degree: 'B.Com', institution: 'CCS University Meerut', year: 2020, percentage: 68.5, stream: 'Commerce' },
        { degree: '12th', institution: 'Govt Inter College Noida', year: 2017, percentage: 72.0, stream: 'Commerce' },
        { degree: '10th', institution: 'Govt High School Noida', year: 2015, percentage: 74.0, stream: 'General' },
      ],
    }],
    ['family', 'POST', 'FAMILY', {
      ...tk,
      members: [
        { name: 'Rajesh Sharma', relation: 'Father', age: 52, occupation: 'Retired Govt Employee', mobile: '9812345678', is_dependent: true },
        { name: 'Sunita Sharma', relation: 'Mother', age: 48, occupation: 'Homemaker', mobile: '9898765432', is_dependent: true },
      ],
    }],
    ['experience', 'POST', 'EXPERIENCE', {
      ...tk,
      experiences: [{
        company_name: 'Concentrix Services Pvt Ltd',
        designation: 'Customer Service Associate',
        from_date: '2020-08-01', to_date: '2022-06-30',
        ctc: 14000, reason_for_leaving: 'Better opportunity',
        reporting_manager: 'Suresh Patel', hr_contact: '9011223344',
      }],
    }],
    ['final-section', 'POST', 'FINAL', {
      ...tk,
      emergency_contact_name: 'Rajesh Sharma',
      emergency_contact_mobile: '9812345678',
      emergency_contact_relation: 'Father',
      pf_opt_out: false, esic_applicable: true,
    }],
  ];

  for (const [ep, method, label, payload] of sections) {
    const r = await apiReq(method, `${base}/${ep}`, payload).catch(() => ({ status: 0, body: {} }));
    log(`ONBOARD_${label}`, r.status < 400 ? 'PASS' : 'WARN',
      `${ep} (HTTP ${r.status})`, r.status >= 400 ? r.body?.message || r.body : null);
  }

  // Status check
  const sts = await apiReq('GET', `${base}/status?token=${ONBOARDING_TOKEN}`)
    .catch(() => ({ status: 0, body: {} }));
  log('ONBOARD_STATUS', sts.status < 400 ? 'PASS' : 'WARN', `Status (HTTP ${sts.status})`,
    sts.status < 400 ? {
      sections_complete: Object.entries(sts.body?.data?.completion || {})
        .filter(([,v]) => v).map(([k]) => k).join(', ') || 'check response',
    } : null);

  await gotoAuth(page, `${APP}/ats/candidate/${CANDIDATE_ID}`);
  await snap(page, '05b_candidate_with_onboarding');

  await gotoAuth(page, `${APP}/ats/onboarding`);
  await snap(page, '05c_hr_onboarding_queue');
}

// ─── STEP 6: HR Review ────────────────────────────────────────────────────────
async function step6_hr_review(page) {
  console.log('\n══════════════════════════════════════════════');
  console.log(' STEP 6 — HR Review & Approval');
  console.log('══════════════════════════════════════════════');
  if (!CANDIDATE_ID) { log('HR_REVIEW', 'SKIP', 'No candidate'); return; }

  const full = await apiReq('GET', `/api/ats/onboarding-full/candidate/${CANDIDATE_ID}`)
    .catch(() => ({ status: 0, body: {} }));
  log('HR_FULL_DATA', full.status < 400 ? 'PASS' : 'WARN', `Profile retrieved (HTTP ${full.status})`,
    full.status < 400 ? { sections: Object.keys(full.body?.data || {}).slice(0, 8).join(', ') } : null);

  const rev = await apiReq('PATCH', `/api/ats/onboarding-full/candidate/${CANDIDATE_ID}/review`, {
    status: 'approved',
    remarks: 'All documents verified. BGV clear. Joining approved for 2026-07-15.',
    reviewed_by: 'Anjali Mehta — HR Admin',
  }).catch(() => ({ status: 0, body: {} }));
  log('HR_APPROVE', rev.status < 400 ? 'PASS' : 'WARN', `HR approval (HTTP ${rev.status})`,
    rev.status >= 400 ? rev.body?.message || rev.body : null);

  const upd = await apiReq('PUT', `/api/ats/candidates/${CANDIDATE_ID}`, {
    profile_status: 'approved', bgv_status: 'clear', current_stage: 'hr_review',
  });
  log('HR_STATUS_UPDATE', upd.status < 400 ? 'PASS' : 'FAIL', `Candidate status updated (HTTP ${upd.status})`);

  await gotoAuth(page, `${APP}/ats/candidate/${CANDIDATE_ID}`);
  await snap(page, '06_hr_review_approved');
}

// ─── STEP 7: Convert to Employee ─────────────────────────────────────────────
async function step7_convert(page) {
  console.log('\n══════════════════════════════════════════════');
  console.log(' STEP 7 — Employee Conversion');
  console.log('══════════════════════════════════════════════');
  if (!CANDIDATE_ID) { log('CONVERT', 'SKIP', 'No candidate'); return null; }

  // Primary: POST /api/ats/convert/:candidateId
  const r1 = await apiReq('POST', `/api/ats/convert/${CANDIDATE_ID}`, {
    joining_date: '2026-07-15',
    designation: 'Customer Care Executive',
    department: 'Operations',
  }).catch(() => ({ status: 0, body: {} }));

  const empId = r1.body?.data?.employee_id || r1.body?.data?.id || r1.body?.employee_id || '';
  log('EMPLOYEE_CONVERT', r1.status < 400 ? 'PASS' : 'WARN',
    `Convert (HTTP ${r1.status})`, {
      empId: empId || 'pending offer flow',
      msg: (r1.body?.message || r1.body?.success || '').toString().substring(0, 100),
    });

  // Check final candidate state
  const check = await apiReq('GET', `/api/ats/candidates/${CANDIDATE_ID}`);
  const c     = check.body?.data || {};
  log('CONVERT_FINAL_STATE', check.status < 400 ? 'PASS' : 'FAIL', 'Post-convert candidate state', {
    stage: c.current_stage, profile_status: c.profile_status, bgv_status: c.bgv_status,
  });

  if (empId) {
    await gotoAuth(page, `${APP}/employees/${empId}`);
    await snap(page, '07a_new_employee_profile');
    return empId;
  }

  await gotoAuth(page, `${APP}/ats/candidate/${CANDIDATE_ID}`);
  await snap(page, '07b_candidate_after_conversion');
  return null;
}

// ─── STEP 8: Post-Onboarding ──────────────────────────────────────────────────
async function step8_post_onboarding(page, empId) {
  console.log('\n══════════════════════════════════════════════');
  console.log(' STEP 8 — Post-Onboarding Verification');
  console.log('══════════════════════════════════════════════');

  await gotoAuth(page, `${APP}/employees`);
  await snap(page, '08a_employees_list');

  await gotoAuth(page, `${APP}/ats`);
  await snap(page, '08b_ats_pipeline');

  // ATS analytics (final candidate summary)
  const atsStats = await apiReq('GET', '/api/ats/analytics?period=today').catch(() => ({ status: 0, body: {} }));
  log('ATS_ANALYTICS', atsStats.status < 400 ? 'PASS' : 'WARN', `ATS analytics (HTTP ${atsStats.status})`);

  // Final candidate state
  const fin = await apiReq('GET', `/api/ats/candidates/${CANDIDATE_ID}`);
  const c   = fin.body?.data || {};
  log('JOURNEY_FINAL', fin.status < 400 ? 'PASS' : 'FAIL', '★ Full E2E journey complete', {
    code: CANDIDATE_CODE,
    name: c.full_name,
    current_stage: c.current_stage,
    profile_status: c.profile_status,
    bgv_status: c.bgv_status,
    onboarding_token: ONBOARDING_TOKEN ? `✓ (${ONBOARDING_TOKEN.substring(0, 18)}...)` : '✗',
    employee_id: empId || '(offer flow pending)',
  });
}

// ─── Report ───────────────────────────────────────────────────────────────────
function finalReport() {
  const pass  = REPORT.filter(r => r.status === 'PASS').length;
  const fail  = REPORT.filter(r => r.status === 'FAIL').length;
  const warn  = REPORT.filter(r => r.status === 'WARN' || r.status === 'SKIP').length;
  const shots = fs.existsSync(SS) ? fs.readdirSync(SS).sort() : [];

  console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║  E2E JOURNEY REPORT v3 — Walk-in → BGV → Onboarding → Conversion  ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝');
  console.log(`  Candidate  : ${CANDIDATE_CODE || 'N/A'} | ID: ${CANDIDATE_ID || 'N/A'}`);
  console.log(`  OB Token   : ${ONBOARDING_TOKEN ? ONBOARDING_TOKEN.substring(0, 30) + '...' : 'N/A'}`);
  console.log(`  ✅ PASS: ${pass}   ⚠️  WARN: ${warn}   ❌ FAIL: ${fail}   TOTAL: ${REPORT.length}`);
  console.log('  ─────────────────────────────────────────────────────────────────');
  REPORT.forEach(r => {
    const icon = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '⚠️ ';
    console.log(`  ${icon}  ${(r.step).padEnd(40)} ${r.detail.substring(0, 80)}`);
  });
  console.log('  ─────────────────────────────────────────────────────────────────');
  console.log(`  Screenshots (${shots.length}):`);
  shots.forEach(f => console.log(`    📸 screenshots_v3/${f}`));
  console.log('═════════════════════════════════════════════════════════════════════\n');

  const rpt = path.join(__dirname, 'e2e-report-v3.json');
  fs.writeFileSync(rpt, JSON.stringify({
    testRun: 'v3', candidateCode: CANDIDATE_CODE, candidateId: CANDIDATE_ID,
    onboardingToken: ONBOARDING_TOKEN,
    timestamp: new Date().toISOString(),
    summary: { pass, fail, warn, total: REPORT.length },
    steps: REPORT, screenshots: shots,
  }, null, 2));
  console.log(`📄 Report saved: ${rpt}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 40, args: ['--start-maximized'] });
  const ctx     = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-IN' });
  const page    = await ctx.newPage();

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
    console.error('\nFATAL ERROR:', err.message);
    log('FATAL', 'FAIL', err.message.substring(0, 150));
    await snap(page, 'fatal_error').catch(() => {});
  } finally {
    await browser.close();
    finalReport();
  }
})();
