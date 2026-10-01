/**
 * Re-sends the address-BGV email to candidates who were sent the original 72-hour link and have not
 * completed it, now with a 7-day window and the de-duplicated current-address text.
 *
 * Selects the latest attempt of every candidate whose link was ISSUED before the 7-day rule went
 * live (CUTOFF below), is still unsubmitted/undecided, and whose address is not already verified.
 * It keeps the SAME token (so a link already in their inbox keeps working) and adds no attempt row,
 * so no attempt out of the allowed 3 is used up. For each candidate it:
 *   1. emails the link again with a 7-day expiry and the current-address text (never permanent),
 *   2. ONLY IF that email was actually sent, sets expires_at = now + 7 days, status 'pending', and
 *      refreshes declared_address. A skipped/failed send (e.g. SMTP not configured on the machine
 *      running this) leaves the row untouched and is reported as a failure, not as a success.
 * Run it where SMTP is configured (the production host / the Ops Scripts workflow). Running it twice
 * emails the same people twice.
 * Skipped: no email, no current address, address already verified.
 *
 * Dry-run by default; nothing is written or sent without --apply.
 *   npx tsx scripts/resend-address-bgv-links.ts                 # list who would be re-sent
 *   npx tsx scripts/resend-address-bgv-links.ts --apply         # extend + send
 *   npx tsx scripts/resend-address-bgv-links.ts --apply --limit 5   # first 5 only
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { buildPresentAddress, MAX_ATTEMPTS } from "../src/modules/ats/bgv-address-verification.routes.js";
import { sendAddressBgvLinkEmail } from "../src/modules/ats/ats.email.service.js";
import { env } from "../src/config/env.js";

const apply = process.argv.includes("--apply");
const limitArg = process.argv.indexOf("--limit");
const limit = limitArg > -1 ? Math.max(1, Number(process.argv[limitArg + 1]) || 0) : Infinity;
const EXPIRY_DAYS = 7;
// Local DB time (IST) before which links were still issued with the old 72-hour expiry. Checked against
// production on 2026-10-01: the last 72h link was created at 16:43-17:15 and every link from 17:41 on
// already carries 168 hours and was emailed correctly by the normal flow, so the cut sits between them.
const CUTOFF = "2026-10-01 17:30:00";

async function main() {
  // The mailer reports { ok: true } even when it silently skips for missing SMTP credentials, so a
  // misconfigured machine would look like a clean run. Refuse to apply anywhere that cannot send.
  if (apply && (!env.SMTP_USER || !env.SMTP_PASS)) {
    throw new Error("SMTP is not configured on this machine — refusing --apply. Run it on the production host (Ops Scripts workflow).");
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT v.id, v.candidate_id, v.token, v.attempt_number, v.status, v.expires_at,
            c.full_name, c.email,
            p.current_address, p.present_address_line1, p.present_address_line2, p.present_address,
            p.present_city, p.present_state, p.present_pincode,
            r.address_status
       FROM candidate_bgv_address_verification v
       JOIN ats_candidate c ON c.id = v.candidate_id
       LEFT JOIN candidate_onboarding_profile p ON p.candidate_id = v.candidate_id
       LEFT JOIN candidate_bgv_report r ON r.candidate_id = v.candidate_id
      WHERE v.created_at < ?
        AND v.submitted_at IS NULL
        AND v.hr_decision IS NULL
        AND v.status IN ('pending', 'expired')
        -- the latest attempt per candidate only
        AND v.attempt_number = (SELECT MAX(v2.attempt_number) FROM candidate_bgv_address_verification v2 WHERE v2.candidate_id = v.candidate_id)
      ORDER BY v.created_at`,
    [CUTOFF],
  );

  const appUrl = process.env.APP_URL ?? "https://mcnhrms.teammas.in";
  let done = 0, skipped = 0, failed = 0;
  for (const row of rows) {
    if (done >= limit) break;
    const who = `${row.full_name} <${row.email}>`;
    if (String(row.address_status ?? "") === "passed") { skipped++; console.log(`SKIP ${who}: address already verified`); continue; }
    if (!row.email || !String(row.email).trim()) { skipped++; console.log(`SKIP ${who}: no email`); continue; }
    const address = buildPresentAddress(row);
    if (!address) { skipped++; console.log(`SKIP ${who}: no current address`); continue; }

    const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 24 * 3600 * 1000);
    console.log(`${apply ? "RESEND" : "WOULD RESEND"} ${who}  attempt=${row.attempt_number} was=${row.status}  address="${address}"`);
    done++;
    if (!apply) continue;

    const sent = await sendAddressBgvLinkEmail({
      candidateId: String(row.candidate_id),
      to: String(row.email),
      candidateName: String(row.full_name ?? "Candidate"),
      declaredAddress: address,
      verificationLink: `${appUrl}/bgv-address-verify/${row.token}`,
      attemptNumber: Number(row.attempt_number),
      maxAttempts: MAX_ATTEMPTS,
      expiresAt,
    });
    if (!sent?.ok) {
      failed++;
      done--;
      console.log(`  FAILED ${who}: email not sent (${sent?.error ?? "unknown"}) — row left unchanged`);
      continue;
    }
    await db.execute(
      `UPDATE candidate_bgv_address_verification SET expires_at = ?, status = 'pending', declared_address = ? WHERE id = ?`,
      [expiresAt, address, row.id],
    );
  }
  console.log(`\n${done} ${apply ? "re-sent" : "would be re-sent (dry run — add --apply)"}; ${skipped} skipped; ${failed} FAILED to send; ${rows.length} candidate(s) matched.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
