import nodemailer from 'nodemailer';
import { randomUUID } from 'crypto';
import { db } from '../../db/mysql.js';
import { env } from '../../config/env.js';
import {
  candidateSuccessEmail,
  recruiterNotificationEmail,
  selectionCongratulationsEmail,
  selectionLetterOfIntent,
  bgvCompletionEmail,
  payrollHRNotificationEmail,
  branchHeadApprovalEmail,
  rejectedEmail,
} from './email.templates.js';

type EmailType = 'registration' | 'selected' | 'rejected' | 'rejected_professional' | 'token_sent' | 'offer_review' | 'approved' | 'welcome' |
                 'recruiter_notification' | 'selection_congratulations' | 'selection_letter' | 'bgv_completion' | 'payroll_hr_notification' | 'branch_head_approval' | 'otp_verification' |
                 'joining_doc_reminder';

interface SendResult { ok: boolean; error?: string }

const transporter = nodemailer.createTransport({
  host:   env.SMTP_HOST   || '',
  port:   Number(env.SMTP_PORT || 587),
  secure: false,
  auth: {
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
  },
});

async function logEmail(
  candidateId: string,
  type: EmailType,
  sentTo: string,
  status: 'sent' | 'failed' | 'skipped',
  error?: string,
) {
  try {
    await db.execute(
      `INSERT IGNORE INTO ats_email_log (id, candidate_id, email_type, sent_to, status, error_message)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [randomUUID(), candidateId, type, sentTo, status, error ?? null],
    );
  } catch (logError: unknown) {
    const message = logError instanceof Error ? logError.message : String(logError);
    console.warn(`[ATS-EMAIL] failed to log ${type} email for ${candidateId}: ${message}`);
  }
}

async function send(
  to: string,
  subject: string,
  html: string,
  candidateId: string,
  type: EmailType,
): Promise<SendResult> {
  if (!env.SMTP_USER || !env.SMTP_PASS) {
    console.warn(`[ATS-EMAIL] SMTP not configured - skipping ${type} to ${to} (candidate ${candidateId})`);
    await logEmail(candidateId, type, to, 'skipped', 'SMTP not configured');
    return { ok: true };
  }
  const fromAddr = env.SMTP_FROM || env.SMTP_USER;
  const finalHtml = /<html[\s>]/i.test(html)
    ? html
    : atsFrame({
        eyebrow: "MAS Callnet HRMS",
        title: subject.replace(/[^\x20-\x7E]/g, "-"),
        body: html,
      });
  try {
    await transporter.sendMail({ from: `"MAS Callnet" <${fromAddr}>`, to, subject: subject.replace(/[^\x20-\x7E]/g, "-"), html: finalHtml });
    await logEmail(candidateId, type, to, 'sent');
    return { ok: true };
  } catch (err: unknown) {
    const msg = (err as Error)?.message ?? String(err);
    await logEmail(candidateId, type, to, 'failed', msg);
    return { ok: false, error: msg };
  }
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function atsFrame(input: {
  eyebrow: string;
  title: string;
  body: string;
  actionLabel?: string;
  actionUrl?: string;
  note?: string;
}): string {
  const action = input.actionLabel && input.actionUrl
    ? `<p style="margin:26px 0 10px"><a href="${escapeHtml(input.actionUrl)}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:999px;font-weight:800">${escapeHtml(input.actionLabel)}</a></p>`
    : "";
  const note = input.note
    ? `<div style="margin-top:22px;border-left:4px solid #f59e0b;background:#fffbeb;border-radius:12px;padding:14px 16px;color:#92400e;font-size:14px;line-height:1.6">${input.note}</div>`
    : "";

  return `<!doctype html>
<html>
<body style="margin:0;background:#eef2f7;font-family:Arial,Helvetica,sans-serif;color:#111827">
  <div style="max-width:660px;margin:0 auto;padding:28px 16px">
    <div style="overflow:hidden;border-radius:24px;background:#ffffff;box-shadow:0 18px 50px rgba(15,23,42,.12)">
      <div style="background:linear-gradient(135deg,#083344,#0f766e 58%,#f59e0b);padding:30px;color:#ffffff">
        <div style="font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#ccfbf1">${escapeHtml(input.eyebrow)}</div>
        <h1 style="margin:10px 0 0;font-size:28px;line-height:1.22">${escapeHtml(input.title)}</h1>
      </div>
      <div style="padding:30px;font-size:15px;line-height:1.75">
        ${input.body}
        ${action}
        ${note}
        <p style="margin:30px 0 0;color:#64748b">Regards,<br><strong>MAS Callnet Talent Team</strong></p>
      </div>
    </div>
    <p style="margin:14px 0 0;text-align:center;font-size:11px;color:#94a3b8">This is an automated HRMS notification. Please keep candidate and employee information confidential.</p>
  </div>
</body>
</html>`;
}

export async function sendRegistrationEmail(params: {
  candidateId: string; to: string; candidateName: string;
  candidateCode: string; branch: string; recruiterName: string; recruiterMobile: string;
}): Promise<SendResult> {
  return send(
    params.to,
    'Registration Successful - MAS Callnet',
    `<p>Dear ${params.candidateName},</p>
     <p>Your registration at MAS Callnet (${params.branch}) was successful.</p>
     <p><strong>Your Candidate ID: ${params.candidateCode}</strong></p>
     <p>Recruiter: ${params.recruiterName} | ${params.recruiterMobile}</p>
     <p>We will be in touch shortly. Thank you for your interest.</p>`,
    params.candidateId,
    'registration',
  );
}

export async function sendSelectedEmail(params: {
  candidateId: string; to: string; candidateName: string;
  branchName: string; hrName: string; hrPhone: string;
}): Promise<SendResult> {
  return send(
    params.to,
    'Congratulations! You have been selected - MAS Callnet',
    `<p>Dear ${params.candidateName},</p>
     <p>Congratulations! You have been selected at MAS Callnet, ${params.branchName}.</p>
     <p>Your HR contact: ${params.hrName} | ${params.hrPhone}</p>
     <p>You will receive further instructions for completing your joining formalities.</p>`,
    params.candidateId,
    'selected',
  );
}

export async function sendRejectedEmail(params: {
  candidateId: string; to: string; candidateName: string; branchName: string;
}): Promise<SendResult> {
  return send(
    params.to,
    'Thank you for visiting MAS Callnet',
    `<p>Dear ${params.candidateName},</p>
     <p>Thank you for your time and interest in MAS Callnet, ${params.branchName}.</p>
     <p>We will keep your profile on file for future opportunities.</p>`,
    params.candidateId,
    'rejected',
  );
}

export async function sendOnboardingTokenEmail(params: {
  candidateId: string; to: string; candidateName: string; onboardingLink: string;
}): Promise<SendResult> {
  return send(
    params.to,
    'Complete Your Joining Formalities - MAS Callnet',
    atsFrame({
      eyebrow: "Candidate Onboarding",
      title: "Complete Your 10-Step Joining Form",
      body: `<p>Dear <strong>${escapeHtml(params.candidateName)}</strong>,</p>
        <p>Your profile has been selected. Please complete your secure 10-step onboarding form using the button below.</p>
        <div style="margin:18px 0;border:1px solid #dbeafe;background:#eff6ff;border-radius:16px;padding:16px;color:#1e3a8a">
          <strong>Before you start:</strong> Keep Aadhaar, PAN, Bank Passbook or Cancelled Cheque (if you have an account), education proof, and experience documents ready.
        </div>
        <p style="margin-top:18px;color:#64748b;font-size:13px;line-height:1.6">If the button does not open, copy this link into your browser:<br><span style="word-break:break-all">${escapeHtml(params.onboardingLink)}</span></p>`,
      actionLabel: "Open Onboarding Form",
      actionUrl: params.onboardingLink,
      note: "This secure link is valid for 7 days. If it expires, ask your recruiter or HR to resend it.",
    }),
    params.candidateId,
    'token_sent',
  );
}

export async function sendOfferReviewEmail(params: {
  candidateId: string; to: string; candidateName: string; offerSummary: string;
}): Promise<SendResult> {
  return send(
    params.to,
    'New Employment Offer Awaiting Your Approval - MAS Callnet',
    `<p>A new employment offer requires your approval.</p>
     <p><strong>Candidate:</strong> ${params.candidateName}</p>
     <p>${params.offerSummary}</p>
     <p>Please log in to review and approve.</p>`,
    params.candidateId,
    'offer_review',
  );
}

export async function sendWelcomeEmail(params: {
  candidateId: string; to: string; candidateName: string;
  employeeCode: string; loginEmail: string; tempPassword: string; loginUrl: string;
}): Promise<SendResult> {
  return send(
    params.to,
    `Welcome to MAS Callnet - Your Employee ID is ${params.employeeCode}`,
    atsFrame({
      eyebrow: "Employee Account Activated",
      title: `Welcome to MAS Callnet, ${params.employeeCode}`,
      body: `<p>Dear <strong>${escapeHtml(params.candidateName)}</strong>,</p>
        <p>Your employee account is active. Use the details below to login and complete your first-day HRMS tasks.</p>
        <div style="margin:18px 0;border:1px solid #d1fae5;background:#ecfdf5;border-radius:16px;padding:16px">
          <p style="margin:0 0 8px"><strong>Employee ID:</strong> ${escapeHtml(params.employeeCode)}</p>
          <p style="margin:0 0 8px"><strong>Login Email:</strong> ${escapeHtml(params.loginEmail)}</p>
          <p style="margin:0"><strong>Temporary Password:</strong> ${escapeHtml(params.tempPassword)}</p>
        </div>
        <p style="color:#64748b;font-size:13px;line-height:1.6">If the button does not open, copy this link into your browser:<br><span style="word-break:break-all">${escapeHtml(params.loginUrl)}</span></p>`,
      actionLabel: "Login to HRMS",
      actionUrl: params.loginUrl,
      note: "You will be asked to change your temporary password on first login. Do not share this password with anyone.",
    }),
    params.candidateId,
    'welcome',
  );
}

// ── Enhanced Email Functions (using professional templates) ───────────────────

export async function sendCandidateSuccessEmail(params: {
  candidateId: string;
  to: string;
  candidateName: string;
  tokenNumber: string;
  branchDisplayName: string;
  recruiterName: string;
  recruiterMobile: string;
  registrationDate: string;
}): Promise<SendResult> {
  const html = candidateSuccessEmail({
    candidateName: params.candidateName,
    candidateId: params.candidateId,
    tokenNumber: params.tokenNumber,
    branchDisplayName: params.branchDisplayName,
    recruiterName: params.recruiterName,
    recruiterMobile: params.recruiterMobile,
    registrationDate: params.registrationDate,
  });

  return send(
    params.to,
    'Registration Successful - MAS Callnet',
    html,
    params.candidateId,
    'registration',
  );
}

export async function sendRecruiterNotificationEmail(params: {
  candidateId: string;
  to: string;
  recruiterName: string;
  candidateName: string;
  candidateMobile: string;
  tokenNumber: string;
  branchDisplayName: string;
  roleApplied: string;
}): Promise<SendResult> {
  const html = recruiterNotificationEmail({
    recruiterName: params.recruiterName,
    candidateName: params.candidateName,
    candidateMobile: params.candidateMobile,
    tokenNumber: params.tokenNumber,
    branchDisplayName: params.branchDisplayName,
    roleApplied: params.roleApplied,
  });

  return send(
    params.to,
    'New Candidate Assigned - MAS Callnet',
    html,
    params.candidateId,
    'recruiter_notification',
  );
}

export async function sendSelectionCongratulationsEmail(params: {
  candidateId: string;
  to: string;
  candidateName: string;
  branchDisplayName: string;
  roleOffered: string;
  onboardingPortalUrl: string;
  /** Omitted when the link is a tokenised onboarding URL that needs no login. */
  tempPassword?: string | null;
}): Promise<SendResult> {
  const html = selectionCongratulationsEmail({
    candidateName: params.candidateName,
    candidateEmail: params.to,
    branchDisplayName: params.branchDisplayName,
    roleOffered: params.roleOffered,
    onboardingPortalUrl: params.onboardingPortalUrl,
    tempPassword: params.tempPassword ?? null,
  });

  return send(
    params.to,
    'Congratulations! You are Selected - MAS Callnet',
    html,
    params.candidateId,
    'selection_congratulations',
  );
}

export async function sendSelectionLetterOfIntent(params: {
  candidateId: string;
  to: string;
  candidateName: string;
  roleOffered: string;
  branchName: string;
  dateOfJoining: string | null;
  reportingTiming: string | null;
  salaryStructure: string | null;
  otDetails: string | null;
  performanceIncentives: string | null;
  onboardingLink: string;
  recruiterName: string | null;
  recruiterMobile: string | null;
  recruiterEmail: string | null;
}): Promise<SendResult> {
  const html = selectionLetterOfIntent({
    candidateName: params.candidateName,
    roleOffered: params.roleOffered,
    branchName: params.branchName,
    dateOfJoining: params.dateOfJoining,
    reportingTiming: params.reportingTiming,
    salaryStructure: params.salaryStructure,
    otDetails: params.otDetails,
    performanceIncentives: params.performanceIncentives,
    onboardingLink: params.onboardingLink,
    recruiterName: params.recruiterName,
    recruiterMobile: params.recruiterMobile,
    recruiterEmail: params.recruiterEmail,
  });

  return send(
    params.to,
    'Selection Letter of Intent - MAS Callnet',
    html,
    params.candidateId,
    'selection_letter',
  );
}

export async function sendBGVCompletionEmail(params: {
  candidateId: string;
  to: string;
  candidateName: string;
  bgvStatus: 'verified' | 'negative' | 'insufficient';
  bgvRemarks: string;
  nextSteps: string;
}): Promise<SendResult> {
  const html = bgvCompletionEmail({
    candidateName: params.candidateName,
    bgvStatus: params.bgvStatus,
    bgvRemarks: params.bgvRemarks,
    nextSteps: params.nextSteps,
  });

  const statusText = params.bgvStatus === 'verified' ? 'Completed' : 'Action Required';
  return send(
    params.to,
    `BGV ${statusText} - MAS Callnet`,
    html,
    params.candidateId,
    'bgv_completion',
  );
}

export async function sendPayrollHRNotificationEmail(params: {
  candidateId: string;
  to: string;
  hrName: string;
  candidateName: string;
  branchDisplayName: string;
  roleOffered: string;
}): Promise<SendResult> {
  const html = payrollHRNotificationEmail({
    hrName: params.hrName,
    candidateName: params.candidateName,
    candidateId: params.candidateId,
    branchDisplayName: params.branchDisplayName,
    roleOffered: params.roleOffered,
  });

  return send(
    params.to,
    'New Candidate for Validation - MAS Callnet',
    html,
    params.candidateId,
    'payroll_hr_notification',
  );
}

export async function sendBranchHeadApprovalEmail(params: {
  candidateId: string;
  to: string;
  branchHeadName: string;
  candidateName: string;
  branchDisplayName: string;
  roleOffered: string;
  proposedSalary: string;
  joiningDate: string;
}): Promise<SendResult> {
  const html = branchHeadApprovalEmail({
    branchHeadName: params.branchHeadName,
    candidateName: params.candidateName,
    candidateId: params.candidateId,
    branchDisplayName: params.branchDisplayName,
    roleOffered: params.roleOffered,
    proposedSalary: params.proposedSalary,
    joiningDate: params.joiningDate,
  });

  return send(
    params.to,
    'Approval Request - MAS Callnet',
    html,
    params.candidateId,
    'branch_head_approval',
  );
}

export async function sendPayrollHrJoiningDocNotification(params: {
  to: string;
  hrName: string;
  employeeCode: string;
  employeeName: string;
  joiningDocUrl: string;
  candidateId?: string;
}): Promise<SendResult> {
  const cid = params.candidateId ?? params.employeeCode;
  return send(
    params.to,
    `Action Required: Issue Joining Documents for ${params.employeeCode}`,
    atsFrame({
      eyebrow: "Post-Onboarding Action",
      title: `Issue Joining Documents — ${params.employeeCode}`,
      body: `<p>Dear <strong>${escapeHtml(params.hrName)}</strong>,</p>
        <p>The offer for <strong>${escapeHtml(params.employeeName)}</strong> has been approved by the Branch Head.
        The employee code <strong>${escapeHtml(params.employeeCode)}</strong> has been activated.</p>
        <p>Please issue the joining documents (appointment letter, NDA, welcome kit) at your earliest convenience.</p>`,
      actionLabel: "Open Joining Documents",
      actionUrl: params.joiningDocUrl,
      note: "This action is assigned to Payroll HR. The joining document issue is required before the employee's first day.",
    }),
    cid,
    'payroll_hr_notification',
  );
}

export async function sendOnboardingOtp(params: {
  mobile: string;
  otp: string;
  candidateName: string;
  email?: string | null;
}): Promise<SendResult | null> {
  // Primary: SMS via email-to-SMS gateway or configured SMS provider
  // Fallback: send OTP to candidate's personal email
  const subject = `Your OTP for MAS Callnet Onboarding: ${params.otp}`;
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px">
      <h2 style="color:#1e293b">Mobile Verification</h2>
      <p>Hi ${params.candidateName},</p>
      <p>Your one-time password (OTP) for mobile verification is:</p>
      <div style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#2563eb;padding:16px;background:#f1f5f9;border-radius:8px;text-align:center">${params.otp}</div>
      <p style="color:#64748b;font-size:13px">Valid for 10 minutes. Do not share this OTP with anyone.</p>
    </div>`;
  if (!params.email) return null;
  return send(params.email, subject, html, params.email, 'otp_verification');
}

export async function sendRejectedEmailProfessional(params: {
  candidateId: string;
  to: string;
  candidateName: string;
  branchDisplayName: string;
  processName?: string | null;
  applicationRef?: string | null;
}): Promise<SendResult> {
  const html = rejectedEmail({
    candidateName: params.candidateName,
    branchDisplayName: params.branchDisplayName,
    processName: params.processName ?? null,
    applicationRef: params.applicationRef ?? null,
  });
  return send(
    params.to,
    'Update on Your Application - MAS Callnet India',
    html,
    params.candidateId,
    'rejected_professional',
  );
}

// ── Joining Document eSign Email ───────────────────────────────────────────────

export function buildJoiningDocEsignEmailHtml(params: {
  employeeName: string;
  documentName: string;
  signLink: string;
  expiryStr: string;
}): string {
  const { employeeName, documentName, signLink, expiryStr } = params;
  return `
  <div style="margin:0;padding:24px;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #dbe4f0;border-radius:18px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#0f766e,#0ea5e9);padding:24px 28px;color:#ffffff">
        <div style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;opacity:.88">MAS Callnet HRMS — Action Required</div>
        <h1 style="margin:8px 0 0;font-size:20px;line-height:1.3">Please sign your joining document</h1>
      </div>
      <div style="padding:26px 28px">
        <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#334155">Dear <strong>${employeeName}</strong>,</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#334155">
          Your HR team has shared the following joining document for your e-signature:
        </p>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:14px 18px;margin:0 0 20px">
          <p style="margin:0;font-size:15px;font-weight:700;color:#166534">${documentName}</p>
        </div>
        <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#475569">
          Please review and sign the document by clicking the button below. This link is valid until <strong>${expiryStr}</strong>.
        </p>
        <p style="margin:0 0 8px">
          <a href="${signLink}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:12px;font-weight:800;font-size:15px">Review &amp; Sign Document</a>
        </p>
        <p style="margin:16px 0 0;font-size:12px;color:#64748b">If the button does not work, copy this link:<br><span style="word-break:break-all">${signLink}</span></p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 16px">
        <p style="margin:0;font-size:12px;color:#94a3b8">If you did not expect this document, please contact your HR team immediately.</p>
      </div>
      <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:14px 28px;color:#94a3b8;font-size:11px">
        MAS Callnet India Pvt. Ltd. &bull; This is an automated message — please do not reply directly to this email.
      </div>
    </div>
  </div>`;
}

/**
 * The EPF compliance review link, for the member to confirm their own details.
 *
 * The link was minted and returned to the HR screen for manual copy-paste, and
 * nothing ever sent it — which is a large part of why the EPF profile table
 * holds 4 rows. The member is the only person who can confirm their own PF
 * particulars, so they have to be able to reach the page.
 *
 * Deliberately not the same copy as the e-sign mail: this asks the member to
 * check what HR recorded, which is a different request from signing a document.
 */
export function buildEpfComplianceReviewEmailHtml(params: {
  employeeName: string;
  reviewLink: string;
  expiryStr: string;
}): string {
  const { employeeName, reviewLink, expiryStr } = params;
  return `
  <div style="margin:0;padding:24px;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #dbe4f0;border-radius:18px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#0f766e,#0ea5e9);padding:24px 28px;color:#ffffff">
        <div style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;opacity:.88">MAS Callnet HRMS — Action Required</div>
        <h1 style="margin:8px 0 0;font-size:20px;line-height:1.3">Check your PF details before we file them</h1>
      </div>
      <div style="padding:26px 28px">
        <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#334155">Dear <strong>${employeeName}</strong>,</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#334155">
          HR has prepared your Employees' Provident Fund record. Please check it is correct —
          these details go on your EPF filing, and a mistake in your name, date of birth or
          UAN is far harder to correct afterwards.
        </p>
        <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#475569">
          You can confirm the details or ask HR to correct them. This link is valid until <strong>${expiryStr}</strong>.
        </p>
        <p style="margin:0 0 8px">
          <a href="${reviewLink}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:12px;font-weight:800;font-size:15px">Review my PF details</a>
        </p>
        <p style="margin:16px 0 0;font-size:12px;color:#64748b">If the button does not work, copy this link:<br><span style="word-break:break-all">${reviewLink}</span></p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 16px">
        <p style="margin:0;font-size:12px;color:#94a3b8">If you were not expecting this, please contact your HR team immediately.</p>
      </div>
      <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:14px 28px;color:#94a3b8;font-size:11px">
        MAS Callnet India Pvt. Ltd. &bull; This is an automated message — please do not reply directly to this email.
      </div>
    </div>
  </div>`;
}

export async function sendJoiningDocReminderEmail(params: {
  to: string;
  employeeName: string;
  pendingDocuments: string[];
  employeeId: string;
}): Promise<SendResult> {
  const { to, employeeName, pendingDocuments, employeeId } = params;
  const docList = pendingDocuments.map(d => `<li style="margin-bottom:4px">${d}</li>`).join('');
  const hrLink = `${env.FRONTEND_URL || 'http://localhost:5173'}/employees/${employeeId}/joining-documents`;
  const html = `
  <div style="margin:0;padding:24px;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #dbe4f0;border-radius:18px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#0f766e,#0ea5e9);padding:24px 28px;color:#ffffff">
        <div style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;opacity:.88">MAS Callnet HRMS — Reminder</div>
        <h1 style="margin:8px 0 0;font-size:20px;line-height:1.3">Joining documents pending</h1>
      </div>
      <div style="padding:26px 28px">
        <p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#334155">Dear <strong>${employeeName}</strong>,</p>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#334155">The following joining documents are still pending your action:</p>
        <ul style="margin:0 0 20px;padding-left:20px;font-size:14px;color:#334155;line-height:1.7">${docList}</ul>
        <p style="margin:0 0 14px;font-size:14px;color:#475569">Please check your email inbox for individual signing links, or contact your HR team.</p>
        <p style="margin:0 0 8px">
          <a href="${hrLink}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:12px;font-weight:700;font-size:14px">View Joining Documents</a>
        </p>
      </div>
      <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:14px 28px;color:#94a3b8;font-size:11px">MAS Callnet India Pvt. Ltd.</div>
    </div>
  </div>`;
  return send(to, 'Reminder: Joining documents pending — MAS Callnet', html, employeeId, 'joining_doc_reminder');
}
