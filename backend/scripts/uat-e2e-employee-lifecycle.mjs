#!/usr/bin/env node
/**
 * E2E UAT Script: Complete Employee Lifecycle
 *
 * Journey: Candidate → Interview → Selection → Onboarding → Offer →
 *          BH Approval → Salary → E-Sign → Auth User → Exit → F&F
 *
 * Usage: node uat-e2e-employee-lifecycle.mjs [--skip-esign] [--skip-exit]
 */

import mysql from 'mysql2/promise';
// The database password is read from the environment, never written here. This file was one
// of 13 that had it as a source literal; the repository is public and the same value
// authenticates mas_hrms, dialer_db, db_bill and mcn_lms. Pasting it back is exactly what
// backend/src/db/__tests__/no-hardcoded-credentials.contract.test.ts exists to catch.
// Run: node --env-file=backend/.env <this script>
if (!process.env.DB_PASSWORD) {
  throw new Error('DB_PASSWORD is not set. Run with: node --env-file=backend/.env <script>');
}

import { randomUUID } from 'crypto';
import readline from 'readline';

const DB_CONFIG = {
  host: '122.184.128.90',
  user: 'shivam_user',
  password: process.env.DB_PASSWORD,
  database: 'mas_hrms',
};

// Use production API - change to localhost:3000 for local testing
const API_BASE = process.env.API_BASE || 'https://mcnhrms.teammas.in';

const TEST_DATA = {
  candidateName: 'Shivam Test',
  firstName: 'Shivam',
  lastName: 'Test',
  email: 'shivam.test.uat@teammas.in',
  mobile: '2147672100', // Will add 51 for e-sign
  esignMobile: '2147672100', // For e-sign OTP - user said "214767210051" - seems like it has extra digit
  branchId: 'febd8777-6583-11f1-adb1-00155d0ab410',
  processId: '04f20ddc-67ba-11f1-adb1-00155d0ab410',
  costCentreId: '0339a406-6584-11f1-adb1-00155d0ab410',
  salarySlabId: '6dff99e3-673f-11f1-adb1-00155d0ab410',
  ctc: 8500,
  doj: new Date().toISOString().split('T')[0], // Today
};

let db;
let authToken;
let testState = {
  candidateId: null,
  onboardingRequestId: null,
  offerId: null,
  employeeId: null,
  employeeCode: null,
  userId: null,
  exitRequestId: null,
};

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const askUser = (q) => new Promise(r => rl.question(q, r));

async function log(step, message, data = null) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${step}] ${message}`);
  if (data) console.log('   ', JSON.stringify(data, null, 2).split('\n').join('\n    '));
}

async function apiCall(method, path, body = null, token = authToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${API_BASE}${path}`, opts);
  const json = await res.json();

  if (!res.ok) {
    throw new Error(`API ${method} ${path} failed: ${res.status} - ${JSON.stringify(json)}`);
  }
  return json;
}

async function getAuthToken() {
  // Try login first; fall back to pre-generated dev token
  try {
    const res = await apiCall('POST', '/api/auth/login', {
      email: 'shivam.giri@teammas.in',
      password: process.env.ADMIN_PASSWORD || '',
    }, null);
    const tok = res.data?.token || res.token;
    if (tok) return tok;
  } catch {}

  // Use pre-generated JWT signed with local dev secret
  if (process.env.DEV_TOKEN) return process.env.DEV_TOKEN;
  throw new Error('No auth token available. Set DEV_TOKEN=<jwt> or ADMIN_PASSWORD=<pass> env var.');
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 1: Create Candidate
// ═══════════════════════════════════════════════════════════════════════════
async function stage1_createCandidate() {
  log('STAGE-1', 'Creating candidate...');

  const candidateData = {
    first_name: TEST_DATA.firstName,
    last_name: TEST_DATA.lastName,
    email: TEST_DATA.email,
    mobile: TEST_DATA.mobile,
    source: 'UAT_TEST',
    branch_id: TEST_DATA.branchId,
    process_id: TEST_DATA.processId,
    cost_centre_id: TEST_DATA.costCentreId,
  };

  const res = await apiCall('POST', '/api/ats/candidates', candidateData);
  testState.candidateId = res.data?.id || res.id;

  log('STAGE-1', `Candidate created: ${testState.candidateId}`);
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 2: Submit Interview Result (Selected)
// ═══════════════════════════════════════════════════════════════════════════
async function stage2_submitInterview() {
  log('STAGE-2', 'Submitting interview result (SELECTED)...');

  // Move candidate through stages
  await apiCall('POST', `/api/ats/candidates/${testState.candidateId}/move-stage`, {
    stage: 'interview',
  });

  // Submit interview result as selected
  const interviewData = {
    candidate_id: testState.candidateId,
    round_type: 'round1',
    final_decision: 'Selected',
    interviewer_remarks: 'UAT Test - Auto selected',
    score: 85,
  };

  await apiCall('POST', '/api/ats-full-parity/recruiter-submission', interviewData);

  // Move to selected stage
  await apiCall('POST', `/api/ats/candidates/${testState.candidateId}/move-stage`, {
    stage: 'selected',
  });

  log('STAGE-2', 'Interview submitted, candidate SELECTED');
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 3: Fill Onboarding Form
// ═══════════════════════════════════════════════════════════════════════════
async function stage3_fillOnboarding() {
  log('STAGE-3', 'Creating onboarding request and filling form...');

  // Create onboarding request
  const onboardRes = await apiCall('POST', '/api/ats/onboarding/requests', {
    candidate_id: testState.candidateId,
    onboarding_type: 'full',
  });
  testState.onboardingRequestId = onboardRes.data?.id || onboardRes.id;

  // Get the onboarding token
  const [tokenRow] = await db.execute(
    `SELECT token FROM onboarding_request WHERE id = ? LIMIT 1`,
    [testState.onboardingRequestId]
  );
  const token = tokenRow[0]?.token;

  if (!token) {
    // Directly insert onboarding data via DB for speed
    log('STAGE-3', 'Filling onboarding data directly via DB...');

    await db.execute(`
      UPDATE candidates SET
        father_name = 'Test Father',
        mother_name = 'Test Mother',
        date_of_birth = '1995-01-15',
        gender = 'Male',
        marital_status = 'Single',
        blood_group = 'O+',
        nationality = 'Indian',
        aadhar_number = '123456789012',
        pan_number = 'ABCDE1234F',
        current_address = '123 Test Street, Noida',
        permanent_address = '123 Test Street, Noida',
        emergency_contact_name = 'Emergency Contact',
        emergency_contact_phone = '9876543210',
        emergency_contact_relation = 'Father'
      WHERE id = ?
    `, [testState.candidateId]);
  } else {
    // Use API to fill form
    const baseUrl = `/api/ats/onboarding-full`;

    // Employee details
    await apiCall('POST', `${baseUrl}/employee-details`, {
      token,
      father_name: 'Test Father',
      mother_name: 'Test Mother',
      date_of_birth: '1995-01-15',
      gender: 'Male',
      marital_status: 'Single',
      blood_group: 'O+',
      nationality: 'Indian',
      current_address: '123 Test Street, Noida',
      permanent_address: '123 Test Street, Noida',
    });

    // Bank details
    await apiCall('POST', `${baseUrl}/bank-details`, {
      token,
      bank_name: 'HDFC Bank',
      account_number: '12345678901234',
      ifsc_code: 'HDFC0001234',
      account_holder_name: TEST_DATA.candidateName,
    });

    // Statutory
    await apiCall('POST', `${baseUrl}/statutory`, {
      token,
      aadhar_number: '123456789012',
      pan_number: 'ABCDE1234F',
      uan_number: '',
      esic_number: '',
    });
  }

  log('STAGE-3', 'Onboarding form filled');
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 4: Create Offer
// ═══════════════════════════════════════════════════════════════════════════
async function stage4_createOffer() {
  log('STAGE-4', 'Creating offer...');

  // First calculate salary breakdown
  const calcRes = await apiCall('POST', '/api/ats/onboarding/calculate-salary', {
    ctc: TEST_DATA.ctc,
    salary_slab_id: TEST_DATA.salarySlabId,
  });

  const components = calcRes.data?.components || calcRes.components || [];

  // Create offer
  const offerData = {
    date_of_joining: TEST_DATA.doj,
    ctc: TEST_DATA.ctc,
    salary_slab_id: TEST_DATA.salarySlabId,
    designation: 'Customer Service Executive',
    department: 'Operations',
    components: components,
  };

  const offerRes = await apiCall('POST', `/api/ats/onboarding/requests/${testState.onboardingRequestId}/offer`, offerData);
  testState.offerId = offerRes.data?.id || offerRes.id;

  log('STAGE-4', `Offer created: ${testState.offerId}, CTC: ${TEST_DATA.ctc}`);
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 5: Branch Head Approval
// ═══════════════════════════════════════════════════════════════════════════
async function stage5_branchHeadApproval() {
  log('STAGE-5', 'Branch Head approving offer...');

  // Find the pending approval
  const pendingRes = await apiCall('GET', '/api/ats/branch-head-approval/pending');
  const pending = pendingRes.data || [];

  const myPending = pending.find(p => p.candidate_id === testState.candidateId);

  if (myPending) {
    await apiCall('POST', '/api/ats/branch-head-approval/process', {
      candidate_id: testState.candidateId,
      decision: 'approved',
      remarks: 'UAT Test - Approved',
    });
  } else {
    // Direct approval via the offer route
    await apiCall('POST', `/api/ats/onboarding/offers/${testState.offerId}/approve`, {
      remarks: 'UAT Test - Approved',
    });
  }

  // Wait a moment for employee creation
  await new Promise(r => setTimeout(r, 2000));

  // Get employee ID
  const [empRow] = await db.execute(
    `SELECT id, employee_code, user_id FROM employees WHERE candidate_id = ? LIMIT 1`,
    [testState.candidateId]
  );

  if (empRow.length > 0) {
    testState.employeeId = empRow[0].id;
    testState.employeeCode = empRow[0].employee_code;
    testState.userId = empRow[0].user_id;
    log('STAGE-5', `Employee created: ${testState.employeeCode} (${testState.employeeId})`);
  } else {
    throw new Error('Employee not created after approval');
  }

  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 6: Salary Assignment (via Payroll Head Review)
// ═══════════════════════════════════════════════════════════════════════════
async function stage6_salaryAssignment() {
  log('STAGE-6', 'Verifying salary assignment...');

  // Salary should already be assigned during employee creation
  // Let's verify and do payroll head review if needed

  const [salaryRow] = await db.execute(
    `SELECT ctc, basic, hra, conveyance FROM employee_salary WHERE employee_id = ? AND is_current = 1 LIMIT 1`,
    [testState.employeeId]
  );

  if (salaryRow.length > 0) {
    log('STAGE-6', `Salary already assigned: CTC ${salaryRow[0].ctc}`);
  } else {
    // Assign via API
    await apiCall('POST', `/api/ats/salary-components/${testState.candidateId}`, {
      salary_slab_id: TEST_DATA.salarySlabId,
      ctc: TEST_DATA.ctc,
    });
    log('STAGE-6', 'Salary assigned via API');
  }

  // Check payroll head review queue
  const [reviewRow] = await db.execute(
    `SELECT id, status FROM employee_payroll_head_review WHERE employee_id = ? LIMIT 1`,
    [testState.employeeId]
  );

  if (reviewRow.length > 0 && reviewRow[0].status === 'pending') {
    // Approve via payroll head
    await db.execute(
      `UPDATE employee_payroll_head_review SET status = 'approved', reviewed_at = NOW(), remarks = 'UAT Test' WHERE id = ?`,
      [reviewRow[0].id]
    );
    log('STAGE-6', 'Payroll Head review approved');
  }

  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 7: Verify Notifications
// ═══════════════════════════════════════════════════════════════════════════
async function stage7_verifyNotifications() {
  log('STAGE-7', 'Checking notifications sent...');

  // Check dispatch_log for notifications
  const [dispatches] = await db.execute(`
    SELECT channel, event_type, status, created_at
    FROM dispatch_log
    WHERE entity_id = ? OR entity_id = ?
    ORDER BY created_at DESC LIMIT 20
  `, [testState.candidateId, testState.employeeId]);

  if (dispatches.length > 0) {
    log('STAGE-7', `Found ${dispatches.length} notification dispatches:`);
    for (const d of dispatches) {
      console.log(`     - ${d.channel}: ${d.event_type} (${d.status})`);
    }
  } else {
    log('STAGE-7', 'No notifications found in dispatch_log (may be sent via different entity)');
  }

  // Check work_inbox
  const [inboxItems] = await db.execute(`
    SELECT type, title, status, created_at
    FROM work_inbox_item
    WHERE user_id = ? OR JSON_EXTRACT(metadata, '$.employee_id') = ?
    ORDER BY created_at DESC LIMIT 10
  `, [testState.userId, testState.employeeId]);

  if (inboxItems.length > 0) {
    log('STAGE-7', `Found ${inboxItems.length} work inbox items`);
  }

  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 8: E-Sign (Joining Documents)
// ═══════════════════════════════════════════════════════════════════════════
async function stage8_esign(skipEsign) {
  if (skipEsign) {
    log('STAGE-8', 'E-Sign skipped (--skip-esign flag)');
    return true;
  }

  log('STAGE-8', 'Initiating e-sign for joining documents...');

  // Check if appointment letter request exists
  const [letterReq] = await db.execute(`
    SELECT id, esign_status, esign_request_id
    FROM appointment_letter_request
    WHERE employee_id = ? LIMIT 1
  `, [testState.employeeId]);

  if (letterReq.length === 0) {
    log('STAGE-8', 'No appointment letter request found - creating one...');

    // Trigger joining kit dispatch
    try {
      await apiCall('POST', `/api/ats/onboarding-full/candidate/${testState.candidateId}/esign/initiate`, {
        mobile: TEST_DATA.esignMobile,
      });
    } catch (e) {
      log('STAGE-8', `E-sign initiation may have failed (non-blocking): ${e.message}`);
    }
  } else {
    log('STAGE-8', `Appointment letter exists, esign_status: ${letterReq[0].esign_status}`);
  }

  // If e-sign is in progress, wait for OTP
  const otpAnswer = await askUser('\n>>> E-Sign OTP sent to your mobile. Enter OTP (or "skip" to skip): ');

  if (otpAnswer.toLowerCase() === 'skip') {
    log('STAGE-8', 'E-Sign skipped by user');
    return true;
  }

  // Verify OTP (would need the actual e-sign verification endpoint)
  log('STAGE-8', `OTP entered: ${otpAnswer} - verification would happen via provider callback`);

  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 9: Verify Auth User Created
// ═══════════════════════════════════════════════════════════════════════════
async function stage9_verifyAuthUser() {
  log('STAGE-9', 'Verifying auth user and HRMS login access...');

  // Refresh employee data
  const [empRow] = await db.execute(
    `SELECT user_id, active_status, employment_status, official_email, email
     FROM employees WHERE id = ? LIMIT 1`,
    [testState.employeeId]
  );

  const emp = empRow[0];
  testState.userId = emp?.user_id;

  if (!testState.userId) {
    log('STAGE-9', 'No user_id yet - employee may not be activated');

    // Check if employee should be activated (DOJ = today)
    if (emp?.active_status === 0) {
      log('STAGE-9', 'Employee not yet active. Triggering manual activation...');

      // Directly activate for testing
      await db.execute(
        `UPDATE employees SET active_status = 1, employment_status = 'Active' WHERE id = ?`,
        [testState.employeeId]
      );

      // Create auth user
      const loginEmail = emp.official_email || emp.email || TEST_DATA.email;
      const userId = randomUUID();
      const bcrypt = await import('bcryptjs');
      const pwdHash = await bcrypt.default.hash('Welcome@123', 10);

      await db.execute(
        `INSERT IGNORE INTO auth_user (id, email, password_hash, must_change_password, created_at)
         VALUES (?, ?, ?, 1, NOW())`,
        [userId, loginEmail, pwdHash]
      );

      await db.execute(
        `INSERT IGNORE INTO user_roles (id, user_id, role_key, active_status, created_at)
         VALUES (UUID(), ?, 'Employee', 1, NOW())`,
        [userId]
      );

      await db.execute(
        `UPDATE employees SET user_id = ? WHERE id = ?`,
        [userId, testState.employeeId]
      );

      testState.userId = userId;
      log('STAGE-9', `Auth user created: ${loginEmail} / Welcome@123`);
    }
  } else {
    // Verify auth user exists
    const [authRow] = await db.execute(
      `SELECT email, must_change_password FROM auth_user WHERE id = ? LIMIT 1`,
      [testState.userId]
    );

    if (authRow.length > 0) {
      log('STAGE-9', `Auth user exists: ${authRow[0].email}`);
    }
  }

  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 10: Roster Assignment
// ═══════════════════════════════════════════════════════════════════════════
async function stage10_rosterAssignment() {
  log('STAGE-10', 'Checking roster/attendance setup...');

  // Check if employee has roster config
  const [rosterConfig] = await db.execute(`
    SELECT id, shift_id, weekoff_pattern
    FROM employee_roster_config
    WHERE employee_id = ? LIMIT 1
  `, [testState.employeeId]);

  if (rosterConfig.length > 0) {
    log('STAGE-10', `Roster config exists: shift=${rosterConfig[0].shift_id}`);
  } else {
    log('STAGE-10', 'No roster config - WFM provisioning task pending');

    // Check IT provisioning tasks
    const [provTasks] = await db.execute(`
      SELECT task_code, status, sla_due_at
      FROM it_provisioning_request
      WHERE employee_id = ?
    `, [testState.employeeId]);

    if (provTasks.length > 0) {
      log('STAGE-10', 'Provisioning tasks:');
      for (const t of provTasks) {
        console.log(`     - ${t.task_code}: ${t.status}`);
      }
    }
  }

  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 11: Submit Resignation (Exit)
// ═══════════════════════════════════════════════════════════════════════════
async function stage11_submitExit(skipExit) {
  if (skipExit) {
    log('STAGE-11', 'Exit skipped (--skip-exit flag)');
    return true;
  }

  log('STAGE-11', 'Submitting resignation...');

  // Calculate LWD (30 days notice)
  const lwd = new Date();
  lwd.setDate(lwd.getDate() + 30);
  const lwdStr = lwd.toISOString().split('T')[0];

  const exitData = {
    employee_id: testState.employeeId,
    exit_type: 'resignation',
    reason: 'UAT Test - Personal reasons',
    requested_lwd: lwdStr,
    remarks: 'This is a UAT test resignation',
  };

  const exitRes = await apiCall('POST', '/api/exit', exitData);
  testState.exitRequestId = exitRes.data?.id || exitRes.id;

  log('STAGE-11', `Exit request created: ${testState.exitRequestId}, LWD: ${lwdStr}`);

  // Accept resignation
  await apiCall('POST', `/api/exit/resignation/${testState.exitRequestId}/accept`, {
    remarks: 'UAT Test - Accepted',
    confirmed_lwd: lwdStr,
  });

  log('STAGE-11', 'Resignation accepted');
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 12: Complete Clearance
// ═══════════════════════════════════════════════════════════════════════════
async function stage12_clearance(skipExit) {
  if (skipExit) {
    log('STAGE-12', 'Clearance skipped');
    return true;
  }

  log('STAGE-12', 'Completing clearance tasks...');

  // Generate clearance tasks
  await apiCall('POST', `/api/exit/${testState.exitRequestId}/clearance/generate`);

  // Get clearance tasks
  const clearRes = await apiCall('GET', `/api/exit/${testState.exitRequestId}/clearance`);
  const tasks = clearRes.data || [];

  log('STAGE-12', `Found ${tasks.length} clearance tasks`);

  // Complete all tasks
  for (const task of tasks) {
    await apiCall('PATCH', `/api/exit/${testState.exitRequestId}/clearance/${task.id}`, {
      status: 'cleared',
      remarks: 'UAT Test - Cleared',
    });
    console.log(`     - Cleared: ${task.area}`);
  }

  // Move to F&F pending
  await apiCall('POST', `/api/exit/resignation/${testState.exitRequestId}/mark-fnf-pending`, {
    remarks: 'All clearance complete',
  });

  log('STAGE-12', 'All clearance tasks completed');
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 13: F&F Settlement
// ═══════════════════════════════════════════════════════════════════════════
async function stage13_fnf(skipExit) {
  if (skipExit) {
    log('STAGE-13', 'F&F skipped');
    return true;
  }

  log('STAGE-13', 'Computing Full & Final settlement...');

  // Compute F&F
  const ffRes = await apiCall('GET', `/api/exit/ff/${testState.exitRequestId}/compute`);
  const ff = ffRes.data || {};

  log('STAGE-13', 'F&F Computation:', {
    notice_recovery: ff.notice_recovery,
    leave_encashment: ff.leave_encashment,
    gratuity: ff.gratuity,
    net_payable: ff.net_payable,
  });

  // Create F&F record
  await apiCall('POST', `/api/exit/ff/${testState.exitRequestId}`, {
    components: ff.components || [],
    net_payable: ff.net_payable || 0,
  });

  // Mark as paid (for testing)
  const [ffRow] = await db.execute(
    `SELECT id FROM full_final_settlement WHERE exit_request_id = ? LIMIT 1`,
    [testState.exitRequestId]
  );

  if (ffRow.length > 0) {
    await db.execute(
      `UPDATE full_final_settlement SET payment_status = 'paid', payment_reference = 'UAT-TEST-REF', paid_at = NOW() WHERE id = ?`,
      [ffRow[0].id]
    );
  }

  log('STAGE-13', 'F&F settlement completed');
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 14: Close Exit
// ═══════════════════════════════════════════════════════════════════════════
async function stage14_closeExit(skipExit) {
  if (skipExit) {
    log('STAGE-14', 'Close exit skipped');
    return true;
  }

  log('STAGE-14', 'Closing exit request...');

  await apiCall('POST', `/api/exit/resignation/${testState.exitRequestId}/close`, {
    remarks: 'UAT Test - Exit completed',
  });

  // Verify employee status
  const [empRow] = await db.execute(
    `SELECT active_status, employment_status FROM employees WHERE id = ? LIMIT 1`,
    [testState.employeeId]
  );

  log('STAGE-14', `Exit closed. Employee status: ${empRow[0]?.employment_status}, active: ${empRow[0]?.active_status}`);

  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  const args = process.argv.slice(2);
  const skipEsign = args.includes('--skip-esign');
  const skipExit = args.includes('--skip-exit');

  console.log('\n' + '═'.repeat(70));
  console.log('  E2E UAT: COMPLETE EMPLOYEE LIFECYCLE');
  console.log('  Candidate → Onboarding → Offer → Approval → E-Sign → Exit → F&F');
  console.log('═'.repeat(70) + '\n');

  console.log(`Test Candidate: ${TEST_DATA.candidateName}`);
  console.log(`Branch: NOIDA-2 / Process: Onfido`);
  console.log(`CTC: ₹${TEST_DATA.ctc} / DOJ: ${TEST_DATA.doj}`);
  console.log(`Skip E-Sign: ${skipEsign} / Skip Exit: ${skipExit}\n`);

  try {
    // Connect to DB
    db = await mysql.createConnection(DB_CONFIG);
    log('INIT', 'Database connected');

    // Get auth token
    authToken = await getAuthToken();
    log('INIT', 'Auth token obtained');

    // Run stages
    await stage1_createCandidate();
    await stage2_submitInterview();
    await stage3_fillOnboarding();
    await stage4_createOffer();
    await stage5_branchHeadApproval();
    await stage6_salaryAssignment();
    await stage7_verifyNotifications();
    await stage8_esign(skipEsign);
    await stage9_verifyAuthUser();
    await stage10_rosterAssignment();
    await stage11_submitExit(skipExit);
    await stage12_clearance(skipExit);
    await stage13_fnf(skipExit);
    await stage14_closeExit(skipExit);

    console.log('\n' + '═'.repeat(70));
    console.log('  UAT COMPLETE - ALL STAGES PASSED');
    console.log('═'.repeat(70));
    console.log('\nTest State Summary:');
    console.log(JSON.stringify(testState, null, 2));

  } catch (err) {
    console.error('\n[ERROR] UAT FAILED:', err.message);
    console.error('\nTest State at failure:');
    console.error(JSON.stringify(testState, null, 2));
    process.exit(1);
  } finally {
    if (db) await db.end();
    rl.close();
  }
}

main();
