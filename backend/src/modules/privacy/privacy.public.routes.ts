import { Router } from "express";
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * Public privacy surfaces — no authentication.
 *
 * This router exists separately from privacy.routes.ts because clientRouter is mounted on
 * the bare "/api" prefix and calls `router.use(requireAuth)`, so every router mounted after
 * it is unreachable without a token. privacy.routes.ts is mounted after it. The site footer
 * renders on public pages — the landing page and the privacy policy itself — where there is
 * no token to send, so serving the grievance officer from there returned 401 to exactly the
 * visitors who most need it.
 *
 * Mounted in app.ts ahead of clientRouter so it is reached first.
 *
 * Only the statutory contact block is exposed: the officer's name, address, designation and
 * response window. Nothing here is personal data of any data principal.
 */
export const privacyPublicRouter = Router();

const h = (fn: (req: never, res: Response) => Promise<unknown>) =>
  (req: never, res: Response, next: (error?: unknown) => void) => fn(req, res).catch(next);

export interface GrievanceOfficer {
  name: string;
  email: string;
  designation: string;
  sla_days: number;
}

/**
 * dpdp_config seeds these keys with placeholders so a fresh install has rows to edit rather
 * than missing ones. They are not contact details, and production still holds exactly them.
 * Publishing them would name "To be configured" as the DPDP Grievance Officer and point
 * complaints at an address nobody reads: the statutory obligation would look discharged
 * while every grievance went nowhere.
 */
const GRIEVANCE_PLACEHOLDERS = new Set([
  "to be configured",
  "privacy@yourcompany.com",
]);

const configured = (value: string | undefined) => {
  const trimmed = (value ?? "").trim();
  return trimmed && !GRIEVANCE_PLACEHOLDERS.has(trimmed.toLowerCase()) ? trimmed : "";
};

/** Exported so the placeholder rules can be tested without standing up the route. */
export function resolveGrievanceOfficer(
  config: Map<string, string>
): GrievanceOfficer | null {
  const name = configured(config.get("grievance_officer_name"));
  const email = configured(config.get("grievance_officer_email"));
  // Both are needed for the footer to be useful: a name with no address gives a visitor
  // nobody to write to, and an address with no name is not an identified officer.
  if (!name || !email) return null;

  const slaDays = Number(config.get("grievance_response_sla_days"));
  return {
    name,
    email,
    designation: configured(config.get("grievance_officer_designation")),
    // The DPDP Act sets the response period; fall back to the statutory 30 rather than 0,
    // which would advertise an impossible turnaround.
    sla_days: Number.isFinite(slaDays) && slaDays > 0 ? slaDays : 30,
  };
}

// GET /grievance-officer — the site footer renders this on every page, signed in or not.
privacyPublicRouter.get(
  "/grievance-officer",
  h(async (_req, res: Response) => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT config_key, config_value
         FROM dpdp_config
        WHERE config_key IN (
          'grievance_officer_name',
          'grievance_officer_email',
          'grievance_officer_designation',
          'grievance_response_sla_days'
        )`
    );
    const config = new Map(rows.map((row) => [String(row.config_key), String(row.config_value)]));
    // null, not 404: the footer asks on every page and simply renders nothing when the
    // officer is unset. An error would be noise for a state that is merely unconfigured.
    return res.json({ success: true, data: resolveGrievanceOfficer(config) });
  })
);
