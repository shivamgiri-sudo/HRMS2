/**
 * populate-call-centre-code.mjs
 *
 * One-time bridge script: matches shivamgiri.AgentMaster rows to employees
 * and backfills employees.call_centre_code where it is still NULL.
 *
 * Strategies tried IN ORDER per agent (stops at first match):
 *   a. call_centre_code already set and matches  → skip (already done)
 *   b. employee_code matches MasId               → update
 *   c. biometric_code matches MasId              → update
 *   d. SOUNDEX(full_name) matches AgentName      → update (fuzzy fallback)
 *
 * Usage:
 *   node backend/scripts/populate-call-centre-code.mjs
 *
 * Reads DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME from .env
 * (looked up from the repo root).
 */

import { createConnection } from 'mysql2/promise';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ── .env loader ────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../../.env');

function loadEnv(path) {
  try {
    const text = readFileSync(path, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    // .env may not exist in CI — rely on real env vars
  }
}

loadEnv(envPath);

const {
  DB_HOST = '127.0.0.1',
  DB_PORT = '3306',
  DB_USER,
  DB_PASSWORD,
  DB_NAME = 'mas_hrms',
} = process.env;

if (!DB_USER) {
  console.error('ERROR: DB_USER is not set. Check your .env file.');
  process.exit(1);
}

// ── helpers ───────────────────────────────────────────────────────────────────

/** Upper-trim, collapse whitespace, return '' for null/undefined */
function norm(v) {
  return String(v ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const conn = await createConnection({
    host: DB_HOST,
    port: Number(DB_PORT),
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    multipleStatements: false,
  });

  try {
    console.log(`Connected to ${DB_HOST}:${DB_PORT}/${DB_NAME}`);

    // ── 1. Load AgentMaster ────────────────────────────────────────────────
    console.log('\nLoading shivamgiri.AgentMaster…');
    const [agents] = await conn.execute(
      `SELECT MasId, AgentName
         FROM shivamgiri.AgentMaster
        WHERE MasId IS NOT NULL AND MasId != ''`,
    );
    console.log(`  ${agents.length} agents loaded`);

    if (!agents.length) {
      console.log('Nothing to do — AgentMaster is empty or unreachable.');
      return;
    }

    // ── 2. Load employees ─────────────────────────────────────────────────
    console.log('Loading employees…');
    const [employees] = await conn.execute(
      `SELECT id, employee_code, biometric_code, call_centre_code, full_name
         FROM employees`,
    );
    console.log(`  ${employees.length} employees loaded`);

    // Build lookup indexes (normalised key → employee row)
    const byCode      = new Map(); // employee_code   → row
    const byBiometric = new Map(); // biometric_code  → row
    const byCcc       = new Map(); // call_centre_code → row (already-set rows)
    const bySoundex   = new Map(); // soundex(full_name) → row[]

    for (const emp of employees) {
      const ec  = norm(emp.employee_code);
      const bc  = norm(emp.biometric_code);
      const ccc = norm(emp.call_centre_code);

      if (ec)  byCode.set(ec, emp);
      if (bc)  byBiometric.set(bc, emp);
      if (ccc) byCcc.set(ccc, emp);

      // Soundex: use the MySQL SOUNDEX algorithm approximation
      // We'll verify against the DB for real matches, but build a quick
      // name → employee_id map for a first pass.
      const name = norm(emp.full_name);
      if (name) {
        if (!bySoundex.has(name)) bySoundex.set(name, []);
        bySoundex.get(name).push(emp);
      }
    }

    // ── 3. Strategy d: fetch SOUNDEX matches from DB in bulk ──────────────
    // Build a map: soundex(AgentName) → [employee ids with matching soundex(full_name)]
    // We do this in a single query to avoid N round trips.
    const agentNames = [...new Set(agents.map((a) => a.AgentName).filter(Boolean))];
    let soundexMatches = new Map(); // MasId → employee row (first match)

    if (agentNames.length) {
      const placeholders = agentNames.map(() => '?').join(',');
      const [sdRows] = await conn.execute(
        `SELECT e.id, e.employee_code, e.biometric_code, e.call_centre_code, e.full_name,
                agent_names.agent_name AS matched_agent_name
           FROM employees e
           JOIN (
             SELECT SOUNDEX(?) AS sx, ? AS agent_name
             ${agentNames.slice(1).map(() => 'UNION ALL SELECT SOUNDEX(?), ?').join('\n')}
           ) agent_names ON SOUNDEX(e.full_name) = agent_names.sx
          WHERE e.call_centre_code IS NULL`,
        agentNames.flatMap((n) => [n, n]),
      );
      for (const row of sdRows) {
        const key = norm(row.matched_agent_name);
        if (!soundexMatches.has(key)) soundexMatches.set(key, row);
      }
    }

    // ── 4. Match each agent ────────────────────────────────────────────────
    const updates  = []; // { id, masId, strategy }
    const unmatched = [];
    const counts   = { a: 0, b: 0, c: 0, d: 0 };

    for (const agent of agents) {
      const masId     = norm(agent.MasId);
      const agentName = norm(agent.AgentName);

      // Strategy a: call_centre_code already set to this MasId → skip
      if (byCcc.has(masId)) {
        counts.a++;
        continue;
      }

      // Strategy b: employee_code matches MasId
      if (byCode.has(masId)) {
        const emp = byCode.get(masId);
        if (!norm(emp.call_centre_code)) {
          updates.push({ id: emp.id, masId: agent.MasId, strategy: 'b' });
          counts.b++;
          continue;
        }
      }

      // Strategy c: biometric_code matches MasId
      if (byBiometric.has(masId)) {
        const emp = byBiometric.get(masId);
        if (!norm(emp.call_centre_code)) {
          updates.push({ id: emp.id, masId: agent.MasId, strategy: 'c' });
          counts.c++;
          continue;
        }
      }

      // Strategy d: SOUNDEX name match
      if (soundexMatches.has(agentName)) {
        const emp = soundexMatches.get(agentName);
        if (!norm(emp.call_centre_code)) {
          updates.push({ id: emp.id, masId: agent.MasId, strategy: 'd' });
          counts.d++;
          continue;
        }
      }

      unmatched.push({ MasId: agent.MasId, AgentName: agent.AgentName });
    }

    console.log(`\nMatch summary:`);
    console.log(`  Strategy a (already set):    ${counts.a}`);
    console.log(`  Strategy b (employee_code):  ${counts.b}`);
    console.log(`  Strategy c (biometric_code): ${counts.c}`);
    console.log(`  Strategy d (soundex name):   ${counts.d}`);
    console.log(`  Unmatched:                   ${unmatched.length}`);
    console.log(`  Total agents:                ${agents.length}`);
    console.log(`  Updates to apply:            ${updates.length}`);

    // ── 5. Apply updates ──────────────────────────────────────────────────
    if (updates.length) {
      console.log('\nApplying updates…');
      let applied = 0;
      for (const u of updates) {
        const [result] = await conn.execute(
          `UPDATE employees SET call_centre_code = ? WHERE id = ? AND call_centre_code IS NULL`,
          [u.masId, u.id],
        );
        if (result.affectedRows > 0) applied++;
      }
      console.log(`  Applied: ${applied} / ${updates.length} rows updated`);
    }

    // ── 6. Write unmatched report ─────────────────────────────────────────
    const reportPath = resolve(__dirname, 'unmatched-agents.json');
    writeFileSync(reportPath, JSON.stringify(unmatched, null, 2), 'utf8');
    console.log(`\nUnmatched agents written to: ${reportPath}`);
    console.log(`  ${unmatched.length} agents could not be matched`);

  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message ?? err);
  process.exit(1);
});
