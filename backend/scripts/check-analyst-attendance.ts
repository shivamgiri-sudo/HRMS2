/**
 * Script to check analyst attendance capture and salary data
 * Run: npx tsx scripts/check-analyst-attendance.ts
 */

import { createConnection } from 'mysql2/promise';

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const DB_CONFIG = {
  host: requiredEnv('DB_HOST'),
  port: Number(process.env.DB_PORT || 3306),
  user: requiredEnv('DB_USER'),
  password: requiredEnv('DB_PASSWORD'),
  database: requiredEnv('DB_NAME')
};

async function main() {
  const masConn = await createConnection(DB_CONFIG);
  console.log('✅ Connected to mas_hrms\n');

  // ===== 1. CHECK ATTENDANCE TABLES =====
  console.log('═══════════════════════════════════════');
  console.log('1. ATTENDANCE TABLES IN mas_hrms');
  console.log('═══════════════════════════════════════');
  const [tables] = await masConn.execute<any[]>("SHOW TABLES LIKE '%attendance%'");
  tables.forEach(t => console.log(' -', Object.values(t)[0]));

  // ===== 2. ATTENDANCE RECORDS COUNT =====
  console.log('\n═══════════════════════════════════════');
  console.log('2. ATTENDANCE RECORDS COUNT');
  console.log('═══════════════════════════════════════');
  const [countResult] = await masConn.execute<any[]>(
    'SELECT COUNT(*) as total FROM wfm_attendance_record'
  );
  console.log('Total attendance records:', countResult[0].total);

  // ===== 3. ANALYST ATTENDANCE =====
  console.log('\n═══════════════════════════════════════');
  console.log('3. ANALYST ATTENDANCE (Last 10)');
  console.log('═══════════════════════════════════════');
  const [analystAttendance] = await masConn.execute<any[]>(`
    SELECT
      ar.id,
      ar.employee_id,
      e.employee_code,
      CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) as employee_name,
      d.designation_name,
      dept.dept_name,
      ar.attendance_date,
      ar.attendance_source,
      ar.dialler_minutes,
      ar.biometric_minutes,
      ar.raw_minutes,
      ar.attendance_status,
      ar.created_at
    FROM wfm_attendance_record ar
    LEFT JOIN employees e ON e.id = ar.employee_id
    LEFT JOIN designation_master d ON d.id = e.designation_id
    LEFT JOIN department_master dept ON dept.id = e.department_id
    WHERE LOWER(d.designation_name) LIKE '%analyst%'
       OR LOWER(d.designation_name) LIKE '%agent%'
    ORDER BY ar.attendance_date DESC, ar.created_at DESC
    LIMIT 10
  `);

  if (analystAttendance.length > 0) {
    console.table(analystAttendance);
  } else {
    console.log('❌ No analyst attendance records found');
  }

  // ===== 4. ATTENDANCE BY SOURCE =====
  console.log('\n═══════════════════════════════════════');
  console.log('4. ATTENDANCE RECORDS BY SOURCE');
  console.log('═══════════════════════════════════════');
  const [sourceStats] = await masConn.execute<any[]>(`
    SELECT
      attendance_source,
      COUNT(*) as total_records,
      COUNT(DISTINCT employee_id) as unique_employees
    FROM wfm_attendance_record
    GROUP BY attendance_source
  `);
  console.table(sourceStats);

  // ===== 5. SALARY DATA COUNT =====
  console.log('\n═══════════════════════════════════════');
  console.log('5. EMPLOYEE SALARY DATA');
  console.log('═══════════════════════════════════════');

  const [salaryCount] = await masConn.execute<any[]>(
    'SELECT COUNT(*) as total FROM employee_salary_assignment WHERE active_status = 1'
  );
  console.log('Active salary assignments:', salaryCount[0].total);

  const [salaryDetails] = await masConn.execute<any[]>(`
    SELECT
      COUNT(DISTINCT esa.employee_id) as employees_with_salary,
      MIN(esa.ctc_annual) as min_ctc,
      MAX(esa.ctc_annual) as max_ctc,
      AVG(esa.ctc_annual) as avg_ctc
    FROM employee_salary_assignment esa
    WHERE esa.active_status = 1
  `);
  console.table(salaryDetails);

  // ===== 6. CHECK db_billl CONNECTION =====
  console.log('\n═══════════════════════════════════════');
  console.log('6. CHECKING db_billl.masjclrentry');
  console.log('═══════════════════════════════════════');

  try {
    const billConn = await createConnection({
      ...DB_CONFIG,
      database: 'db_billl'
    });

    const [tableExists] = await billConn.execute<any[]>(
      "SHOW TABLES LIKE 'masjclrentry'"
    );

    if (tableExists.length > 0) {
      const [billCount] = await billConn.execute<any[]>(
        'SELECT COUNT(*) as total FROM masjclrentry'
      );
      console.log('Total records in db_billl.masjclrentry:', billCount[0].total);

      const [billStructure] = await billConn.execute<any[]>(
        'DESCRIBE masjclrentry'
      );
      console.log('\nTable structure:');
      console.table(billStructure);

      const [billSample] = await billConn.execute<any[]>(
        'SELECT * FROM masjclrentry LIMIT 5'
      );
      console.log('\nSample data (first 5 rows):');
      console.table(billSample);
    } else {
      console.log('❌ Table masjclrentry not found in db_billl');
    }

    await billConn.end();
  } catch (err) {
    console.error('Error accessing db_billl:', (err as Error).message);
  }

  // ===== 7. ATTENDANCE INTEGRATION POINTS =====
  console.log('\n═══════════════════════════════════════');
  console.log('7. ATTENDANCE DATA SOURCES');
  console.log('═══════════════════════════════════════');

  const [dialerSource] = await masConn.execute<any[]>(`
    SELECT COUNT(*) as total
    FROM wfm_attendance_record
    WHERE attendance_source = 'dialler'
      AND attendance_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
  `);
  console.log('Dialler records (last 7 days):', dialerSource[0].total);

  const [biometricSource] = await masConn.execute<any[]>(`
    SELECT COUNT(*) as total
    FROM wfm_attendance_record
    WHERE attendance_source = 'biometric'
      AND attendance_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
  `);
  console.log('Biometric records (last 7 days):', biometricSource[0].total);

  await masConn.end();
  console.log('\n✅ Analysis complete');
}

main().catch(console.error);
