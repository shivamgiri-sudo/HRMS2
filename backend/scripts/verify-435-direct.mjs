import mysql from './node_modules/mysql2/promise.js';
import { readFileSync } from 'fs';

const env = readFileSync('./backend/.env','utf8');
const get = k => env.match(new RegExp('^'+k+'=(.+)','m'))?.[1]?.trim();

const conn = await mysql.createConnection({
  host: '122.184.128.90',
  port: 3306,
  user: 'shivam_user',
  password: '"qwersdfg!@#hjk"',
  database: 'mas_hrms',
  connectTimeout: 8000,
});

const PAGE_CODES = ['ATTENDANCE_BILLING_CONFIG','BENEFITS','CLIENT_MASTER',
  'COMPLIANCE_AUDIT_REPORT','EXIT_COMMAND_CENTER','LEAVE_TYPES',
  'MCNMEET','MOBILITY','PORTAL_DATA_MANAGER','PROCESS_CONFIG','SUPPORT_COMMAND_CENTER'];

const [catalog] = await conn.query(
  'SELECT page_code, page_name, active_status FROM page_catalog WHERE page_code IN (?) ORDER BY page_code',
  [PAGE_CODES]);
console.log('\n=== page_catalog ===');
for(const r of catalog) console.log(' ',r.page_code.padEnd(34),'name='+r.page_name,'active='+r.active_status);

const [grants] = await conn.query(
  'SELECT role_key, page_code, can_view, can_create, can_edit, can_delete, can_export FROM role_page_access WHERE page_code IN (?) ORDER BY page_code, role_key',
  [PAGE_CODES]);
console.log('\n=== role_page_access (current) ===');
if(!grants.length) console.log('  0 rows for all 11 — all super_admin-only via catalog default');
for(const r of grants) console.log(' ',r.page_code.padEnd(34),'role='+r.role_key);

const cnt={};
for(const r of grants) cnt[r.page_code]=(cnt[r.page_code]||0)+1;
console.log('\n=== Per-page grant count ===');
for(const pc of PAGE_CODES) console.log(' ',pc.padEnd(34),(cnt[pc]??0),'rows');

await conn.end();
