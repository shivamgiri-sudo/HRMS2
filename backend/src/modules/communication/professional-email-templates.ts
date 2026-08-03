// Professional Email Templates for HR, Payroll, Exit, Admin, IT, and Engagement
// All templates are mobile-responsive with MAS Callnet branding

const BASE_STYLES = `
  body { margin: 0; padding: 0; background: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }
  .container { max-width: 640px; margin: 0 auto; padding: 24px 16px; }
  .card { background: #fff; border-radius: 20px; overflow: hidden; box-shadow: 0 12px 40px rgba(15,23,42,.12); }
  .header { padding: 32px; text-align: center; color: #fff; }
  .header-label { font-size: 11px; font-weight: 800; letter-spacing: .15em; text-transform: uppercase; margin-bottom: 8px; }
  .header-title { margin: 0; font-size: 26px; font-weight: 800; }
  .content { padding: 32px; }
  .text { margin: 0 0 24px; font-size: 15px; line-height: 1.7; color: #475569; }
  .info-box { border-radius: 12px; padding: 24px; margin: 24px 0; }
  .info-row { padding: 12px 0; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; }
  .info-value { font-size: 15px; font-weight: 600; color: #0f172a; text-align: right; }
  .btn { display: inline-block; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 700; font-size: 15px; }
  .alert { border-left: 4px solid; border-radius: 8px; padding: 16px; margin: 24px 0; font-size: 13px; line-height: 1.6; }
  .footer { background: #f8fafc; padding: 20px 32px; border-top: 1px solid #e2e8f0; text-align: center; }
  .footer-text { margin: 0; font-size: 11px; color: #94a3b8; }
  .signature { margin: 32px 0 24px; padding-top: 24px; border-top: 1px solid #e2e8f0; }
  @media (max-width: 600px) { .content, .header { padding: 24px 20px; } .header-title { font-size: 22px; } }
`;

// ══════════════════════════════════════════════════════════════════════════════
// ATS TEMPLATES
// ══════════════════════════════════════════════════════════════════════════════

export interface InterviewInvitationData {
  candidateName: string;
  role: string;
  interviewDate: string;
  interviewTime: string;
  location: string;
  interviewerName: string;
}

export function interviewInvitationEmail(data: InterviewInvitationData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>${BASE_STYLES}</style></head>
<body>
  <div class="container">
    <div class="card">
      <div class="header" style="background:linear-gradient(135deg,#083344 0%,#0f766e 60%,#14b8a6 100%)">
        <div class="header-label" style="color:#99f6e4">MAS CALLNET INDIA PVT. LTD.</div>
        <h1 class="header-title">Interview Invitation</h1>
      </div>
      <div class="content">
        <p class="text">Dear <strong>${data.candidateName}</strong>,</p>
        <p class="text">We are pleased to invite you for an interview for the position of <strong>${data.role}</strong> at MAS Callnet India Pvt. Ltd.</p>
        <div class="info-box" style="background:#f8fafc;border-left:4px solid #0f766e">
          <table style="width:100%;border-collapse:collapse">
            <tr><td class="info-row" style="color:#64748b;width:120px">Date</td><td class="info-value">${data.interviewDate}</td></tr>
            <tr><td class="info-row" style="color:#64748b">Time</td><td class="info-value">${data.interviewTime}</td></tr>
            <tr><td class="info-row" style="color:#64748b">Location</td><td class="info-value">${data.location}</td></tr>
            <tr><td class="info-row" style="color:#64748b">Interviewer</td><td class="info-value">${data.interviewerName}</td></tr>
          </table>
        </div>
        <div class="alert" style="background:#fffbeb;border-color:#f59e0b;color:#92400e">
          <strong>Please bring:</strong> Original ID proof (Aadhaar/PAN), updated resume, and educational certificates.
        </div>
        <p class="text">Please confirm your attendance by replying to this email or contacting us.</p>
        <div class="signature">
          <p style="margin:0;font-size:14px;color:#64748b">Best regards,</p>
          <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#0f172a">MAS Callnet Recruitment Team</p>
        </div>
      </div>
      <div class="footer">
        <p class="footer-text">This is an automated notification. Please do not reply directly.</p>
        <p class="footer-text" style="margin-top:8px">&copy; 2026 Mas Callnet India Pvt. Ltd. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export interface OfferAcceptanceData {
  candidateName: string;
  role: string;
  startDate: string;
  branchName: string;
  onboardingLink: string;
  hrName: string;
  hrContact: string;
}

export function offerAcceptanceConfirmationEmail(data: OfferAcceptanceData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>${BASE_STYLES}</style></head>
<body>
  <div class="container">
    <div class="card">
      <div class="header" style="background:linear-gradient(135deg,#059669 0%,#10b981 60%,#34d399 100%)">
        <div style="font-size:48px;margin-bottom:12px">🎉</div>
        <div class="header-label" style="color:#d1fae5">MAS CALLNET INDIA PVT. LTD.</div>
        <h1 class="header-title">Welcome to the Team!</h1>
      </div>
      <div class="content">
        <p class="text">Dear <strong>${data.candidateName}</strong>,</p>
        <p class="text">We are thrilled to confirm that your offer for the position of <strong>${data.role}</strong> has been accepted. Welcome to the MAS Callnet family!</p>
        <div class="info-box" style="background:#ecfdf5;border:1px solid #a7f3d0;text-align:center">
          <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#065f46;text-transform:uppercase;letter-spacing:.5px">Your Start Date</p>
          <p style="margin:0;font-size:24px;font-weight:800;color:#047857">${data.startDate}</p>
        </div>
        <h3 style="margin:28px 0 16px;font-size:16px;font-weight:700;color:#0f172a;border-bottom:2px solid #10b981;padding-bottom:8px">What Happens Next</h3>
        <ul style="margin:0;padding:0 0 0 20px;color:#475569;line-height:1.8">
          <li>Complete your onboarding documents (if not already done)</li>
          <li>HR will contact you with joining day instructions</li>
          <li>Prepare your original documents for verification</li>
          <li>Report to ${data.branchName} on your start date</li>
        </ul>
        <div style="margin:32px 0;text-align:center">
          <a href="${data.onboardingLink}" class="btn" style="background:linear-gradient(135deg,#059669,#10b981);color:#fff;box-shadow:0 4px 12px rgba(16,185,129,.3)">Complete Onboarding</a>
        </div>
        <div class="signature">
          <p style="margin:0;font-size:14px;color:#64748b">For any queries, contact:</p>
          <p style="margin:4px 0 0;font-size:15px;font-weight:600;color:#0f172a">${data.hrName} | ${data.hrContact}</p>
        </div>
      </div>
      <div class="footer">
        <p class="footer-text">&copy; 2026 Mas Callnet India Pvt. Ltd. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// PAYROLL TEMPLATES
// ══════════════════════════════════════════════════════════════════════════════

export interface PayslipReadyData {
  employeeName: string;
  month: string;
  year: string;
  netPay: string;
  downloadLink: string;
}

export function payslipReadyEmail(data: PayslipReadyData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>${BASE_STYLES}</style></head>
<body>
  <div class="container">
    <div class="card">
      <div class="header" style="background:linear-gradient(135deg,#1e40af 0%,#3b82f6 60%,#60a5fa 100%)">
        <div class="header-label" style="color:#bfdbfe">MAS CALLNET INDIA PVT. LTD.</div>
        <h1 class="header-title">Payslip Available</h1>
        <p style="margin:8px 0 0;font-size:14px;color:#dbeafe">${data.month} ${data.year}</p>
      </div>
      <div class="content">
        <p class="text">Dear <strong>${data.employeeName}</strong>,</p>
        <p class="text">Your payslip for <strong>${data.month} ${data.year}</strong> is now available. You can view and download it from the HRMS portal.</p>
        <div class="info-box" style="background:#eff6ff;border:1px solid #bfdbfe;text-align:center">
          <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:.5px">Net Pay</p>
          <p style="margin:0;font-size:32px;font-weight:800;color:#1e3a8a">₹${data.netPay}</p>
        </div>
        <div style="margin:28px 0;text-align:center">
          <a href="${data.downloadLink}" class="btn" style="background:linear-gradient(135deg,#1e40af,#3b82f6);color:#fff;box-shadow:0 4px 12px rgba(59,130,246,.3)">View Payslip</a>
        </div>
        <div class="alert" style="background:#fefce8;border-color:#eab308;color:#854d0e">
          <strong>Note:</strong> This is a confidential document. Please do not share your payslip details with unauthorized persons.
        </div>
        <div class="signature">
          <p style="margin:0;font-size:14px;color:#64748b">Best regards,</p>
          <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#0f172a">MAS Callnet Payroll Team</p>
        </div>
      </div>
      <div class="footer">
        <p class="footer-text">This is a confidential communication intended for the addressee only.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export interface SalaryCreditedData {
  employeeName: string;
  month: string;
  year: string;
  amount: string;
  accountLast4: string;
  reference: string;
}

export function salaryCreditedEmail(data: SalaryCreditedData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>${BASE_STYLES}</style></head>
<body>
  <div class="container">
    <div class="card">
      <div class="header" style="background:linear-gradient(135deg,#047857 0%,#10b981 60%,#34d399 100%)">
        <div style="font-size:48px;margin-bottom:12px">💰</div>
        <div class="header-label" style="color:#d1fae5">MAS CALLNET INDIA PVT. LTD.</div>
        <h1 class="header-title">Salary Credited</h1>
      </div>
      <div class="content">
        <p class="text">Dear <strong>${data.employeeName}</strong>,</p>
        <p class="text">Your salary for <strong>${data.month} ${data.year}</strong> has been credited to your registered bank account.</p>
        <div class="info-box" style="background:#ecfdf5;border:1px solid #a7f3d0">
          <table style="width:100%;border-collapse:collapse">
            <tr><td class="info-row" style="color:#065f46">Amount Credited</td><td style="padding:10px 0;font-size:20px;font-weight:800;color:#047857;text-align:right">₹${data.amount}</td></tr>
            <tr><td class="info-row" style="color:#065f46;border-top:1px solid #a7f3d0">Account</td><td class="info-value" style="border-top:1px solid #a7f3d0">****${data.accountLast4}</td></tr>
            <tr><td class="info-row" style="color:#065f46;border-top:1px solid #a7f3d0">Reference</td><td style="padding:10px 0;font-size:13px;font-weight:600;color:#64748b;text-align:right;border-top:1px solid #a7f3d0">${data.reference}</td></tr>
          </table>
        </div>
        <p class="text" style="font-size:14px;color:#64748b">Your detailed payslip is available in the HRMS portal. Please verify and report any discrepancies within 3 working days.</p>
        <div class="signature">
          <p style="margin:0;font-size:14px;color:#64748b">Best regards,</p>
          <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#0f172a">MAS Callnet Finance Team</p>
        </div>
      </div>
      <div class="footer">
        <p class="footer-text">This is a confidential communication. Do not forward.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// EXIT TEMPLATES
// ══════════════════════════════════════════════════════════════════════════════

export interface FFSettlementData {
  employeeName: string;
  lastWorkingDay: string;
  settlementAmount: string;
  paymentDate: string;
}

export function ffSettlementCompleteEmail(data: FFSettlementData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>${BASE_STYLES}</style></head>
<body>
  <div class="container">
    <div class="card">
      <div class="header" style="background:linear-gradient(135deg,#4338ca 0%,#6366f1 60%,#818cf8 100%)">
        <div class="header-label" style="color:#c7d2fe">MAS CALLNET INDIA PVT. LTD.</div>
        <h1 class="header-title">Full & Final Settlement</h1>
        <p style="margin:8px 0 0;font-size:14px;color:#e0e7ff">Settlement Completed</p>
      </div>
      <div class="content">
        <p class="text">Dear <strong>${data.employeeName}</strong>,</p>
        <p class="text">Your Full & Final settlement has been processed successfully. Below are the settlement details:</p>
        <div class="info-box" style="background:#f8fafc;border:1px solid #e2e8f0;padding:0;overflow:hidden">
          <div style="padding:16px 20px;background:#f1f5f9;border-bottom:1px solid #e2e8f0">
            <p style="margin:0;font-size:14px;font-weight:700;color:#0f172a">Settlement Summary</p>
          </div>
          <div style="padding:20px">
            <table style="width:100%;border-collapse:collapse">
              <tr><td style="padding:10px 0;font-size:14px;color:#475569">Last Working Day</td><td style="padding:10px 0;font-size:14px;font-weight:600;color:#0f172a;text-align:right">${data.lastWorkingDay}</td></tr>
              <tr><td style="padding:10px 0;font-size:14px;color:#475569;border-top:1px solid #e2e8f0">Settlement Amount</td><td style="padding:10px 0;font-size:18px;font-weight:800;color:#047857;text-align:right;border-top:1px solid #e2e8f0">₹${data.settlementAmount}</td></tr>
              <tr><td style="padding:10px 0;font-size:14px;color:#475569;border-top:1px solid #e2e8f0">Payment Date</td><td style="padding:10px 0;font-size:14px;font-weight:600;color:#0f172a;text-align:right;border-top:1px solid #e2e8f0">${data.paymentDate}</td></tr>
            </table>
          </div>
        </div>
        <div class="alert" style="background:#fefce8;border-color:#eab308;color:#854d0e">
          <strong>Documents:</strong> Your experience letter and relieving letter have been sent to your registered email. Please collect any pending physical documents from HR within 30 days.
        </div>
        <p class="text">We thank you for your contributions to MAS Callnet and wish you all the best in your future endeavors.</p>
        <div class="signature">
          <p style="margin:0;font-size:14px;color:#64748b">Best regards,</p>
          <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#0f172a">MAS Callnet HR & Finance Team</p>
        </div>
      </div>
      <div class="footer">
        <p class="footer-text">&copy; 2026 Mas Callnet India Pvt. Ltd. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// HR TEMPLATES
// ══════════════════════════════════════════════════════════════════════════════

export interface ProbationConfirmationData {
  employeeName: string;
  confirmationDate: string;
}

export function probationConfirmationEmail(data: ProbationConfirmationData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>${BASE_STYLES}</style></head>
<body>
  <div class="container">
    <div class="card">
      <div class="header" style="background:linear-gradient(135deg,#7c3aed 0%,#8b5cf6 60%,#a78bfa 100%)">
        <div style="font-size:48px;margin-bottom:12px">🎊</div>
        <div class="header-label" style="color:#ddd6fe">MAS CALLNET INDIA PVT. LTD.</div>
        <h1 class="header-title">Probation Confirmed!</h1>
      </div>
      <div class="content">
        <p class="text">Dear <strong>${data.employeeName}</strong>,</p>
        <p class="text">Congratulations! We are pleased to inform you that you have successfully completed your probation period and are now confirmed as a permanent employee of MAS Callnet India Pvt. Ltd.</p>
        <div class="info-box" style="background:#f5f3ff;border:1px solid #ddd6fe;text-align:center">
          <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#6d28d9;text-transform:uppercase;letter-spacing:.5px">Confirmation Date</p>
          <p style="margin:0;font-size:24px;font-weight:800;color:#5b21b6">${data.confirmationDate}</p>
        </div>
        <h3 style="margin:28px 0 16px;font-size:16px;font-weight:700;color:#0f172a;border-bottom:2px solid #8b5cf6;padding-bottom:8px">Your New Benefits</h3>
        <ul style="margin:0;padding:0 0 0 20px;color:#475569;line-height:1.8">
          <li>Full eligibility for all company benefits</li>
          <li>Access to performance incentive programs</li>
          <li>Eligibility for internal job postings</li>
          <li>Enhanced leave entitlements</li>
        </ul>
        <p class="text" style="margin-top:24px">Thank you for your dedication and hard work. We look forward to your continued contributions to the team!</p>
        <div class="signature">
          <p style="margin:0;font-size:14px;color:#64748b">Best regards,</p>
          <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#0f172a">MAS Callnet HR Team</p>
        </div>
      </div>
      <div class="footer">
        <p class="footer-text">&copy; 2026 Mas Callnet India Pvt. Ltd. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export interface PromotionData {
  employeeName: string;
  oldRole: string;
  newRole: string;
  effectiveDate: string;
}

export function promotionAnnouncementEmail(data: PromotionData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>${BASE_STYLES}</style></head>
<body>
  <div class="container">
    <div class="card">
      <div class="header" style="background:linear-gradient(135deg,#b45309 0%,#d97706 60%,#f59e0b 100%)">
        <div style="font-size:48px;margin-bottom:12px">🏆</div>
        <div class="header-label" style="color:#fef3c7">MAS CALLNET INDIA PVT. LTD.</div>
        <h1 class="header-title">Congratulations!</h1>
      </div>
      <div class="content">
        <p class="text">Dear <strong>${data.employeeName}</strong>,</p>
        <p class="text">We are thrilled to announce your well-deserved promotion! Your hard work, dedication, and consistent performance have been recognized.</p>
        <div class="info-box" style="background:#fffbeb;border:1px solid #fde68a">
          <table style="width:100%;border-collapse:collapse">
            <tr><td class="info-row" style="color:#92400e">Previous Role</td><td style="padding:12px 0;font-size:15px;color:#78350f;text-align:right">${data.oldRole}</td></tr>
            <tr><td class="info-row" style="color:#92400e;border-top:1px solid #fde68a">New Role</td><td style="padding:12px 0;font-size:18px;font-weight:800;color:#b45309;text-align:right;border-top:1px solid #fde68a">${data.newRole}</td></tr>
            <tr><td class="info-row" style="color:#92400e;border-top:1px solid #fde68a">Effective Date</td><td style="padding:12px 0;font-size:15px;font-weight:600;color:#78350f;text-align:right;border-top:1px solid #fde68a">${data.effectiveDate}</td></tr>
          </table>
        </div>
        <p class="text">This promotion reflects your exceptional contributions and the trust we have in your abilities. We are confident you will excel in your new role.</p>
        <p class="text">Wishing you continued success!</p>
        <div class="signature">
          <p style="margin:0;font-size:14px;color:#64748b">Best regards,</p>
          <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#0f172a">MAS Callnet Management</p>
        </div>
      </div>
      <div class="footer">
        <p class="footer-text">&copy; 2026 Mas Callnet India Pvt. Ltd. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export interface TransferData {
  employeeName: string;
  fromBranch: string;
  toBranch: string;
  effectiveDate: string;
  newManager: string;
}

export function transferNotificationEmail(data: TransferData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>${BASE_STYLES}</style></head>
<body>
  <div class="container">
    <div class="card">
      <div class="header" style="background:linear-gradient(135deg,#0369a1 0%,#0ea5e9 60%,#38bdf8 100%)">
        <div class="header-label" style="color:#bae6fd">MAS CALLNET INDIA PVT. LTD.</div>
        <h1 class="header-title">Transfer Notification</h1>
      </div>
      <div class="content">
        <p class="text">Dear <strong>${data.employeeName}</strong>,</p>
        <p class="text">This is to inform you that your transfer has been approved. Please find the details below:</p>
        <div class="info-box" style="background:#f0f9ff;border:1px solid #bae6fd">
          <table style="width:100%;border-collapse:collapse">
            <tr><td class="info-row" style="color:#0369a1">From Branch</td><td style="padding:12px 0;font-size:15px;color:#0c4a6e;text-align:right">${data.fromBranch}</td></tr>
            <tr><td class="info-row" style="color:#0369a1;border-top:1px solid #bae6fd">To Branch</td><td style="padding:12px 0;font-size:18px;font-weight:800;color:#0369a1;text-align:right;border-top:1px solid #bae6fd">${data.toBranch}</td></tr>
            <tr><td class="info-row" style="color:#0369a1;border-top:1px solid #bae6fd">Effective Date</td><td style="padding:12px 0;font-size:15px;font-weight:600;color:#0c4a6e;text-align:right;border-top:1px solid #bae6fd">${data.effectiveDate}</td></tr>
            <tr><td class="info-row" style="color:#0369a1;border-top:1px solid #bae6fd">Reporting To</td><td style="padding:12px 0;font-size:15px;font-weight:600;color:#0c4a6e;text-align:right;border-top:1px solid #bae6fd">${data.newManager}</td></tr>
          </table>
        </div>
        <div class="alert" style="background:#fefce8;border-color:#eab308;color:#854d0e">
          <strong>Action Required:</strong> Please complete your handover at the current location and report to your new branch on the effective date.
        </div>
        <div class="signature">
          <p style="margin:0;font-size:14px;color:#64748b">Best regards,</p>
          <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#0f172a">MAS Callnet HR Team</p>
        </div>
      </div>
      <div class="footer">
        <p class="footer-text">&copy; 2026 Mas Callnet India Pvt. Ltd. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN/IT TEMPLATES
// ══════════════════════════════════════════════════════════════════════════════

export interface DocumentExpiryData {
  employeeName: string;
  documentType: string;
  expiryDate: string;
  daysLeft: number;
  uploadLink: string;
}

export function documentExpiryReminderEmail(data: DocumentExpiryData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>${BASE_STYLES}</style></head>
<body>
  <div class="container">
    <div class="card">
      <div class="header" style="background:linear-gradient(135deg,#dc2626 0%,#ef4444 60%,#f87171 100%)">
        <div style="font-size:48px;margin-bottom:12px">⚠️</div>
        <div class="header-label" style="color:#fecaca">MAS CALLNET INDIA PVT. LTD.</div>
        <h1 class="header-title">Document Expiry Alert</h1>
      </div>
      <div class="content">
        <p class="text">Dear <strong>${data.employeeName}</strong>,</p>
        <p class="text">This is a reminder that one of your documents is expiring soon. Please take action to renew it.</p>
        <div class="info-box" style="background:#fef2f2;border:1px solid #fecaca">
          <table style="width:100%;border-collapse:collapse">
            <tr><td class="info-row" style="color:#b91c1c">Document Type</td><td style="padding:12px 0;font-size:16px;font-weight:700;color:#7f1d1d;text-align:right">${data.documentType}</td></tr>
            <tr><td class="info-row" style="color:#b91c1c;border-top:1px solid #fecaca">Expiry Date</td><td style="padding:12px 0;font-size:16px;font-weight:700;color:#dc2626;text-align:right;border-top:1px solid #fecaca">${data.expiryDate}</td></tr>
            <tr><td class="info-row" style="color:#b91c1c;border-top:1px solid #fecaca">Days Remaining</td><td style="padding:12px 0;font-size:20px;font-weight:800;color:#dc2626;text-align:right;border-top:1px solid #fecaca">${data.daysLeft} days</td></tr>
          </table>
        </div>
        <div class="alert" style="background:#fefce8;border-color:#eab308;color:#854d0e">
          <strong>Action Required:</strong> Please upload the renewed document in the HRMS portal before the expiry date to avoid compliance issues.
        </div>
        <div style="margin:28px 0;text-align:center">
          <a href="${data.uploadLink}" class="btn" style="background:linear-gradient(135deg,#dc2626,#ef4444);color:#fff;box-shadow:0 4px 12px rgba(220,38,38,.3)">Upload Document</a>
        </div>
        <div class="signature">
          <p style="margin:0;font-size:14px;color:#64748b">Best regards,</p>
          <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#0f172a">MAS Callnet Admin Team</p>
        </div>
      </div>
      <div class="footer">
        <p class="footer-text">&copy; 2026 Mas Callnet India Pvt. Ltd. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export interface AssetAssignmentData {
  employeeName: string;
  assetType: string;
  assetId: string;
  issueDate: string;
}

export function assetAssignmentEmail(data: AssetAssignmentData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>${BASE_STYLES}</style></head>
<body>
  <div class="container">
    <div class="card">
      <div class="header" style="background:linear-gradient(135deg,#475569 0%,#64748b 60%,#94a3b8 100%)">
        <div style="font-size:48px;margin-bottom:12px">💻</div>
        <div class="header-label" style="color:#e2e8f0">MAS CALLNET INDIA PVT. LTD.</div>
        <h1 class="header-title">Asset Assigned</h1>
      </div>
      <div class="content">
        <p class="text">Dear <strong>${data.employeeName}</strong>,</p>
        <p class="text">The following asset has been assigned to you. Please acknowledge receipt and handle it with care.</p>
        <div class="info-box" style="background:#f8fafc;border:1px solid #e2e8f0">
          <table style="width:100%;border-collapse:collapse">
            <tr><td class="info-row" style="color:#64748b">Asset Type</td><td style="padding:12px 0;font-size:16px;font-weight:700;color:#0f172a;text-align:right">${data.assetType}</td></tr>
            <tr><td class="info-row" style="color:#64748b;border-top:1px solid #e2e8f0">Asset ID</td><td class="info-value" style="border-top:1px solid #e2e8f0">${data.assetId}</td></tr>
            <tr><td class="info-row" style="color:#64748b;border-top:1px solid #e2e8f0">Issue Date</td><td class="info-value" style="border-top:1px solid #e2e8f0">${data.issueDate}</td></tr>
          </table>
        </div>
        <div class="alert" style="background:#eff6ff;border-color:#3b82f6;color:#1e40af">
          <strong>Important:</strong> You are responsible for this asset. Please report any damage or loss immediately to the IT department.
        </div>
        <div class="signature">
          <p style="margin:0;font-size:14px;color:#64748b">Best regards,</p>
          <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#0f172a">MAS Callnet IT Team</p>
        </div>
      </div>
      <div class="footer">
        <p class="footer-text">&copy; 2026 Mas Callnet India Pvt. Ltd. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// ENGAGEMENT TEMPLATES
// ══════════════════════════════════════════════════════════════════════════════

export interface BirthdayGreetingData {
  employeeName: string;
  photoUrl?: string;
  branchName?: string;
}

export function birthdayGreetingEmail(data: BirthdayGreetingData): string {
  const avatarSection = data.photoUrl
    ? `<img src="${data.photoUrl}" width="110" height="110" alt="${data.employeeName}"
           style="width:110px;height:110px;border-radius:50%;object-fit:cover;border:5px solid #3BAD49;box-shadow:0 0 0 4px rgba(59,173,73,.2);display:block;margin:0 auto" />`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="110" height="110" viewBox="0 0 120 120" style="display:block;margin:0 auto">
        <circle cx="60" cy="60" r="60" fill="#fce7f3"/>
        <!-- Cake plate -->
        <ellipse cx="60" cy="100" rx="40" ry="9" fill="#fbcfe8"/>
        <!-- Cake bottom -->
        <rect x="22" y="72" width="76" height="30" rx="8" fill="#fce7f3"/>
        <!-- Icing drips top -->
        <path d="M22 78 Q28 86 34 78 Q40 86 46 78 Q52 86 58 78 Q64 86 70 78 Q76 86 82 78 Q88 86 94 78 Q98 86 98 78" stroke="#f9a8d4" stroke-width="5" fill="none" stroke-linecap="round"/>
        <!-- Cake top tier -->
        <rect x="34" y="52" width="52" height="24" rx="7" fill="#fbcfe8"/>
        <!-- Tier icing drips -->
        <path d="M34 58 Q39 64 44 58 Q49 64 54 58 Q59 64 64 58 Q69 64 74 58 Q79 64 84 58 Q86 64 86 58" stroke="#f9a8d4" stroke-width="3.5" fill="none" stroke-linecap="round"/>
        <!-- Candles -->
        <rect x="42" y="38" width="8" height="17" rx="4" fill="#E8231A"/>
        <rect x="56" y="34" width="8" height="21" rx="4" fill="#1B6AB5"/>
        <rect x="70" y="38" width="8" height="17" rx="4" fill="#3BAD49"/>
        <!-- Flames -->
        <ellipse cx="46" cy="35" rx="4" ry="5" fill="#fbbf24"/>
        <ellipse cx="60" cy="31" rx="4" ry="5.5" fill="#fbbf24"/>
        <ellipse cx="74" cy="35" rx="4" ry="5" fill="#fbbf24"/>
        <!-- Flame highlight -->
        <ellipse cx="46" cy="34" rx="1.5" ry="2" fill="#fff" opacity=".6"/>
        <ellipse cx="60" cy="30" rx="1.5" ry="2" fill="#fff" opacity=".6"/>
        <ellipse cx="74" cy="34" rx="1.5" ry="2" fill="#fff" opacity=".6"/>
        <!-- Sprinkles on cake -->
        <rect x="30" y="84" rx="1" ry="1" width="6" height="3" fill="#E8231A" transform="rotate(-30 33 86)"/>
        <rect x="50" y="80" rx="1" ry="1" width="6" height="3" fill="#1B6AB5" transform="rotate(20 53 82)"/>
        <rect x="68" y="85" rx="1" ry="1" width="6" height="3" fill="#3BAD49" transform="rotate(-15 71 87)"/>
        <rect x="85" y="81" rx="1" ry="1" width="5" height="3" fill="#fbbf24" transform="rotate(10 87 83)"/>
        <!-- Flowers corner left -->
        <circle cx="8" cy="22" r="7" fill="#f9a8d4" opacity=".9"/>
        <circle cx="8" cy="22" r="3.5" fill="#fbbf24"/>
        <circle cx="3" cy="38" r="4" fill="#fbcfe8" opacity=".8"/>
        <circle cx="3" cy="38" r="2" fill="#fde68a"/>
        <!-- Flowers corner right -->
        <circle cx="112" cy="18" r="6" fill="#fde68a" opacity=".9"/>
        <circle cx="112" cy="18" r="3" fill="#f9a8d4"/>
        <circle cx="117" cy="35" r="4" fill="#f9a8d4" opacity=".8"/>
        <circle cx="117" cy="35" r="2" fill="#fbbf24"/>
      </svg>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Happy Birthday!</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #fff0f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; }
  @keyframes float1 { 0%,100%{transform:translateY(0) rotate(-8deg)} 50%{transform:translateY(-14px) rotate(-8deg)} }
  @keyframes float2 { 0%,100%{transform:translateY(0) rotate(5deg)} 50%{transform:translateY(-18px) rotate(5deg)} }
  @keyframes float3 { 0%,100%{transform:translateY(0) rotate(-4deg)} 50%{transform:translateY(-10px) rotate(-4deg)} }
  @keyframes shimmer { 0%,100%{opacity:.6} 50%{opacity:1} }
  @media (prefers-reduced-motion:reduce) { * { animation:none !important; } }
</style>
</head>
<body>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#fff0f6;min-height:100vh">
<tr><td align="center" style="padding:0">
<table width="100%" style="max-width:640px;background:#fff;overflow:hidden" cellpadding="0" cellspacing="0">

  <!-- ═══ HERO HEADER ═══ -->
  <tr><td style="background:linear-gradient(160deg,#073f78 0%,#1B6AB5 55%,#2563eb 100%);padding:0;position:relative;overflow:hidden">

    <!-- Background pattern circles -->
    <div style="position:absolute;top:-40px;left:-40px;width:200px;height:200px;border-radius:50%;background:rgba(255,255,255,.04)"></div>
    <div style="position:absolute;bottom:-60px;right:-30px;width:240px;height:240px;border-radius:50%;background:rgba(255,255,255,.05)"></div>
    <div style="position:absolute;top:20px;right:80px;width:80px;height:80px;border-radius:50%;background:rgba(255,255,255,.06)"></div>

    <!-- Confetti strip at top -->
    <div style="height:6px;background:linear-gradient(90deg,#E8231A 0%,#fbbf24 20%,#3BAD49 40%,#1B6AB5 60%,#E8231A 80%,#fbbf24 100%)"></div>

    <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 32px 0">
      <tr>
        <td>
          <p style="margin:0 0 6px;font-size:10px;font-weight:800;letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,.55)">MAS CALLNET INDIA PVT. LTD.</p>
          <h1 style="margin:0;font-size:38px;font-weight:900;color:#fff;line-height:1.1;letter-spacing:-1px">🎂 Happy<br>Birthday!</h1>
          ${data.branchName ? `<p style="margin:10px 0 0;font-size:13px;color:rgba(255,255,255,.7);font-weight:600">${data.branchName} Branch</p>` : ""}
        </td>
        <td align="right" valign="top" style="width:80px">
          <!-- MCN brand monogram -->
          <div style="width:52px;height:52px;border-radius:50%;background:rgba(255,255,255,.15);border:2px solid rgba(255,255,255,.3);display:flex;align-items:center;justify-content:center;text-align:center;line-height:52px;font-size:20px;font-weight:900;color:#fff">M</div>
        </td>
      </tr>
    </table>

    <!-- Balloon scene: full-width SVG -->
    <div style="padding:20px 0 0;overflow:hidden;line-height:0">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 180" width="100%" height="180" preserveAspectRatio="xMidYMax meet" style="display:block">
        <!-- Balloon 1 — Red -->
        <g style="animation:float1 3.8s ease-in-out infinite" transform-origin="82 50">
          <ellipse cx="82" cy="50" rx="28" ry="34" fill="#E8231A"/>
          <ellipse cx="75" cy="38" rx="8" ry="6" fill="rgba(255,255,255,.25)" transform="rotate(-30 75 38)"/>
          <path d="M82 84 Q79 100 82 115" stroke="#cbd5e1" stroke-width="1.5" fill="none"/>
          <path d="M79 115 Q82 110 85 115" stroke="#cbd5e1" stroke-width="1.5" fill="none"/>
        </g>
        <!-- Balloon 2 — Yellow (tall, centre-left) -->
        <g style="animation:float2 4.4s .6s ease-in-out infinite" transform-origin="185 35">
          <ellipse cx="185" cy="35" rx="22" ry="27" fill="#fbbf24"/>
          <ellipse cx="179" cy="26" rx="6" ry="4.5" fill="rgba(255,255,255,.3)" transform="rotate(-25 179 26)"/>
          <path d="M185 62 Q182 78 183 95" stroke="#cbd5e1" stroke-width="1.5" fill="none"/>
          <path d="M181 95 Q184 90 187 95" stroke="#cbd5e1" stroke-width="1.5" fill="none"/>
        </g>
        <!-- Balloon 3 — MCN Blue (large, centre) -->
        <g style="animation:float1 5s 1s ease-in-out infinite" transform-origin="310 28">
          <ellipse cx="310" cy="28" rx="34" ry="40" fill="#1B6AB5"/>
          <ellipse cx="300" cy="14" rx="10" ry="8" fill="rgba(255,255,255,.22)" transform="rotate(-20 300 14)"/>
          <path d="M310 68 Q307 88 308 110" stroke="#cbd5e1" stroke-width="1.5" fill="none"/>
          <path d="M305 110 Q308 104 311 110" stroke="#cbd5e1" stroke-width="1.5" fill="none"/>
        </g>
        <!-- Balloon 4 — Green -->
        <g style="animation:float3 3.5s .3s ease-in-out infinite" transform-origin="440 42">
          <ellipse cx="440" cy="42" rx="25" ry="30" fill="#3BAD49"/>
          <ellipse cx="433" cy="31" rx="7" ry="5.5" fill="rgba(255,255,255,.25)" transform="rotate(-28 433 31)"/>
          <path d="M440 72 Q437 88 438 104" stroke="#cbd5e1" stroke-width="1.5" fill="none"/>
          <path d="M436 104 Q439 99 442 104" stroke="#cbd5e1" stroke-width="1.5" fill="none"/>
        </g>
        <!-- Balloon 5 — Pink (far right) -->
        <g style="animation:float2 4s 1.4s ease-in-out infinite" transform-origin="562 55">
          <ellipse cx="562" cy="55" rx="26" ry="32" fill="#f472b6"/>
          <ellipse cx="555" cy="43" rx="8" ry="6" fill="rgba(255,255,255,.25)" transform="rotate(-22 555 43)"/>
          <path d="M562 87 Q559 103 560 118" stroke="#cbd5e1" stroke-width="1.5" fill="none"/>
          <path d="M558 118 Q561 113 564 118" stroke="#cbd5e1" stroke-width="1.5" fill="none"/>
        </g>
        <!-- Confetti shapes scattered -->
        <rect x="140" y="130" width="10" height="5" rx="2" fill="#E8231A" transform="rotate(-35 145 132)" opacity=".8"/>
        <rect x="260" y="140" width="8" height="4" rx="2" fill="#3BAD49" transform="rotate(20 264 142)" opacity=".8"/>
        <rect x="380" y="125" width="10" height="5" rx="2" fill="#fbbf24" transform="rotate(-15 385 127)" opacity=".8"/>
        <rect x="510" y="138" width="8" height="4" rx="2" fill="#1B6AB5" transform="rotate(30 514 140)" opacity=".8"/>
        <circle cx="60" cy="150" r="4" fill="#fbbf24" opacity=".6"/>
        <circle cx="220" cy="158" r="3" fill="#f472b6" opacity=".6"/>
        <circle cx="490" cy="152" r="4" fill="#E8231A" opacity=".6"/>
        <circle cx="600" cy="145" r="3" fill="#3BAD49" opacity=".6"/>
      </svg>
    </div>
  </td></tr>

  <!-- ═══ AVATAR ═══ -->
  <tr><td style="background:linear-gradient(180deg,#1B6AB5 0%,#fff0f6 100%);padding:0;text-align:center">
    <div style="display:inline-block;margin-top:-10px;border-radius:50%;border:5px solid #fff;box-shadow:0 8px 28px rgba(7,63,120,.22);background:#fff;overflow:visible">
      ${avatarSection}
    </div>
  </td></tr>

  <!-- ═══ MAIN BODY ═══ -->
  <tr><td style="background:#fff;padding:28px 40px 0;text-align:center">
    <h2 style="margin:0 0 6px;font-size:26px;font-weight:900;color:#073f78;letter-spacing:-.5px">${data.employeeName}</h2>
    ${data.branchName ? `<p style="margin:0 0 24px;font-size:13px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:.08em">${data.branchName}</p>` : `<div style="height:24px"></div>`}

    <p style="margin:0 0 24px;font-size:17px;line-height:1.8;color:#334155">
      May your birthday be as <strong style="color:#E8231A">joyful</strong>, <strong style="color:#3BAD49">bright</strong>, and
      <strong style="color:#1B6AB5">beautiful</strong> as the energy you bring to our team every single day! 🎉
    </p>

    <!-- Quote card -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
      <tr><td style="background:linear-gradient(135deg,#fdf2f8 0%,#eff6ff 100%);border-radius:16px;padding:24px 28px;border-left:5px solid #E8231A">
        <p style="margin:0;font-size:16px;font-weight:700;color:#073f78;line-height:1.7;font-style:italic">
          "You're not just an employee — you're a vital spark in the MAS Callnet family flame. 💙"
        </p>
        <p style="margin:10px 0 0;font-size:12px;color:#94a3b8;font-weight:600">— MAS Callnet HR Team</p>
      </td></tr>
    </table>

    <!-- 3-icon decorations: balloon, flowers, gift -->
    <table align="center" cellpadding="0" cellspacing="0" style="margin:0 auto 28px">
      <tr>
        <td style="padding:0 12px;text-align:center;vertical-align:bottom">
          <!-- Big balloon -->
          <svg xmlns="http://www.w3.org/2000/svg" width="52" height="72" viewBox="0 0 52 72" style="display:block;margin:0 auto">
            <ellipse cx="26" cy="26" rx="22" ry="26" fill="#E8231A"/>
            <ellipse cx="19" cy="16" rx="7" ry="5" fill="rgba(255,255,255,.28)" transform="rotate(-25 19 16)"/>
            <path d="M26 52 Q24 60 22 72" stroke="#94a3b8" stroke-width="1.5" fill="none"/>
            <path d="M20 72 Q23 66 26 72" stroke="#94a3b8" stroke-width="1.5" fill="none"/>
          </svg>
          <p style="margin:4px 0 0;font-size:10px;color:#94a3b8;font-weight:700">Celebrate!</p>
        </td>
        <td style="padding:0 12px;text-align:center;vertical-align:bottom">
          <!-- Flower cluster -->
          <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" style="display:block;margin:0 auto">
            <!-- Centre flower big -->
            <circle cx="32" cy="32" r="8" fill="#fbbf24"/>
            <ellipse cx="32" cy="14" rx="7" ry="10" fill="#f9a8d4"/>
            <ellipse cx="32" cy="50" rx="7" ry="10" fill="#f9a8d4"/>
            <ellipse cx="14" cy="32" rx="10" ry="7" fill="#fbcfe8"/>
            <ellipse cx="50" cy="32" rx="10" ry="7" fill="#fbcfe8"/>
            <!-- Diagonal petals -->
            <ellipse cx="19" cy="19" rx="6" ry="9" fill="#fde68a" transform="rotate(-45 19 19)"/>
            <ellipse cx="45" cy="19" rx="6" ry="9" fill="#fde68a" transform="rotate(45 45 19)"/>
            <ellipse cx="19" cy="45" rx="6" ry="9" fill="#fde68a" transform="rotate(45 19 45)"/>
            <ellipse cx="45" cy="45" rx="6" ry="9" fill="#fde68a" transform="rotate(-45 45 45)"/>
            <circle cx="32" cy="32" r="6" fill="#f59e0b"/>
          </svg>
          <p style="margin:4px 0 0;font-size:10px;color:#94a3b8;font-weight:700">Bloom!</p>
        </td>
        <td style="padding:0 12px;text-align:center;vertical-align:bottom">
          <!-- Gift box -->
          <svg xmlns="http://www.w3.org/2000/svg" width="56" height="60" viewBox="0 0 56 60" style="display:block;margin:0 auto">
            <rect x="6" y="22" width="44" height="32" rx="4" fill="#3BAD49"/>
            <rect x="4" y="16" width="48" height="10" rx="3" fill="#2a8f38"/>
            <rect x="25" y="16" width="6" height="38" fill="#fbbf24"/>
            <rect x="4" y="20" width="48" height="6" fill="rgba(0,0,0,.05)"/>
            <!-- Bow -->
            <path d="M28 16 Q20 6 16 10 Q12 14 20 16Z" fill="#fbbf24"/>
            <path d="M28 16 Q36 6 40 10 Q44 14 36 16Z" fill="#fbbf24"/>
            <circle cx="28" cy="16" r="4" fill="#f59e0b"/>
            <!-- Dots on box -->
            <circle cx="14" cy="34" r="2" fill="rgba(255,255,255,.4)"/>
            <circle cx="42" cy="34" r="2" fill="rgba(255,255,255,.4)"/>
          </svg>
          <p style="margin:4px 0 0;font-size:10px;color:#94a3b8;font-weight:700">Surprise!</p>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- ═══ WISHES BANNER ═══ -->
  <tr><td style="padding:0 40px 32px">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="background:linear-gradient(135deg,#073f78 0%,#1B6AB5 100%);border-radius:16px;padding:22px 28px;text-align:center">
        <p style="margin:0 0 6px;font-size:20px">🌸🎈🎁🎊🌼</p>
        <p style="margin:0;font-size:15px;color:#fff;line-height:1.7">
          Wishing you a year full of new adventures, growth, and happiness.<br>
          <strong>Many happy returns of the day!</strong>
        </p>
        <p style="margin:12px 0 0;font-size:14px;font-weight:800;color:rgba(255,255,255,.85)">
          — Your MAS Callnet Family 💙
        </p>
      </td></tr>
    </table>
  </td></tr>

  <!-- ═══ FOOTER ═══ -->
  <tr><td>
    <div style="height:5px;background:linear-gradient(90deg,#E8231A 0%,#1B6AB5 50%,#3BAD49 100%)"></div>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:20px 32px">
      <tr>
        <td align="center">
          <div style="width:36px;height:36px;border-radius:50%;background:#073f78;display:inline-block;line-height:36px;text-align:center;font-size:14px;font-weight:900;color:#fff;margin-bottom:8px">M</div>
          <p style="margin:0;font-size:11px;color:#94a3b8">&copy; 2026 Mas Callnet India Pvt. Ltd. All rights reserved.</p>
          <p style="margin:4px 0 0;font-size:11px;color:#cbd5e1">Automated birthday greeting from your HR team. Please do not reply.</p>
        </td>
      </tr>
    </table>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

export interface WorkAnniversaryData {
  employeeName: string;
  yearsCompleted: number;
  joinDate: string;
  photoUrl?: string;
  branchName?: string;
}

export function workAnniversaryEmail(data: WorkAnniversaryData): string {
  const yearLabel = data.yearsCompleted === 1 ? "Year" : "Years";

  const avatarSection = data.photoUrl
    ? `<img src="${data.photoUrl}" width="110" height="110" alt="${data.employeeName}"
           style="width:110px;height:110px;border-radius:50%;object-fit:cover;border:5px solid #F59E0B;box-shadow:0 0 0 4px rgba(245,158,11,.2);display:block;margin:0 auto" />`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="110" height="110" viewBox="0 0 120 120" style="display:block;margin:0 auto">
        <circle cx="60" cy="60" r="60" fill="#fef3c7"/>
        <!-- Trophy base -->
        <rect x="46" y="88" width="28" height="9" rx="3" fill="#d1d5db"/>
        <rect x="36" y="97" width="48" height="9" rx="5" fill="#e5e7eb"/>
        <!-- Trophy cup -->
        <path d="M30 28 L90 28 L82 72 Q60 84 38 72 Z" fill="#F59E0B"/>
        <path d="M36 28 L84 28 L78 66 Q60 76 42 66 Z" fill="#fbbf24"/>
        <!-- Handles -->
        <path d="M30 34 Q12 38 16 54 Q20 64 34 60" stroke="#F59E0B" stroke-width="7" fill="none" stroke-linecap="round"/>
        <path d="M90 34 Q108 38 104 54 Q100 64 86 60" stroke="#F59E0B" stroke-width="7" fill="none" stroke-linecap="round"/>
        <!-- Star on cup -->
        <path d="M60 42 l2.5 7.5h7.8l-6.3 4.6 2.5 7.5L60 57.4l-6.5 4.6 2.5-7.5-6.3-4.6h7.8Z" fill="#fff" opacity=".85"/>
        <!-- Rays above -->
        <line x1="60" y1="8" x2="60" y2="16" stroke="#fbbf24" stroke-width="3" stroke-linecap="round"/>
        <line x1="74" y1="11" x2="70" y2="18" stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round"/>
        <line x1="46" y1="11" x2="50" y2="18" stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round"/>
        <line x1="84" y1="18" x2="79" y2="23" stroke="#fbbf24" stroke-width="2" stroke-linecap="round"/>
        <line x1="36" y1="18" x2="41" y2="23" stroke="#fbbf24" stroke-width="2" stroke-linecap="round"/>
      </svg>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Work Anniversary!</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #f0f4ff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; }
  @keyframes starPulse { 0%,100%{transform:scale(1);opacity:.8} 50%{transform:scale(1.3);opacity:1} }
  @keyframes floatTrophy { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
  @media (prefers-reduced-motion:reduce) { * { animation:none !important; } }
</style>
</head>
<body>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4ff;min-height:100vh">
<tr><td align="center" style="padding:0">
<table width="100%" style="max-width:640px;background:#fff;overflow:hidden" cellpadding="0" cellspacing="0">

  <!-- ═══ HERO HEADER ═══ -->
  <tr><td style="background:linear-gradient(160deg,#042656 0%,#073f78 45%,#0d5aa7 100%);padding:0;position:relative;overflow:hidden">

    <!-- Gold shimmer circles -->
    <div style="position:absolute;top:-50px;right:-50px;width:220px;height:220px;border-radius:50%;background:rgba(245,158,11,.07)"></div>
    <div style="position:absolute;bottom:-40px;left:-30px;width:180px;height:180px;border-radius:50%;background:rgba(245,158,11,.05)"></div>

    <!-- Gold accent strip at top -->
    <div style="height:6px;background:linear-gradient(90deg,#F59E0B 0%,#fbbf24 30%,#3BAD49 60%,#F59E0B 100%)"></div>

    <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 32px 0">
      <tr>
        <td>
          <p style="margin:0 0 6px;font-size:10px;font-weight:800;letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,.5)">MAS CALLNET INDIA PVT. LTD.</p>
          <h1 style="margin:0;font-size:36px;font-weight:900;color:#fff;line-height:1.1;letter-spacing:-1px">⭐ Work<br>Anniversary!</h1>
          ${data.branchName ? `<p style="margin:10px 0 0;font-size:13px;color:rgba(255,255,255,.65);font-weight:600">${data.branchName} Branch</p>` : ""}
        </td>
        <td align="right" valign="top" style="width:80px">
          <div style="width:52px;height:52px;border-radius:50%;background:rgba(245,158,11,.25);border:2px solid rgba(245,158,11,.5);text-align:center;line-height:52px;font-size:20px;font-weight:900;color:#fbbf24">M</div>
        </td>
      </tr>
    </table>

    <!-- Star + Trophy scene -->
    <div style="padding:16px 0 0;overflow:hidden;line-height:0">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 160" width="100%" height="160" preserveAspectRatio="xMidYMax meet" style="display:block">
        <!-- Large central trophy silhouette -->
        <g style="animation:floatTrophy 4s ease-in-out infinite" transform-origin="320 80">
          <path d="M296 40 L344 40 L336 90 Q320 100 304 90 Z" fill="rgba(245,158,11,.18)"/>
          <path d="M296 46 Q280 50 284 64 Q288 72 300 68" stroke="rgba(245,158,11,.22)" stroke-width="5" fill="none" stroke-linecap="round"/>
          <path d="M344 46 Q360 50 356 64 Q352 72 340 68" stroke="rgba(245,158,11,.22)" stroke-width="5" fill="none" stroke-linecap="round"/>
        </g>
        <!-- Stars scattered -->
        <g style="animation:starPulse 2s ease-in-out infinite">
          <path d="M80 55 l4 12h13l-10.5 7.5 4 12L80 79l-10.5 7.5 4-12L63 67h13Z" fill="#F59E0B" opacity=".9"/>
        </g>
        <g style="animation:starPulse 2.4s .5s ease-in-out infinite">
          <path d="M180 30 l3 9h9l-7.5 5.5 3 9-7.5-5.5-7.5 5.5 3-9L168 39h9Z" fill="#fbbf24" opacity=".8"/>
        </g>
        <g style="animation:starPulse 1.8s .3s ease-in-out infinite">
          <path d="M460 40 l4 12h13l-10.5 7.5 4 12L460 64l-10.5 7.5 4-12L443 52h13Z" fill="#F59E0B" opacity=".9"/>
        </g>
        <g style="animation:starPulse 2.6s .8s ease-in-out infinite">
          <path d="M560 25 l3 9h9l-7.5 5.5 3 9-7.5-5.5-7.5 5.5 3-9L548 34h9Z" fill="#fbbf24" opacity=".7"/>
        </g>
        <!-- Confetti rectangles -->
        <rect x="120" y="120" width="12" height="6" rx="2" fill="#3BAD49" transform="rotate(-30 126 123)" opacity=".7"/>
        <rect x="240" y="130" width="10" height="5" rx="2" fill="#E8231A" transform="rotate(20 245 132)" opacity=".7"/>
        <rect x="400" y="118" width="12" height="6" rx="2" fill="#1B6AB5" transform="rotate(-18 406 121)" opacity=".7"/>
        <rect x="510" y="128" width="10" height="5" rx="2" fill="#fbbf24" transform="rotate(25 515 130)" opacity=".7"/>
        <!-- Dot sparkles -->
        <circle cx="60" cy="140" r="4" fill="#F59E0B" opacity=".5"/>
        <circle cx="220" cy="148" r="3" fill="#3BAD49" opacity=".5"/>
        <circle cx="430" cy="142" r="4" fill="#F59E0B" opacity=".5"/>
        <circle cx="590" cy="135" r="3" fill="#E8231A" opacity=".5"/>
        <!-- Year badge (large) -->
        <rect x="264" y="110" width="112" height="44" rx="22" fill="rgba(59,173,73,.9)"/>
        <text x="320" y="138" text-anchor="middle" font-family="Arial,sans-serif" font-size="22" font-weight="900" fill="#fff">${data.yearsCompleted} ${yearLabel}</text>
      </svg>
    </div>
  </td></tr>

  <!-- ═══ AVATAR ═══ -->
  <tr><td style="background:linear-gradient(180deg,#0d5aa7 0%,#f0f4ff 100%);text-align:center;padding:0">
    <div style="display:inline-block;margin-top:-10px;border-radius:50%;border:5px solid #fff;box-shadow:0 8px 30px rgba(245,158,11,.3);background:#fff">
      ${avatarSection}
    </div>
  </td></tr>

  <!-- ═══ MAIN BODY ═══ -->
  <tr><td style="background:#fff;padding:28px 40px 0;text-align:center">
    <h2 style="margin:0 0 6px;font-size:26px;font-weight:900;color:#073f78;letter-spacing:-.5px">${data.employeeName}</h2>
    ${data.branchName ? `<p style="margin:0 0 24px;font-size:13px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:.08em">${data.branchName}</p>` : `<div style="height:24px"></div>`}

    <!-- Year milestone badge -->
    <div style="display:inline-block;background:linear-gradient(135deg,#3BAD49,#2a8f38);border-radius:20px;padding:16px 36px;margin-bottom:24px;box-shadow:0 6px 20px rgba(59,173,73,.3)">
      <p style="margin:0;font-size:12px;font-weight:800;color:rgba(255,255,255,.8);text-transform:uppercase;letter-spacing:.12em">Celebrating</p>
      <p style="margin:4px 0;font-size:52px;font-weight:900;color:#fff;line-height:1">${data.yearsCompleted}</p>
      <p style="margin:0;font-size:15px;font-weight:700;color:rgba(255,255,255,.92)">${yearLabel} of Excellence 🏆</p>
    </div>

    <p style="margin:0 0 24px;font-size:17px;line-height:1.8;color:#334155">
      Congratulations on this incredible milestone! Your <strong style="color:#3BAD49">dedication</strong>,
      <strong style="color:#1B6AB5">consistency</strong>, and <strong style="color:#F59E0B">commitment</strong>
      are the foundation of our success. 🌟
    </p>

    <!-- Timeline journey -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
      <tr><td style="background:linear-gradient(135deg,#eff6ff 0%,#f0fdf4 100%);border-radius:16px;padding:22px 28px;border-left:5px solid #3BAD49">
        <p style="margin:0 0 12px;font-size:11px;font-weight:800;color:#3BAD49;text-transform:uppercase;letter-spacing:.12em">Your Journey with MAS Callnet</p>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="width:40%">
              <p style="margin:0;font-size:12px;color:#64748b;font-weight:600">JOINED</p>
              <p style="margin:4px 0 0;font-size:15px;font-weight:800;color:#073f78">${data.joinDate}</p>
            </td>
            <td align="center" style="font-size:28px;color:#3BAD49;font-weight:900;width:20%">→</td>
            <td align="center" style="width:40%">
              <div style="background:#073f78;border-radius:10px;padding:6px 12px;display:inline-block">
                <p style="margin:0;font-size:13px;font-weight:900;color:#fff">${data.yearsCompleted} ${yearLabel} Strong 🎉</p>
              </div>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>

    <!-- Stars row -->
    <div style="margin:0 0 24px;text-align:center">
      <svg xmlns="http://www.w3.org/2000/svg" width="160" height="32" viewBox="0 0 160 32" style="display:inline-block">
        <path d="M16 2l3.5 7h7.5l-6 4.5 2.5 7.5L16 17l-7.5 4-2.5-7.5-6-4.5h7.5Z" fill="#F59E0B"/>
        <path d="M48 2l3.5 7h7.5l-6 4.5 2.5 7.5L48 17l-7.5 4-2.5-7.5-6-4.5h7.5Z" fill="#F59E0B"/>
        <path d="M80 0l4 8h9l-7 5.5 3 8.5L80 17.5l-9 4.5 3-8.5-7-5.5h9Z" fill="#fbbf24"/>
        <path d="M112 2l3.5 7h7.5l-6 4.5 2.5 7.5L112 17l-7.5 4-2.5-7.5-6-4.5h7.5Z" fill="#F59E0B"/>
        <path d="M144 2l3.5 7h7.5l-6 4.5 2.5 7.5L144 17l-7.5 4-2.5-7.5-6-4.5h7.5Z" fill="#F59E0B"/>
      </svg>
    </div>
  </td></tr>

  <!-- ═══ CLOSING BANNER ═══ -->
  <tr><td style="padding:0 40px 32px">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="background:linear-gradient(135deg,#042656 0%,#073f78 60%,#0d5aa7 100%);border-radius:16px;padding:24px 28px;text-align:center">
        <p style="margin:0 0 8px;font-size:22px">🌟 ✨ 🏆 ✨ 🌟</p>
        <p style="margin:0;font-size:15px;color:#fff;line-height:1.8">
          Thank you for being a pillar of our family.<br>
          <strong>Here's to many more years of excellence!</strong>
        </p>
        <p style="margin:14px 0 0;font-size:14px;font-weight:800;color:rgba(255,255,255,.8)">
          — MAS Callnet Management 🏆
        </p>
      </td></tr>
    </table>
  </td></tr>

  <!-- ═══ FOOTER ═══ -->
  <tr><td>
    <div style="height:5px;background:linear-gradient(90deg,#F59E0B 0%,#073f78 50%,#3BAD49 100%)"></div>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:20px 32px">
      <tr><td align="center">
        <div style="width:36px;height:36px;border-radius:50%;background:#073f78;display:inline-block;line-height:36px;text-align:center;font-size:14px;font-weight:900;color:#fff;margin-bottom:8px">M</div>
        <p style="margin:0;font-size:11px;color:#94a3b8">&copy; 2026 Mas Callnet India Pvt. Ltd. All rights reserved.</p>
        <p style="margin:4px 0 0;font-size:11px;color:#cbd5e1">Automated work anniversary greeting from your HR team. Please do not reply.</p>
      </td></tr>
    </table>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// AUTH TEMPLATES (Upgraded)
// ══════════════════════════════════════════════════════════════════════════════

export interface PasswordResetData {
  resetLink: string;
}

export function passwordResetEmailProfessional(data: PasswordResetData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>${BASE_STYLES}</style></head>
<body>
  <div class="container">
    <div class="card">
      <div class="header" style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 60%,#334155 100%)">
        <div class="header-label" style="color:#94a3b8">MAS CALLNET HRMS</div>
        <h1 class="header-title">Password Reset Request</h1>
      </div>
      <div class="content">
        <p class="text">We received a request to reset your HRMS password. Click the button below to create a new password.</p>
        <div style="margin:28px 0;text-align:center">
          <a href="${data.resetLink}" class="btn" style="background:linear-gradient(135deg,#2563eb,#3b82f6);color:#fff;padding:16px 40px;font-size:16px;box-shadow:0 4px 12px rgba(37,99,235,.3)">Reset Password</a>
        </div>
        <p style="margin:24px 0;font-size:13px;color:#64748b;text-align:center;word-break:break-all">Or copy this link: ${data.resetLink}</p>
        <div class="alert" style="background:#fef2f2;border-color:#ef4444;color:#991b1b">
          <strong>Security Notice:</strong> This link expires in 1 hour. If you did not request this reset, please ignore this email or contact IT support immediately.
        </div>
        <div class="signature">
          <p style="margin:0;font-size:14px;color:#64748b">Best regards,</p>
          <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#0f172a">MAS Callnet IT Team</p>
        </div>
      </div>
      <div class="footer">
        <p class="footer-text">This is an automated security notification. Do not share this link.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export interface ManagerResignationNoticeData {
  managerName: string;
  employeeName: string;
  employeeCode: string;
  exitRequestId: string;
  reviewLink: string;
}

export function managerResignationNoticeEmail(data: ManagerResignationNoticeData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>${BASE_STYLES}</style></head>
<body>
  <div class="container">
    <div class="card">
      <div class="header" style="background:linear-gradient(135deg,#dc2626 0%,#ef4444 60%,#f87171 100%)">
        <div class="header-label" style="color:#fecaca">RESIGNATION NOTICE</div>
        <h1 class="header-title">Team Member Resignation</h1>
      </div>
      <div class="content">
        <p class="text">Dear <strong>${data.managerName}</strong>,</p>
        <p class="text">This is to notify you that <strong>${data.employeeName}</strong> has submitted a resignation request. Your action is required to review and respond to this request.</p>
        <div class="info-box" style="background:#fef2f2;border:1px solid #fecaca">
          <table style="width:100%;border-collapse:collapse">
            <tr><td class="info-row" style="color:#b91c1c">Employee</td><td class="info-value">${data.employeeName}</td></tr>
            <tr><td class="info-row" style="color:#b91c1c;border-top:1px solid #fecaca">Employee Code</td><td class="info-value" style="border-top:1px solid #fecaca">${data.employeeCode}</td></tr>
            <tr><td class="info-row" style="color:#b91c1c;border-top:1px solid #fecaca">Exit Request ID</td><td style="padding:10px 0;font-size:13px;color:#64748b;text-align:right;border-top:1px solid #fecaca">${data.exitRequestId}</td></tr>
          </table>
        </div>
        <div style="margin:28px 0;text-align:center">
          <a href="${data.reviewLink}" class="btn" style="background:linear-gradient(135deg,#dc2626,#ef4444);color:#fff;box-shadow:0 4px 12px rgba(220,38,38,.3)">Review & Respond</a>
        </div>
        <div class="alert" style="background:#fefce8;border-color:#eab308;color:#854d0e">
          <strong>Action Required:</strong> Please log in to HRMS to review the resignation details and submit your response (approve/reject/discuss).
        </div>
        <div class="signature">
          <p style="margin:0;font-size:14px;color:#64748b">Best regards,</p>
          <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#0f172a">MAS Callnet HRMS</p>
        </div>
      </div>
      <div class="footer">
        <p class="footer-text">This is an automated HR notification. Please keep this information confidential.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}
