const mysql = require('mysql2/promise');
let provisionerPromise;

function getLmsProvisioner() {
  if (!provisionerPromise) {
    provisionerPromise = import('../src/modules/lms/lms-provisioning.service.js');
  }
  return provisionerPromise;
}

function requiredEnv(name) {
  const value = process.env[name] && process.env[name].trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const LEGACY_CONFIG = {
  host: requiredEnv('BILL_DB_HOST'),
  port: Number(process.env.BILL_DB_PORT || 3306),
  user: requiredEnv('BILL_DB_USER'),
  password: requiredEnv('BILL_DB_PASSWORD'),
  database: requiredEnv('BILL_DB_NAME'),
};

const HRMS_CONFIG = {
  host: requiredEnv('DB_HOST'),
  port: Number(process.env.DB_PORT || 3306),
  user: requiredEnv('DB_USER'),
  password: requiredEnv('DB_PASSWORD'),
  database: requiredEnv('DB_NAME'),
};

function splitName(fullName) {
  if (!fullName) return { first: 'Unknown', last: null };
  const parts = fullName.trim().split(/\s+/);
  return {
    first: parts[0] || 'Unknown',
    last: parts.slice(1).join(' ') || null,
  };
}

function maskAadhaar(aadhaar) {
  if (!aadhaar) return null;
  return aadhaar.replace(/\s/g, '').slice(-4);
}

async function runFullSync() {
  console.log('🚀 FULL EMPLOYEE SYNC STARTING\n');

  const legacyDb = await mysql.createConnection(LEGACY_CONFIG);
  const hrmsDb = await mysql.createConnection(HRMS_CONFIG);

  try {
    // Fetch all employees
    console.log('📥 Fetching employees from legacy...');
    const [legacyEmployees] = await legacyDb.execute('SELECT * FROM masjclrentry ORDER BY id ASC');
    console.log(`Found ${legacyEmployees.length} employees in legacy\n`);

    let inserted = 0, updated = 0, errors = 0;

    console.log('💾 Syncing to HRMS database...');
    for (let i = 0; i < legacyEmployees.length; i++) {
      const emp = legacyEmployees[i];

      if (i % 500 === 0) {
        console.log(`Progress: ${i}/${legacyEmployees.length} (${Math.round(i/legacyEmployees.length*100)}%)`);
      }

      try {
        const name = splitName(emp.EmpName);
        const aadhaar = maskAadhaar(emp.AdharId);

        const [result] = await hrmsDb.execute(`
          INSERT INTO employees (
            id, employee_code, biometric_code, first_name, last_name, title, gender,
            date_of_birth, date_of_joining, date_of_leaving,
            mobile, email, official_email,
            pan_number, aadhaar_last4, passport_number, epf_number, esic_number, uan,
            department, designation, branch, client_name, process, cost_center,
            bank_account_number, bank_name, bank_branch, ifsc_code, account_holder_name,
            marital_status, blood_group, qualification,
            address_line1, address_line2, city, state, pincode,
            active_status, legacy_last_updated, legacy_emp_id, created_at, updated_at
          ) VALUES (
            UUID(), ?, ?, ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, NOW(), NOW()
          )
          ON DUPLICATE KEY UPDATE
            biometric_code = VALUES(biometric_code),
            first_name = VALUES(first_name),
            last_name = VALUES(last_name),
            title = VALUES(title),
            gender = VALUES(gender),
            date_of_birth = VALUES(date_of_birth),
            date_of_joining = VALUES(date_of_joining),
            date_of_leaving = VALUES(date_of_leaving),
            mobile = VALUES(mobile),
            email = VALUES(email),
            official_email = VALUES(official_email),
            pan_number = VALUES(pan_number),
            aadhaar_last4 = VALUES(aadhaar_last4),
            passport_number = VALUES(passport_number),
            epf_number = VALUES(epf_number),
            esic_number = VALUES(esic_number),
            uan = VALUES(uan),
            department = VALUES(department),
            designation = VALUES(designation),
            branch = VALUES(branch),
            client_name = VALUES(client_name),
            process = VALUES(process),
            cost_center = VALUES(cost_center),
            bank_account_number = VALUES(bank_account_number),
            bank_name = VALUES(bank_name),
            bank_branch = VALUES(bank_branch),
            ifsc_code = VALUES(ifsc_code),
            account_holder_name = VALUES(account_holder_name),
            marital_status = VALUES(marital_status),
            blood_group = VALUES(blood_group),
            qualification = VALUES(qualification),
            address_line1 = VALUES(address_line1),
            address_line2 = VALUES(address_line2),
            city = VALUES(city),
            state = VALUES(state),
            pincode = VALUES(pincode),
            active_status = VALUES(active_status),
            legacy_last_updated = VALUES(legacy_last_updated),
            legacy_emp_id = VALUES(legacy_emp_id),
            updated_at = NOW()
        `, [
          emp.EmpCode, emp.BioCode, name.first, name.last,
          emp.Title, emp.Gendar,
          emp.DOB, emp.DOJ, emp.DOL,
          emp.Mobile, emp.EmailId, emp.OfficeEmailId,
          emp.PanNo, aadhaar, emp.PassportNo,
          emp.EPFNo, emp.ESICNo, emp.UAN,
          emp.Dept, emp.Desgination, emp.BranchName,
          emp.ClientName, emp.Process, emp.CostCenter,
          emp.AcNo, emp.AcBank, emp.AcBranch,
          emp.IFSCCode, emp.AccHolder,
          emp.MaritalStatus, emp.BloodGruop, emp.Qualification,
          emp.Adrress1, emp.Adrress2, emp.City, emp.State, emp.PinCode,
          emp.Status === '1', emp.lastUpdated, emp.id,
        ]);

        try {
          const { provisionLmsIdentityForEmployee } = await getLmsProvisioner();
          const lmsResult = await provisionLmsIdentityForEmployee({ employeeCode: String(emp.EmpCode).trim() });
          if (lmsResult.message) {
            console.log(`[Legacy Sync] LMS provisioning for ${emp.EmpCode}: ${lmsResult.message}`);
          }
        } catch (err) {
          console.warn(
            `[Legacy Sync] LMS provisioning skipped for ${emp.EmpCode}:`,
            err instanceof Error ? err.message : String(err),
          );
        }

        if (result.insertId) {
          inserted++;
        } else {
          updated++;
        }
      } catch (err) {
        errors++;
        if (errors < 5) {
          console.error(`Error syncing ${emp.EmpCode}:`, err.message);
        }
      }
    }

    console.log('\n✅ SYNC COMPLETE!');
    console.log(`   Inserted: ${inserted}`);
    console.log(`   Updated: ${updated}`);
    console.log(`   Errors: ${errors}`);

    // Update checkpoint
    await hrmsDb.execute(`
      INSERT INTO legacy_sync_checkpoint (domain, last_sync_time, updated_at)
      VALUES ('employee', NOW(), NOW())
      ON DUPLICATE KEY UPDATE last_sync_time = NOW(), updated_at = NOW()
    `);

    // Log sync run
    await hrmsDb.execute(`
      INSERT INTO legacy_sync_run_log (id, domain, status, records_processed, records_failed, started_at, completed_at)
      VALUES (UUID(), 'employee', 'success', ?, ?, NOW(), NOW())
    `, [inserted + updated, errors]);

    // Verify
    const [count] = await hrmsDb.execute('SELECT COUNT(*) as total FROM employees WHERE legacy_emp_id IS NOT NULL');
    console.log(`\n📊 Total employees in HRMS: ${count[0].total}`);

    console.log('\n🔐 Auth users were not created by this sync.');
    console.log('   Use the protected invite/reset-token flow to activate employee accounts.');
    console.log('\n🎉 EMPLOYEE SYNC COMPLETE!');

  } finally {
    await legacyDb.end();
    await hrmsDb.end();
  }
}

runFullSync().catch(err => {
  console.error('❌ Sync failed:', err.message);
  process.exit(1);
});
