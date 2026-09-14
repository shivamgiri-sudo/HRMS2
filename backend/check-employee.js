import { db } from './src/db/mysql.js';

const [rows] = await db.execute(
  'SELECT id, user_id, employee_code, name FROM employees WHERE employee_code = ? LIMIT 1',
  ['EMP-STF-001']
);

console.log('Employee EMP-STF-001:', JSON.stringify(rows, null, 2));

await db.end();
