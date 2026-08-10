/**
 * seed-demo-auth.ts
 * Run once on a fresh local database to create demo auth accounts.
 *
 * Usage:
 *   cd backend
 *   npx tsx scripts/seed-demo-auth.ts
 */
import bcrypt from 'bcryptjs';
import { db } from '../src/db/mysql.js';

const DEMO_ACCOUNTS = [
  { id: 'demo-admin-id',     email: 'admin@mascallnet.com' },
  { id: 'demo-hr-id',        email: 'hr@mascallnet.com' },
  { id: 'demo-recruiter-id', email: 'recruiter@mascallnet.com' },
  { id: 'demo-manager-id',   email: 'manager@mascallnet.com' },
  { id: 'demo-tl-id',        email: 'tl@mascallnet.com' },
  { id: 'demo-qa-id',        email: 'qa@mascallnet.com' },
  { id: 'demo-wfm-id',       email: 'wfm@mascallnet.com' },
  { id: 'demo-finance-id',   email: 'finance@mascallnet.com' },
  { id: 'demo-employee-id',  email: 'employee@mascallnet.com' },
  { id: 'demo-ceo-id',       email: 'ceo@mascallnet.com' },
  { id: 'demo-trainer-id',   email: 'trainer@mascallnet.com' },
];

const DEMO_ROLES: Record<string, string[]> = {
  'demo-admin-id':     ['admin'],
  'demo-hr-id':        ['hr'],
  'demo-recruiter-id': ['recruiter'],
  'demo-manager-id':   ['process_manager'],
  'demo-tl-id':        ['team_leader'],
  'demo-qa-id':        ['qa'],
  'demo-wfm-id':       ['wfm'],
  'demo-finance-id':   ['finance'],
  'demo-employee-id':  ['employee'],
  'demo-ceo-id':       ['ceo'],
  'demo-trainer-id':   ['trainer'],
};

async function main() {
  const demoPassword = process.env.DEMO_AUTH_PASSWORD?.trim();
  if (!demoPassword || demoPassword.length < 12) {
    throw new Error('DEMO_AUTH_PASSWORD with at least 12 characters is required');
  }
  console.log('Seeding demo auth accounts...');
  for (const account of DEMO_ACCOUNTS) {
    const hash = await bcrypt.hash(demoPassword, 10);
    await db.execute(
      `INSERT INTO auth_user (id, email, password_hash)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
      [account.id, account.email, hash]
    );

    const roles = DEMO_ROLES[account.id] ?? [];
    for (const roleKey of roles) {
      await db.execute(
        `INSERT INTO user_roles (id, user_id, role_key, active_status)
         VALUES (UUID(), ?, ?, 1)
         ON DUPLICATE KEY UPDATE active_status = 1`,
        [account.id, roleKey]
      );
    }

    console.log(`  seeded: ${account.email} (${roles.join(', ')})`);
  }
  console.log('Done. Demo accounts ready.');
  await db.end();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
