// backend/scripts/migrate-legacy.masters.ts
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { toMasterCode } from './migrate-legacy.transforms.js';

export interface MasterMaps {
  branch:      Map<string, string>; // legacy Location value → branch_master.id
  department:  Map<string, string>; // legacy Depart value → department_master.id
  process:     Map<string, string>; // legacy Process value → process_master.id
  designation: Map<string, string>; // legacy Desig value → designation_master.id
  leaveType:   Map<string, string>; // leave_code → leave_type_master.id
}

async function seedTable(
  dst: Connection,
  table: string,
  codeCol: string,
  nameCol: string,
  values: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const val of values) {
    if (!val || val.trim() === '') continue;
    const code = toMasterCode(val);
    await dst.execute(
      `INSERT INTO ${table} (${codeCol}, ${nameCol}) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE ${nameCol} = ${nameCol}`,
      [code, val.trim()],
    );
    const [rows] = await dst.execute<RowDataPacket[]>(
      `SELECT id FROM ${table} WHERE ${codeCol} = ?`,
      [code],
    );
    if (rows[0]) map.set(val.trim(), rows[0].id as string);
  }
  return map;
}

export async function seedMasters(
  src: Connection,
  dst: Connection,
  table: string,
): Promise<MasterMaps> {
  console.log('  [Phase 1] Seeding master tables…');

  const [locRows] = await src.execute<RowDataPacket[]>(
    `SELECT DISTINCT Location FROM ${table} WHERE Location IS NOT NULL AND Location != ''`,
  );
  const [deptRows] = await src.execute<RowDataPacket[]>(
    `SELECT DISTINCT Depart FROM ${table} WHERE Depart IS NOT NULL AND Depart != ''`,
  );
  const [procRows] = await src.execute<RowDataPacket[]>(
    `SELECT DISTINCT Process FROM ${table} WHERE Process IS NOT NULL AND Process != ''`,
  );
  const [desigRows] = await src.execute<RowDataPacket[]>(
    `SELECT DISTINCT Desig FROM ${table} WHERE Desig IS NOT NULL AND Desig != ''`,
  );

  const branch      = await seedTable(dst, 'branch_master',      'branch_code',       'branch_name',       locRows.map(r => r.Location));
  const department  = await seedTable(dst, 'department_master',  'dept_code',         'dept_name',         deptRows.map(r => r.Depart));
  const process     = await seedTable(dst, 'process_master',     'process_code',      'process_name',      procRows.map(r => r.Process));
  const designation = await seedTable(dst, 'designation_master', 'designation_code',  'designation_name',  desigRows.map(r => r.Desig));

  // Build leave type map from existing leave_type_master
  const [ltRows] = await dst.execute<RowDataPacket[]>(
    `SELECT id, leave_code FROM leave_type_master`,
  );
  const leaveType = new Map<string, string>(ltRows.map(r => [r.leave_code as string, r.id as string]));

  console.log(`  [Phase 1] Done. branch:${branch.size} dept:${department.size} proc:${process.size} desig:${designation.size} leaveType:${leaveType.size}`);
  return { branch, department, process, designation, leaveType };
}
