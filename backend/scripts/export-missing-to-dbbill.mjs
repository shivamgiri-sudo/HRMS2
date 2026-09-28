/**
 * export-missing-to-dbbill.mjs
 *
 * Finds employees in mas_hrms that are NOT in db_bill.masjclrentry and
 * exports them to an Excel file with the exact column headers that
 * migration-hrms-to-dbbill-v7.xlsx uses, so the file can be directly
 * uploaded into db_bill.
 *
 * Usage:
 *   node backend/scripts/export-missing-to-dbbill.mjs
 *
 * Output: Downloads/missing-employees-for-dbbill-YYYY-MM-DD.xlsx
 */

import mysql from 'mysql2/promise';
import XLSX from 'xlsx';
import path from 'path';
import os from 'os';

const HRMS = { host:'122.184.128.90', port:3306, user:'shivam_user', password:'qwersdfg!@#hjk', database:'mas_hrms', connectTimeout:15000 };
const BILL = { host:'192.168.10.22',  port:3306, user:'shivam_user', password:'qwersdfg!@#hjk', database:'db_bill',  connectTimeout:15000 };

// db_bill column order — must match exactly
const HEADERS = [
  'EmpType','EmpCode','BioCode','OfferNo','Title','EmpName',
  'ParentType','Father','Husband','Gendar','DOB','DOJ','DOL','Age',
  'MaritalStatus','BloodGruop','Qualification','Qualification_Details',
  'Passed_Out_Year','Passed_Out_State','Passed_Out_City','Passed_Out_Percent',
  'Mobile','Mobile1','LandLine','LandLine1','EmailId','OfficeEmailId',
  'Adrress1','Adrress2','City','State','PinCode',
  'City1','State1','PinCode1',
  'NomineeName','NomineeRelation','NomineeDob',
  'Family_Annual_Income','Count_Of_Dependents',
  'BranchName','Dept','Desgination','Process','CostCenter','ClientName',
  'Band','KPI','PanNo','AdharId','UAN','EPFNo','NewEpfNo','ESICNo',
  'pfelig','esielig','EpfDate','PassportNo','dlNo',
  'AcNo','IFSCCode','AcBank','AcBranch','AccHolder','AccType',
  'AcValidationStatus','AccountFlag',
  'bs','hra','conv','da','portf','ma','lta','mob','sa','oa',
  'Bonus','Gross','NetInhand','CTC','PLI','EPF','EPFCO','ESIC','ESICCO',
  'Gratuity','ProfessionalTax','AdminCharges','package',
  'SalarySource','Source','SourceType',
  'Reporting_Manager_Name','Reporting_Manager_Mobile_No',
  'Status','Pwd','PayMode','SalaryPaymentMode',
  'EmpFor','EmpLocation','SubLocation','work_status',
  'Billable_Status','Type_Of_Employee','pli_status',
  'EntryDate','CreateDate','lastUpdated'
];

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt)) return '';
  return dt.toISOString().slice(0, 10);
}

function calcAge(dob) {
  if (!dob) return '';
  const b = new Date(dob), now = new Date();
  let y = now.getFullYear() - b.getFullYear();
  let m = now.getMonth() - b.getMonth();
  let d = now.getDate() - b.getDate();
  if (d < 0) { m--; }
  if (m < 0) { y--; m += 12; }
  return `${y} Year   ${Math.abs(m)} Month   `;
}

async function main() {
  console.log('Connecting to databases...');
  const [hrmsConn, billConn] = await Promise.all([
    mysql.createConnection(HRMS),
    mysql.createConnection(BILL),
  ]);

  // 1. Get all EmpCodes already in db_bill
  console.log('Fetching existing EmpCodes from db_bill.masjclrentry...');
  const [billRows] = await billConn.query('SELECT DISTINCT EmpCode FROM masjclrentry WHERE EmpCode IS NOT NULL');
  const inBill = new Set(billRows.map(r => r.EmpCode));
  console.log(`  db_bill has ${inBill.size} distinct EmpCodes`);
  await billConn.end();

  // 2. Get all active employees from mas_hrms
  console.log('Fetching active employees from mas_hrms...');
  const [emps] = await hrmsConn.query(`
    SELECT
      e.id, e.employee_code, e.biometric_code, e.emp_type, e.employment_type,
      e.first_name, e.last_name, e.full_name, e.gender, e.marital_status,
      e.date_of_birth, e.date_of_joining, e.date_of_exit, e.date_of_leaving,
      e.blood_group, e.father_name, e.nominee_name, e.nominee_relation,
      e.annual_income, e.count_of_dependents,
      e.mobile, e.alternate_mobile, e.personal_email, e.email,
      e.official_email, e.office_email,
      e.address1, e.address2, e.address_line1, e.address_line2,
      e.city, e.state, e.pincode,
      e.permanent_city, e.permanent_state, e.permanent_pincode,
      e.pan_number, e.pan_number_masked,
      e.aadhaar_number, e.aadhaar_last4,
      e.uan_number, e.epf_number, e.esic_number,
      e.bank_account_number, e.ifsc_code, e.bank_name, e.bank_branch,
      e.account_holder_name, e.account_type,
      e.ctc, e.gross_salary, e.net_inhand,
      e.band, e.billable_status, e.is_billable,
      e.cost_center_code, e.employment_status,
      e.source, e.source_type, e.sub_source,
      e.epf_compliance_status,
      e.created_at, e.updated_at,
      e.cost_centre_id, e.branch_id, e.department_id,
      e.designation_id, e.process_id, e.reporting_manager_id,
      e.employee_category,
      -- org names via join
      b.branch_name,
      d.dept_name AS department_name,
      dg.designation_name,
      p.process_name,
      cc.billing_client_name AS client_name,
      -- reporting manager
      rm.full_name AS rm_name, rm.mobile AS rm_mobile
    FROM employees e
    LEFT JOIN branch_master b ON b.id = e.branch_id
    LEFT JOIN department_master d ON d.id = e.department_id
    LEFT JOIN designation_master dg ON dg.id = e.designation_id
    LEFT JOIN process_master p ON p.id = e.process_id
    LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
    LEFT JOIN employees rm ON rm.id = e.reporting_manager_id
    WHERE e.employment_status = 'active'
  `);
  console.log(`  mas_hrms has ${emps.length} active employees`);

  // 3. Find missing
  const missing = emps.filter(e => !inBill.has(e.employee_code));
  console.log(`  Missing from db_bill: ${missing.length} employees`);

  if (missing.length === 0) {
    console.log('No missing employees. No file generated.');
    await hrmsConn.end();
    return;
  }

  // 4. Fetch education (take highest / most recent per employee)
  const missingIds = missing.map(e => `'${e.id}'`).join(',');
  const [edRows] = await hrmsConn.query(`
    SELECT employee_id, qualification, specialization_course_name,
           passed_out_year, passed_out_state, passed_out_city, passed_out_percentage
    FROM employee_education
    WHERE employee_id IN (${missingIds})
    ORDER BY passed_out_year DESC
  `);
  const eduMap = {};
  for (const r of edRows) {
    if (!eduMap[r.employee_id]) eduMap[r.employee_id] = r;
  }

  // 5. Fetch salary for missing employees (take latest active assignment)
  const [salRows] = await hrmsConn.query(`
    SELECT s.employee_id,
           s.basic, s.hra, s.conveyance, s.bonus, s.portfolio,
           s.medical_allowance, s.lta, s.other_allowance, s.pli,
           s.special_allowance, s.gross, s.ctc, s.net_estimate,
           s.pf_employee, s.esic_employee, s.pf_applicable, s.esi_applicable
    FROM salary_component_assignments s
    INNER JOIN (
      SELECT employee_id, MAX(effective_date) AS max_date
      FROM salary_component_assignments
      WHERE employee_id IN (${missingIds}) AND status = 'active'
      GROUP BY employee_id
    ) latest ON latest.employee_id = s.employee_id AND latest.max_date = s.effective_date
    WHERE s.status = 'active'
  `);
  const salMap = {};
  for (const r of salRows) {
    salMap[r.employee_id] = r;
  }

  await hrmsConn.end();

  // 6. Build rows
  const rows = [HEADERS];

  for (const e of missing) {
    const edu = eduMap[e.id] || {};
    const sal = salMap[e.id] || null;

    const gender = (e.gender || '').toUpperCase();
    const married = (e.marital_status || '').toUpperCase() === 'MARRIED';
    const title = gender === 'FEMALE' ? (married ? 'Mrs' : 'Ms') : 'Mr';

    const pfElig = (sal?.pf_applicable ?? (e.epf_number ? 1 : 0)) ? 'YES' : 'NO';
    const esiElig = (sal?.esi_applicable ?? (e.esic_number ? 1 : 0)) ? 'YES' : 'NO';

    const salSource = sal ? 'HRMS' : 'PENDING_PAYROLL_HEAD';

    // Use employment_type (set by offer form) over emp_type (legacy field, often NULL).
    // Normalize to the two values db_bill recognises: ONROLL and MGMT. TRAINEE.
    const rawType = (e.emp_type || e.employment_type || '').trim().toUpperCase();
    const empType = rawType.includes('MGMT') ? 'MGMT. TRAINEE'
      : rawType.includes('OFFROLL') || rawType.includes('OFF') ? 'OFFROLL'
      : 'ONROLL';

    const emailId = e.personal_email || e.email || '';
    const officeEmail = e.official_email || e.office_email || '';
    const addr1 = e.address_line1 || e.address1 || '';
    const addr2 = e.address_line2 || e.address2 || '';
    const pan = e.pan_number_masked || e.pan_number || '';
    const aadhaar = e.aadhaar_number || (e.aadhaar_last4 ? `XXXX-XXXX-${e.aadhaar_last4}` : '');

    const row = [
      empType,                                   // EmpType
      e.employee_code,                           // EmpCode
      e.biometric_code || e.employee_code,       // BioCode
      e.employee_code,                           // OfferNo
      title,                                     // Title
      e.full_name || `${e.first_name} ${e.last_name}`.trim(), // EmpName
      'Father',                                  // ParentType
      e.father_name || '',                       // Father
      '',                                        // Husband
      gender || '',                              // Gendar
      fmtDate(e.date_of_birth),                  // DOB
      fmtDate(e.date_of_joining),                // DOJ
      fmtDate(e.date_of_exit || e.date_of_leaving), // DOL
      calcAge(e.date_of_birth),                  // Age
      e.marital_status || '',                    // MaritalStatus
      e.blood_group || '',                       // BloodGruop
      edu.qualification || '',                   // Qualification
      edu.specialization_course_name || '',      // Qualification_Details
      edu.passed_out_year || '',                 // Passed_Out_Year
      edu.passed_out_state || '',                // Passed_Out_State
      edu.passed_out_city || '',                 // Passed_Out_City
      edu.passed_out_percentage || '',           // Passed_Out_Percent
      e.mobile || '',                            // Mobile
      e.alternate_mobile || e.mobile || '',      // Mobile1
      '',                                        // LandLine
      '',                                        // LandLine1
      emailId,                                   // EmailId
      officeEmail,                               // OfficeEmailId
      addr1,                                     // Adrress1
      addr2,                                     // Adrress2
      e.city || '',                              // City
      e.state || '',                             // State
      e.pincode || '',                           // PinCode
      e.permanent_city || e.city || '',          // City1
      e.permanent_state || e.state || '',        // State1
      e.permanent_pincode || e.pincode || '',    // PinCode1
      e.nominee_name || '',                      // NomineeName
      e.nominee_relation || '',                  // NomineeRelation
      '',                                        // NomineeDob
      e.annual_income || '',                     // Family_Annual_Income
      e.count_of_dependents || '',               // Count_Of_Dependents
      e.branch_name || '',                       // BranchName
      e.department_name || '',                   // Dept
      e.designation_name || '',                  // Desgination
      e.process_name || '',                      // Process
      e.cost_center_code || '',                  // CostCenter
      e.client_name || '',                       // ClientName
      e.band || '',                              // Band
      '',                                        // KPI
      pan,                                       // PanNo
      aadhaar,                                   // AdharId
      e.uan_number || '',                        // UAN
      e.epf_number || '',                        // EPFNo
      e.epf_number || '',                        // NewEpfNo
      e.esic_number || '',                       // ESICNo
      pfElig,                                    // pfelig
      esiElig,                                   // esielig
      '',                                        // EpfDate
      '',                                        // PassportNo
      '',                                        // dlNo
      e.bank_account_number || '',               // AcNo
      e.ifsc_code || '',                         // IFSCCode
      e.bank_name || '',                         // AcBank
      e.bank_branch || '',                       // AcBranch
      e.account_holder_name || '',               // AccHolder
      e.account_type || '',                      // AccType
      e.bank_account_number ? 'Yes' : '',        // AcValidationStatus
      e.bank_account_number ? '2' : '',          // AccountFlag
      sal?.basic ?? '',                          // bs
      sal?.hra ?? '',                            // hra
      sal?.conveyance ?? '',                     // conv
      '',                                        // da
      sal?.portfolio ?? '',                      // portf
      sal?.medical_allowance ?? '',              // ma
      sal?.lta ?? '',                            // lta
      '',                                        // mob
      sal?.special_allowance ?? '',              // sa
      sal?.other_allowance ?? '',                // oa
      sal?.bonus ?? '',                          // Bonus
      sal?.gross || e.gross_salary || '',        // Gross
      sal?.net_estimate || e.net_inhand || '',   // NetInhand
      sal?.ctc || e.ctc || '',                   // CTC
      sal?.pli ?? '',                            // PLI
      sal?.pf_employee ?? '',                    // EPF
      '',                                        // EPFCO
      sal?.esic_employee ?? '',                  // ESIC
      '',                                        // ESICCO
      '',                                        // Gratuity
      '',                                        // ProfessionalTax
      '',                                        // AdminCharges
      '',                                        // package
      salSource,                                 // SalarySource
      e.source || '',                            // Source
      e.source_type || e.sub_source || '',       // SourceType
      e.rm_name || '',                           // Reporting_Manager_Name
      e.rm_mobile || '',                         // Reporting_Manager_Mobile_No
      '1',                                       // Status (active)
      'bpsbps',                                  // Pwd (default)
      'ECS',                                     // PayMode
      'Cheque',                                  // SalaryPaymentMode
      'HRMS',                                    // EmpFor
      'OnSite',                                  // EmpLocation
      '',                                        // SubLocation
      'WFO',                                     // work_status
      e.billable_status || (e.is_billable ? 'Yes' : 'No'), // Billable_Status
      e.employee_category || 'BMC',              // Type_Of_Employee
      0,                                         // pli_status
      fmtDate(e.created_at),                     // EntryDate
      fmtDate(e.created_at),                     // CreateDate
      fmtDate(e.updated_at),                     // lastUpdated
    ];

    rows.push(row);
  }

  // 7. Write Excel
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Column widths
  ws['!cols'] = HEADERS.map((h, i) => {
    const maxLen = rows.reduce((m, r) => Math.max(m, String(r[i] ?? '').length), h.length);
    return { wch: Math.min(maxLen + 2, 40) };
  });

  XLSX.utils.book_append_sheet(wb, ws, 'Migration Data');

  const outFile = path.join(os.homedir(), 'Downloads',
    `missing-employees-for-dbbill-${new Date().toISOString().slice(0,10)}-v${Date.now()%10000}.xlsx`);
  XLSX.writeFile(wb, outFile);

  console.log(`\n✓ Done! ${missing.length} employees written to:\n  ${outFile}`);
  console.log('\nSample EmpCodes (first 10):');
  missing.slice(0, 10).forEach(e => console.log(`  ${e.employee_code} — ${e.full_name} (${e.branch_name})`));
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
