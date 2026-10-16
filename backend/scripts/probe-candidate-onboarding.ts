/**
 * Onboarding link + state for specific candidates. READ-ONLY (one SELECT).
 *   npx tsx scripts/probe-candidate-onboarding.ts CND-AAAA CND-BBBB
 * Prints the same link the app sends: <FRONTEND_URL>/onboard-full?token=<token>.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const codes = process.argv.slice(2).map((c) => c.trim().toUpperCase()).filter((c) => /^CND-[A-Z0-9]{4,20}$/.test(c));
(async () => {
  if (!codes.length) { console.log("no valid candidate codes"); process.exit(1); }
  const base = (process.env.FRONTEND_URL || "https://mcnhrms.teammas.in").replace(/\/$/, "");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT c.candidate_code, c.full_name, c.mobile, c.profile_status,
            b.status AS bridge_status, b.onboarding_token, DATE_FORMAT(b.onboarding_token_expires_at, '%Y-%m-%d %H:%i') AS expires_at,
            (b.onboarding_token_expires_at IS NOT NULL AND b.onboarding_token_expires_at < NOW()) AS expired
       FROM ats_candidate c LEFT JOIN ats_onboarding_bridge b ON b.candidate_id = c.id
      WHERE UPPER(c.candidate_code) IN (${codes.map(() => "?").join(",")})`, codes);
  for (const code of codes) {
    const r = (rows as RowDataPacket[]).find((x) => String(x.candidate_code).toUpperCase() === code);
    if (!r) { console.log(`${code}: NOT FOUND`); continue; }
    console.log(`${code} | ${r.full_name} | mobile ${String(r.mobile ?? "").replace(/\d(?=\d{4})/g, "*")} | profile ${r.profile_status} | onboarding ${r.bridge_status ?? "(no bridge row)"}`);
    console.log(r.onboarding_token
      ? `  link: ${base}/onboard-full?token=${r.onboarding_token}  | expires ${r.expires_at ?? "-"}${Number(r.expired) ? "  ** EXPIRED: resend from ATS -> Onboarding Requests **" : ""}`
      : "  link: none (no token yet: use Resend link in ATS -> Onboarding Requests)");
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
