import { notificationService } from "./notification.service.js";
import type { NotificationRecipient, NotificationContext } from "./notification.service.js";
import { emailService } from "../modules/communication/email.service.js";

// Database connection
let db: any;
try {
  const dbModule = await import("../db/mysql.js");
  db = dbModule.db;
} catch {
  console.warn("[ATSNotification] Database module not found");
}

// ── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Send REG_RECRUITER notification when candidate is assigned
 */
export async function notifyRecruiterNewAssignment(input: {
  candidateId: string;
  candidateName: string;
  mobile: string;
  email: string;
  branch: string;
  roleApplied: string;
  qToken: string;
  recruiterName: string;
}): Promise<void> {
  try {
    // Get recruiter email/mobile
    const [recruiterRows]: any = await db.execute(
      "SELECT email, mobile FROM ats_recruiter_roster WHERE name = ? AND active_status = 1 LIMIT 1",
      [input.recruiterName]
    );

    const recipients: NotificationRecipient[] = [];

    if (recruiterRows && recruiterRows[0]?.email) {
      recipients.push({
        type: "recruiter",
        email: recruiterRows[0].email,
        mobile: recruiterRows[0].mobile,
        name: input.recruiterName,
      });
    }

    // Also notify HR
    const [hrRows]: any = await db.execute(
      `SELECT DISTINCT e.email
       FROM employees e
       JOIN auth_user au ON au.id = e.user_id
       JOIN user_roles ur ON ur.user_id = au.id AND ur.active_status = 1
       WHERE ur.role_key IN ('hr', 'admin', 'super_admin')
       AND e.active_status = 1
       AND e.email IS NOT NULL
       LIMIT 3`
    );

    if (hrRows) {
      for (const hr of hrRows) {
        if (hr.email) {
          recipients.push({
            type: "hr",
            email: hr.email,
          });
        }
      }
    }

    if (recipients.length === 0) {
      console.warn("[ATSNotification] No recipients for REG_RECRUITER");
      return;
    }

    const context: NotificationContext = {
      CandidateName: input.candidateName,
      Mobile: input.mobile,
      Email: input.email,
      Branch: input.branch,
      RoleApplied: input.roleApplied,
      QToken: input.qToken,
      RecruiterName: input.recruiterName,
      Org_Name: "MAS Callnet",
    };

    await notificationService.send({
      template_code: "REG_RECRUITER",
      recipients,
      context,
    });
  } catch (error: any) {
    console.error("[ATSNotification] REG_RECRUITER failed:", error.message);
  }
}

/**
 * Send STAGE_SELECTED notification when candidate clears a round
 */
export async function notifyCandidateStageSelected(input: {
  candidateId: string;
  candidateName: string;
  candidateEmail?: string;
  candidateMobile?: string;
  stageName: string;
  roleApplied: string;
}): Promise<void> {
  try {
    if (!input.candidateEmail && !input.candidateMobile) {
      console.warn("[ATSNotification] No contact info for candidate");
      return;
    }

    const recipients: NotificationRecipient[] = [
      {
        type: "candidate",
        id: input.candidateId,
        email: input.candidateEmail,
        mobile: input.candidateMobile,
        name: input.candidateName,
      },
    ];

    const context: NotificationContext = {
      CandidateName: input.candidateName,
      StageName: input.stageName,
      RoleApplied: input.roleApplied,
      Org_Name: "MAS Callnet",
    };

    await notificationService.send({
      template_code: "STAGE_SELECTED",
      recipients,
      context,
    });
  } catch (error: any) {
    console.error("[ATSNotification] STAGE_SELECTED failed:", error.message);
  }
}

/**
 * Send STAGE_REJECTED notification when candidate is rejected
 */
export async function notifyCandidateStageRejected(input: {
  candidateId: string;
  candidateName: string;
  candidateEmail?: string;
  roleApplied: string;
}): Promise<void> {
  try {
    if (!input.candidateEmail) {
      console.warn("[ATSNotification] No email for rejected candidate");
      return;
    }

    const recipients: NotificationRecipient[] = [
      {
        type: "candidate",
        id: input.candidateId,
        email: input.candidateEmail,
        name: input.candidateName,
      },
    ];

    const context: NotificationContext = {
      CandidateName: input.candidateName,
      RoleApplied: input.roleApplied,
      Org_Name: "MAS Callnet",
    };

    await notificationService.send({
      template_code: "STAGE_REJECTED",
      recipients,
      context,
    });
  } catch (error: any) {
    console.error("[ATSNotification] STAGE_REJECTED failed:", error.message);
  }
}

/**
 * Send FINAL_SELECTED notification with offer details
 */
export async function notifyCandidateFinalSelected(input: {
  candidateId: string;
  candidateName: string;
  candidateEmail?: string;
  roleApplied: string;
  offerDOJ: string;
  offerShift: string;
  offerSalary: number;
}): Promise<void> {
  try {
    if (!input.candidateEmail) {
      console.warn("[ATSNotification] No email for selected candidate");
      return;
    }

    const recipients: NotificationRecipient[] = [
      {
        type: "candidate",
        id: input.candidateId,
        email: input.candidateEmail,
        name: input.candidateName,
      },
    ];

    // TODO: Get actual form links from config
    const candidateConfirmLink = "https://forms.example.com/candidate-confirm";
    const day1DocFormLink = "https://forms.example.com/day1-docs";
    const day1Docs = `
- Original Aadhaar Card
- PAN Card
- Educational Certificates (10th, 12th, Graduation)
- Previous Employment Documents (if applicable)
- 2 Passport Size Photos
- Bank Account Details (Cancelled Cheque)
    `.trim();

    const context: NotificationContext = {
      CandidateName: input.candidateName,
      RoleApplied: input.roleApplied,
      OfferDOJ: input.offerDOJ,
      OfferShift: input.offerShift,
      OfferSalary: input.offerSalary.toString(),
      CandidateConfirmLink: candidateConfirmLink,
      Day1DocFormLink: day1DocFormLink,
      Day1Docs: day1Docs,
      Org_Name: "MAS Callnet",
    };

    await notificationService.send({
      template_code: "FINAL_SELECTED",
      recipients,
      context,
    });
  } catch (error: any) {
    console.error("[ATSNotification] FINAL_SELECTED failed:", error.message);
  }
}

/**
 * Build HTML email for SLA breach alert.
 * Shows candidate name, recruiter name, branch, position, and wait time.
 * Does NOT expose the internal candidate UUID.
 */
function buildSlaBreachHtml(input: {
  candidateName: string;
  recruiterName: string;
  branch: string;
  roleApplied: string;
  slaMinutes: number;
  qToken: string;
}): string {
  const waitStr = input.slaMinutes >= 60
    ? `${Math.floor(input.slaMinutes / 60)}h ${input.slaMinutes % 60}m`
    : `${input.slaMinutes} min`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:#dc2626;padding:24px 32px;">
            <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:1px;color:#fecaca;text-transform:uppercase;">MAS Callnet ATS</p>
            <h1 style="margin:6px 0 0;font-size:20px;font-weight:700;color:#ffffff;">⚠ Candidate Waiting — SLA Breached</h1>
          </td>
        </tr>

        <!-- Alert banner -->
        <tr>
          <td style="background:#fef2f2;border-bottom:1px solid #fecaca;padding:14px 32px;">
            <p style="margin:0;font-size:14px;color:#991b1b;font-weight:600;">
              A candidate has been waiting for <strong>${waitStr}</strong> without being attended.
            </p>
          </td>
        </tr>

        <!-- Detail table -->
        <tr>
          <td style="padding:28px 32px 8px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
              <tr>
                <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;width:40%;">
                  <span style="font-size:11px;font-weight:600;letter-spacing:.5px;color:#64748b;text-transform:uppercase;">Candidate</span>
                </td>
                <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;">
                  <span style="font-size:14px;font-weight:600;color:#0f172a;">${escapeHtml(input.candidateName)}</span>
                  <span style="font-size:12px;color:#64748b;margin-left:8px;">Token: ${escapeHtml(input.qToken)}</span>
                </td>
              </tr>
              <tr>
                <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;">
                  <span style="font-size:11px;font-weight:600;letter-spacing:.5px;color:#64748b;text-transform:uppercase;">Recruiter</span>
                </td>
                <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;">
                  <span style="font-size:14px;color:#0f172a;">${escapeHtml(input.recruiterName)}</span>
                </td>
              </tr>
              <tr>
                <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;">
                  <span style="font-size:11px;font-weight:600;letter-spacing:.5px;color:#64748b;text-transform:uppercase;">Branch</span>
                </td>
                <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;">
                  <span style="font-size:14px;color:#0f172a;">${escapeHtml(input.branch)}</span>
                </td>
              </tr>
              <tr>
                <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;">
                  <span style="font-size:11px;font-weight:600;letter-spacing:.5px;color:#64748b;text-transform:uppercase;">Position Applied</span>
                </td>
                <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;">
                  <span style="font-size:14px;color:#0f172a;">${escapeHtml(input.roleApplied)}</span>
                </td>
              </tr>
              <tr>
                <td style="padding:10px 0;">
                  <span style="font-size:11px;font-weight:600;letter-spacing:.5px;color:#64748b;text-transform:uppercase;">Waiting Time</span>
                </td>
                <td style="padding:10px 0;">
                  <span style="font-size:16px;font-weight:700;color:#dc2626;">${waitStr}</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- CTA -->
        <tr>
          <td style="padding:8px 32px 28px;">
            <p style="margin:0 0 16px;font-size:13px;color:#475569;">
              Please ensure the recruiter attends to this candidate immediately.
            </p>
            <a href="https://mcnhrms.teammas.in/ats/walkin-queue"
               style="display:inline-block;background:#dc2626;color:#ffffff;font-size:13px;font-weight:600;padding:10px 22px;border-radius:6px;text-decoration:none;">
              Open Walk-in Queue →
            </a>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 32px;">
            <p style="margin:0;font-size:11px;color:#94a3b8;">This is an automated alert from MAS Callnet ATS. Do not reply to this email.</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Send SLA_BREACH notification when candidate waits too long.
 * Recipients: recruiter's reporting manager (TO) + recruiter (CC).
 * Reporting manager resolved via 3-level fallback:
 *   1. ats_recruiter_roster.reporting_manager if it contains '@'
 *   2. employees.reporting_manager_id → auth_user.email
 *   3. manager employees.email directly
 */
export async function notifySLABreach(input: {
  candidateId: string;
  candidateName: string;
  qToken: string;
  recruiterName: string;
  branch: string;
  roleApplied: string;
  slaMinutes: number;
}): Promise<void> {
  try {
    // Resolve recruiter email + reporting manager email in one query
    const [rosterRows]: any = await db.execute(
      `SELECT
         rr.email                                                        AS recruiter_email,
         rr.mobile                                                       AS recruiter_mobile,
         COALESCE(
           CASE WHEN rr.reporting_manager LIKE '%@%' THEN rr.reporting_manager ELSE NULL END,
           NULLIF(manager_user.email, ''),
           NULLIF(manager_emp.email, '')
         )                                                               AS manager_email,
         COALESCE(
           NULLIF(manager_emp.full_name, ''),
           CONCAT(COALESCE(manager_emp.first_name,''), ' ', COALESCE(manager_emp.last_name,''))
         )                                                               AS manager_name
       FROM ats_recruiter_roster rr
       LEFT JOIN employees emp         ON emp.id = rr.employee_id
       LEFT JOIN employees manager_emp ON manager_emp.id = emp.reporting_manager_id
       LEFT JOIN auth_user manager_user ON manager_user.id = manager_emp.user_id
       WHERE rr.name = ? AND rr.active_status = 1
       LIMIT 1`,
      [input.recruiterName]
    );

    const roster = rosterRows?.[0];
    const recruiterEmail: string | null = roster?.recruiter_email || null;
    const managerEmail: string | null = roster?.manager_email || null;

    if (!managerEmail && !recruiterEmail) {
      console.warn(`[ATSNotification] No email addresses resolved for recruiter "${input.recruiterName}" — SLA alert skipped`);
      return;
    }

    const subject = `[SLA Alert] Candidate waiting ${input.slaMinutes} min — ${input.branch}`;
    const html = buildSlaBreachHtml(input);
    const text = `SLA BREACH: ${input.candidateName} (Token: ${input.qToken}) has been waiting ${input.slaMinutes} minutes.\n\nRecruiter: ${input.recruiterName}\nBranch: ${input.branch}\nPosition: ${input.roleApplied}\n\nPlease attend immediately.`;

    if (managerEmail) {
      // TO: reporting manager, CC: recruiter
      await emailService.send({
        to: managerEmail,
        subject,
        html,
        text,
        ...(recruiterEmail ? { cc: recruiterEmail } : {}),
      });
      console.log(`[ATSNotification] SLA alert sent → manager: ${managerEmail}${recruiterEmail ? `, cc: ${recruiterEmail}` : ""}`);
    } else if (recruiterEmail) {
      // Fallback: no manager found — send directly to recruiter
      await emailService.send({ to: recruiterEmail, subject, html, text });
      console.log(`[ATSNotification] SLA alert sent → recruiter (no manager found): ${recruiterEmail}`);
    }
  } catch (error: any) {
    console.error("[ATSNotification] SLA_BREACH failed:", error.message);
  }
}
