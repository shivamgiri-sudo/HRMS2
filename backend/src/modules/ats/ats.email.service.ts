import nodemailer from 'nodemailer';
import { randomUUID } from 'crypto';
import { db } from '../../db/mysql.js';
import { env } from '../../config/env.js';
import {
  candidateSuccessEmail,
  recruiterNotificationEmail,
  selectionCongratulationsEmail,
  bgvCompletionEmail,
  payrollHRNotificationEmail,
  branchHeadApprovalEmail,
  rejectedEmail,
} from './email.templates.js';

type EmailType = 'registration' | 'selected' | 'rejected' | 'rejected_professional' | 'token_sent' | 'offer_review' | 'approved' | 'welcome' |
                 'recruiter_notification' | 'selection_congratulations' | 'bgv_completion' | 'payroll_hr_notification' | 'branch_head_approval' | 'otp_verification';

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
  await db.execute(
    `INSERT INTO ats_email_log (id, candidate_id, email_type, sent_to, status, error_message)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [randomUUID(), candidateId, type, sentTo, status, error ?? null],
  );
}

async function send(
  to: string,
  subject: string,
  html: string,
  candidateId: string,
  type: EmailType,
): Promise<SendResult> {
  if (!env.SMTP_USER || !env.SMTP_PASS) {
    console.warn(`[ATS-EMAIL] SMTP not configured — skipping ${type} to ${to} (candidate ${candidateId})`);
    await logEmail(candidateId, type, to, 'skipped', 'SMTP not configured');
    return { ok: true };
  }
  const fromAddr = env.SMTP_FROM || env.SMTP_USER;
  try {
    await transporter.sendMail({ from: `"MAS Callnet" <${fromAddr}>`, to, subject, html });
    await logEmail(candidateId, type, to, 'sent');
    return { ok: true };
  } catch (err: unknown) {
    const msg = (err as Error)?.message ?? String(err);
    await logEmail(candidateId, type, to, 'failed', msg);
    return { ok: false, error: msg };
  }
}

export async function sendRegistrationEmail(params: {
  candidateId: string; to: string; candidateName: string;
  candidateCode: string; branch: string; recruiterName: string; recruiterMobile: string;
}): Promise<SendResult> {
  return send(
    params.to,
    'Registration Successful — MAS Callnet',
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
    'Congratulations! You have been selected — MAS Callnet',
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
    'Complete Your Joining Formalities — MAS Callnet',
    `<p>Dear ${params.candidateName},</p>
     <p>Please complete your joining formalities by clicking the link below.</p>
     <p><a href="${params.onboardingLink}">Complete Profile (valid for 7 days)</a></p>
     <p>If the link expires, contact your HR representative.</p>`,
    params.candidateId,
    'token_sent',
  );
}

export async function sendOfferReviewEmail(params: {
  candidateId: string; to: string; candidateName: string; offerSummary: string;
}): Promise<SendResult> {
  return send(
    params.to,
    'New Employment Offer Awaiting Your Approval — MAS Callnet',
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
    `Welcome to MAS Callnet — Your Employee ID is ${params.employeeCode}`,
    `<p>Dear ${params.candidateName},</p>
     <p>Welcome to MAS Callnet! Your employee account has been activated.</p>
     <p><strong>Employee ID:</strong> ${params.employeeCode}</p>
     <p><strong>Login Email:</strong> ${params.loginEmail}</p>
     <p><strong>Temporary Password:</strong> ${params.tempPassword}</p>
     <p><a href="${params.loginUrl}">Login to HRMS</a></p>
     <p>You will be prompted to change your password on first login.</p>`,
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
    '🎉 Registration Successful - MAS Callnet',
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
    '👤 New Candidate Assigned - MAS Callnet',
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
  tempPassword: string;
}): Promise<SendResult> {
  const html = selectionCongratulationsEmail({
    candidateName: params.candidateName,
    candidateEmail: params.to,
    branchDisplayName: params.branchDisplayName,
    roleOffered: params.roleOffered,
    onboardingPortalUrl: params.onboardingPortalUrl,
    tempPassword: params.tempPassword,
  });

  return send(
    params.to,
    '🎉 Congratulations! You\'re Selected - MAS Callnet',
    html,
    params.candidateId,
    'selection_congratulations',
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
    `🔍 BGV ${statusText} - MAS Callnet`,
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
    '📋 New Candidate for Validation - MAS Callnet',
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
    '✅ Approval Request - MAS Callnet',
    html,
    params.candidateId,
    'branch_head_approval',
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
    'Update on Your Application — MAS Callnet India',
    html,
    params.candidateId,
    'rejected_professional',
  );
}
