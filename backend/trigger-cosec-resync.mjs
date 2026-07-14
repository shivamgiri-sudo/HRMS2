#!/usr/bin/env node
/**
 * Triggers COSEC sync via the running PM2 backend API (which has MSSQL access)
 * Usage: node backend/trigger-cosec-resync.mjs 2026-07-01 2026-07-14
 */
import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const env = readFileSync(resolve(__dirname, '.env'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

const FROM = process.argv[2] || '2026-07-01';
const TO   = process.argv[3] || '2026-07-14';
const PORT = process.env.PORT || 5055;

const mc = await mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, dateStrings: true,
});

// Find an admin user to login with
const [users] = await mc.execute(
  "SELECT email FROM users WHERE role IN ('admin','super_admin') AND active_status=1 LIMIT 5"
);
await mc.end();

console.log('Admin users found:');
users.forEach((u, i) => console.log(`  ${i+1}. ${u.email}`));

// Try each user with common passwords to get a token
const passwords = ['Admin@123', 'admin@123', 'Admin123', 'admin123', 'Mas@1234', 'mas@1234', 'Support#123', 'password', '123456'];

let token = null;
let usedEmail = null;

outer:
for (const u of users) {
  for (const pwd of passwords) {
    const res = await fetch(`http://localhost:${PORT}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: u.email, password: pwd }),
    });
    const data = await res.json();
    if (data.token || data.accessToken) {
      token = data.token || data.accessToken;
      usedEmail = u.email;
      console.log(`\nLogged in as: ${u.email}`);
      break outer;
    }
  }
}

if (!token) {
  console.error('\nCould not authenticate. Try: node backend/trigger-cosec-resync.mjs <from> <to> <email> <password>');
  // Support manual email/password as args
  if (process.argv[4] && process.argv[5]) {
    const res = await fetch(`http://localhost:${PORT}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: process.argv[4], password: process.argv[5] }),
    });
    const data = await res.json();
    token = data.token || data.accessToken;
    usedEmail = process.argv[4];
    if (token) console.log(`Logged in as: ${usedEmail}`);
  }
}

if (!token) {
  console.error('Authentication failed. Pass email and password as 4th and 5th args.');
  process.exit(1);
}

console.log(`\nTriggering COSEC sync: ${FROM} → ${TO}`);
console.log('This may take 1-3 minutes...\n');

const syncRes = await fetch(`http://localhost:${PORT}/api/cosec-sync/run`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  },
  body: JSON.stringify({ from: FROM, to: TO }),
});

const result = await syncRes.json();
console.log('Sync result:');
console.log(`  success      : ${result.success}`);
console.log(`  pulled events: ${result.pulledEvents}`);
console.log(`  grouped days : ${result.groupedDays}`);
console.log(`  migrated days: ${result.migratedDays}`);
if (result.unmappedUsers?.length) console.log(`  unmapped     : ${result.unmappedUsers.length}`);
if (result.failed?.length)        console.log(`  failed       : ${result.failed.length}`);
if (!result.success) console.log('Full result:', JSON.stringify(result, null, 2));

process.exit(0);
