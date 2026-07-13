// backend/scripts/migrate-legacy.employees.ts
import type { Connection, RowDataPacket } from 'mysql2/promise';
import type { MasterMaps } from './migrate-legacy.masters.js';
import type { LegacyEmployeeRow } from './migrate-legacy.transforms.js';
import {
  parseLegacyDate, splitName, normalizeGender,
  toDecimal, boolFlag, buildAddress, parseUAN,
} from './migrate-legacy.transforms.js';
import { provisionLmsIdentityForEmployee } from '../src/modules/lms/lms-provisioning.service.js';

export interface EmployeeMigrationResult {
  inserted: number;
  skipped: number;
  errors: Array<{ empCode: string; error: string }>;
}

export async function migrateEmployees(
  src: Connection,
  dst: Connection,
  srcTable: string,
  masters: MasterMaps,
): Promise<EmployeeMigrationResult> {
  console.log('  [Phase 2] Migrating employeesâ€¦');

  const [rows] = await src.execute<RowDataPacket[]>(`SELECT * FROM ${srcTable}`);
  const result: EmployeeMigrationResult = { inserted: 0, skipped: 0, errors: [] };

  for (const raw of rows) {
    const row = raw as LegacyEmployeeRow;
    try {
      await migrateOneEmployee(dst, row, masters, result);
    } catch (err) {
      result.errors.push({ empCode: row.EmpCode, error: String(err) });
    }
  }

  console.log(`  [Phase 2] Done. inserted:${result.inserted} skipped:${result.skipped} errors:${result.errors.length}`);
  return result;
}

async function migrateOneEmployee(
  dst: Connection,
  row: LegacyEmployeeRow,
  masters: MasterMaps,
  result: EmployeeMigrationResult,
): Promise<void> {
  if (!row.EmpCode || !row.EmpCode.trim()) {
    result.skipped++;
    return;
  }
  if (!row.EmpName || !row.EmpName.trim()) {
    result.skipped++;
    return;
  }
  const { firstName, lastName } = splitName(row.EmpName);

  const isLeft = row.Status === 'L';
  const empStatus = isLeft ? 'Resigned' : 'Active';
  const activeStatus = isLeft ? 0 : 1;

  const doj = parseLegacyDate(row.DOJ);
  if (!doj) {
    result.errors.push({ empCode: row.EmpCode, error: 'Missing or invalid date_of_joining (DOJ)' });
    return;
  }
  const dob = parseLegacyDate(row.DOB);
  const exitDate = isLeft ? parseLegacyDate(row.LeftDate) : null;

  const branchId = row.Location ? (masters.branch.get(row.Location.trim()) ?? null) : null;
  const departmentId = row.Depart ? (masters.department.get(row.Depart.trim()) ?? null) : null;
  const processId = row.Process ? (masters.process.get(row.Process.trim()) ?? null) : null;
  const designationId = row.Desig ? (masters.designation.get(row.Desig.trim()) ?? null) : null;

  await dst.execute(
    `INSERT INTO employees
       (employee_code, first_name, last_name, email, mobile, gender,
        date_of_birth, date_of_joining, date_of_exit, employment_type,
        employment_status, active_status, branch_id, department_id,
        process_id, designation_id, biometric_code, band, stream,
        profile_type, source_type, source, legacy_emp_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       first_name = VALUES(first_name), last_name = VALUES(last_name),
       email = VALUES(email), mobile = VALUES(mobile),
       gender = VALUES(gender), date_of_birth = VALUES(date_of_birth),
       date_of_joining = VALUES(date_of_joining), date_of_exit = VALUES(date_of_exit),
       employment_status = VALUES(employment_status), active_status = VALUES(active_status),
       branch_id = VALUES(branch_id), department_id = VALUES(department_id),
       process_id = VALUES(process_id), designation_id = VALUES(designation_id),
       biometric_code = VALUES(biometric_code), band = VALUES(band),
       stream = VALUES(stream), profile_type = VALUES(profile_type),
       source_type = VALUES(source_type), source = VALUES(source),
       legacy_emp_id = VALUES(legacy_emp_id)`,
    [
      row.EmpCode, firstName, lastName,
      row.EmailId ?? null, row.PMobNo ?? null,
      normalizeGender(row.Gender),
      dob, doj, exitDate,
      row.EmpType ?? 'OnRoll', empStatus, activeStatus,
      branchId, departmentId, processId, designationId,
      row.BiometricCode ?? null, row.Band ?? null,
      row.Stream ?? null, row.Profile ?? null,
      row.SourceType ?? null, row.Source ?? null,
      row.Id,
    ],
  );

  const [empRows] = await dst.execute<RowDataPacket[]>(
    `SELECT id FROM employees WHERE employee_code = ?`,
    [row.EmpCode],
  );
  const employeeId = empRows[0]?.id as string | undefined;
  if (!employeeId) {
    result.skipped++;
    return;
  }

  try {
    const lmsResult = await provisionLmsIdentityForEmployee({ employeeCode: String(row.EmpCode).trim() });
    if (lmsResult.message) {
      console.info(`[Legacy Migration] LMS provisioning for ${row.EmpCode}: ${lmsResult.message}`);
    }
  } catch (err) {
    console.warn(
      `[Legacy Migration] LMS provisioning skipped for ${row.EmpCode}:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  if (row.AcNo) {
    await dst.execute(
      `INSERT INTO employee_bank_detail
         (employee_id, bank_name, account_number, ifsc_code, account_type)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         bank_name = VALUES(bank_name),
         account_number = VALUES(account_number),
         ifsc_code = VALUES(ifsc_code),
         account_type = VALUES(account_type)`,
      [
        employeeId, row.AcBank ?? null,
        Buffer.from(row.AcNo, 'utf8'),
        row.IFSCCode ?? null,
        row.AccType ?? 'Savings',
      ],
    );
  }

  await dst.execute(
    `INSERT INTO employee_statutory_info
       (employee_id, epf_number, esi_number, uan_number, pan_number,
        aadhaar_id, pf_eligible, esi_eligible, epf_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       epf_number = VALUES(epf_number), esi_number = VALUES(esi_number),
       uan_number = VALUES(uan_number), pan_number = VALUES(pan_number),
       aadhaar_id = VALUES(aadhaar_id), pf_eligible = VALUES(pf_eligible),
       esi_eligible = VALUES(esi_eligible), epf_date = VALUES(epf_date)`,
    [
      employeeId,
      row.EpfNo ?? null,
      row.EsiNo ?? null,
      parseUAN(row.UAN),
      row.panno ?? null,
      row.AadharID ?? null,
      boolFlag(row.pfelig),
      boolFlag(row.esielig),
      parseLegacyDate(row.EpfDate),
    ],
  );

  await dst.execute(
    `INSERT INTO employee_salary_snapshot
       (employee_id, snapshot_date, basic, hra, conveyance, da,
        portfolio_allowance, medical_allowance, lta, mobile_allowance,
        special_allowance, other_allowance, bonus, gross, net_in_hand,
        ctc_offered, package, epf_employee, esic_employee, epf_employer,
        esic_employer, professional_tax, gratuity, admin_charges, pli,
        pay_mode, salary_payment_mode)
     VALUES (?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       snapshot_date = VALUES(snapshot_date),
       basic = VALUES(basic), hra = VALUES(hra), conveyance = VALUES(conveyance),
       da = VALUES(da), portfolio_allowance = VALUES(portfolio_allowance),
       medical_allowance = VALUES(medical_allowance), lta = VALUES(lta),
       mobile_allowance = VALUES(mobile_allowance), special_allowance = VALUES(special_allowance),
       other_allowance = VALUES(other_allowance), bonus = VALUES(bonus),
       gross = VALUES(gross), net_in_hand = VALUES(net_in_hand),
       ctc_offered = VALUES(ctc_offered), package = VALUES(package),
       epf_employee = VALUES(epf_employee), esic_employee = VALUES(esic_employee),
       epf_employer = VALUES(epf_employer), esic_employer = VALUES(esic_employer),
       professional_tax = VALUES(professional_tax), gratuity = VALUES(gratuity),
       admin_charges = VALUES(admin_charges), pli = VALUES(pli),
       pay_mode = VALUES(pay_mode), salary_payment_mode = VALUES(salary_payment_mode)`,
    [
      employeeId,
      toDecimal(row.bs), toDecimal(row.hra), toDecimal(row.conv), toDecimal(row.da),
      toDecimal(row.portf), toDecimal(row.ma), toDecimal(row.lta), toDecimal(row.mob),
      toDecimal(row.sa), toDecimal(row.oa),
      toDecimal(row.Bonus), toDecimal(row.Gross), toDecimal(row.NetInHand),
      toDecimal(row.CTCOffered), toDecimal(row.package),
      toDecimal(row.EPF), toDecimal(row.ESIC),
      toDecimal(row.EPFCO), toDecimal(row.ESICCO),
      toDecimal(row.ProfessionalTax), toDecimal(row.Gratuity),
      toDecimal(row.AdminCharges), toDecimal(row.PLI),
      row.PayMode ?? null, row.SalaryPaymentMode ?? null,
    ],
  );

  if (row.ClientName || row.CostCenter) {
    await dst.execute(
      `INSERT INTO employee_client_mapping
         (employee_id, client_name, cost_center, emp_for, effective_from)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         client_name = VALUES(client_name), cost_center = VALUES(cost_center)`,
      [
        employeeId,
        row.ClientName ?? null, row.CostCenter ?? null,
        row.EmpFor ?? null, doj ?? null,
      ],
    );
  }

  if (row.KPIId) {
    await dst.execute(
      `INSERT INTO employee_kpi_assignment (employee_id, legacy_kpi_id, assign_date)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE legacy_kpi_id = VALUES(legacy_kpi_id)`,
      [employeeId, row.KPIId, parseLegacyDate(row.AssignDate)],
    );
  }

  await dst.execute(
    `INSERT INTO employee_legacy_meta
       (employee_id, father_name, relationship_type, acc_holder_name, blood_group,
        qualification, marital_status, permanent_address, temporary_address,
        land_line_p, land_line_t, passport_no, dl_no, offer_no, box_file_no,
        appoint_print_date, document_done, account_flag, ac_validation_date,
        ac_validated_by, ac_rejection_remarks, updated_by, official_email)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       father_name = VALUES(father_name), blood_group = VALUES(blood_group),
       qualification = VALUES(qualification), official_email = VALUES(official_email)`,
    [
      employeeId,
      row.Fname ?? null, row.RType ?? null, row.AccHolder ?? null,
      row.BloodG ?? null, row.Qualification ?? null, row.MaritalStatus ?? null,
      buildAddress(row.PAddress, row.PCity, row.PState, row.PpinCode),
      buildAddress(row.TAddress, row.TCity, row.TState, row.TPinCode),
      row.PLandLine ?? null, row.TLandLine ?? null,
      row.PassPortNo ?? null, row.dlNo ?? null,
      row.OfferNo ?? null, row.BoxFileNo ?? null,
      parseLegacyDate(row.AppointPrintDate),
      row.documentDone ?? null, row.AccountFlag ?? null,
      parseLegacyDate(row.AcValidationDate),
      row.AcValidatedBy ?? null, row.AcRejectionRemarks ?? null,
      row.UpdatedBy ?? null, row.OfficialEmailID ?? null,
    ],
  );

  result.inserted++;
}
