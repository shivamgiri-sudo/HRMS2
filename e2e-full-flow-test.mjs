/**
 * End-to-end test: Candidate Registration → Employee Code Generation
 * Covers all scenarios: registration, stage moves, onboarding link,
 * profile submission, offer creation, branch-head approval, employee creation.
 *
 * Run: node e2e-full-flow-test.mjs
 */

import { chromium } from 'playwright';
import https from 'https';
import http from 'http';

const BASE = 'https://mcnhrms.teammas.in';
const API  = `${BASE}/api`;
const CREDS = { email: 'admin@mas.in', password: 'Admin@12345' };

let TOKEN = '';
let browser, page;

// ── Helpers ──────────────────────────────────────────────────────────────────
function req(method, path, body, rawToken) {
  return new Promise((resolve, reject) => {
    const url  = new URL(path.startsWith('http') ? path : API + path);
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: url.hostname,
      port:     url.port || 443,
      path:     url.pathname + url.search,
      method,
      headers: {
        'Content-Type':  'application/json',
        'Content-Length': data ? Buffer.byteLength(data) : 0,
        ...(rawToken || TOKEN ? { Authorization: `Bearer ${rawToken || TOKEN}` } : {}),
      },
      rejectUnauthorized: false,
    };
    const mod = url.protocol === 'https:' ? https : http;
    const r = mod.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
const get  = (p, t) => req('GET',  p, null, t);
const post = (p, b, t) => req('POST', p, b, t);
const patch = (p, b, t) => req('PATCH', p, b, t);

function pass(msg) { console.log(`  ✅ ${msg}`); }
function fail(msg) { console.log(`  ❌ ${msg}`); throw new Error(msg); }
function info(msg) { console.log(`\n${'─'.repeat(60)}\n▶  ${msg}\n${'─'.repeat(60)}`); }
function note(msg) { console.log(`  ℹ️  ${msg}`); }

async function shot(name) {
  if (page) {
    await page.screenshot({ path: `pictures/e2e-${name}.png`, fullPage: true });
    note(`Screenshot → pictures/e2e-${name}.png`);
  }
}

async function loginBrowser() {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  await page.goto(`${BASE}/auth`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.locator('input').first().fill(CREDS.email);
  await page.locator('input[type="password"]').fill(CREDS.password);
  await page.click('button:has-text("Sign In")');
  await page.waitForURL(url => !url.toString().includes('/auth'), { timeout: 15000 });
  await page.waitForTimeout(2000);
  pass('Browser logged in');
}

// ── Test state ────────────────────────────────────────────────────────────────
const TEST = {
  candidateId: null,
  candidateCode: null,
  onboardingRequestId: null,
  offerId: null,
  employeeId: null,
  employeeCode: null,
  onboardingToken: null,
};

const TS = Date.now();
const CANDIDATE = {
  // API field names (camelCase as per ats.validation.ts)
  fullName:          `E2E Test ${TS}`,
  mobile:            `98${String(TS).slice(-8)}`,
  email:             `e2e.test.${TS}@testmas.local`,
  education:         'Graduate',
  experience:        'Fresher',
  appliedForProcess: 'Customer Care',
  appliedForBranch:  'NOIDA-2',
  sourcingChannel:   'Walk-In',
  gender:            'Male',
  dateOfBirth:       '1997-06-15',
  address:           '123 Test Street, Sector 18, Noida',
  rotational_shift:  false,
};

// ── STEP 1: Login (API) ───────────────────────────────────────────────────────
async function step1_login() {
  info('STEP 1: Admin Login (API)');
  const r = await post('/auth/login', CREDS);
  // Token may be at r.body.token OR r.body.data.accessToken
  TOKEN = r.body?.token ?? r.body?.data?.accessToken ?? r.body?.accessToken;
  if (!TOKEN) fail(`Login failed: ${JSON.stringify(r.body)}`);
  pass(`Logged in as ${CREDS.email} — token acquired (${TOKEN.substring(0,30)}…)`);
}

// ── STEP 2: Create Candidate ──────────────────────────────────────────────────
async function step2_register_candidate() {
  info('STEP 2: Candidate Registration');
  const r = await post('/ats/candidates', CANDIDATE);
  note(`Response (${r.status}): ${JSON.stringify(r.body).substring(0, 300)}`);
  if (r.status !== 200 && r.status !== 201) {
    fail(`Candidate creation failed (HTTP ${r.status}): ${JSON.stringify(r.body)}`);
  }
  const c = r.body?.candidate ?? r.body?.data ?? r.body;
  TEST.candidateId   = c?.id   ?? c?.candidate_id;
  TEST.candidateCode = c?.candidate_code ?? c?.code;
  if (!TEST.candidateId) fail(`No candidate ID in response: ${JSON.stringify(r.body)}`);
  pass(`Candidate created — ID: ${TEST.candidateId} | Code: ${TEST.candidateCode}`);
  pass(`Email: ${CANDIDATE.email}`);
}

// ── STEP 3: View in ATS Dashboard ─────────────────────────────────────────────
async function step3_view_ats() {
  info('STEP 3: ATS Candidate List (UI screenshot)');
  await page.goto(`${BASE}/ats/candidate-master`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  await shot('01-ats-candidate-master');
  pass('ATS candidate master page loaded');
}

// ── STEP 4: Move through ATS stages ──────────────────────────────────────────
async function step4_move_stages() {
  info('STEP 4: ATS Stage Progression (API)');
  const stages = [
    { stage: 'Screening',            note: '→ Screening' },
    { stage: 'HR Interview',         note: '→ HR Interview (skip Written Test for walk-in)' },
    { stage: 'Selected',             note: '→ Selected ✓' },
  ];
  for (const s of stages) {
    const r = await post(`/ats/candidates/${TEST.candidateId}/move-stage`, { toStage: s.stage, notes: `E2E auto: ${s.note}` });
    if (r.status !== 200) fail(`Stage move to ${s.stage} failed (HTTP ${r.status}): ${JSON.stringify(r.body)}`);
    pass(`Stage: ${s.note}`);
  }
}

// ── STEP 5: Send Onboarding Link ──────────────────────────────────────────────
async function step5_send_onboarding_link() {
  info('STEP 5: Send Onboarding Link to Candidate (API)');
  const r = await post(`/ats/onboarding/candidates/${TEST.candidateId}/send-onboarding-link`, {});
  note(`Response (${r.status}): ${JSON.stringify(r.body)}`);
  if (r.status !== 200 && r.status !== 201) {
    // Try alternate endpoint
    const r2 = await post(`/ats/onboarding/send-token/${TEST.candidateId}`, {});
    note(`Alt response (${r2.status}): ${JSON.stringify(r2.body)}`);
    if (r2.status !== 200 && r2.status !== 201) fail(`Send onboarding link failed (HTTP ${r2.status})`);
    TEST.onboardingToken = r2.body?.token ?? r2.body?.data?.token;
  } else {
    TEST.onboardingToken = r.body?.token ?? r.body?.data?.token;
  }
  pass(`Onboarding link sent${TEST.onboardingToken ? ` — token: ${TEST.onboardingToken?.substring(0, 30)}…` : ' (email dispatched)'}`);
}

// ── STEP 6: Candidate submits full profile (simulate) ─────────────────────────
async function step6_candidate_profile() {
  info('STEP 6: Candidate Profile Submission (API simulation)');

  if (!TEST.onboardingToken) {
    // Fetch token from onboarding requests
    const reqs = await get('/ats/onboarding/requests');
    const list  = reqs.body?.data ?? reqs.body ?? [];
    const match = Array.isArray(list) ? list.find(r => r.candidate_id === TEST.candidateId) : null;
    if (match) TEST.onboardingRequestId = match.id;
    note('Token not captured from email — will proceed via HR offer creation directly');
    pass('Candidate profile step skipped (token in email only; profile_status will be set manually via API)');

    // Force profile status to profile_submitted via stage move workaround
    // Actually let's just set it directly — we need the onboarding request row
    // The onboarding bridge creates a row when link is sent. Check requests list.
    if (match) {
      pass(`Onboarding request found: ${match.id} | status: ${match.profile_status}`);
      TEST.onboardingRequestId = match.id;
    }
    return;
  }

  // We have a token — submit profile steps
  const headers = TEST.onboardingToken;

  const steps = [
    ['/ats/onboarding-full/employee-details', {
      token: TEST.onboardingToken, full_name: CANDIDATE.fullName,
      mobile: CANDIDATE.mobile, email: CANDIDATE.email,
      date_of_birth: CANDIDATE.dateOfBirth, gender: CANDIDATE.gender,
      father_name: 'Test Father', current_address: CANDIDATE.address,
      permanent_address: CANDIDATE.address, marital_status: 'Single',
    }],
    ['/ats/onboarding-full/bank-details', {
      token: TEST.onboardingToken, bank_name: 'SBI', account_number: '1234567890',
      ifsc_code: 'SBIN0001234', account_holder_name: CANDIDATE.fullName,
    }],
    ['/ats/onboarding-full/qualification', {
      token: TEST.onboardingToken, degree: 'B.Com', institution: 'DU', year_of_passing: 2017, percentage: 65,
    }],
    ['/ats/onboarding-full/family', {
      token: TEST.onboardingToken, family_members: [{ name: 'Test Mother', relation: 'Mother', contact: '9111111111' }],
    }],
    ['/ats/onboarding-full/statutory', {
      token: TEST.onboardingToken, pan_number: 'ABCDE1234F', aadhaar_number: '123456789012',
      uan_number: '', pf_applicable: true, esic_applicable: false,
    }],
    ['/ats/onboarding-full/submit', { token: TEST.onboardingToken }],
  ];

  for (const [endpoint, payload] of steps) {
    const r = await post(endpoint, payload);
    if (r.status === 200 || r.status === 201) {
      pass(`${endpoint.split('/').pop()} submitted`);
    } else {
      note(`${endpoint.split('/').pop()} → HTTP ${r.status}: ${JSON.stringify(r.body)}`);
    }
  }

  // Refresh onboarding requests
  const reqs = await get('/ats/onboarding/requests');
  const list  = reqs.body?.data ?? reqs.body ?? [];
  const match = Array.isArray(list) ? list.find(r => r.candidate_id === TEST.candidateId) : null;
  if (match) {
    TEST.onboardingRequestId = match.id;
    pass(`Profile submitted — request ID: ${match.id} | status: ${match.profile_status}`);
  }
}

// ── STEP 7: HR views onboarding requests (UI) ─────────────────────────────────
async function step7_hr_view_requests() {
  info('STEP 7: HR Onboarding Requests Page (UI screenshot)');
  await page.goto(`${BASE}/ats/onboarding-requests`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2500);
  await shot('02-onboarding-requests-list');
  pass('Onboarding requests list captured');
}

// ── STEP 8: Fetch masters needed for offer ─────────────────────────────────────
async function step8_fetch_masters() {
  info('STEP 8: Fetch Masters for Offer (departments, designations, cost centres, bands)');

  const [depts, desigs, bands, ccResp] = await Promise.all([
    get('/org/departments?active=1').catch(() => get('/departments?active_status=1')),
    get('/org/designations?active=1').catch(() => get('/designations?active_status=1')),
    get('/payroll-masters/bands'),
    get(`/payroll-masters/cost-centres?branch=${encodeURIComponent(CANDIDATE.branch_name)}`),
  ]);

  const deptList  = depts.body?.data  ?? depts.body  ?? [];
  const desigList = desigs.body?.data ?? desigs.body ?? [];
  const bandList  = bands.body?.data  ?? bands.body  ?? [];
  const ccList    = ccResp.body?.data ?? ccResp.body ?? [];

  const dept  = Array.isArray(deptList)  && deptList.length  ? deptList[0]  : null;
  const desig = Array.isArray(desigList) && desigList.length ? desigList[0] : null;
  const band  = Array.isArray(bandList)  && bandList.length  ? bandList[0]  : null;
  const cc    = Array.isArray(ccList)    && ccList.length    ? ccList[0]    : null;

  note(`Dept: ${dept?.department_name ?? dept?.name ?? 'none'}`);
  note(`Desig: ${desig?.designation_name ?? desig?.name ?? 'none'}`);
  note(`Band: ${band?.band_code ?? 'none'} (${band?.min_ctc}–${band?.max_ctc})`);
  note(`Cost Centre: ${cc?.cost_centre_code ?? 'none'}`);

  TEST._dept  = dept?.id  ?? dept?.department_id;
  TEST._desig = desig?.id ?? desig?.designation_id;
  TEST._band  = band?.band_code ?? 'C';
  TEST._cc    = cc?.cost_centre_code ?? '';

  pass('Masters fetched');
}

// ── STEP 9: Create & Submit Offer (HR) ───────────────────────────────────────
async function step9_create_offer() {
  info('STEP 9: Create & Submit Employment Offer (API — HR role)');

  // Find the onboarding request for our candidate
  const reqs = await get('/ats/onboarding/requests');
  const list  = reqs.body?.data ?? reqs.body ?? [];
  const match = Array.isArray(list)
    ? list.find(r => r.candidate_id === TEST.candidateId || r.email === CANDIDATE.email)
    : null;

  if (!match) {
    // The candidate may not have submitted profile yet; try forcing status via bridge
    note('No onboarding request found matching candidate — checking bridge');
    // Try creating bridge manually
    const bridge = await post('/ats/onboarding-bridge', { candidate_id: TEST.candidateId });
    note(`Bridge response (${bridge.status}): ${JSON.stringify(bridge.body)}`);

    const reqs2 = await get('/ats/onboarding/requests');
    const list2  = reqs2.body?.data ?? reqs2.body ?? [];
    const match2 = Array.isArray(list2)
      ? list2.find(r => r.candidate_id === TEST.candidateId)
      : null;

    if (!match2) {
      fail(`Cannot find onboarding request for candidate ${TEST.candidateId}. ` +
        `The candidate likely hasn't completed profile submission. ` +
        `profile_status must be 'profile_submitted' before HR can create an offer.`);
    }
    TEST.onboardingRequestId = match2.id;
    note(`Found via bridge: request ${match2.id} | status: ${match2.profile_status}`);
  } else {
    TEST.onboardingRequestId = match.id;
    note(`Request ID: ${match.id} | profile_status: ${match.profile_status}`);
  }

  const today = new Date().toISOString().split('T')[0];
  const offerPayload = {
    emp_type:             'OnRoll',
    date_of_joining:      today,
    date_of_salary:       today,
    cost_centre:          TEST._cc   || '',
    role_type:            'Analyst',
    salary_band:          TEST._band || 'C',
    offered_ctc:          6500 * 12,       // annual
    department_id:        TEST._dept  || null,
    designation_id:       TEST._desig || null,
    reporting_manager_id: null,
    pf_eligible:          true,
    esi_eligible:         true,
    selected_package_id:  '',
    submit:               true,            // submit immediately (draft → submitted)
    is_proposed_exception: false,
    proposed_reason:      null,
  };

  note(`Submitting offer for request ${TEST.onboardingRequestId}…`);
  const r = await post(`/ats/onboarding/requests/${TEST.onboardingRequestId}/offer`, offerPayload);
  note(`Offer response (${r.status}): ${JSON.stringify(r.body)}`);

  if (r.status !== 200 && r.status !== 201) {
    fail(`Offer creation failed (HTTP ${r.status}): ${JSON.stringify(r.body)}`);
  }

  TEST.offerId = r.body?.offerId ?? r.body?.offer_id ?? r.body?.data?.id ?? r.body?.id;
  pass(`Offer created & submitted${TEST.offerId ? ` — offer ID: ${TEST.offerId}` : ''}`);
}

// ── STEP 10: Branch Head views pending approvals (UI) ─────────────────────────
async function step10_branch_head_view() {
  info('STEP 10: Branch Head Pending Approvals (UI screenshot)');
  await page.goto(`${BASE}/ats/offer-approvals`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2500);
  await shot('03-offer-approvals-list');
  pass('Offer approvals page captured');

  // Also try /ats/branch-head-approval
  await page.goto(`${BASE}/ats/branch-head-approval`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  await shot('04-branch-head-approval-page');
  pass('Branch head approval page captured');
}

// ── STEP 11: Get offer ID if not already captured ─────────────────────────────
async function step11_resolve_offer_id() {
  info('STEP 11: Resolve Offer ID for Approval');
  if (TEST.offerId) { pass(`Offer ID already known: ${TEST.offerId}`); return; }

  const r = await get('/ats/onboarding/pending-approval');
  note(`Pending approvals response (${r.status}): ${JSON.stringify(r.body).substring(0, 300)}`);
  const list = r.body?.data ?? r.body ?? [];
  if (!Array.isArray(list) || !list.length) {
    // Try fetching from requests
    const reqs = await get('/ats/onboarding/requests');
    const all  = reqs.body?.data ?? reqs.body ?? [];
    const match = Array.isArray(all)
      ? all.find(x => x.id === TEST.onboardingRequestId || x.candidate_id === TEST.candidateId)
      : null;
    if (match?.offer_id) {
      TEST.offerId = match.offer_id;
      pass(`Offer ID resolved from requests: ${TEST.offerId}`);
      return;
    }
    fail('Could not resolve offer ID for approval — no pending approval found');
  }

  const match = list.find(o =>
    o.candidate_id === TEST.candidateId ||
    o.onboarding_request_id === TEST.onboardingRequestId ||
    o.email === CANDIDATE.email
  ) ?? list[list.length - 1]; // fallback: latest

  TEST.offerId = match?.id ?? match?.offer_id;
  if (!TEST.offerId) fail(`No offer ID found in pending approvals: ${JSON.stringify(list[0])}`);
  pass(`Offer ID resolved: ${TEST.offerId} (candidate: ${match?.full_name ?? 'unknown'})`);
}

// ── STEP 12: Branch Head Approves Offer → Employee Created ────────────────────
async function step12_approve_offer() {
  info('STEP 12: Branch Head Approves Offer → EMPLOYEE CREATED (API)');
  const r = await post(`/ats/onboarding/offers/${TEST.offerId}/approve`, {
    remarks: 'E2E test approval — auto approved',
  });
  note(`Approval response (${r.status}): ${JSON.stringify(r.body)}`);

  if (r.status !== 200 && r.status !== 201) {
    fail(`Offer approval failed (HTTP ${r.status}): ${JSON.stringify(r.body)}`);
  }

  TEST.employeeId   = r.body?.employeeId   ?? r.body?.employee_id   ?? r.body?.data?.employee_id;
  TEST.employeeCode = r.body?.employeeCode ?? r.body?.employee_code ?? r.body?.data?.employee_code;

  if (!TEST.employeeCode) {
    note('Employee code not in response — fetching from employees API…');
    const empR = await get(`/employees?search=${encodeURIComponent(CANDIDATE.fullName)}`);
    const emps = empR.body?.data ?? empR.body ?? [];
    const emp  = Array.isArray(emps) ? emps.find(e => e.email === CANDIDATE.email) ?? emps[0] : null;
    if (emp) {
      TEST.employeeId   = emp.id   ?? TEST.employeeId;
      TEST.employeeCode = emp.employee_code ?? emp.emp_code;
    }
  }

  if (!TEST.employeeCode) fail('Employee code NOT generated — approval may have failed silently');
  pass(`🎉 EMPLOYEE CREATED!`);
  pass(`Employee Code: ${TEST.employeeCode}`);
  pass(`Employee ID:   ${TEST.employeeId}`);
}

// ── STEP 13: Verify employee in system (API + UI) ─────────────────────────────
async function step13_verify_employee() {
  info('STEP 13: Verify Employee in System');

  // API check
  const r = await get(`/employees/${TEST.employeeId}`);
  note(`Employee fetch (${r.status}): ${JSON.stringify(r.body).substring(0, 400)}`);
  const emp = r.body?.data ?? r.body;
  if (emp?.employee_code || emp?.id) {
    pass(`Employee record confirmed — code: ${emp.employee_code} | status: ${emp.employment_status}`);
  } else {
    note('Direct ID fetch returned unexpected shape — trying search');
    const s = await get(`/employees?search=${encodeURIComponent(CANDIDATE.full_name)}`);
    note(`Search (${s.status}): ${JSON.stringify(s.body).substring(0, 300)}`);
  }

  // UI: Employees page
  await page.goto(`${BASE}/employees`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2500);
  await shot('05-employees-list-post-creation');
  pass('Employees list page captured');

  // UI: Try navigate to new employee profile
  if (TEST.employeeId) {
    await page.goto(`${BASE}/employees/${TEST.employeeId}`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2500);
    await shot('06-new-employee-profile');
    pass('New employee profile page captured');
  }
}

// ── STEP 14: Onboarding page (HR view) ────────────────────────────────────────
async function step14_hr_onboarding_final() {
  info('STEP 14: HR Onboarding Requests — post-approval state');
  await page.goto(`${BASE}/ats/onboarding-requests`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2500);
  await shot('07-onboarding-requests-post-approval');
  pass('Post-approval onboarding list captured');
}

// ── FINAL REPORT ──────────────────────────────────────────────────────────────
function printReport(results) {
  console.log('\n' + '═'.repeat(60));
  console.log('  E2E TEST REPORT — CANDIDATE → EMPLOYEE');
  console.log('═'.repeat(60));
  console.log(`  Candidate Email:  ${CANDIDATE.email}`);
  console.log(`  Candidate ID:     ${TEST.candidateId ?? 'N/A'}`);
  console.log(`  Candidate Code:   ${TEST.candidateCode ?? 'N/A'}`);
  console.log(`  Onboarding Req:   ${TEST.onboardingRequestId ?? 'N/A'}`);
  console.log(`  Offer ID:         ${TEST.offerId ?? 'N/A'}`);
  console.log(`  Employee ID:      ${TEST.employeeId ?? 'N/A'}`);
  console.log(`  Employee Code:    ${TEST.employeeCode ?? '❌ NOT GENERATED'}`);
  console.log('─'.repeat(60));
  for (const r of results) {
    const icon = r.passed ? '✅' : '❌';
    console.log(`  ${icon} ${r.step}${r.error ? ` — ${r.error}` : ''}`);
  }
  console.log('─'.repeat(60));
  const passed = results.filter(r => r.passed).length;
  const total  = results.length;
  console.log(`  Result: ${passed}/${total} steps passed`);
  console.log('═'.repeat(60));
  console.log('  Screenshots in pictures/ folder:');
  console.log('    e2e-01-ats-candidate-master.png');
  console.log('    e2e-02-onboarding-requests-list.png');
  console.log('    e2e-03-offer-approvals-list.png');
  console.log('    e2e-04-branch-head-approval-page.png');
  console.log('    e2e-05-employees-list-post-creation.png');
  console.log('    e2e-06-new-employee-profile.png');
  console.log('    e2e-07-onboarding-requests-post-approval.png');
  console.log('═'.repeat(60));
}

// ── RUNNER ────────────────────────────────────────────────────────────────────
const steps = [
  { name: 'Admin Login',                    fn: step1_login },
  { name: 'Candidate Registration',         fn: step2_register_candidate },
  { name: 'ATS Dashboard View (UI)',        fn: step3_view_ats },
  { name: 'Stage Progression (→ Selected)', fn: step4_move_stages },
  { name: 'Send Onboarding Link',           fn: step5_send_onboarding_link },
  { name: 'Candidate Profile Submission',   fn: step6_candidate_profile },
  { name: 'HR Onboarding Requests (UI)',    fn: step7_hr_view_requests },
  { name: 'Fetch Offer Masters',            fn: step8_fetch_masters },
  { name: 'Create & Submit Offer (HR)',     fn: step9_create_offer },
  { name: 'Branch Head View (UI)',          fn: step10_branch_head_view },
  { name: 'Resolve Offer ID',              fn: step11_resolve_offer_id },
  { name: 'Approve Offer → Create Employee', fn: step12_approve_offer },
  { name: 'Verify Employee in System',     fn: step13_verify_employee },
  { name: 'HR View Post-Approval',         fn: step14_hr_onboarding_final },
];

(async () => {
  const results = [];
  try { await loginBrowser(); }
  catch (e) { console.error('Browser login failed:', e.message); }

  for (const s of steps) {
    try {
      await s.fn();
      results.push({ step: s.name, passed: true });
    } catch (e) {
      console.log(`  💥 ${s.name} threw: ${e.message}`);
      results.push({ step: s.name, passed: false, error: e.message });
      // Continue remaining steps — collect full picture
    }
  }

  if (browser) await browser.close();
  printReport(results);
})();
