const mysql = require('mysql2/promise');

function requiredEnv(name) {
  const value = process.env[name] && process.env[name].trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

// Mapping from the image: Employee Code -> Manager Employee Code
const managerMappings = [
  { employeeCode: 'MAS38040', managerCode: 'MAS38040' },
  { employeeCode: 'MAS51531', managerCode: 'MAS48447' },
  { employeeCode: 'MAS59584', managerCode: 'MAS59598' },
  { employeeCode: 'MAS59586', managerCode: 'MAS60897' },
  { employeeCode: 'MAS59593', managerCode: 'MAS60897' },
  { employeeCode: 'MAS59596', managerCode: 'MAS59598' },
  { employeeCode: 'MAS59598', managerCode: 'MAS38040' },
  { employeeCode: 'MAS59610', managerCode: 'MAS59598' },
  { employeeCode: 'MAS59726', managerCode: 'MAS59598' },
  { employeeCode: 'MAS60037', managerCode: 'MAS60918' },
  { employeeCode: 'MAS60040', managerCode: 'MAS59598' },
  { employeeCode: 'MAS61106', managerCode: 'MAS59598' },
  { employeeCode: 'MAS60118', managerCode: 'MAS51531' },
  { employeeCode: 'MAS60235', managerCode: 'MAS51531' },
  { employeeCode: 'MAS60244', managerCode: 'MAS60918' },
  { employeeCode: 'MAS60390', managerCode: 'MAS60918' },
  { employeeCode: 'MAS60549', managerCode: 'MAS60897' },
  { employeeCode: 'MAS60618', managerCode: 'MAS62043' },
  { employeeCode: 'MAS60806', managerCode: 'MAS51531' },
  { employeeCode: 'MAS60804', managerCode: 'MAS60897' },
  { employeeCode: 'MAS60856', managerCode: 'MAS60897' },
  { employeeCode: 'MAS60856', managerCode: 'MAS60897' },
  { employeeCode: 'MAS60858', managerCode: 'MAS59598' },
  { employeeCode: 'MAS60859', managerCode: 'MAS60897' },
  { employeeCode: 'MAS60897', managerCode: 'MAS59598' },
  { employeeCode: 'MAS61049', managerCode: 'MAS47814' },
  { employeeCode: 'MAS61183', managerCode: 'MAS60897' },
  { employeeCode: 'MAS61289', managerCode: 'MAS61346' },
  { employeeCode: 'MAS61295', managerCode: 'MAS61346' },
  { employeeCode: 'MAS61342', managerCode: 'MAS61346' },
  { employeeCode: 'MAS61344', managerCode: 'MAS61346' },
  { employeeCode: 'MAS61346', managerCode: 'MAS62043' },
  { employeeCode: 'MAS61383', managerCode: 'MAS60897' },
  { employeeCode: 'MAS61416', managerCode: 'MAS60918' },
  { employeeCode: 'MAS61459', managerCode: 'MAS61346' },
  { employeeCode: 'MAS61488', managerCode: 'MAS61346' },
  { employeeCode: 'MAS61463', managerCode: 'MAS61346' },
  { employeeCode: 'MAS61491', managerCode: 'MAS61346' },
  { employeeCode: 'MAS61500', managerCode: 'MAS60897' },
  { employeeCode: 'MAS61522', managerCode: 'MAS59598' },
  { employeeCode: 'MAS61621', managerCode: 'MAS47814' },
  { employeeCode: 'MAS61778', managerCode: 'MAS51531' },
  { employeeCode: 'MAS61929', managerCode: 'MAS59598' },
  { employeeCode: 'MAS62007', managerCode: 'MAS38040' },
  { employeeCode: 'MAS62008', managerCode: 'MAS59598' },
  { employeeCode: 'MAS62043', managerCode: 'MAS38040' },
  { employeeCode: 'MAS62045', managerCode: 'MAS51531' },
  { employeeCode: 'MAS62053', managerCode: 'MAS60897' },
  { employeeCode: 'MAS62054', managerCode: 'MAS51531' },
  { employeeCode: 'MAS62180', managerCode: 'MAS59598' },
  { employeeCode: 'MAS62185', managerCode: 'MAS62043' },
  { employeeCode: 'MAS62196', managerCode: 'MAS62198' },
  { employeeCode: 'MAS62197', managerCode: 'MAS62198' },
  { employeeCode: 'MAS62198', managerCode: 'MAS62043' },
  { employeeCode: 'MAS62199', managerCode: 'MAS62198' },
  { employeeCode: 'MAS62257', managerCode: 'MAS62198' },
  { employeeCode: 'MAS62259', managerCode: 'MAS62198' },
  { employeeCode: 'MAS62260', managerCode: 'MAS62198' },
  { employeeCode: 'MAS62261', managerCode: 'MAS62198' },
  { employeeCode: 'MAS62262', managerCode: 'MAS62198' },
  { employeeCode: 'MAS62264', managerCode: 'MAS62198' },
  { employeeCode: 'MAS62285', managerCode: 'MAS62198' },
  { employeeCode: 'MAS62323', managerCode: 'MAS59598' },
  { employeeCode: 'MAS62324', managerCode: 'MAS60918' },
  { employeeCode: 'MAS62353', managerCode: 'MAS61346' },
  { employeeCode: 'MAS62357', managerCode: 'MAS62198' },
  { employeeCode: 'MAS62358', managerCode: 'MAS62198' },
  { employeeCode: 'MAS62359', managerCode: 'MAS62198' },
  { employeeCode: 'MAS62360', managerCode: 'MAS62198' },
  { employeeCode: 'MAS62361', managerCode: 'MAS62198' },
  { employeeCode: 'MAS62363', managerCode: 'MAS62198' },
  { employeeCode: 'MAS62364', managerCode: 'MAS62198' },
  { employeeCode: 'MAS62366', managerCode: 'MAS62198' },
  { employeeCode: 'MAS62367', managerCode: 'MAS62198' },
  { employeeCode: 'MAS62368', managerCode: 'MAS62198' },
  { employeeCode: 'MAS62369', managerCode: 'MAS62198' },
  { employeeCode: 'MAS62413', managerCode: 'MAS60897' },
  { employeeCode: 'MAS62415', managerCode: 'MAS51531' },
  { employeeCode: 'MAS62469', managerCode: 'MAS62198' },
  { employeeCode: 'MAS62467', managerCode: 'MAS62198' },
  { employeeCode: 'MAS62468', managerCode: 'MAS62198' },
  { employeeCode: 'MAS62499', managerCode: 'MAS60897' },
  { employeeCode: 'MAS62510', managerCode: 'MAS60897' },
  { employeeCode: 'MAS62533', managerCode: 'MAS60897' },
  { employeeCode: 'MAS62573', managerCode: 'MAS62198' },
  { employeeCode: 'MAS62574', managerCode: 'MAS62198' },
  { employeeCode: 'MAS62575', managerCode: 'MAS62198' },
  { employeeCode: 'MAS62648', managerCode: 'MAS61346' },
  { employeeCode: 'MAS62707', managerCode: 'MAS61346' },
  { employeeCode: 'MAS62775', managerCode: 'MAS61346' },
  { employeeCode: 'MAS62777', managerCode: 'MAS61346' },
  { employeeCode: 'MAS62778', managerCode: 'MAS61346' },
  { employeeCode: 'MAS62779', managerCode: 'MAS61346' },
  { employeeCode: 'MAS62848', managerCode: 'MAS62198' },
  { employeeCode: 'MAS62847', managerCode: 'MAS62198' },
  { employeeCode: 'MAS62848', managerCode: 'MAS62198' },
  { employeeCode: 'MAS62849', managerCode: 'MAS62198' },
  { employeeCode: 'MAS62850', managerCode: 'MAS62198' },
  { employeeCode: 'MAS62852', managerCode: 'MAS62198' },
  { employeeCode: 'MAS62853', managerCode: 'MAS62198' },
  { employeeCode: 'MAS62896', managerCode: 'MAS59598' },
  { employeeCode: 'MAS62897', managerCode: 'MAS60918' },
  { employeeCode: 'MAS62854', managerCode: 'MAS59598' },
  { employeeCode: 'MAS62851', managerCode: 'MAS62040' },
  { employeeCode: 'MAS47827', managerCode: 'MAS07279' },
  { employeeCode: 'MAS47814', managerCode: 'MAS07279' },
  { employeeCode: 'MAS48548', managerCode: 'MAS07279' },
  { employeeCode: 'MAS54280', managerCode: 'MAS07279' },
  { employeeCode: 'MAS57637', managerCode: 'MAS07279' },
  { employeeCode: 'MAS61349', managerCode: 'MAS38040' },
  { employeeCode: 'MAS61660', managerCode: 'MAS38040' },
  { employeeCode: 'MAS62325', managerCode: 'MAS38040' },
  { employeeCode: 'MAS62457', managerCode: 'MAS38040' },
  { employeeCode: 'MAS62458', managerCode: 'MAS38040' },
];

async function updateManagers() {
  const connection = await mysql.createConnection({
    host: requiredEnv('DB_HOST'),
    port: Number(process.env.DB_PORT || 3306),
    user: requiredEnv('DB_USER'),
    password: requiredEnv('DB_PASSWORD'),
    database: requiredEnv('DB_NAME'),
  });

  try {
    console.log(`Starting update of ${managerMappings.length} reporting manager assignments...\n`);

    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const mapping of managerMappings) {
      try {
        // Get employee ID from employee code
        const [empRows] = await connection.execute(
          'SELECT id FROM employees WHERE employee_code = ? LIMIT 1',
          [mapping.employeeCode]
        );

        if (empRows.length === 0) {
          errors.push(`Employee ${mapping.employeeCode} not found`);
          errorCount++;
          continue;
        }

        const employeeId = empRows[0].id;

        // Get manager ID from manager code
        const [mgrRows] = await connection.execute(
          'SELECT id FROM employees WHERE employee_code = ? LIMIT 1',
          [mapping.managerCode]
        );

        if (mgrRows.length === 0) {
          errors.push(`Manager ${mapping.managerCode} not found for employee ${mapping.employeeCode}`);
          errorCount++;
          continue;
        }

        const managerId = mgrRows[0].id;

        // Update reporting_manager_id
        await connection.execute(
          'UPDATE employees SET reporting_manager_id = ? WHERE id = ?',
          [managerId, employeeId]
        );

        successCount++;
        console.log(`✅ ${mapping.employeeCode} → Manager: ${mapping.managerCode}`);

      } catch (err) {
        errors.push(`${mapping.employeeCode}: ${err.message}`);
        errorCount++;
      }
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`✅ Successfully updated: ${successCount}`);
    console.log(`❌ Errors: ${errorCount}`);

    if (errors.length > 0) {
      console.log(`\nErrors:`);
      errors.forEach(err => console.log(`  - ${err}`));
    }

  } catch (err) {
    console.error('❌ Fatal error:', err.message);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

updateManagers();
