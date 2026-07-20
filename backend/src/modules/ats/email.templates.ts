// Email templates for ATS journey
// All templates are mobile-responsive and include company branding

const BASE_STYLES = `
  body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6; }
  .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
  .header { background: linear-gradient(135deg, #6d28d9 0%, #8b5cf6 100%); padding: 32px 24px; text-align: center; }
  .logo { font-size: 28px; font-weight: 900; color: #ffffff; margin: 0; letter-spacing: 0.5px; }
  .tagline { font-size: 13px; color: rgba(255,255,255,0.9); margin-top: 8px; font-weight: 500; }
  .content { padding: 32px 24px; }
  .title { font-size: 24px; font-weight: 800; color: #111827; margin: 0 0 16px 0; }
  .text { font-size: 15px; color: #4b5563; line-height: 1.6; margin: 0 0 16px 0; }
  .info-card { background: #f9fafb; border-left: 4px solid #6d28d9; padding: 16px; border-radius: 8px; margin: 16px 0; }
  .info-label { font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .info-value { font-size: 16px; font-weight: 700; color: #111827; }
  .button { display: inline-block; background: linear-gradient(135deg, #6d28d9 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 700; font-size: 15px; margin: 16px 0; box-shadow: 0 4px 12px rgba(109, 40, 217, 0.3); }
  .footer { background: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb; }
  .footer-text { font-size: 13px; color: #6b7280; margin: 0 0 8px 0; }
  .footer-link { color: #6d28d9; text-decoration: none; font-weight: 600; }
  .divider { height: 1px; background: #e5e7eb; margin: 24px 0; }
  .success-badge { display: inline-block; background: #ecfdf5; color: #065f46; padding: 8px 16px; border-radius: 20px; font-size: 13px; font-weight: 700; margin: 8px 0; }
  .warning-box { background: #fffbeb; border-left: 4px solid #f59e0b; padding: 16px; border-radius: 8px; margin: 16px 0; }
  .warning-text { font-size: 14px; color: #92400e; margin: 0; }
  @media only screen and (max-width: 600px) {
    .content { padding: 24px 16px; }
    .header { padding: 24px 16px; }
    .title { font-size: 20px; }
  }
`;

function frontendUrl(path: string) {
  const base = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

interface CandidateSuccessEmailData {
  candidateName: string;
  candidateId: string;
  tokenNumber: string;
  branchDisplayName: string;
  recruiterName: string;
  recruiterMobile: string;
  registrationDate: string;
}

export function candidateSuccessEmail(data: CandidateSuccessEmailData): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Registration Successful</title>
  <style>${BASE_STYLES}</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 class="logo">MAS CALLNET</h1>
      <p class="tagline">Connecting Talent to Opportunity</p>
    </div>

    <div class="content">
      <h2 class="title">Registration Successful</h2>

      <p class="text">Dear <strong>${data.candidateName}</strong>,</p>

      <p class="text">Congratulations! Your registration has been successfully completed. We're excited to have you join us at <strong>${data.branchDisplayName}</strong>.</p>

      <div class="info-card">
        <div class="info-label">Your Token Number</div>
        <div class="info-value">${data.tokenNumber}</div>
      </div>

      <div class="info-card">
        <div class="info-label">Candidate ID</div>
        <div class="info-value">${data.candidateId}</div>
      </div>

      <div class="divider"></div>

      <h3 style="font-size: 18px; font-weight: 700; color: #111827; margin: 24px 0 12px 0;">Your Assigned Recruiter</h3>

      <div class="info-card">
        <div class="info-label">Recruiter Name</div>
        <div class="info-value">${data.recruiterName}</div>

        <div class="info-label" style="margin-top: 12px;">Contact Number</div>
        <div class="info-value">${data.recruiterMobile}</div>
      </div>

      <div class="warning-box">
        <p class="warning-text">
          <strong>Important:</strong> Please arrive at the branch on time for your interview. Your recruiter will call you when it's your turn.
        </p>
      </div>

      <p class="text">If you have any questions, feel free to contact your recruiter at <strong>${data.recruiterMobile}</strong>.</p>

      <p class="text" style="color: #6b7280; font-size: 14px;">Registration Date: ${data.registrationDate}</p>
    </div>

    <div class="footer">
      <p class="footer-text">Best regards,<br><strong>Team MAS Callnet</strong></p>
      <p class="footer-text">(c) 2026 Mas Callnet India Pvt. Ltd. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `;
}

interface RecruiterNotificationEmailData {
  recruiterName: string;
  candidateName: string;
  candidateMobile: string;
  tokenNumber: string;
  branchDisplayName: string;
  roleApplied: string;
}

export function recruiterNotificationEmail(data: RecruiterNotificationEmailData): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Candidate Assigned</title>
  <style>${BASE_STYLES}</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 class="logo">MAS CALLNET</h1>
      <p class="tagline">Recruiter Portal</p>
    </div>

    <div class="content">
      <h2 class="title">New Candidate Assigned</h2>

      <p class="text">Hi <strong>${data.recruiterName}</strong>,</p>

      <p class="text">A new candidate has been assigned to you for interview at <strong>${data.branchDisplayName}</strong>.</p>

      <div class="success-badge">Token: ${data.tokenNumber}</div>

      <div class="info-card">
        <div class="info-label">Candidate Name</div>
        <div class="info-value">${data.candidateName}</div>

        <div class="info-label" style="margin-top: 12px;">Mobile Number</div>
        <div class="info-value">${data.candidateMobile}</div>

        <div class="info-label" style="margin-top: 12px;">Applied Role</div>
        <div class="info-value">${data.roleApplied}</div>
      </div>

      <div class="warning-box">
        <p class="warning-text">
          <strong>Action Required:</strong> Please check the live queue and call the candidate when ready.
        </p>
      </div>

      <a href="${frontendUrl('/ats/recruiter/my-candidates')}" class="button">Open My Candidates</a>

      <p class="text" style="margin-top: 24px; font-size: 14px; color: #6b7280;">This is an automated notification from the ATS system.</p>
    </div>

    <div class="footer">
      <p class="footer-text">Best regards,<br><strong>ATS System</strong></p>
    </div>
  </div>
</body>
</html>
  `;
}

interface SelectionEmailData {
  candidateName: string;
  candidateEmail: string;
  branchDisplayName: string;
  roleOffered: string;
  onboardingPortalUrl: string;
  tempPassword: string;
}

export function selectionCongratulationsEmail(data: SelectionEmailData): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Congratulations - You're Selected!</title>
  <style>${BASE_STYLES}</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 class="logo">MAS CALLNET</h1>
      <p class="tagline">Welcome to the Team!</p>
    </div>

    <div class="content">
      <h2 class="title">Congratulations! You're Selected</h2>

      <p class="text">Dear <strong>${data.candidateName}</strong>,</p>

      <p class="text">We are thrilled to inform you that you have been <strong>selected</strong> for the position of <strong>${data.roleOffered}</strong> at <strong>${data.branchDisplayName}</strong>!</p>

      <div class="success-badge">Selection Confirmed</div>

      <div class="divider"></div>

      <h3 style="font-size: 18px; font-weight: 700; color: #111827; margin: 24px 0 12px 0;">Next Steps - Complete Your Onboarding</h3>

      <p class="text">To proceed with joining, please complete your onboarding form using the credentials below:</p>

      <div class="info-card">
        <div class="info-label">Onboarding Portal</div>
        <div class="info-value" style="font-size: 14px; word-break: break-all;">${data.onboardingPortalUrl}</div>

        <div class="info-label" style="margin-top: 12px;">Your Email</div>
        <div class="info-value" style="font-size: 14px;">${data.candidateEmail}</div>

        <div class="info-label" style="margin-top: 12px;">Temporary Password</div>
        <div class="info-value">${data.tempPassword}</div>
      </div>

      <a href="${data.onboardingPortalUrl}" class="button">Complete Onboarding Now</a>

      <div class="warning-box">
        <p class="warning-text">
          <strong>Important:</strong> Please complete your onboarding within 7 days. You will be prompted to change your password on first login.
        </p>
      </div>

      <div class="divider"></div>

      <h3 style="font-size: 16px; font-weight: 700; color: #111827; margin: 24px 0 12px 0;">What to Prepare</h3>

      <ul style="color: #4b5563; line-height: 1.8; margin: 0; padding-left: 20px;">
        <li>Aadhaar Card (front & back)</li>
        <li>PAN Card</li>
        <li>Educational Certificates</li>
        <li>Bank Account Details</li>
        <li>Passport-size Photograph</li>
        <li>Previous Experience Letters (if applicable)</li>
      </ul>

      <p class="text" style="margin-top: 24px;">We look forward to having you on our team!</p>
    </div>

    <div class="footer">
      <p class="footer-text">Best regards,<br><strong>Team MAS Callnet</strong></p>
      <p class="footer-text">(c) 2026 Mas Callnet India Pvt. Ltd. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `;
}

// ── Professional Selection Letter of Intent ──────────────────────────────────

interface SelectionLetterData {
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
}

export function selectionLetterOfIntent(data: SelectionLetterData): string {
  const logoUrl = `${process.env.FRONTEND_URL || 'https://mcnhrms.teammas.in'}/mcn-logo.png`;

  // Format joining details with fallbacks
  const joiningDate = data.dateOfJoining || '<em style="color:#94a3b8">To be confirmed</em>';
  const reportingTime = data.reportingTiming || '9:00 AM';
  const salary = data.salaryStructure || '<em style="color:#94a3b8">As per offer discussion</em>';
  const hasPerks = data.otDetails || data.performanceIncentives;

  // Recruiter contact with fallback to HR
  const recruiterName = data.recruiterName || 'HR Team';
  const recruiterMobile = data.recruiterMobile || 'Contact your branch';
  const recruiterEmail = data.recruiterEmail || 'hr@mascallnet.com';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Selection Letter of Intent - MAS Callnet</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background-color: #f3f4f6;
      color: #111827;
    }
    .email-container {
      max-width: 680px;
      margin: 0 auto;
      background-color: #ffffff;
    }
    .header {
      background: linear-gradient(135deg, #083344 0%, #0f766e 60%, #14b8a6 100%);
      padding: 40px 32px;
      text-align: center;
      color: #ffffff;
    }
    .logo-container {
      margin-bottom: 20px;
    }
    .logo {
      max-width: 180px;
      height: auto;
    }
    .company-name {
      font-size: 22px;
      font-weight: 800;
      margin: 12px 0 4px;
      letter-spacing: 0.5px;
    }
    .tagline {
      font-size: 13px;
      color: rgba(255,255,255,0.9);
      font-weight: 500;
    }
    .content {
      padding: 40px 32px;
    }
    .salutation {
      font-size: 17px;
      color: #111827;
      margin: 0 0 20px;
      font-weight: 600;
    }
    .opening {
      font-size: 15px;
      color: #374151;
      line-height: 1.7;
      margin: 0 0 28px;
    }
    .section-title {
      font-size: 18px;
      font-weight: 700;
      color: #111827;
      margin: 32px 0 16px;
      padding-bottom: 8px;
      border-bottom: 2px solid #0f766e;
    }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin: 20px 0;
    }
    .info-card {
      background: #f9fafb;
      border-left: 4px solid #0f766e;
      padding: 16px;
      border-radius: 8px;
    }
    .info-card.full-width {
      grid-column: 1 / -1;
    }
    .info-label {
      font-size: 11px;
      font-weight: 700;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
    }
    .info-value {
      font-size: 16px;
      font-weight: 700;
      color: #111827;
    }
    .perks-badge {
      display: inline-block;
      background: #ecfdf5;
      color: #065f46;
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 700;
      margin: 8px 0;
      border: 1px solid #a7f3d0;
    }
    .cta-section {
      text-align: center;
      margin: 32px 0;
      padding: 24px;
      background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
      border-radius: 12px;
    }
    .cta-button {
      display: inline-block;
      background: linear-gradient(135deg, #0f766e 0%, #14b8a6 100%);
      color: #ffffff;
      text-decoration: none;
      padding: 16px 32px;
      border-radius: 8px;
      font-weight: 700;
      font-size: 16px;
      margin: 12px 0;
      box-shadow: 0 4px 12px rgba(15, 118, 110, 0.3);
      transition: transform 0.2s;
    }
    .cta-button:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 16px rgba(15, 118, 110, 0.4);
    }
    .link-fallback {
      font-size: 12px;
      color: #6b7280;
      margin-top: 12px;
      word-break: break-all;
    }
    .document-list {
      list-style: none;
      padding: 0;
      margin: 16px 0;
    }
    .document-list li {
      padding: 12px 16px;
      margin: 8px 0;
      background: #f9fafb;
      border-left: 4px solid #f59e0b;
      border-radius: 6px;
      font-size: 14px;
      color: #374151;
    }
    .document-list li:before {
      content: "✓";
      display: inline-block;
      width: 24px;
      height: 24px;
      background: #f59e0b;
      color: #ffffff;
      border-radius: 50%;
      text-align: center;
      line-height: 24px;
      margin-right: 12px;
      font-weight: 700;
      font-size: 14px;
    }
    .closing {
      margin: 32px 0 24px;
      font-size: 15px;
      color: #374151;
      line-height: 1.6;
    }
    .signature {
      margin: 24px 0;
    }
    .signature p {
      margin: 4px 0;
      font-size: 15px;
      color: #111827;
    }
    .signature .title {
      font-weight: 700;
      font-size: 16px;
    }
    .divider {
      height: 1px;
      background: #e5e7eb;
      margin: 32px 0;
    }
    .footer {
      background: #f9fafb;
      padding: 32px;
      border-top: 1px solid #e5e7eb;
    }
    .footer-title {
      font-size: 14px;
      font-weight: 700;
      color: #111827;
      margin: 0 0 12px;
    }
    .recruiter-card {
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 16px;
      margin: 12px 0;
    }
    .recruiter-row {
      display: flex;
      align-items: center;
      margin: 8px 0;
      font-size: 14px;
      color: #374151;
    }
    .recruiter-icon {
      display: inline-block;
      width: 32px;
      height: 32px;
      background: #0f766e;
      color: #ffffff;
      border-radius: 50%;
      text-align: center;
      line-height: 32px;
      margin-right: 12px;
      font-weight: 700;
    }
    .legal-footer {
      text-align: center;
      padding: 24px 32px;
      font-size: 11px;
      color: #94a3b8;
      line-height: 1.6;
    }
    @media only screen and (max-width: 600px) {
      .content, .footer, .legal-footer { padding: 24px 20px; }
      .header { padding: 32px 20px; }
      .info-grid { grid-template-columns: 1fr; }
      .company-name { font-size: 20px; }
      .section-title { font-size: 16px; }
    }
  </style>
</head>
<body>
  <div class="email-container">
    <!-- Header with Logo -->
    <div class="header">
      <div class="logo-container">
        <img src="${logoUrl}" alt="MAS Callnet Logo" class="logo" />
      </div>
      <h1 class="company-name">MAS CALLNET INDIA PVT. LTD.</h1>
      <p class="tagline">Talent Acquisition Team</p>
    </div>

    <!-- Main Content -->
    <div class="content">
      <p class="salutation">Dear ${data.candidateName},</p>

      <p class="opening">
        <strong>Congratulations!</strong> We are pleased to inform you that you have been selected for the role of
        <strong>${data.roleOffered}</strong> at <strong>MAS Callnet India Pvt. Ltd.</strong>, ${data.branchName} branch.
      </p>

      <!-- Joining Details Section -->
      <h2 class="section-title">Joining Details</h2>
      <div class="info-grid">
        <div class="info-card">
          <div class="info-label">Date of Joining</div>
          <div class="info-value">${joiningDate}</div>
        </div>
        <div class="info-card">
          <div class="info-label">Reporting Timing</div>
          <div class="info-value">${reportingTime}</div>
        </div>
        <div class="info-card full-width">
          <div class="info-label">Salary Structure</div>
          <div class="info-value">${salary}</div>
        </div>
      </div>

      ${hasPerks ? '<div class="perks-badge">✨ Additional Perks: Over Time & Performance Incentive</div>' : ''}

      <!-- Onboarding CTA Section -->
      <h2 class="section-title">Next Steps</h2>
      <div class="cta-section">
        <p style="margin:0 0 16px;font-size:15px;color:#1e40af;font-weight:600;">
          Please complete the following forms before joining:
        </p>
        <a href="${data.onboardingLink}" class="cta-button">Complete Onboarding Forms →</a>
        <p class="link-fallback">
          If the button doesn't work, copy this link:<br>
          <span style="color:#0f766e;">${data.onboardingLink}</span>
        </p>
      </div>

      <!-- Documents Checklist -->
      <h2 class="section-title">Documents to Carry on Day-1</h2>
      <ul class="document-list">
        <li>ID Proof (Aadhaar / PAN Card)</li>
        <li>Address Proof</li>
        <li>Education Certificates</li>
        <li>2 Passport-size Photographs</li>
        <li>Bank Account Details (if not submitted online)</li>
      </ul>

      <div class="divider"></div>

      <p class="closing">
        We look forward to welcoming you to the team!
      </p>

      <div class="signature">
        <p style="margin-bottom:8px;">Regards,</p>
        <p class="title">MAS Callnet India Pvt. Ltd.</p>
        <p>Recruitment Team</p>
      </div>
    </div>

    <!-- Recruiter Contact Footer -->
    <div class="footer">
      <p class="footer-title">For any queries, contact your recruiter:</p>
      <div class="recruiter-card">
        <div class="recruiter-row">
          <span class="recruiter-icon">👤</span>
          <strong>${recruiterName}</strong>
        </div>
        <div class="recruiter-row">
          <span class="recruiter-icon">📞</span>
          ${recruiterMobile}
        </div>
        <div class="recruiter-row">
          <span class="recruiter-icon">✉️</span>
          <a href="mailto:${recruiterEmail}" style="color:#0f766e;text-decoration:none;">${recruiterEmail}</a>
        </div>
      </div>
    </div>

    <!-- Legal Footer -->
    <div class="legal-footer">
      <p style="margin:0 0 8px;">This is an automated notification from MAS Callnet HRMS. Please keep candidate information confidential.</p>
      <p style="margin:0;">© 2026 Mas Callnet India Pvt. Ltd. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `;
}

interface BGVCompletionEmailData {
  candidateName: string;
  bgvStatus: 'verified' | 'negative' | 'insufficient';
  bgvRemarks: string;
  nextSteps: string;
}

export function bgvCompletionEmail(data: BGVCompletionEmailData): string {
  const statusColor = data.bgvStatus === 'verified' ? '#065f46' : '#b91c1c';
  const statusBg = data.bgvStatus === 'verified' ? '#ecfdf5' : '#fef2f2';
  const statusText = data.bgvStatus === 'verified' ? 'Verified' : data.bgvStatus === 'negative' ? 'Issues Found' : 'Insufficient Documents';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BGV Completion Status</title>
  <style>${BASE_STYLES}</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 class="logo">MAS CALLNET</h1>
      <p class="tagline">Background Verification Update</p>
    </div>

    <div class="content">
      <h2 class="title">Background Verification Completed</h2>

      <p class="text">Dear <strong>${data.candidateName}</strong>,</p>

      <p class="text">Your background verification process has been completed.</p>

      <div style="background: ${statusBg}; border-left: 4px solid ${statusColor}; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <div class="info-label">BGV Status</div>
        <div class="info-value" style="color: ${statusColor};">${statusText}</div>

        <div class="info-label" style="margin-top: 12px;">Remarks</div>
        <p style="margin: 4px 0 0 0; font-size: 14px; color: ${statusColor};">${data.bgvRemarks}</p>
      </div>

      <div class="divider"></div>

      <h3 style="font-size: 16px; font-weight: 700; color: #111827; margin: 24px 0 12px 0;">Next Steps</h3>

      <p class="text">${data.nextSteps}</p>

      ${data.bgvStatus !== 'verified' ? `
      <div class="warning-box">
        <p class="warning-text">
          <strong>Action Required:</strong> Please contact HR to resolve any pending items.
        </p>
      </div>
      ` : ''}
    </div>

    <div class="footer">
      <p class="footer-text">Best regards,<br><strong>HR Team - MAS Callnet</strong></p>
    </div>
  </div>
</body>
</html>
  `;
}

interface PayrollHRNotificationEmailData {
  hrName: string;
  candidateName: string;
  candidateId: string;
  branchDisplayName: string;
  roleOffered: string;
}

export function payrollHRNotificationEmail(data: PayrollHRNotificationEmailData): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Candidate for Validation</title>
  <style>${BASE_STYLES}</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 class="logo">MAS CALLNET</h1>
      <p class="tagline">Payroll HR Portal</p>
    </div>

    <div class="content">
      <h2 class="title">New Candidate for Salary Validation</h2>

      <p class="text">Hi <strong>${data.hrName}</strong>,</p>

      <p class="text">A new candidate has completed BGV and is now pending your validation for salary assignment.</p>

      <div class="info-card">
        <div class="info-label">Candidate Name</div>
        <div class="info-value">${data.candidateName}</div>

        <div class="info-label" style="margin-top: 12px;">Candidate ID</div>
        <div class="info-value">${data.candidateId}</div>

        <div class="info-label" style="margin-top: 12px;">Branch</div>
        <div class="info-value">${data.branchDisplayName}</div>

        <div class="info-label" style="margin-top: 12px;">Role</div>
        <div class="info-value">${data.roleOffered}</div>
      </div>

      <div class="warning-box">
        <p class="warning-text">
          <strong>Action Required:</strong> Please validate the candidate's details, assign salary structure, and submit for branch head approval.
        </p>
      </div>

      <a href="${frontendUrl('/ats/payroll-hr-validation')}" class="button">Open Payroll HR Validation</a>

      <p class="text" style="margin-top: 24px; font-size: 14px; color: #6b7280;">This is an automated notification from the ATS system.</p>
    </div>

    <div class="footer">
      <p class="footer-text">Best regards,<br><strong>ATS System</strong></p>
    </div>
  </div>
</body>
</html>
  `;
}

interface BranchHeadApprovalEmailData {
  branchHeadName: string;
  candidateName: string;
  candidateId: string;
  branchDisplayName: string;
  roleOffered: string;
  proposedSalary: string;
  joiningDate: string;
}

export function branchHeadApprovalEmail(data: BranchHeadApprovalEmailData): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Approval Request</title>
  <style>${BASE_STYLES}</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 class="logo">MAS CALLNET</h1>
      <p class="tagline">Branch Head Portal</p>
    </div>

    <div class="content">
      <h2 class="title">New Candidate Pending Your Approval</h2>

      <p class="text">Dear <strong>${data.branchHeadName}</strong>,</p>

      <p class="text">A new candidate has been validated by Payroll HR and is now pending your final approval.</p>

      <div class="info-card">
        <div class="info-label">Candidate Name</div>
        <div class="info-value">${data.candidateName}</div>

        <div class="info-label" style="margin-top: 12px;">Candidate ID</div>
        <div class="info-value">${data.candidateId}</div>

        <div class="info-label" style="margin-top: 12px;">Branch</div>
        <div class="info-value">${data.branchDisplayName}</div>

        <div class="info-label" style="margin-top: 12px;">Role</div>
        <div class="info-value">${data.roleOffered}</div>

        <div class="info-label" style="margin-top: 12px;">Proposed CTC</div>
        <div class="info-value">${data.proposedSalary}</div>

        <div class="info-label" style="margin-top: 12px;">Joining Date</div>
        <div class="info-value">${data.joiningDate}</div>
      </div>

      <div class="warning-box">
        <p class="warning-text">
          <strong>Action Required:</strong> Please review the candidate details and approve or reject the joining.
        </p>
      </div>

      <a href="${frontendUrl('/ats/branch-head-approval')}" class="button">Review & Approve</a>

      <p class="text" style="margin-top: 24px; font-size: 14px; color: #6b7280;">Once approved, an employee code will be generated automatically.</p>
    </div>

    <div class="footer">
      <p class="footer-text">Best regards,<br><strong>ATS System</strong></p>
    </div>
  </div>
</body>
</html>
  `;
}

// ── Professional Rejection Email ──────────────────────────────────────────────

export interface RejectionEmailData {
  candidateName: string;
  branchDisplayName: string;
  processName?: string | null;
  applicationRef?: string | null;
  companyName?: string;
  hrEmail?: string;
}

export function rejectedEmail(data: RejectionEmailData): string {
  const company = data.companyName ?? 'MAS Callnet India Pvt. Ltd.';
  const hrEmail = data.hrEmail ?? 'hr@mascallnet.com';
  const ref = data.applicationRef ? `<p style="font-size:13px;color:#6b7280;margin:4px 0 0;">Ref: ${data.applicationRef}</p>` : '';
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Application Update - ${company}</title>
<style>${BASE_STYLES}
  .rej-header { background: linear-gradient(135deg, #374151 0%, #4b5563 100%); padding: 32px 24px; text-align: center; }
  .rej-badge { display: inline-block; background: #fef2f2; color: #991b1b; padding: 8px 18px; border-radius: 20px; font-size: 13px; font-weight: 700; margin: 8px 0; border: 1px solid #fecaca; }
  .encourage-box { background: #eff6ff; border-left: 4px solid #3b82f6; padding: 16px; border-radius: 8px; margin: 16px 0; }
  .encourage-text { font-size: 14px; color: #1e40af; margin: 0; line-height: 1.6; }
</style>
</head>
<body>
  <div class="container">
    <div class="rej-header">
      <p class="logo">${company}</p>
      <p class="tagline">Talent Acquisition</p>
    </div>
    <div class="content">
      <p class="text">Dear <strong>${data.candidateName}</strong>,</p>
      <p class="text">Thank you for your interest in joining <strong>${company}</strong> and for taking the time to attend our recruitment process at our <strong>${data.branchDisplayName}</strong> location${data.processName ? ` - <strong>${data.processName}</strong>` : ''}.</p>
      <p class="text">After careful evaluation of all candidates, we regret to inform you that we are unable to proceed with your application at this time.</p>
      <span class="rej-badge">Application Not Progressed</span>
      ${ref}
      <div class="divider"></div>
      <div class="encourage-box">
        <p class="encourage-text">
          <strong>Keep going!</strong> This decision is specific to this opening and does not reflect on your overall potential or abilities. We encourage you to continue developing your skills and apply for future opportunities that match your profile.
        </p>
      </div>
      <p class="text">We will retain your profile in our database and may reach out for suitable future openings.</p>
      <p class="text">For any queries, write to us at <a href="mailto:${hrEmail}" style="color:#6d28d9;">${hrEmail}</a>.</p>
      <p class="text" style="margin-top:24px;">We wish you the very best in your career journey.</p>
      <p class="text">Warm regards,<br><strong>Talent Acquisition Team</strong><br>${company}</p>
    </div>
    <div class="footer">
      <p class="footer-text">This is an automated notification. Please do not reply to this email.</p>
      <p class="footer-text" style="margin-top:8px;">For queries: <a href="mailto:${hrEmail}" class="footer-link">${hrEmail}</a></p>
    </div>
  </div>
</body>
</html>
  `;
}

// ── Assessment Invitation ──────────────────────────────────────────────────────

export interface AssessmentInvitationEmailData {
  candidateName: string;
  tokenNumber: string;
  assessmentLink: string;
  recruiterName: string;
  recruiterMobile: string;
  expiresAt: string;
}

export function assessmentInvitationEmail(data: AssessmentInvitationEmailData): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Complete Your Assessment — MAS Callnet</title>
  <style>${BASE_STYLES}</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 class="logo">MAS CALLNET</h1>
      <p class="tagline">Connecting Talent to Opportunity</p>
    </div>

    <div class="content">
      <h2 class="title">Complete Your Pre-Employment Assessment</h2>

      <p class="text">Dear <strong>${data.candidateName}</strong>,</p>

      <p class="text">
        Your recruiter has shared a pre-employment assessment link with you. Please complete it before your interview to proceed to the next round.
      </p>

      <div style="text-align:center;margin:28px 0;">
        <a href="${data.assessmentLink}" class="button" target="_blank">Start Assessment →</a>
      </div>

      <p class="text" style="font-size:13px;color:#6b7280;word-break:break-all;">
        If the button above doesn't work, copy and paste this link into your browser:<br>
        <strong>${data.assessmentLink}</strong>
      </p>

      <div class="info-card">
        <div class="info-label">Token Number</div>
        <div class="info-value">${data.tokenNumber}</div>
        <div class="info-label" style="margin-top:12px;">Link valid until</div>
        <div class="info-value">${data.expiresAt}</div>
      </div>

      <div class="divider"></div>

      <h3 style="font-size:16px;font-weight:700;color:#111827;margin:20px 0 10px 0;">Your Assigned Recruiter</h3>

      <div class="info-card">
        <div class="info-label">Recruiter</div>
        <div class="info-value">${data.recruiterName}</div>
        <div class="info-label" style="margin-top:12px;">Contact</div>
        <div class="info-value">${data.recruiterMobile}</div>
      </div>

      <div class="warning-box">
        <p class="warning-text">
          <strong>Important:</strong> This link is personal — do not share it with anyone. Complete the assessment in one sitting using a stable internet connection.
        </p>
      </div>
    </div>

    <div class="footer">
      <p class="footer-text">Best regards,<br><strong>Team MAS Callnet</strong></p>
      <p class="footer-text">&copy; 2026 Mas Callnet India Pvt. Ltd. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `;
}
