/**
 * fix-master-tables.mjs
 * Systematically cleans & deduplicates department_master, designation_master, process_master
 * in mas_hrms.
 *
 * Rules:
 *  - NEVER deletes rows (FK safety)
 *  - Remaps employee FKs first, THEN deactivates the stale record
 *  - Canonical source = db_bill Department_Master (Status=1)
 *  - Run with: node scripts/fix-master-tables.mjs
 *  - Run with: node scripts/fix-master-tables.mjs --dry-run   (report only, no writes)
 */

import mysql from 'mysql2/promise';

const DRY = process.argv.includes('--dry-run');

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const CFG = {
  host: requiredEnv('DB_HOST'),
  port: Number(process.env.DB_PORT || 3306),
  user: requiredEnv('DB_USER'),
  password: requiredEnv('DB_PASSWORD'),
  database: requiredEnv('DB_NAME'),
};

// ─── helpers ────────────────────────────────────────────────────────────────

function log(...args) { console.log(new Date().toISOString(), ...args); }

async function exec(conn, sql, params = []) {
  if (DRY) { console.log('  [DRY]', sql.slice(0, 120), params); return { affectedRows: 0 }; }
  const [res] = await conn.execute(sql, params);
  return res;
}

async function remapEmployees(conn, table, fkCol, fromId, toId, label) {
  const [[{ cnt }]] = await conn.execute(
    `SELECT COUNT(*) AS cnt FROM employees WHERE ${fkCol} = ?`, [fromId]
  );
  if (cnt === 0) { log(`  skip remap ${label} → 0 employees`); return 0; }
  log(`  remap ${cnt} employees  ${label}  (${fkCol})`);
  const r = await exec(conn,
    `UPDATE employees SET ${fkCol} = ? WHERE ${fkCol} = ?`, [toId, fromId]
  );
  return r.affectedRows ?? cnt;
}

async function deactivate(conn, table, id, reason) {
  log(`  deactivate ${table} id=${id}  — ${reason}`);
  await exec(conn, `UPDATE ${table} SET active_status = 0 WHERE id = ?`, [id]);
}

async function setName(conn, table, id, newName, col = 'dept_name') {
  log(`  rename ${table} id=${id}  → "${newName}"`);
  await exec(conn, `UPDATE ${table} SET ${col} = ? WHERE id = ?`, [newName, id]);
}

async function setActive(conn, table, id, name) {
  log(`  activate ${table} id=${id}  "${name}"`);
  await exec(conn, `UPDATE ${table} SET active_status = 1 WHERE id = ?`, [id]);
}

// ─── fetch helpers ───────────────────────────────────────────────────────────

async function deptMap(conn) {
  const [rows] = await conn.execute(
    'SELECT id, dept_code, dept_name, active_status FROM department_master'
  );
  const byCode = {}, byName = {}, all = rows;
  for (const r of rows) {
    byCode[r.dept_code] = r;
    byName[r.dept_name?.toUpperCase()] = byName[r.dept_name?.toUpperCase()] ?? [];
    byName[r.dept_name?.toUpperCase()].push(r);
  }
  return { byCode, byName, all };
}

async function desigMap(conn) {
  const [rows] = await conn.execute(
    'SELECT id, designation_code, designation_name, grade, active_status FROM designation_master'
  );
  const byCode = {};
  for (const r of rows) byCode[r.designation_code] = r;
  return { byCode, all: rows };
}

async function procMap(conn) {
  const [rows] = await conn.execute(
    'SELECT id, process_code, process_name, active_status FROM process_master'
  );
  const byCode = {};
  for (const r of rows) byCode[r.process_code] = r;
  return { byCode, all: rows };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. DEPARTMENT MASTER
// ═══════════════════════════════════════════════════════════════════════════

async function fixDepartments(conn) {
  log('\n════ DEPARTMENT MASTER ════');
  const { byCode } = await deptMap(conn);

  // Canonical 10 from db_bill Department_Master (Status=1):
  // code → canonical HRMS dept_code
  const canonical = [
    'ADMIN', 'DIALER', 'FINANCE', 'HR', 'IT', 'MGT',
    'OPERATIONS', 'COMPLIANCE', 'SALES', 'TRAINING',
  ];

  // ── Ensure all 10 canonical are active ──────────────────────────────────
  for (const code of canonical) {
    const r = byCode[code];
    if (!r) { log(`  WARN: canonical code "${code}" not found in HRMS!`); continue; }
    if (!r.active_status) await setActive(conn, 'department_master', r.id, r.dept_name);
  }

  // ── Fix: "SALES & MARKETING" canonical code is SALES ───────────────────
  const salesCanon   = byCode['SALES'];
  const salesStale   = byCode['SALES__MARKETING'];   // inactive, 177 emps
  if (salesStale && salesCanon) {
    await remapEmployees(conn, 'department_master', 'department_id', salesStale.id, salesCanon.id,
      '"SALES & MARKETING" stale → canonical');
    await deactivate(conn, 'department_master', salesStale.id, 'duplicate of SALES');
  }

  // ── Fix: MANAGEMENT duplicate ───────────────────────────────────────────
  const mgtCanon  = byCode['MGT'];
  const mgtStale  = byCode['MANAGEMENT'];
  if (mgtStale && mgtCanon && mgtStale.id !== mgtCanon.id) {
    await remapEmployees(conn, 'department_master', 'department_id', mgtStale.id, mgtCanon.id,
      '"MANAGEMENT" stale → canonical MGT');
    await deactivate(conn, 'department_master', mgtStale.id, 'duplicate of MGT');
  }

  // ── Fix: INFORMATION TECHNOLOGY duplicate ───────────────────────────────
  const itCanon  = byCode['IT'];
  const itStale  = byCode['INFORMATION_TECHNOLOGY'];
  if (itStale && itCanon) {
    await remapEmployees(conn, 'department_master', 'department_id', itStale.id, itCanon.id,
      '"INFORMATION TECHNOLOGY" stale → canonical IT');
    await deactivate(conn, 'department_master', itStale.id, 'duplicate of IT');
  }

  // ── Fix: HUMAN RESOURCE AND DEVELOPMENT duplicate ───────────────────────
  const hrCanon  = byCode['HR'];
  const hrStale  = byCode['HUMAN_RESOURCE_AND_DEVELOPMENT'];
  if (hrStale && hrCanon) {
    await remapEmployees(conn, 'department_master', 'department_id', hrStale.id, hrCanon.id,
      '"HRD" stale → canonical HR');
    await deactivate(conn, 'department_master', hrStale.id, 'duplicate of HR');
  }

  // ── Remap non-canonical depts with employees ─────────────────────────────
  const remaps = [
    // [stale_code, canonical_code, reason]
    ['ADMINHR',            'ADMIN',      'ADMIN/HR → ADMINISTRATION'],
    ['HUMAN_RESOURCE',     'HR',         'HUMAN RESOURCE → HRD'],
    ['HUMAR_RESOURCE',     'HR',         'typo HUMAR → HRD'],
    ['MARKETING',          'SALES',      'MARKETING → SALES & MARKETING'],
    ['FINANCEACCOUNTS',    'FINANCE',    'FINANCE/ACCOUNTS → FINANCE & ACCOUNTS'],
    ['CALL_CENTER',        'OPERATIONS', 'CALL CENTER → OPERATIONS'],
    ['FACILITIES',         'ADMIN',      'FACILITIES → ADMINISTRATION'],
    ['FIELD_RETENTION',    'OPERATIONS', 'FIELD RETENTION → OPERATIONS'],
    ['ITSYSTEM',           'IT',         'IT/SYSTEM → IT'],
    ['MIS',                'IT',         'MIS → IT'],
    ['QUALITIES',          'TRAINING',   'QUALITIES (typo) → TRAINING AND QUALITY'],
    ['QUALITY',            'TRAINING',   'Quality Assurance → TRAINING AND QUALITY'],
    ['ADMINISTRATION_FINANCE__ACCOUNTS', 'FINANCE', 'Hybrid dept → FINANCE'],
    ['BACKOFICE_DEO',      'OPERATIONS', 'Back Office DEO → OPERATIONS'],
    ['OPS',                'OPERATIONS', 'Operations legacy → OPERATIONS'],
    ['TECH',               'IT',         'Technology → IT'],
  ];

  for (const [staleCode, canonCode, reason] of remaps) {
    const stale = byCode[staleCode];
    const canon = byCode[canonCode];
    if (!stale || !canon) continue;
    if (stale.id === canon.id) continue;
    await remapEmployees(conn, 'department_master', 'department_id', stale.id, canon.id, reason);
    await deactivate(conn, 'department_master', stale.id, reason);
  }

  // ── Handle truly junk entries (phone numbers as dept names) ─────────────
  for (const junkCode of ['5000', '8059435856', 'CREDIT_MANAGEMENT']) {
    const r = byCode[junkCode];
    if (!r) continue;
    const ops = byCode['OPERATIONS'];
    if (ops) await remapEmployees(conn, 'department_master', 'department_id', r.id, ops.id,
      `junk "${r.dept_name}" → OPERATIONS`);
    await deactivate(conn, 'department_master', r.id, 'junk / invalid entry');
  }

  // ── Fix dept names to match db_bill canonical names ─────────────────────
  const nameCorrections = [
    ['QUALITY',     'dept_name', 'TRAINING AND QUALITY',   'Quality Assurance → canonical name'],
    ['OPERATIONS',  'dept_name', 'OPERATIONS',             'already correct'],
    ['MGT',         'dept_name', 'MANAGEMENT',             'MGT canonical name is MANAGEMENT'],
  ];
  const { byCode: freshDeptByCode } = await deptMap(conn);
  for (const [code, col, newName, reason] of nameCorrections) {
    const r = freshDeptByCode[code];
    if (!r || r.dept_name === newName) continue;
    log(`  rename dept "${r.dept_name}" → "${newName}"  (${reason})`);
    await exec(conn, `UPDATE department_master SET ${col} = ? WHERE id = ?`, [newName, r.id]);
  }

  log('  ✓ Departments done');
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. DESIGNATION MASTER
// ═══════════════════════════════════════════════════════════════════════════

async function fixDesignations(conn) {
  log('\n════ DESIGNATION MASTER ════');
  const { byCode } = await desigMap(conn);

  // Merge pattern: [stale_code, canonical_code, reason]
  const merges = [
    // DY. MANAGER duplicates → keep DY__MANAGER (has grade K)
    ['DY_MANAGER',              'DY__MANAGER',            'DY. MANAGER variant'],

    // SR. EXECUTIVE duplicates → keep SR__EXECUTIVE (has grade I)
    ['SREXECUTIVE',             'SR__EXECUTIVE',          'SR.EXECUTIVE → SR. EXECUTIVE'],
    ['SR__EXECUTIVE__ADMIN',    'EXECUTIVE__ADMIN',       'SR . EXECUTIVE - ADMIN → EXECUTIVE - ADMIN'],

    // SR. MANAGER duplicates → keep SR__MANAGER (has grade K)
    ['SRMANAGER',               'SR__MANAGER',            'SR.MANAGER → SR. MANAGER'],

    // ASST. MANAGER variants → ASSISTANT MANAGER
    ['ASST_MANAGER',            'ASSISTANT_MANAGER',      'ASST. MANAGER → ASSISTANT MANAGER'],
    ['ASST_MANAGER_OPERATION',  'ASSISTANT_MANAGER',      'ASST. MANAGER OPERATION → ASSISTANT MANAGER'],
    ['ASSTMGR',                 'ASSISTANT_MANAGER',      'ASST.MGR. → ASSISTANT MANAGER'],

    // MANAGER OPERATION → OPERATION MANAGER
    ['MANAGER_OPERATION',       'OPERATION_MANAGER',      'MANAGER OPERATION → OPERATION MANAGER'],

    // CEO / Chief Executive → CHIEF_EXECUTIVE_OFFICER
    ['CEO',                     'CHIEF_EXECUTIVE_OFFICER','Chief Executive Officer → CHIEF EXECUTIVE OFFICER'],

    // VP / VICE PRESIDENT duplicates
    ['VP',                      'VICE_PRESIDENT',         'V.P. → VICE PRESIDENT'],

    // Team Leader (mixed case alias) → TEAM_LEADER
    ['TEAM_LEAD',               'TEAM_LEADER',            'Team Leader alias → TEAM LEADER'],

    // EXECUTIVE - VOICE (lowercase alias from Onsite) → EXECUTIVE__VOICE
    // "Executive - Onsite" (only 8 emps) → EXECUTIVE__ON_SITE
    // (these already have their own codes - just the sr.executive admin cleanup above)

    // SR.EXECUTIVE variants
    ['SREXECUTIVE__BACKEND',    'SR_EXECUTIVE__IT',       'SR.EXECUTIVE - BACKEND (small count) → SR. EXECUTIVE - IT'],

    // Junk designation: phone number
    ['9034288892',              'EXECUTIVE',              'junk phone-number desig → EXECUTIVE'],

    // Unused seeds
    ['OPERATIONS',              'OPERATION_MANAGER',      'OPERATIONS (generic) → OPERATION MANAGER'],
  ];

  for (const [staleCode, canonCode, reason] of merges) {
    const stale = byCode[staleCode];
    const canon = byCode[canonCode];
    if (!stale || !canon) { log(`  skip (not found): ${staleCode} or ${canonCode}`); continue; }
    if (stale.id === canon.id) continue;
    await remapEmployees(conn, 'designation_master', 'designation_id', stale.id, canon.id, reason);
    await deactivate(conn, 'designation_master', stale.id, reason);
  }

  // ── Fix grade for EXECUTIVE - VOICE (most important designation, 23K emps) ──
  const execVoice = byCode['EXECUTIVE__VOICE'];
  if (execVoice && !execVoice.grade) {
    log('  set grade G on EXECUTIVE - VOICE');
    await exec(conn, `UPDATE designation_master SET grade = 'G' WHERE id = ?`, [execVoice.id]);
  }

  // ── Fix grade for CCE (6816 emps, same level as EXECUTIVE) ──
  const cce = byCode['CCE'];
  if (cce && !cce.grade) {
    log('  set grade G on CCE');
    await exec(conn, `UPDATE designation_master SET grade = 'G' WHERE id = ?`, [cce.id]);
  }

  log('  ✓ Designations done');
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. PROCESS MASTER
// ═══════════════════════════════════════════════════════════════════════════

async function fixProcesses(conn) {
  log('\n════ PROCESS MASTER ════');
  const { byCode } = await procMap(conn);

  // Merge: [stale_code, canonical_code, reason]
  // Rule: keep the record with more employees / better code
  const merges = [
    // BACK OFFIC (typo) → BACK OFFICE
    ['BACK_OFFIC',                  'BACK_OFFICE',                     'BACK OFFIC typo → BACK OFFICE'],

    // BSS-OTHERS: BSSOTHERS (179) more than BSS_OTHERS (16) → consolidate to BSSOTHERS
    ['BSS_OTHERS',                  'BSSOTHERS',                       'BSS-OTHERS duplicate → BSSOTHERS'],

    // C-SAT: CSAT (138) vs C_SAT (34)
    ['C_SAT',                       'CSAT',                            'C-SAT duplicate'],

    // CMG-OTHERS: CMG_OTHERS (358) vs CMG__OTHERS (169)
    ['CMG__OTHERS',                 'CMG_OTHERS',                      'CMG-OTHERS duplicate'],

    // CS-OTHERS: CS_OTHERS (733) vs CSOTHERS (580)
    ['CSOTHERS',                    'CS_OTHERS',                       'CS-OTHERS duplicate (keep CS_OTHERS)'],

    // FINANCE-CORPORATE (1) + FINANCECORPORATE (0) → consolidate
    ['FINANCECORPORATE',            'FINANCE_CORPORATE',               'FINANCE-CORPORATE duplicate'],

    // HR-CORPORATE
    ['HRCORPORATE',                 'HR_CORPORATE',                    'HR-CORPORATE duplicate'],

    // MANAGEMENT-CORPORATE
    ['MANAGEMENTCORPORATE',         'MANAGEMENT_CORPORATE',            'MANAGEMENT-CORPORATE duplicate'],

    // NEW ACQUISITION & ADD ON
    ['NEW_ACQUISITION___ADD_ON',    'NEW_ACQUISITION__ADD_ON',         'NEW ACQUISITION duplicate'],

    // PREPAID RETENTION: PREPAID_RETENTION__UPSELLING (2377) > PREPAID_RETENTION___UPSELLING (504)
    ['PREPAID_RETENTION___UPSELLING', 'PREPAID_RETENTION__UPSELLING',  'PREPAID RETENTION duplicate'],

    // PRO-ACTIVE CHURN: PROACTIVE_CHURN_MANAGEMENT (100) > PRO_ACTIVE_CHURN_MANAGEMENT (1)
    ['PRO_ACTIVE_CHURN_MANAGEMENT', 'PROACTIVE_CHURN_MANAGEMENT',      'PRO-ACTIVE CHURN duplicate'],

    // S & M -OTHERS: S__M_OTHERS (146) > S___M__OTHERS (6)
    ['S___M__OTHERS',               'S__M_OTHERS',                     'S&M -OTHERS duplicate'],

    // SALES & MARKETING: SALES__MARKETING (5780) > SALES___MARKETING (9)
    ['SALES___MARKETING',           'SALES__MARKETING',                'SALES & MARKETING process duplicate'],

    // SOFT COLLECTION & RETENTION: SOFT_COLLECTION__RETENTION (825) > SOFT_COLLECTION___RETENTION (310)
    ['SOFT_COLLECTION___RETENTION', 'SOFT_COLLECTION__RETENTION',      'SOFT COLLECTION & RETENTION duplicate'],

    // SOFT COLLECTION RETENTION (no &) (20 emps) → SOFT_COLLECTION__RETENTION
    ['SOFT_COLLECTION_RETENTION',   'SOFT_COLLECTION__RETENTION',      'SOFT COLLECTION RETENTION (no &) → canonical'],

    // UPSELLING & CROSSELLING: UPSELLING___CROSSELLING (1089) > UPSELLING__CROSSELLING (591)
    ['UPSELLING__CROSSELLING',      'UPSELLING___CROSSELLING',         'UPSELLING duplicate'],

    // DIAL DESK (space) → DIALDESK (no space)
    ['DIAL_DESK',                   'DIALDESK',                        'DIAL DESK variant → DIALDESK'],

    // HUMAN_RESOURCES (inactive, 2 emps) → HR-CORPORATE process
    ['HUMAN_RESOURCES',             'HR_CORPORATE',                    'Human Resources → HR-CORPORATE'],

    // QUALITY (old, 1 emp) → QUALITY_MGT
    ['QUALITY',                     'QUALITY_MGT',                     'Quality process duplicate'],

    // "0" process — 1928 employees with no proper process; remap to ONBOARDING (historical)
    // Actually remap to MANPOWER_OUTSOURCING which is the closest for unclassified
    // or better to BACK_OFFICE since they're likely internal
    // Decision: rename "0" to "UNCLASSIFIED" and keep active for historical employees
    // — handled separately below

    // Background_verification (0 emps) → deactivate
    // 8059435856 junk → BACK_OFFICE
    ['8059435856',                  'BACK_OFFICE',                     'junk phone-number process → BACK OFFICE'],
  ];

  for (const [staleCode, canonCode, reason] of merges) {
    const stale = byCode[staleCode];
    const canon = byCode[canonCode];
    if (!stale || !canon) { log(`  skip (not found): ${staleCode} or ${canonCode}`); continue; }
    if (stale.id === canon.id) continue;
    await remapEmployees(conn, 'process_master', 'process_id', stale.id, canon.id, reason);
    await deactivate(conn, 'process_master', stale.id, reason);
  }

  // ── Special: rename "0" to "UNCLASSIFIED" and keep it ───────────────────
  const zeroProc = byCode['0'];
  if (zeroProc) {
    log(`  rename process "0" → "UNCLASSIFIED" (has 1928 employees — legacy corporate staff)`);
    await exec(conn,
      `UPDATE process_master SET process_name = 'UNCLASSIFIED', process_code = 'UNCLASSIFIED' WHERE id = ?`,
      [zeroProc.id]
    );
  }

  // ── Deactivate zero-employee junk / fully retired processes ─────────────
  const toDeactivate = [
    'BACKGROUND_VERIFICATION', 'FINANCECORPORATE', 'HRCORPORATE', 'MANAGEMENTCORPORATE',
    'NEW_ACQUISITION___ADD_ON', 'QUALITY_MGT', 'HUMAN_RESOURCES',
    'HR_OPS', 'GEN_OPS',
  ];
  for (const code of toDeactivate) {
    const r = byCode[code];
    if (!r || !r.active_status) continue;
    const [[{ cnt }]] = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM employees WHERE process_id = ?`, [r.id]
    );
    if (cnt > 0) { log(`  skip deactivate ${code}: still has ${cnt} employees`); continue; }
    await deactivate(conn, 'process_master', r.id, 'zero employees, retired process');
  }

  // ── Re-activate any process still carrying employees (historical data) ───
  // After merges, whatever process still has employees must be accessible in UI
  log('  Activating processes that have employees and were previously inactive...');
  const [{ byCode: freshByCode }] = [await procMap(conn)];
  const [allProcs] = await conn.execute(
    `SELECT pm.id, pm.process_code, pm.process_name, pm.active_status, COUNT(e.id) AS emp_count
     FROM process_master pm
     LEFT JOIN employees e ON e.process_id = pm.id
     WHERE pm.active_status = 0
     GROUP BY pm.id HAVING emp_count > 0`
  );
  let reactivated = 0;
  for (const p of allProcs) {
    log(`  reactivate "${p.process_name}" (${p.emp_count} emps)`);
    await exec(conn, `UPDATE process_master SET active_status = 1 WHERE id = ?`, [p.id]);
    reactivated++;
  }
  log(`  Reactivated ${reactivated} processes with employees.`);

  log('  ✓ Processes done');
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. FINAL REPORT
// ═══════════════════════════════════════════════════════════════════════════

async function report(conn) {
  log('\n════ FINAL VALIDATION REPORT ════');

  // Departments
  const [depts] = await conn.execute(`
    SELECT dm.dept_name, dm.dept_code, dm.active_status, COUNT(e.id) AS emp_count
    FROM department_master dm
    LEFT JOIN employees e ON e.department_id = dm.id
    GROUP BY dm.id
    HAVING emp_count > 0 OR dm.active_status = 1
    ORDER BY dm.active_status DESC, emp_count DESC
  `);
  log('\n--- Active/Used Departments ---');
  for (const r of depts) {
    log(`  [${r.active_status ? 'ACTIVE' : 'inactive'}]  ${r.dept_name.padEnd(40)} (${r.dept_code})  emps: ${r.emp_count}`);
  }

  // Orphaned employees (no department)
  const [[{ orphanDept }]] = await conn.execute(
    `SELECT COUNT(*) AS orphanDept FROM employees WHERE department_id IS NULL`
  );
  log(`\n  Employees with NULL department_id: ${orphanDept}`);

  // Designations with 0 employees but still active
  const [activeUnused] = await conn.execute(`
    SELECT dm.designation_name, dm.designation_code
    FROM designation_master dm
    LEFT JOIN employees e ON e.designation_id = dm.id
    WHERE dm.active_status = 1
    GROUP BY dm.id HAVING COUNT(e.id) = 0
  `);
  log(`\n  Active designations with 0 employees: ${activeUnused.length}`);
  activeUnused.forEach(r => log(`    ${r.designation_code}`));

  // Processes with >100 employees still inactive
  const [bigInactiveProcs] = await conn.execute(`
    SELECT pm.process_name, pm.process_code, pm.active_status, COUNT(e.id) AS emp_count
    FROM process_master pm
    LEFT JOIN employees e ON e.process_id = pm.id
    WHERE pm.active_status = 0
    GROUP BY pm.id HAVING emp_count > 100
    ORDER BY emp_count DESC
  `);
  log(`\n--- Inactive Processes still carrying >100 employees ---`);
  bigInactiveProcs.forEach(r => log(`  [inactive]  ${r.process_name.padEnd(45)} emps: ${r.emp_count}`));

  // Summary counts
  const [[{ deptActive }]] = await conn.execute(`SELECT COUNT(*) AS deptActive FROM department_master WHERE active_status=1`);
  const [[{ desigActive }]] = await conn.execute(`SELECT COUNT(*) AS desigActive FROM designation_master WHERE active_status=1`);
  const [[{ procActive }]] = await conn.execute(`SELECT COUNT(*) AS procActive FROM process_master WHERE active_status=1`);
  const [[{ totalEmps }]] = await conn.execute(`SELECT COUNT(*) AS totalEmps FROM employees`);

  log(`\n════ SUMMARY ════`);
  log(`  Total employees       : ${totalEmps}`);
  log(`  Active departments    : ${deptActive}`);
  log(`  Active designations   : ${desigActive}`);
  log(`  Active processes      : ${procActive}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  if (DRY) log('*** DRY RUN — no writes will happen ***');
  log('Connecting to mas_hrms...');
  const conn = await mysql.createConnection(CFG);
  await conn.execute('SET foreign_key_checks = 0');

  try {
    await fixDepartments(conn);
    await fixDesignations(conn);
    await fixProcesses(conn);
    await report(conn);
    log('\n✅ All done.');
  } finally {
    await conn.execute('SET foreign_key_checks = 1');
    await conn.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
