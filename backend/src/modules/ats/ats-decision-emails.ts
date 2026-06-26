import nodemailer from 'nodemailer';
import { randomUUID } from 'crypto';
import { db } from '../../db/mysql.js';
import { env } from '../../config/env.js';

// ── Types ────────────────────────────────────────────────────────────────────

type DecisionEmailType =
  | 'decision_selected'
  | 'decision_rejected'
  | 'decision_hold'
  | 'decision_client_pending'
  | 'decision_noshow';

interface SendDecisionParams {
  candidateId: string;
  candidateName: string;
  candidateEmail: string | null;
  mobile: string | null;
  process: string;
  branch: string;
  queueToken: string | null;
  stage: string;
  finalDecision: string;
  // Only for Selected:
  offerSalary?: number | null;
  offerDoj?: string | null;
  reportingTiming?: string | null;
  otDetails?: string | null;
  performanceIncentives?: string | null;
  onboardingLink?: string | null;
  // Recruiter info:
  recruiterName: string;
  recruiterMobile: string | null;
  recruiterEmail: string | null;
}

// ── Transporter ──────────────────────────────────────────────────────────────

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST || '',
  port: Number(env.SMTP_PORT || 587),
  secure: false,
  auth: {
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
  },
});

// ── Logging ──────────────────────────────────────────────────────────────────

async function logEmail(
  candidateId: string,
  type: DecisionEmailType,
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

// ── Decision Mapper ──────────────────────────────────────────────────────────

function mapDecisionToEmailType(decision: string): DecisionEmailType {
  const d = decision.toLowerCase().replace(/[\s\-_]+/g, '');
  if (d.includes('selected') || d.includes('select')) return 'decision_selected';
  if (d.includes('rejected') || d.includes('reject')) return 'decision_rejected';
  if (d.includes('hold')) return 'decision_hold';
  if (d.includes('clientround') || d.includes('clientpending') || d.includes('client')) return 'decision_client_pending';
  if (d.includes('noshow') || d.includes('noshowed')) return 'decision_noshow';
  return 'decision_rejected'; // fallback
}

// ── Shared HTML Utilities ────────────────────────────────────────────────────

const FONT_FAMILY = `"Segoe UI", Arial, sans-serif`;

function wrapEmail(bodyContent: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MAS Callnet</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:${FONT_FAMILY};">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f1f5f9;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="720" style="max-width:720px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
          ${bodyContent}
        </table>
        <!-- Footer -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="720" style="max-width:720px;width:100%;margin-top:24px;">
          <tr>
            <td align="center" style="padding:16px;color:#94a3b8;font-size:12px;font-family:${FONT_FAMILY};">
              &copy; ${new Date().getFullYear()} Mas Callnet India Pvt. Ltd. All rights reserved.<br/>
              This is an automated email. Please do not reply directly to this message.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function headerBanner(gradient: string, icon: string, title: string, subtitle: string): string {
  return `<tr>
  <td style="background:${gradient};padding:40px 32px;text-align:center;">
    <div style="font-size:48px;margin-bottom:12px;">${icon}</div>
    <h1 style="margin:0;font-size:26px;font-weight:700;color:#ffffff;font-family:${FONT_FAMILY};">${title}</h1>
    <p style="margin:8px 0 0;font-size:15px;color:rgba(255,255,255,0.85);font-family:${FONT_FAMILY};">${subtitle}</p>
  </td>
</tr>`;
}

function infoCard(label: string, value: string, bgColor: string = '#f8fafc', textColor: string = '#1e293b'): string {
  return `<td style="padding:8px 6px;vertical-align:top;width:50%;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr>
      <td style="background:${bgColor};border-radius:10px;padding:14px 16px;">
        <div style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;font-family:${FONT_FAMILY};">${label}</div>
        <div style="font-size:15px;font-weight:600;color:${textColor};margin-top:4px;font-family:${FONT_FAMILY};">${value}</div>
      </td>
    </tr>
  </table>
</td>`;
}

function infoCardsRow(cards: Array<{ label: string; value: string; bg?: string; color?: string }>): string {
  let html = '<tr><td style="padding:0 32px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">';
  for (let i = 0; i < cards.length; i += 2) {
    html += '<tr>';
    html += infoCard(cards[i].label, cards[i].value, cards[i].bg, cards[i].color);
    if (cards[i + 1]) {
      html += infoCard(cards[i + 1].label, cards[i + 1].value, cards[i + 1].bg, cards[i + 1].color);
    } else {
      html += '<td style="padding:8px 6px;width:50%;"></td>';
    }
    html += '</tr>';
  }
  html += '</table></td></tr>';
  return html;
}

function recruiterSection(name: string, mobile: string | null, email: string | null): string {
  const contactLines: string[] = [];
  if (mobile) contactLines.push(`<span style="color:#475569;">Phone:</span> <a href="tel:${mobile}" style="color:#2563eb;text-decoration:none;">${mobile}</a>`);
  if (email) contactLines.push(`<span style="color:#475569;">Email:</span> <a href="mailto:${email}" style="color:#2563eb;text-decoration:none;">${email}</a>`);

  return `<tr>
  <td style="padding:24px 32px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f0f9ff;border-radius:12px;border:1px solid #bae6fd;">
      <tr>
        <td style="padding:20px 24px;">
          <div style="font-size:13px;font-weight:700;color:#0369a1;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;font-family:${FONT_FAMILY};">Your Recruiter Contact</div>
          <div style="font-size:16px;font-weight:600;color:#1e293b;font-family:${FONT_FAMILY};">${name}</div>
          ${contactLines.length > 0 ? `<div style="margin-top:6px;font-size:14px;line-height:1.6;font-family:${FONT_FAMILY};">${contactLines.join('<br/>')}</div>` : ''}
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

function actionButton(text: string, url: string, bgColor: string): string {
  return `<tr>
  <td align="center" style="padding:24px 32px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="background:${bgColor};border-radius:10px;padding:16px 40px;">
          <a href="${url}" target="_blank" style="color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;display:inline-block;font-family:${FONT_FAMILY};">${text}</a>
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

function dividerRow(): string {
  return `<tr><td style="padding:0 32px;"><div style="border-top:1px solid #e2e8f0;margin:8px 0;"></div></td></tr>`;
}

// ── Template: Selected ───────────────────────────────────────────────────────

function buildSelectedEmail(params: SendDecisionParams): { subject: string; html: string } {
  const dojFormatted = params.offerDoj
    ? new Date(params.offerDoj).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })
    : 'To be communicated';
  const salaryFormatted = params.offerSalary
    ? `INR ${params.offerSalary.toLocaleString('en-IN')} per month`
    : 'As discussed';

  const cards = [
    { label: 'Candidate', value: params.candidateName, bg: '#f0fdf4', color: '#166534' },
    { label: 'Process / Role', value: params.process, bg: '#f0fdf4', color: '#166534' },
    { label: 'Branch', value: params.branch, bg: '#ecfdf5', color: '#065f46' },
    ...(params.queueToken ? [{ label: 'Queue Token', value: params.queueToken, bg: '#ecfdf5', color: '#065f46' }] : []),
    { label: 'Stage', value: params.stage, bg: '#f0fdf4', color: '#166534' },
  ];

  let joiningDetails = `
    <tr>
      <td style="padding:24px 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f0fdf4;border-radius:12px;border:1px solid #86efac;">
          <tr>
            <td style="padding:24px;">
              <div style="font-size:14px;font-weight:700;color:#166534;margin-bottom:12px;font-family:${FONT_FAMILY};">JOINING DETAILS</div>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size:14px;font-family:${FONT_FAMILY};">
                <tr>
                  <td style="padding:6px 0;color:#475569;width:160px;vertical-align:top;">Date of Joining:</td>
                  <td style="padding:6px 0;color:#1e293b;font-weight:600;">${dojFormatted}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;color:#475569;vertical-align:top;">Reporting Time:</td>
                  <td style="padding:6px 0;color:#1e293b;font-weight:600;">${params.reportingTiming || 'Will be shared by recruiter'}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;color:#475569;vertical-align:top;">Salary / CTC:</td>
                  <td style="padding:6px 0;color:#1e293b;font-weight:600;">${salaryFormatted}</td>
                </tr>`;

  if (params.otDetails) {
    joiningDetails += `
                <tr>
                  <td style="padding:6px 0;color:#475569;vertical-align:top;">OT Details:</td>
                  <td style="padding:6px 0;color:#1e293b;font-weight:600;">${params.otDetails}</td>
                </tr>`;
  }
  if (params.performanceIncentives) {
    joiningDetails += `
                <tr>
                  <td style="padding:6px 0;color:#475569;vertical-align:top;">Incentives:</td>
                  <td style="padding:6px 0;color:#1e293b;font-weight:600;">${params.performanceIncentives}</td>
                </tr>`;
  }

  joiningDetails += `
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;

  const onboardingBtn = params.onboardingLink
    ? actionButton('Complete Onboarding', params.onboardingLink, '#0F8D68')
    : '';

  const documentsSection = `<tr>
  <td style="padding:0 32px 24px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fffbeb;border-radius:12px;border:1px solid #fde68a;">
      <tr>
        <td style="padding:20px 24px;">
          <div style="font-size:13px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;font-family:${FONT_FAMILY};">Documents to Carry on Day 1</div>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;font-family:${FONT_FAMILY};color:#1e293b;">
            <tr><td style="padding:4px 0;">&#x2022; Government ID Proof (Aadhaar / PAN / Voter ID)</td></tr>
            <tr><td style="padding:4px 0;">&#x2022; Address Proof (Aadhaar / Utility Bill / Rent Agreement)</td></tr>
            <tr><td style="padding:4px 0;">&#x2022; Education Proof (Highest Qualification Certificate)</td></tr>
            <tr><td style="padding:4px 0;">&#x2022; 2 Passport-size Photographs</td></tr>
          </table>
        </td>
      </tr>
    </table>
  </td>
</tr>`;

  const body = `
${headerBanner('linear-gradient(135deg, #0F8D68 0%, #10b981 50%, #34d399 100%)', '&#127881;', 'Congratulations!', 'Next steps for your joining at Mas Callnet India Pvt. Ltd.')}
<tr>
  <td style="padding:28px 32px 8px;">
    <p style="margin:0;font-size:16px;line-height:1.6;color:#334155;font-family:${FONT_FAMILY};">Dear <strong>${params.candidateName}</strong>,</p>
    <p style="margin:12px 0 0;font-size:15px;line-height:1.7;color:#475569;font-family:${FONT_FAMILY};">
      We are delighted to inform you that you have been <strong style="color:#0F8D68;">selected</strong> for the position of <strong>${params.process}</strong> at our <strong>${params.branch}</strong> branch. Welcome to the MAS Callnet family!
    </p>
  </td>
</tr>
${dividerRow()}
${infoCardsRow(cards)}
${joiningDetails}
${onboardingBtn}
${dividerRow()}
${documentsSection}
${recruiterSection(params.recruiterName, params.recruiterMobile, params.recruiterEmail)}
<tr>
  <td style="padding:16px 32px 32px;text-align:center;">
    <p style="margin:0;font-size:13px;color:#94a3b8;font-family:${FONT_FAMILY};">We look forward to seeing you on your joining date. Best wishes!</p>
  </td>
</tr>`;

  return {
    subject: `Congratulations! You are Selected - Mas Callnet India Pvt. Ltd.`,
    html: wrapEmail(body),
  };
}

// ── Template: Rejected ───────────────────────────────────────────────────────

function buildRejectedEmail(params: SendDecisionParams): { subject: string; html: string } {
  const cards = [
    { label: 'Candidate', value: params.candidateName, bg: '#fef2f2', color: '#991b1b' },
    { label: 'Process / Role', value: params.process, bg: '#fef2f2', color: '#991b1b' },
    { label: 'Branch', value: params.branch, bg: '#fff1f2', color: '#be123c' },
    { label: 'Stage', value: params.stage, bg: '#fff1f2', color: '#be123c' },
  ];

  const body = `
${headerBanner('linear-gradient(135deg, #475569 0%, #64748b 50%, #94a3b8 100%)', '&#128172;', 'Thank You for Visiting', 'Mas Callnet India Pvt. Ltd.')}
<tr>
  <td style="padding:28px 32px 8px;">
    <p style="margin:0;font-size:16px;line-height:1.6;color:#334155;font-family:${FONT_FAMILY};">Dear <strong>${params.candidateName}</strong>,</p>
    <p style="margin:12px 0 0;font-size:15px;line-height:1.7;color:#475569;font-family:${FONT_FAMILY};">
      Thank you for taking the time to visit us and for your interest in the <strong>${params.process}</strong> position at our <strong>${params.branch}</strong> branch.
    </p>
    <p style="margin:12px 0 0;font-size:15px;line-height:1.7;color:#475569;font-family:${FONT_FAMILY};">
      After careful consideration, we regret to inform you that we are unable to move forward with your application at this time. This decision does not reflect on your abilities and we encourage you to keep developing your skills.
    </p>
  </td>
</tr>
${dividerRow()}
${infoCardsRow(cards)}
<tr>
  <td style="padding:24px 32px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f0f9ff;border-radius:12px;border:1px solid #bae6fd;">
      <tr>
        <td style="padding:20px 24px;text-align:center;">
          <p style="margin:0;font-size:15px;color:#0c4a6e;font-family:${FONT_FAMILY};line-height:1.6;">
            <strong>We encourage you to apply again in the future.</strong><br/>
            New opportunities open regularly and we would be happy to reconsider your profile.
          </p>
        </td>
      </tr>
    </table>
  </td>
</tr>
${recruiterSection(params.recruiterName, params.recruiterMobile, params.recruiterEmail)}
<tr>
  <td style="padding:16px 32px 32px;text-align:center;">
    <p style="margin:0;font-size:13px;color:#94a3b8;font-family:${FONT_FAMILY};">We wish you all the best in your career journey.</p>
  </td>
</tr>`;

  return {
    subject: `Thank You for Visiting - Mas Callnet India Pvt. Ltd.`,
    html: wrapEmail(body),
  };
}

// ── Template: Hold ───────────────────────────────────────────────────────────

function buildHoldEmail(params: SendDecisionParams): { subject: string; html: string } {
  const cards = [
    { label: 'Candidate', value: params.candidateName, bg: '#fffbeb', color: '#92400e' },
    { label: 'Process / Role', value: params.process, bg: '#fffbeb', color: '#92400e' },
    { label: 'Branch', value: params.branch, bg: '#fef3c7', color: '#b45309' },
    { label: 'Stage', value: params.stage, bg: '#fef3c7', color: '#b45309' },
  ];

  const body = `
${headerBanner('linear-gradient(135deg, #b45309 0%, #d97706 50%, #f59e0b 100%)', '&#9203;', 'Your Application is On Hold', 'Mas Callnet India Pvt. Ltd.')}
<tr>
  <td style="padding:28px 32px 8px;">
    <p style="margin:0;font-size:16px;line-height:1.6;color:#334155;font-family:${FONT_FAMILY};">Dear <strong>${params.candidateName}</strong>,</p>
    <p style="margin:12px 0 0;font-size:15px;line-height:1.7;color:#475569;font-family:${FONT_FAMILY};">
      Thank you for your patience. We wanted to let you know that your application for the <strong>${params.process}</strong> position at our <strong>${params.branch}</strong> branch is currently <strong style="color:#b45309;">on hold</strong>.
    </p>
    <p style="margin:12px 0 0;font-size:15px;line-height:1.7;color:#475569;font-family:${FONT_FAMILY};">
      This means your profile is still under consideration and we will contact you shortly with an update. Please keep your phone accessible during this period.
    </p>
  </td>
</tr>
${dividerRow()}
${infoCardsRow(cards)}
<tr>
  <td style="padding:24px 32px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fffbeb;border-radius:12px;border:1px solid #fde68a;">
      <tr>
        <td style="padding:20px 24px;text-align:center;">
          <p style="margin:0;font-size:15px;color:#92400e;font-family:${FONT_FAMILY};line-height:1.6;">
            <strong>What does this mean?</strong><br/>
            Your application has not been rejected. We are finalizing requirements and will reach out with a decision soon.
          </p>
        </td>
      </tr>
    </table>
  </td>
</tr>
${recruiterSection(params.recruiterName, params.recruiterMobile, params.recruiterEmail)}
<tr>
  <td style="padding:16px 32px 32px;text-align:center;">
    <p style="margin:0;font-size:13px;color:#94a3b8;font-family:${FONT_FAMILY};">Thank you for your patience. We will be in touch shortly.</p>
  </td>
</tr>`;

  return {
    subject: `Application On Hold - Mas Callnet India Pvt. Ltd.`,
    html: wrapEmail(body),
  };
}

// ── Template: Client Round Pending ───────────────────────────────────────────

function buildClientPendingEmail(params: SendDecisionParams): { subject: string; html: string } {
  const cards = [
    { label: 'Candidate', value: params.candidateName, bg: '#eff6ff', color: '#1e3a8a' },
    { label: 'Process / Role', value: params.process, bg: '#eff6ff', color: '#1e3a8a' },
    { label: 'Branch', value: params.branch, bg: '#dbeafe', color: '#1d4ed8' },
    { label: 'Stage', value: params.stage, bg: '#dbeafe', color: '#1d4ed8' },
  ];

  const body = `
${headerBanner('linear-gradient(135deg, #1e3a8a 0%, #2563eb 50%, #3b82f6 100%)', '&#128640;', 'Client Round Scheduled', 'Mas Callnet India Pvt. Ltd.')}
<tr>
  <td style="padding:28px 32px 8px;">
    <p style="margin:0;font-size:16px;line-height:1.6;color:#334155;font-family:${FONT_FAMILY};">Dear <strong>${params.candidateName}</strong>,</p>
    <p style="margin:12px 0 0;font-size:15px;line-height:1.7;color:#475569;font-family:${FONT_FAMILY};">
      <strong style="color:#1e3a8a;">Congratulations on clearing our internal rounds!</strong> Your profile has been forwarded for client evaluation for the <strong>${params.process}</strong> position at our <strong>${params.branch}</strong> branch.
    </p>
    <p style="margin:12px 0 0;font-size:15px;line-height:1.7;color:#475569;font-family:${FONT_FAMILY};">
      The client interview/assessment will be scheduled shortly. Your recruiter will share the exact date, time and format of the client round.
    </p>
  </td>
</tr>
${dividerRow()}
${infoCardsRow(cards)}
<tr>
  <td style="padding:24px 32px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#eff6ff;border-radius:12px;border:1px solid #bfdbfe;">
      <tr>
        <td style="padding:20px 24px;">
          <div style="font-size:13px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;font-family:${FONT_FAMILY};">Next Steps</div>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;font-family:${FONT_FAMILY};color:#1e293b;">
            <tr><td style="padding:4px 0;">&#x2022; Keep your phone accessible for scheduling updates</td></tr>
            <tr><td style="padding:4px 0;">&#x2022; Prepare for potential telephonic or virtual interview</td></tr>
            <tr><td style="padding:4px 0;">&#x2022; Have your documents ready if requested</td></tr>
            <tr><td style="padding:4px 0;">&#x2022; Contact your recruiter for any queries</td></tr>
          </table>
        </td>
      </tr>
    </table>
  </td>
</tr>
${recruiterSection(params.recruiterName, params.recruiterMobile, params.recruiterEmail)}
<tr>
  <td style="padding:16px 32px 32px;text-align:center;">
    <p style="margin:0;font-size:13px;color:#94a3b8;font-family:${FONT_FAMILY};">All the best for your client round! We are rooting for you.</p>
  </td>
</tr>`;

  return {
    subject: `Client Round Scheduled - Mas Callnet India Pvt. Ltd.`,
    html: wrapEmail(body),
  };
}

// ── Template: No Show ────────────────────────────────────────────────────────

function buildNoShowEmail(params: SendDecisionParams): { subject: string; html: string } {
  const cards = [
    { label: 'Candidate', value: params.candidateName, bg: '#f8fafc', color: '#475569' },
    { label: 'Process / Role', value: params.process, bg: '#f8fafc', color: '#475569' },
    { label: 'Branch', value: params.branch, bg: '#f1f5f9', color: '#334155' },
    { label: 'Stage', value: params.stage, bg: '#f1f5f9', color: '#334155' },
  ];

  const body = `
${headerBanner('linear-gradient(135deg, #475569 0%, #64748b 50%, #94a3b8 100%)', '&#128532;', 'We Missed You Today', 'Mas Callnet India Pvt. Ltd.')}
<tr>
  <td style="padding:28px 32px 8px;">
    <p style="margin:0;font-size:16px;line-height:1.6;color:#334155;font-family:${FONT_FAMILY};">Dear <strong>${params.candidateName}</strong>,</p>
    <p style="margin:12px 0 0;font-size:15px;line-height:1.7;color:#475569;font-family:${FONT_FAMILY};">
      You were expected for an interview today for the <strong>${params.process}</strong> position at our <strong>${params.branch}</strong> branch, but we were unable to meet you.
    </p>
    <p style="margin:12px 0 0;font-size:15px;line-height:1.7;color:#475569;font-family:${FONT_FAMILY};">
      If this was unintentional or due to unforeseen circumstances, please contact your recruiter at the earliest to discuss rescheduling options. We understand that plans can change, and we are happy to work with you.
    </p>
  </td>
</tr>
${dividerRow()}
${infoCardsRow(cards)}
<tr>
  <td style="padding:24px 32px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f1f5f9;border-radius:12px;border:1px solid #cbd5e1;">
      <tr>
        <td style="padding:20px 24px;text-align:center;">
          <p style="margin:0;font-size:15px;color:#475569;font-family:${FONT_FAMILY};line-height:1.6;">
            <strong>Want to reschedule?</strong><br/>
            Reach out to your recruiter below. Rescheduling is subject to availability.
          </p>
        </td>
      </tr>
    </table>
  </td>
</tr>
${recruiterSection(params.recruiterName, params.recruiterMobile, params.recruiterEmail)}
<tr>
  <td style="padding:16px 32px 32px;text-align:center;">
    <p style="margin:0;font-size:13px;color:#94a3b8;font-family:${FONT_FAMILY};">We hope to connect with you soon.</p>
  </td>
</tr>`;

  return {
    subject: `We Missed You Today - Mas Callnet India Pvt. Ltd.`,
    html: wrapEmail(body),
  };
}

// ── Main Exported Function ───────────────────────────────────────────────────

export async function sendDecisionEmail(params: SendDecisionParams): Promise<{ ok: boolean; error?: string }> {
  const emailType = mapDecisionToEmailType(params.finalDecision);

  // If no email on file, log as skipped and return ok
  if (!params.candidateEmail) {
    await logEmail(params.candidateId, emailType, '', 'skipped', 'No email on file');
    return { ok: true };
  }

  // Build the appropriate email template
  let subject: string;
  let html: string;

  switch (emailType) {
    case 'decision_selected': {
      const result = buildSelectedEmail(params);
      subject = result.subject;
      html = result.html;
      break;
    }
    case 'decision_rejected': {
      const result = buildRejectedEmail(params);
      subject = result.subject;
      html = result.html;
      break;
    }
    case 'decision_hold': {
      const result = buildHoldEmail(params);
      subject = result.subject;
      html = result.html;
      break;
    }
    case 'decision_client_pending': {
      const result = buildClientPendingEmail(params);
      subject = result.subject;
      html = result.html;
      break;
    }
    case 'decision_noshow': {
      const result = buildNoShowEmail(params);
      subject = result.subject;
      html = result.html;
      break;
    }
  }

  // Check SMTP configuration
  if (!env.SMTP_USER || !env.SMTP_PASS) {
    console.warn(`[ATS-DECISION-EMAIL] SMTP not configured — skipping ${emailType} to ${params.candidateEmail} (candidate ${params.candidateId})`);
    await logEmail(params.candidateId, emailType, params.candidateEmail, 'skipped', 'SMTP not configured');
    return { ok: true };
  }

  // Send the email
  const fromAddr = env.SMTP_FROM || env.SMTP_USER;
  try {
    await transporter.sendMail({
      from: `"Mas Callnet India Pvt. Ltd." <${fromAddr}>`,
      to: params.candidateEmail,
      subject,
      html,
    });
    await logEmail(params.candidateId, emailType, params.candidateEmail, 'sent');
    return { ok: true };
  } catch (err: unknown) {
    const msg = (err as Error)?.message ?? String(err);
    console.error(`[ATS-DECISION-EMAIL] Failed to send ${emailType} to ${params.candidateEmail}:`, msg);
    await logEmail(params.candidateId, emailType, params.candidateEmail, 'failed', msg);
    return { ok: false, error: msg };
  }
}
