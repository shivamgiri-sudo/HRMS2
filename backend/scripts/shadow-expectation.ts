/**
 * Hand-computed shadow expectation (plan, "Verification" > "Shadow proof").
 *
 * Organic shadow traffic is ~1-3 leave decisions/day, so waiting 48h yields a handful of
 * claims — enough to prove the pipe is connected, far too few to prove recipients are RIGHT.
 * This drives the REAL resolver from the REAL stored recipient_spec across a real sample,
 * so the eventual claim rows have something to be checked against.
 *
 * STRICTLY READ-ONLY: resolveRecipients only SELECTs. Nothing is claimed, sent or written.
 *
 * Run:  npx tsx scripts/shadow-expectation.ts        (SAMPLE_PER_BRANCH=4 by default)
 * SLOW by design: every resolution is several round trips, so against the off-LAN DB each
 * event takes ~60-75s. Do not wrap it in a short `timeout` — it gets killed mid-event and
 * looks like a hang.
 */
import { db } from '../src/db/mysql.js';
import { resolveRecipients } from '../src/shared/recipient-resolver.js';
import type { RecipientSpec } from '../src/shared/recipient-resolver.types.js';
import type { RowDataPacket } from 'mysql2';

const SAMPLE_PER_BRANCH = Number(process.env.SAMPLE_PER_BRANCH ?? 4);

async function main() {
  const [events] = await db.query<RowDataPacket[]>(
    `SELECT event_code, sensitivity, recipient_spec, enabled, dispatch_mode
       FROM notification_event_config
      WHERE event_code IN ('leave_decision','leave_submitted','leave_cancelled',
                           'roster_published','regularization_decision','payslip_ready')
      ORDER BY event_code`,
  );

  // A real spread of employees, not the first N — recipient bugs cluster by branch.
  const [emps] = await db.query<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, e.full_name, e.branch_id, e.process_id, b.branch_name
       FROM employees e LEFT JOIN branch_master b ON b.id = e.branch_id
      WHERE e.active_status = 1
      ORDER BY e.branch_id, e.id`,
  );
  const byBranch = new Map<string, RowDataPacket[]>();
  for (const e of emps) {
    const k = e.branch_name ?? '(no branch)';
    if (!byBranch.has(k)) byBranch.set(k, []);
    const arr = byBranch.get(k)!;
    if (arr.length < SAMPLE_PER_BRANCH) arr.push(e);
  }
  const sample = [...byBranch.values()].flat();
  console.log(`sampling ${sample.length} active employees across ${byBranch.size} branches\n`);

  for (const ev of events) {
    let spec: RecipientSpec;
    try {
      spec = typeof ev.recipient_spec === 'string' ? JSON.parse(ev.recipient_spec) : ev.recipient_spec;
    } catch {
      console.log(`${ev.event_code}: UNPARSEABLE recipient_spec\n`);
      continue;
    }

    const drops = new Map<string, number>();
    let deliverable = 0, empty = 0, threw = 0, to = 0, cc = 0, bcc = 0;
    const throwCodes = new Map<string, number>();

    for (const e of sample) {
      try {
        const r = await resolveRecipients(spec, {
          sensitivity: ev.sensitivity,
          context: { employeeId: e.id, branchId: e.branch_id, processId: e.process_id },
        });
        to += r.to.length; cc += r.cc.length; bcc += r.bcc.length;
        if (r.to.length) deliverable++; else empty++;
        for (const d of r.dropped) drops.set(d.reason, (drops.get(d.reason) ?? 0) + 1);
      } catch (err) {
        threw++;
        const code = (err as { code?: string }).code ?? (err as Error).message.slice(0, 40);
        throwCodes.set(code, (throwCodes.get(code) ?? 0) + 1);
      }
    }

    console.log(`── ${ev.event_code}  [${ev.sensitivity}] enabled=${ev.enabled} mode=${ev.dispatch_mode}`);
    console.log(`   deliverable ${deliverable}/${sample.length}   no-To ${empty}   threw ${threw}`);
    console.log(`   addressees: to=${to} cc=${cc} bcc=${bcc}`);
    if (drops.size) {
      console.log(`   drops: ${[...drops.entries()].sort((a, b) => b[1] - a[1])
        .map(([r, n]) => `${r}=${n}`).join('  ')}`);
    }
    if (throwCodes.size) {
      console.log(`   THREW: ${[...throwCodes.entries()].map(([c, n]) => `${c}=${n}`).join('  ')}`);
    }
    console.log();
  }

  // Per-branch deliverability for the highest-stakes event, since that is the go-live gate.
  const fin = events.find((e) => e.sensitivity === 'fin');
  if (fin) {
    const spec: RecipientSpec = typeof fin.recipient_spec === 'string'
      ? JSON.parse(fin.recipient_spec) : fin.recipient_spec;
    console.log(`=== ${fin.event_code} deliverability by branch (go-live gate) ===`);
    for (const [branch, list] of byBranch) {
      let ok = 0;
      for (const e of list) {
        try {
          const r = await resolveRecipients(spec, {
            sensitivity: fin.sensitivity,
            context: { employeeId: e.id, branchId: e.branch_id, processId: e.process_id },
          });
          if (r.to.length) ok++;
        } catch { /* counted as not-deliverable */ }
      }
      const pct = Math.round((ok / list.length) * 100);
      console.log(`  ${branch.padEnd(26)} ${String(ok).padStart(3)}/${String(list.length).padEnd(3)} ${pct}% ${'█'.repeat(Math.round(pct / 5))}`);
    }
  }

  await db.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
