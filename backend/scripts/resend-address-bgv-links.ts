/**
 * Re-sends the address-BGV email to candidates who were sent the original 72-hour link and have not
 * completed it, now with a 7-day window and the de-duplicated current-address text.
 *
 * It keeps the SAME token (so a link already in their inbox keeps working) and does not add an
 * attempt row, so no attempt out of the allowed 3 is used up. For each candidate it:
 *   - sets expires_at to now + 7 days and status back to 'pending' (also revives an expired link),
 *   - refreshes declared_address from the profile's CURRENT address (never the permanent one),
 *   - emails the link again.
 * Skipped: already submitted/decided, address already passed, no email, no current address.
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

const apply = process.argv.includes("--apply");
const limitArg = process.argv.indexOf("--limit");
const limit = limitArg > -1 ? Math.max(1, Number(process.argv[limitArg + 1]) || 0) : Infinity;
const EXPIRY_DAYS = 7;

async function main() {
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
      WHERE TIMESTAMPDIFF(HOUR, v.created_at, v.expires_at) <= 72
        AND v.submitted_at IS NULL
        AND v.hr_decision IS NULL
        AND v.status IN ('pending', 'expired')
        -- the latest attempt per candidate only
        AND v.attempt_number = (SELECT MAX(v2.attempt_number) FROM candidate_bgv_address_verification v2 WHERE v2.candidate_id = v.candidate_id)
      ORDER BY v.created_at`,
  );

  const appUrl = process.env.APP_URL ?? "https://mcnhrms.teammas.in";
  let done = 0, skipped = 0;
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

    await db.execute(
      `UPDATE candidate_bgv_address_verification SET expires_at = ?, status = 'pending', declared_address = ? WHERE id = ?`,
      [expiresAt, address, row.id],
    );
    const res = await sendAddressBgvLinkEmail({
      candidateId: String(row.candidate_id),
      to: String(row.email),
      candidateName: String(row.full_name ?? "Candidate"),
      declaredAddress: address,
      verificationLink: `${appUrl}/bgv-address-verify/${row.token}`,
      attemptNumber: Number(row.attempt_number),
      maxAttempts: MAX_ATTEMPTS,
      expiresAt,
    });
    if (!(res as { ok?: boolean; success?: boolean })?.ok && !(res as { success?: boolean })?.success) console.log(`  -> email result: ${JSON.stringify(res)}`);
  }
  console.log(`\n${done} ${apply ? "re-sent" : "would be re-sent (dry run — add --apply)"}; ${skipped} skipped; ${rows.length} candidate(s) matched the 72-hour filter.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
