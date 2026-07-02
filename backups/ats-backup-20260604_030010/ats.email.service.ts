import nodemailer from 'nodemailer';
import { randomUUID } from 'crypto';
import { db } from '../../db/mysql.js';
import { env } from '../../config/env.js';

type EmailType = 'registration' | 'selected' | 'rejected' | 'token_sent' | 'offer_review' | 'approved' | 'welcome';

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
