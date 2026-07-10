import { notificationService } from "./notification.service.js";
import type { NotificationRecipient, NotificationContext } from "./notification.service.js";

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
       JOIN user_role ur ON ur.user_id = au.id
       JOIN role r ON r.id = ur.role_id
       WHERE r.role_key IN ('hr', 'admin', 'super_admin')
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
 * Send SLA_BREACH notification when candidate waits too long
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
       JOIN user_role ur ON ur.user_id = au.id
       JOIN role r ON r.id = ur.role_id
       WHERE r.role_key IN ('hr', 'admin', 'super_admin')
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
      console.warn("[ATSNotification] No recipients for SLA_BREACH");
      return;
    }

    const context: NotificationContext = {
      CandidateName: input.candidateName,
      QToken: input.qToken,
      RecruiterName: input.recruiterName,
      Branch: input.branch,
      RoleApplied: input.roleApplied,
      SLAMinutes: input.slaMinutes.toString(),
    };

    await notificationService.send({
      template_code: "SLA_BREACH",
      recipients,
      context,
    });
  } catch (error: any) {
    console.error("[ATSNotification] SLA_BREACH failed:", error.message);
  }
}
