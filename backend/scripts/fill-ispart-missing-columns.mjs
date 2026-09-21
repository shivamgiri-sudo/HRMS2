/**
 * fill-ispart-missing-columns.mjs
 *
 * Fills every possible column in ISPart_Latest_Migrated_Data_63_Employees (1).xlsx
 * by pulling from ALL relevant mas_hrms tables:
 *   - employee_bank_detail          (post-joining bank details)
 *   - candidate_onboarding_bank_detail (onboarding bank details)
 *   - ats_candidate                 (ATS bank_account_no/bank_ifsc/bank_name)
 *   - employee_address              (structured city/state/pincode)
 *   - candidate_onboarding_profile  (onboarding present+permanent address)
 *   - ats_bgv_response              (BGV address city/state/pincode)
 *   - employee_nominee              (nominee name/relation/dob)
 *   - candidate_onboarding_nominee  (onboarding nominee)
 *
 * Usage:
 *   node backend/scripts/fill-ispart-missing-columns.mjs
 */

import mysql from 'mysql2/promise';
import XLSX from 'xlsx';
import path from 'path';
import os from 'os';

const HRMS = { host:'122.184.128.90', port:3306, user:'shivam_user', password:'qwersdfg!@#hjk', database:'mas_hrms', connectTimeout:15000 };
const DOWNLOADS = path.join(os.homedir(), 'Downloads');

async function query(conn, sql, params=[]) {
  const [rows] = await conn.query(sql, params);
  return rows;
}

function byEmpCode(arr, key='employee_code') {
  const m = {};
  for (const r of arr) m[r[key]] = r;
  return m;
}
function byEmpId(arr, key='employee_id') {
  const m = {};
  for (const r of arr) if (!m[r[key]]) m[r[key]] = r;
  return m;
}

async function main() {
  const srcFile = path.join(DOWNLOADS, 'ISPart_Latest_Migrated_Data_63_Employees (1).xlsx');
  console.log('Reading:', srcFile);
  const wb = XLSX.readFile(srcFile);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  const headers = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' })[0];
  console.log(`  ${rows.length} rows, ${headers.length} columns`);

  const empCodes = [...new Set(rows.map(r=>r['EmpCode']).filter(Boolean))];
  const ph = empCodes.map(()=>'?').join(',');

  console.log('Connecting to mas_hrms...');
  const conn = await mysql.createConnection(HRMS);

  // ── Core employee data ───────────────────────────────────────────────────
  const emps = await query(conn, `
    SELECT e.id AS emp_id, e.employee_code, e.candidate_id,
           e.band, e.source, e.source_type, e.sub_source,
           e.nominee_name, e.nominee_relation,
           e.bank_account_number, e.ifsc_code, e.bank_name, e.bank_branch,
           e.account_holder_name, e.account_type,
           e.epf_number, e.esic_number, e.uan_number,
           e.address1, e.address2, e.address_line1, e.address_line2,
           e.city, e.state, e.pincode,
           e.permanent_city, e.permanent_state, e.permanent_pincode,
           e.official_email, e.office_email,
           e.father_name, e.gender, e.blood_group, e.marital_status,
           e.mobile, e.alternate_mobile, e.personal_email,
           e.pan_number, e.pan_number_masked, e.aadhaar_number,
           e.ctc, e.gross_salary, e.net_inhand,
           e.annual_income, e.count_of_dependents,
           e.billable_status, e.is_billable, e.cost_center_code,
           e.emp_type, e.employment_type, e.employee_category,
           b.branch_name, d.dept_name AS department_name,
           dg.designation_name, p.process_name,
           cc.billing_client_name AS client_name,
           rm.full_name AS rm_name, rm.mobile AS rm_mobile
    FROM employees e
    LEFT JOIN branch_master b   ON b.id  = e.branch_id
    LEFT JOIN department_master d   ON d.id  = e.department_id
    LEFT JOIN designation_master dg ON dg.id = e.designation_id
    LEFT JOIN process_master p   ON p.id  = e.process_id
    LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
    LEFT JOIN employees rm ON rm.id = e.reporting_manager_id
    WHERE e.employee_code IN (${ph})`, empCodes);

  const empByCode = byEmpCode(emps);
  const empIds = emps.map(e=>e.emp_id).filter(Boolean);
  const candidateIds = emps.map(e=>e.candidate_id).filter(Boolean);
  const phId  = empIds.map(()=>'?').join(',');
  const phCid = candidateIds.map(()=>'?').join(',');

  // ── Bank details (employee_bank_detail) ──────────────────────────────────
  const bankRows = empIds.length ? await query(conn, `
    SELECT employee_id, bank_name, account_holder_name, bank_branch,
           account_number, ifsc_code, account_type,
           verified, is_primary
    FROM employee_bank_detail
    WHERE employee_id IN (${phId}) AND active_status=1
    ORDER BY is_primary DESC, verified DESC`, empIds) : [];
  const bankByEmpId = byEmpId(bankRows);

  // ── Bank details (candidate_onboarding_bank_detail) ──────────────────────
  const obBankRows = candidateIds.length ? await query(conn, `
    SELECT candidate_id, bank_name, branch_name, account_holder_name,
           account_no_masked, ifsc_code, account_type, name_on_cheque
    FROM candidate_onboarding_bank_detail
    WHERE candidate_id IN (${phCid})
    ORDER BY id DESC`, candidateIds) : [];
  const obBankByCandId = byEmpId(obBankRows, 'candidate_id');

  // ── ATS candidate bank data ───────────────────────────────────────────────
  const atsBankRows = candidateIds.length ? await query(conn, `
    SELECT id AS candidate_id, bank_account_no_masked, bank_ifsc, bank_name
    FROM ats_candidate
    WHERE id IN (${phCid})`, candidateIds) : [];
  const atsBankByCandId = byEmpId(atsBankRows, 'candidate_id');

  // ── Address (employee_address) ────────────────────────────────────────────
  const addrRows = empIds.length ? await query(conn, `
    SELECT employee_id, address_type, address_line1, address_line2,
           city, state, pincode
    FROM employee_address
    WHERE employee_id IN (${phId})`, empIds) : [];
  const currentAddrByEmpId = {}, permAddrByEmpId = {};
  for (const r of addrRows) {
    if ((r.address_type||'').toLowerCase().includes('current')) currentAddrByEmpId[r.employee_id] = r;
    if ((r.address_type||'').toLowerCase().includes('permanent')) permAddrByEmpId[r.employee_id] = r;
  }

  // ── Address (candidate_onboarding_profile) ────────────────────────────────
  const obProfileRows = candidateIds.length ? await query(conn, `
    SELECT candidate_id,
           present_city, present_state, present_pincode,
           present_address_line1, present_address_line2,
           permanent_city, permanent_state, permanent_pincode,
           permanent_address_line1, permanent_address_line2,
           nominee_name, nominee_relation, nominee_date_of_birth,
           nominee2_name, nominee2_relation
    FROM candidate_onboarding_profile
    WHERE candidate_id IN (${phCid})`, candidateIds) : [];
  const obProfileByCandId = byEmpId(obProfileRows, 'candidate_id');

  // ── Address (ats_bgv_response) ─────────────────────────────────────────────
  const bgvRows = candidateIds.length ? await query(conn, `
    SELECT candidate_id, current_city, current_state, current_pincode,
           permanent_city, permanent_state, permanent_pincode
    FROM ats_bgv_response
    WHERE candidate_id IN (${phCid})
    ORDER BY id DESC`, candidateIds) : [];
  const bgvByCandId = byEmpId(bgvRows, 'candidate_id');

  // ── Nominee (employee_nominee) ────────────────────────────────────────────
  const nomRows = empIds.length ? await query(conn, `
    SELECT employee_id, nominee_name, relationship AS nominee_relation,
           date_of_birth AS nominee_dob
    FROM employee_nominee
    WHERE employee_id IN (${phId})
    ORDER BY share_percentage DESC, id ASC`, empIds) : [];
  const nomByEmpId = byEmpId(nomRows);

  // ── Nominee (candidate_onboarding_nominee) ────────────────────────────────
  const obNomRows = candidateIds.length ? await query(conn, `
    SELECT candidate_id, nominee_name, relation AS nominee_relation, dob AS nominee_dob
    FROM candidate_onboarding_nominee
    WHERE candidate_id IN (${phCid}) AND is_primary=1`, candidateIds) : [];
  const obNomByCandId = byEmpId(obNomRows, 'candidate_id');

  // ── Salary ────────────────────────────────────────────────────────────────
  const salRows = empIds.length ? await query(conn, `
    SELECT s.employee_id,
           s.basic, s.hra, s.conveyance, s.bonus, s.portfolio,
           s.medical_allowance, s.lta, s.other_allowance, s.pli,
           s.special_allowance, s.gross, s.ctc, s.net_estimate,
           s.pf_employee, s.esic_employee, s.employer_pf, s.employer_esi,
           s.pf_applicable, s.esi_applicable, s.salary_slab
    FROM salary_component_assignments s
    INNER JOIN (
      SELECT employee_id, MAX(effective_date) AS md
      FROM salary_component_assignments
      WHERE status='active' AND employee_id IN (${phId})
      GROUP BY employee_id
    ) lat ON lat.employee_id=s.employee_id AND s.effective_date=lat.md
    WHERE s.status='active'`, empIds) : [];
  const salByEmpId = byEmpId(salRows);

  // ── Education ─────────────────────────────────────────────────────────────
  const eduRows = empIds.length ? await query(conn, `
    SELECT e2.employee_id, e2.qualification, e2.specialization_course_name,
           e2.passed_out_year, e2.passed_out_state, e2.passed_out_city,
           e2.passed_out_percentage
    FROM employee_education e2
    INNER JOIN (
      SELECT employee_id, MAX(passed_out_year) AS my
      FROM employee_education WHERE employee_id IN (${phId})
      GROUP BY employee_id
    ) lat ON lat.employee_id=e2.employee_id AND e2.passed_out_year=lat.my`, empIds) : [];
  const eduByEmpId = byEmpId(eduRows);

  await conn.end();
  console.log('Data fetched. Building output...');

  // Helper: first non-empty value
  const first = (...vals) => vals.find(v => v !== null && v !== undefined && String(v).trim() !== '') ?? '';

  const filled = rows.map(row => {
    const code = row['EmpCode'];
    const e    = empByCode[code] || {};
    const eid  = e.emp_id || '';
    const cid  = e.candidate_id || '';

    const bank   = bankByEmpId[eid]        || {};
    const obBank = obBankByCandId[cid]      || {};
    const atsBank= atsBankByCandId[cid]     || {};

    const curAddr= currentAddrByEmpId[eid]  || {};
    const perAddr= permAddrByEmpId[eid]     || {};
    const obProf = obProfileByCandId[cid]   || {};
    const bgv    = bgvByCandId[cid]         || {};

    const nom    = nomByEmpId[eid]          || {};
    const obNom  = obNomByCandId[cid]       || {};

    const sal    = salByEmpId[eid]          || null;
    const edu    = eduByEmpId[eid]          || null;

    // Bank: employee_bank_detail → onboarding → ATS (masked for account no)
    const acNo      = first(bank.account_number, obBank.account_no_masked, atsBank.bank_account_no_masked, e.bank_account_number);
    const ifscCode  = first(bank.ifsc_code, obBank.ifsc_code, atsBank.bank_ifsc, e.ifsc_code);
    const acBank    = first(bank.bank_name, obBank.bank_name, atsBank.bank_name, e.bank_name);
    const acBranch  = first(bank.bank_branch, obBank.branch_name, e.bank_branch);
    const accHolder = first(bank.account_holder_name, obBank.account_holder_name, obBank.name_on_cheque, e.account_holder_name);
    const accType   = first(bank.account_type, obBank.account_type, e.account_type);

    // Address: employee_address → onboarding_profile → BGV → employees flat columns
    const city   = first(curAddr.city,  obProf.present_city,  bgv.current_city,   e.city);
    const state  = first(curAddr.state, obProf.present_state, bgv.current_state,  e.state);
    const pin    = first(curAddr.pincode,obProf.present_pincode,bgv.current_pincode,e.pincode);
    const city1  = first(perAddr.city,  obProf.permanent_city, bgv.permanent_city, e.permanent_city, city);
    const state1 = first(perAddr.state, obProf.permanent_state,bgv.permanent_state,e.permanent_state, state);
    const pin1   = first(perAddr.pincode,obProf.permanent_pincode,bgv.permanent_pincode,e.permanent_pincode, pin);
    const addr1  = first(curAddr.address_line1, obProf.present_address_line1, e.address_line1, e.address1);
    const addr2  = first(curAddr.address_line2, obProf.present_address_line2, e.address_line2, e.address2);

    // Nominee
    const nomName = first(nom.nominee_name, obNom.nominee_name, obProf.nominee_name, e.nominee_name);
    const nomRel  = first(nom.nominee_relation, obNom.nominee_relation, obProf.nominee_relation, e.nominee_relation);
    const nomDob  = first(nom.nominee_dob,  obNom.nominee_dob, obProf.nominee_date_of_birth);

    // PF / ESI flags
    const pfElig  = sal ? (sal.pf_applicable  ? 'YES' : 'NO') : (e.epf_number  ? 'YES' : 'NO');
    const esiElig = sal ? (sal.esi_applicable ? 'YES' : 'NO') : (e.esic_number ? 'YES' : 'NO');

    const rawType = ((e.emp_type || e.employment_type) || '').trim().toUpperCase();
    const empType = rawType.includes('MGMT') ? 'MGMT. TRAINEE'
      : rawType.includes('OFF') ? 'OFFROLL' : 'ONROLL';

    return {
      ...row,
      EmpType:      empType || row['EmpType'],
      BranchName:   first(e.branch_name,      row['BranchName']),
      Dept:         first(e.department_name,  row['Dept']),
      Desgination:  first(e.designation_name, row['Desgination']),
      Process:      first(e.process_name,     row['Process']),
      ClientName:   first(e.client_name,      row['ClientName']),
      CostCenter:   first(e.cost_center_code, row['CostCenter']),
      Band:         first(e.band,             row['Band']),
      Source:       first(e.source,           row['Source']),
      SourceType:   first(e.source_type, e.sub_source, row['SourceType']),

      // Personal
      Father:        first(e.father_name,    row['Father']),
      Gendar:        first((e.gender||'').toUpperCase(), row['Gendar']),
      BloodGruop:    first(e.blood_group,    row['BloodGruop']),
      MaritalStatus: first(e.marital_status, row['MaritalStatus']),
      NomineeName:   first(nomName,          row['NomineeName']),
      NomineeRelation: first(nomRel,         row['NomineeRelation']),
      NomineeDob:    nomDob                || row['NomineeDob'],
      Family_Annual_Income:  e.annual_income     ?? row['Family_Annual_Income'],
      Count_Of_Dependents:   e.count_of_dependents ?? row['Count_Of_Dependents'],

      // Contact / address
      Mobile:       first(e.mobile,          row['Mobile']),
      Mobile1:      first(e.alternate_mobile, e.mobile, row['Mobile1']),
      EmailId:      first(e.personal_email,  row['EmailId']),
      OfficeEmailId:first(e.official_email, e.office_email, row['OfficeEmailId']),
      Adrress1:     first(addr1,             row['Adrress1']),
      Adrress2:     first(addr2,             row['Adrress2']),
      City:         first(city,              row['City']),
      City1:        first(city1,             row['City1']),
      State:        first(state,             row['State']),
      State1:       first(state1,            row['State1']),
      PinCode:      first(pin,               row['PinCode']),
      PinCode1:     first(pin1,              row['PinCode1']),

      // IDs
      PanNo:        first(e.pan_number_masked, e.pan_number, row['PanNo']),
      AdharId:      first(e.aadhaar_number,  row['AdharId']),
      UAN:          first(e.uan_number,      row['UAN']),
      EPFNo:        first(e.epf_number,      row['EPFNo']),
      NewEpfNo:     first(e.epf_number,      row['NewEpfNo']),
      ESICNo:       first(e.esic_number,     row['ESICNo']),
      pfelig:       pfElig,
      esielig:      esiElig,

      // Bank — all 6 fields
      AcNo:         first(acNo,      row['AcNo']),
      IFSCCode:     first(ifscCode,  row['IFSCCode']),
      AcBank:       first(acBank,    row['AcBank']),
      AcBranch:     first(acBranch,  row['AcBranch']),
      AccHolder:    first(accHolder, row['AccHolder']),
      AccType:      first(accType,   row['AccType']),
      AcValidationStatus: first(acNo ? 'Yes' : '', row['AcValidationStatus']),
      AccountFlag:  first(acNo ? '2' : '',        row['AccountFlag']),

      // Salary
      bs:      first(sal?.basic,            row['bs']),
      hra:     first(sal?.hra,              row['hra']),
      conv:    first(sal?.conveyance,       row['conv']),
      portf:   first(sal?.portfolio,        row['portf']),
      ma:      first(sal?.medical_allowance,row['ma']),
      lta:     first(sal?.lta,              row['lta']),
      sa:      first(sal?.special_allowance,row['sa']),
      oa:      first(sal?.other_allowance,  row['oa']),
      Bonus:   first(sal?.bonus,            row['Bonus']),
      Gross:   first(sal?.gross, e.gross_salary, row['Gross']),
      NetInhand:first(sal?.net_estimate, e.net_inhand, row['NetInhand']),
      CTC:     first(sal?.ctc, e.ctc,       row['CTC']),
      EPF:     first(sal?.pf_employee,      row['EPF']),
      EPFCO:   first(sal?.employer_pf,      row['EPFCO']),
      ESIC:    first(sal?.esic_employee,    row['ESIC']),
      ESICCO:  first(sal?.employer_esi,     row['ESICCO']),
      PLI:     first(sal?.pli,              row['PLI']),
      package: first(sal?.salary_slab,      row['package']),

      // Education
      Qualification:         first(edu?.qualification,              row['Qualification']),
      Qualification_Details: first(edu?.specialization_course_name, row['Qualification_Details']),
      Passed_Out_Year:       first(edu?.passed_out_year,             row['Passed_Out_Year']),
      Passed_Out_State:      first(edu?.passed_out_state,            row['Passed_Out_State']),
      Passed_Out_City:       first(edu?.passed_out_city,             row['Passed_Out_City']),
      Passed_Out_Percent:    first(edu?.passed_out_percentage,       row['Passed_Out_Percent']),

      // Reporting manager
      Reporting_Manager_Name:      first(e.rm_name,   row['Reporting_Manager_Name']),
      Reporting_Manager_Mobile_No: first(e.rm_mobile, row['Reporting_Manager_Mobile_No']),

      Billable_Status:  first(e.billable_status, e.is_billable ? 'Yes' : '', row['Billable_Status']),
      Type_Of_Employee: first(e.employee_category, row['Type_Of_Employee']),
    };
  });

  // Write output preserving original column order
  const outRows = [headers, ...filled.map(r => headers.map(h => r[h] ?? ''))];
  const wbOut = XLSX.utils.book_new();
  const wsOut = XLSX.utils.aoa_to_sheet(outRows);
  wsOut['!cols'] = headers.map((h, i) => {
    const maxLen = outRows.reduce((m, r) => Math.max(m, String(r[i]??'').length), String(h).length);
    return { wch: Math.min(maxLen + 2, 40) };
  });
  XLSX.utils.book_append_sheet(wbOut, wsOut, 'ISPart Data');

  const outFile = path.join(DOWNLOADS, `ISPart_Filled_${new Date().toISOString().slice(0,10)}.xlsx`);
  try { XLSX.writeFile(wbOut, outFile); } catch(e) {
    const alt = path.join(DOWNLOADS, `ISPart_Filled_${Date.now()}.xlsx`);
    XLSX.writeFile(wbOut, alt);
    console.log(`\n✓ Written to:\n  ${alt}`);
    printReport(rows, outRows, headers); return;
  }

  console.log(`\n✓ Written to:\n  ${outFile}`);
  printReport(rows, outRows, headers);
}

function printReport(rows, outRows, headers) {
  const orig = rows;
  const out  = outRows.slice(1);
  console.log('\n=== Column Fill Report (before → after) ===');
  headers.forEach((h, i) => {
    const before = orig.filter(r => String(r[h]||'').trim() !== '').length;
    const after  = out.filter(r  => String(r[i]||'').trim() !== '').length;
    if (after > before) console.log(`  ✓ ${h}: ${before} → ${after}/${orig.length}`);
    else if (after === 0 && before === 0) {} // skip totally empty unchanged
  });
}

main().catch(e => { console.error('ERROR:', e.message, e.stack); process.exit(1); });
