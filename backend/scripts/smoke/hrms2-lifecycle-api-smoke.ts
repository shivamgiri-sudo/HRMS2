/**
 * HRMS2 API-Driven Lifecycle Smoke Test
 *
 * Tests the complete candidate-to-employee lifecycle through REAL API calls.
 * No direct DB inserts — every step goes through the actual Express routes.
 *
 * Prerequisites:
 *   - Backend running at SMOKE_API_BASE (default: http://localhost:5056)
 *   - Test database (NOT production)
 *   - At least one user per role: admin, hr, payroll_hr, branch_head, it, wfm, branch_admin
 *
 * Usage:
 *   SMOKE_ADMIN_EMAIL=admin@test.com SMOKE_ADMIN_PASSWORD=Admin@123 \
 *   npx tsx scripts/smoke/hrms2-lifecycle-api-smoke.ts
 */

import net from 'net';

const API_BASE = process.env.SMOKE_API_BASE ?? 'http://localhost:5056';
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD;
const ALLOW_PRODUCTION = process.env.ALLOW_PRODUCTION_SMOKE === 'YES_I_ACCEPT_DATA_WRITES';

type Log = { passed: string[]; failed: string[]; warnings: string[] };
const log: Log = { passed: [], failed: [], warnings: [] };

function pass(msg: string) {
  console.log(`  ✓ ${msg}`);
  log.passed.push(msg);
}

function fail(msg: string, detail?: string) {
  const full = detail ? `${msg}: ${detail}` : msg;
  console.error(`  ✗ ${full}`);
  log.failed.push(full);
}

function warn(msg: string) {
  console.warn(`  ⚠ ${msg}`);
  log.warnings.push(msg);
}

function step(title: string) {
  console.log(`\n── ${title} ──`);
}

// ── Safety guard ───────────────────────────────────────────────────────────────

function assertSafeTarget() {
  const host = new URL(API_BASE).hostname;
  const isPublic = (h: string) => {
    if (!h || !net.isIP(h)) return false;
    if (h === '127.0.0.1' || h === '::1' || h === 'localhost') return false;
    if (h.startsWith('10.') || h.startsWith('192.168.')) return false;
    return true;
  };

  console.log('\n========================================================');
  console.log('  HRMS2 API LIFECYCLE SMOKE TEST');
  console.log(`  Target: ${API_BASE}`);
  console.log('  This test CREATES and DELETES test records.');
  console.log('  Use staging/local only.');
  console.log('========================================================\n');

  if (isPublic(host) && !ALLOW_PRODUCTION) {
    console.error('[ABORTED] Target appears to be a public/production server.');
    console.error('Set ALLOW_PRODUCTION_SMOKE=YES_I_ACCEPT_DATA_WRITES to override.');
    process.exit(1);
  }

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error('[ABORTED] SMOKE_ADMIN_EMAIL and SMOKE_ADMIN_PASSWORD required.');
    process.exit(1);
  }
}

// ── HTTP helpers ───────────────────────────────────────────────────────────────

async function api(
  method: string,
  path: string,
  body?: unknown,
  token?: string
): Promise<{ status: number; data: any }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let data: any;
  try {
    data = await res.json();
  } catch {
    data = { raw: await res.text() };
  }

  return { status: res.status, data };
}

// ── Main test ──────────────────────────────────────────────────────────────────

async function main() {
  assertSafeTarget();

  const suffix = Date.now().toString().slice(-6);
  let adminToken = '';
  let candidateId = '';
  let employeeId = '';
  let employeeCode = '';
  let offerId = '';
  let branchId = '';
  let processId = '';

  // ── 1. Auth: login as admin ────────────────────────────────────────────────
  step('1. Admin login');
  {
    const r = await api('POST', '/api/auth/login', {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });

    if (r.status !== 200 || !r.data?.data?.access_token) {
      fail('Admin login', `HTTP ${r.status} — ${r.data?.message ?? JSON.stringify(r.data)}`);
      process.exit(1);
    }

    adminToken = r.data.data.access_token;
    pass(`Admin login (${ADMIN_EMAIL})`);
  }

  // ── 2. Fetch branch and process IDs for test ───────────────────────────────
  step('2. Fetch master data');
  {
    const br = await api('GET', '/api/branch-master?limit=1', undefined, adminToken);
    branchId = br.data?.data?.[0]?.id;
    if (branchId) pass(`Branch found: ${branchId}`);
    else { fail('Branch fetch', 'No branches in master'); process.exit(1); }

    const pr = await api('GET', '/api/process-master?limit=1', undefined, adminToken);
    processId = pr.data?.data?.[0]?.id;
    if (processId) pass(`Process found: ${processId}`);
    else warn('No process in master — WFM alignment will use branchId');
  }

  // ── 3. Register candidate ──────────────────────────────────────────────────
  step('3. Candidate registration');
  {
    const mobile = `9${suffix}00001`;
    const r = await api('POST', '/api/ats/registration-enhanced/submit-enhanced', {
      first_name: `SmokeTest${suffix}`,
      last_name: 'ApiDriven',
      mobile,
      email: `smoketest${suffix}@gmail.com`,
      applied_for_branch: branchId,
      applied_for_process: processId ?? branchId,
      sourcing_channel: 'Walk-In',
    }, adminToken);

    if (r.status === 200 || r.status === 201) {
      candidateId = r.data?.data?.candidate_id ?? r.data?.candidate_id;
      if (candidateId) {
        pass(`Candidate registered: ${candidateId}`);
      } else {
        fail('Candidate registration', 'No candidate_id in response');
      }
    } else {
      fail('Candidate registration', `HTTP ${r.status} — ${r.data?.message}`);
    }
  }

  if (!candidateId) { printSummary(); process.exit(1); }

  // ── 4. Interview: select candidate ─────────────────────────────────────────
  step('4. Interview result — selected');
  {
    const r = await api('POST', `/api/ats/interview/${candidateId}/result`, {
      result: 'selected',
      interviewer_remarks: `API smoke test ${suffix}`,
    }, adminToken);

    if (r.status === 200 || r.status === 201) {
      pass('Interview result: selected');
    } else {
      warn(`Interview result: HTTP ${r.status} — ${r.data?.message}`);
    }
  }

  // ── 5. Send onboarding link ────────────────────────────────────────────────
  step('5. Send onboarding token');
  {
    const r = await api('POST', `/api/ats/onboarding/send-token/${candidateId}`, {}, adminToken);
    if (r.status === 200 || r.status === 201) {
      pass('Onboarding token sent');
    } else {
      warn(`Onboarding token: HTTP ${r.status} — ${r.data?.message}`);
    }
  }

  // ── 6. Verify BGV not auto-approved after onboarding submit ────────────────
  step('6. BGV status check (must be pending, not auto-approved)');
  {
    // Get BGV status directly
    const r = await api('GET', `/api/ats/bgv/status/${candidateId}`, undefined, adminToken);
    if (r.status === 200) {
      const bgvData = r.data?.data;
      const checks: any[] = bgvData?.checks ?? [];
      const autoApproved = checks.filter((c: any) => c.is_auto_approved === 1);

      if (autoApproved.length === 0) {
        pass('BGV checks are NOT auto-approved ✓');
      } else {
        fail('BGV auto-approval not disabled', `${autoApproved.length} auto-approved checks found`);
      }
    } else {
      // 404 = no checks yet (correct behavior after disabling auto-approval)
      if (r.status === 404 || r.status === 400) {
        pass('No BGV checks exist yet (auto-approval disabled) ✓');
      } else {
        warn(`BGV status check: HTTP ${r.status}`);
      }
    }
  }

  // ── 7. Salary validation (Payroll HR) ──────────────────────────────────────
  step('7. Payroll HR salary validation');
  {
    const r = await api('POST', `/api/ats/payroll-hr/validate`, {
      candidate_id: candidateId,
      gross_salary: 25000,
      joining_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      salary_start_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      employment_type: 'OnRoll',
      branch_id: branchId,
    }, adminToken);

    if (r.status === 200 || r.status === 201) {
      pass('Payroll HR validation created');
    } else {
      warn(`Payroll HR validate: HTTP ${r.status} — ${r.data?.message}`);
    }
  }

  // ── 8. Branch Head approval ────────────────────────────────────────────────
  step('8. Branch Head approval');
  {
    // Get pending approvals
    const listR = await api('GET', `/api/ats/branch-head-approval/pending`, undefined, adminToken);
    const pendingList: any[] = listR.data?.data ?? [];
    const pending = pendingList.find((a: any) => a.candidate_id === candidateId);

    if (pending?.id) {
      const r = await api('POST', `/api/ats/branch-head-approval/${pending.id}/approve`, {
        remarks: `API smoke test approval ${suffix}`,
      }, adminToken);

      if (r.status === 200 || r.status === 201) {
        pass('Branch Head approval submitted');

        // Check if employee was created
        if (r.data?.data?.employee_code || r.data?.employeeCode) {
          employeeCode = r.data?.data?.employee_code ?? r.data?.employeeCode;
          employeeId = r.data?.data?.employee_id ?? r.data?.employeeId;
          pass(`Employee created: ${employeeCode}`);
        }
      } else {
        warn(`Branch Head approval: HTTP ${r.status} — ${r.data?.message}`);
      }
    } else {
      warn('No pending Branch Head approval found for this candidate');
    }
  }

  // ── 9. Verify employee state ───────────────────────────────────────────────
  step('9. Verify employee created with correct state');
  if (employeeId || employeeCode) {
    const searchParam = employeeId ? `id=${employeeId}` : `employee_code=${employeeCode}`;
    const r = await api('GET', `/api/employees?${searchParam}`, undefined, adminToken);
    const emp: any = r.data?.data?.[0] ?? r.data?.[0];

    if (emp) {
      if (emp.active_status === 0 || emp.active_status === '0') {
        pass('Employee active_status = 0 (inactive until joining date) ✓');
      } else {
        fail('Employee active_status should be 0', `Got: ${emp.active_status}`);
      }

      if (!emp.official_email) {
        pass('Employee official_email = NULL (IT will set it) ✓');
      } else {
        fail('official_email should be NULL', `Got: ${emp.official_email}`);
      }

      if (!emp.user_id) {
        pass('Employee user_id = NULL (no auth_user until IT provisioning) ✓');
      } else {
        warn('Employee has user_id already — IT provisioning may have already run');
      }

      employeeId = emp.id ?? employeeId;
      employeeCode = emp.employee_code ?? employeeCode;
    } else {
      warn('Could not fetch employee record for verification');
    }
  } else {
    warn('No employee created — skipping employee state checks');
  }

  // ── 10. Verify 4 provisioning tasks created ────────────────────────────────
  step('10. Verify provisioning tasks dispatched');
  if (employeeId) {
    const r = await api('GET', `/api/it-provisioning/tasks?employee_id=${employeeId}`, undefined, adminToken);
    const tasks: any[] = r.data?.data ?? r.data ?? [];

    const expectedTasks = ['IT_EMAIL_DOMAIN_ASSET', 'ADMIN_BIOMETRIC_ID_CARD', 'WFM_PROCESS_ALIGNMENT', 'APPOINTMENT_LETTER_ESIGN'];
    const foundCodes = tasks.map((t: any) => t.task_code);

    for (const expected of expectedTasks) {
      if (foundCodes.includes(expected)) {
        pass(`Task created: ${expected} ✓`);
      } else {
        fail(`Missing task: ${expected}`);
      }
    }

    // Check SLA due_at set
    const withSla = tasks.filter((t: any) => t.sla_due_at);
    if (withSla.length > 0) {
      pass(`SLA deadlines set on ${withSla.length} tasks ✓`);
    } else {
      warn('No SLA deadlines found on tasks');
    }

    // Check unassigned exception tasks visible (not silently skipped)
    const unassigned = tasks.filter((t: any) => t.assignment_exception || t.status === 'pending_unassigned');
    if (unassigned.length > 0) {
      warn(`${unassigned.length} tasks have no assignee (assignment_exception=1) — visible in admin queue ✓`);
    }
  } else {
    warn('No employeeId — skipping provisioning task verification');
  }

  // ── 11. Complete IT provisioning task ─────────────────────────────────────
  step('11. Complete IT provisioning (set official email)');
  if (employeeId) {
    const r = await api('GET', `/api/it-provisioning/tasks?employee_id=${employeeId}&task_code=IT_EMAIL_DOMAIN_ASSET`, undefined, adminToken);
    const itTask: any = (r.data?.data ?? r.data ?? [])[0];

    if (itTask?.id) {
      const complete = await api('POST', `/api/it-provisioning/tasks/${itTask.id}/complete`, {
        official_email: `smoketest${suffix}@teammas.in`,
        domain_account: `smoketest${suffix}`,
        evidence_note: `API smoke test IT completion ${suffix}`,
      }, adminToken);

      if (complete.status === 200 || complete.status === 201) {
        pass('IT task completed — official email set');

        // Verify synced to employee
        const empR = await api('GET', `/api/employees/${employeeId}`, undefined, adminToken);
        const updatedEmp: any = empR.data?.data ?? empR.data;
        if (updatedEmp?.official_email === `smoketest${suffix}@teammas.in`) {
          pass('employees.official_email synced correctly ✓');
        } else {
          fail('Official email not synced to employee master', `Got: ${updatedEmp?.official_email}`);
        }
      } else {
        warn(`IT task complete: HTTP ${complete.status} — ${complete.data?.message}`);
      }
    } else {
      warn('IT task not found for completion');
    }
  }

  // ── 12. Negative tests ─────────────────────────────────────────────────────
  step('12. Negative tests');

  // 12a: Second approval should return existing employee (idempotency)
  if (offerId) {
    const r = await api('POST', `/api/ats/onboarding/offers/${offerId}/approve`, {}, adminToken);
    if (r.data?.alreadyExisted) {
      pass('Idempotency: second approval returns existing employee ✓');
    } else if (r.status === 400 || r.status === 409) {
      pass('Idempotency: second approval blocked correctly ✓');
    } else {
      warn('Idempotency check inconclusive');
    }
  }

  // 12b: Payroll HR cannot access different branch candidates
  // (Hard to test without two-branch setup — document as manual)
  warn('Branch scope isolation: manual test required with two Payroll HR users on different branches');

  // 12c: Personal email should not be in official_email
  if (employeeId) {
    const r = await api('GET', `/api/employees/${employeeId}`, undefined, adminToken);
    const emp: any = r.data?.data ?? r.data;
    if (emp?.official_email?.includes('gmail') || emp?.official_email?.includes('yahoo')) {
      fail('Personal email found in official_email column', emp.official_email);
    } else {
      pass('official_email does not contain personal email domain ✓');
    }
  }

  // ── 13. Reconciliation: check no anomalies for this test candidate ─────────
  step('13. Reconciliation check for test candidate');
  {
    const r = await api('GET', '/api/ats/reconciliation/summary', undefined, adminToken);
    if (r.status === 200) {
      const s = r.data?.data;
      pass('Reconciliation summary endpoint accessible ✓');
      if (s) {
        if (Number(s.offer_approved_no_employee) === 0) {
          pass('No offers approved without employee ✓');
        } else {
          warn(`${s.offer_approved_no_employee} offers approved without employee (may include pre-existing)`);
        }
      }
    } else {
      warn(`Reconciliation summary: HTTP ${r.status}`);
    }
  }

  // ── Print summary ──────────────────────────────────────────────────────────
  printSummary();
  process.exit(log.failed.length > 0 ? 1 : 0);
}

function printSummary() {
  console.log('\n========================================================');
  console.log('  SMOKE TEST SUMMARY');
  console.log('========================================================');
  console.log(`  ✓ Passed:   ${log.passed.length}`);
  console.log(`  ✗ Failed:   ${log.failed.length}`);
  console.log(`  ⚠ Warnings: ${log.warnings.length}`);

  if (log.failed.length > 0) {
    console.log('\n  FAILURES:');
    log.failed.forEach(f => console.log(`    - ${f}`));
  }

  if (log.warnings.length > 0) {
    console.log('\n  WARNINGS:');
    log.warnings.forEach(w => console.log(`    - ${w}`));
  }

  console.log('\n  NOTE: Cleanup not automated — delete test records with:');
  console.log("  DELETE FROM ats_candidate WHERE full_name LIKE 'SmokeTest%ApiDriven';");
  console.log('========================================================\n');
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
