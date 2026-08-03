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
  const photoSection = data.photoUrl
    ? `<img src="${data.photoUrl}" width="100" height="100"
           alt="${data.employeeName}"
           style="width:100px;height:100px;border-radius:50%;object-fit:cover;border:4px solid #3BAD49;display:block;margin:0 auto" />`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100" style="display:block;margin:0 auto">
         <!-- Cake base -->
         <rect x="15" y="55" width="70" height="35" rx="8" fill="#fce7f3"/>
         <rect x="15" y="42" width="70" height="18" rx="6" fill="#fbcfe8"/>
         <!-- Frosting drips -->
         <path d="M15 48 Q20 55 25 48 Q30 55 35 48 Q40 55 45 48 Q50 55 55 48 Q60 55 65 48 Q70 55 75 48 Q80 55 85 48" stroke="#f9a8d4" stroke-width="4" fill="none"/>
         <!-- Candles -->
         <rect x="30" y="32" width="6" height="14" rx="3" fill="#E8231A"/>
         <rect x="47" y="28" width="6" height="18" rx="3" fill="#1B6AB5"/>
         <rect x="64" y="32" width="6" height="14" rx="3" fill="#3BAD49"/>
         <!-- Flames -->
         <ellipse cx="33" cy="30" rx="3" ry="4" fill="#fbbf24"/>
         <ellipse cx="50" cy="26" rx="3" ry="4" fill="#fbbf24"/>
         <ellipse cx="67" cy="30" rx="3" ry="4" fill="#fbbf24"/>
         <!-- Flowers -->
         <circle cx="10" cy="20" r="5" fill="#f9a8d4" opacity=".8"/>
         <circle cx="90" cy="15" r="4" fill="#fde68a" opacity=".8"/>
         <circle cx="5" cy="40" r="3" fill="#fbcfe8" opacity=".7"/>
         <circle cx="95" cy="38" r="3" fill="#fde68a" opacity=".7"/>
       </svg>`;

  const branchLine = data.branchName
    ? `<p style="margin:4px 0 0;font-size:13px;color:rgba(255,255,255,.75)">${data.branchName} Team</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>
  ${BASE_STYLES}
  @keyframes confetti { 0%{transform:translateY(0) rotate(0deg);opacity:1} 100%{transform:translateY(60px) rotate(360deg);opacity:0} }
</style>
</head>
<body>
<div class="container">
  <div class="card">

    <!-- Header: MCN Navy → Blue gradient -->
    <div style="background:linear-gradient(135deg,#073f78 0%,#1B6AB5 100%);padding:36px 32px 28px;text-align:center;position:relative;overflow:hidden">
      <!-- MCN Logo -->
      <div style="position:absolute;top:16px;right:20px">
        <img src="https://mcnhrms.teammas.in/mcn-logo.png" height="30" alt="MCN" style="height:30px;opacity:.9" />
      </div>
      <!-- Confetti dots (pure HTML/CSS) -->
      <div style="position:absolute;top:0;left:0;right:0;height:100%;pointer-events:none;overflow:hidden">
        <div style="position:absolute;top:8px;left:12%;width:8px;height:8px;border-radius:50%;background:#E8231A;animation:confetti 2.4s ease-in infinite"></div>
        <div style="position:absolute;top:14px;left:28%;width:6px;height:6px;border-radius:50%;background:#3BAD49;animation:confetti 2.8s .4s ease-in infinite"></div>
        <div style="position:absolute;top:6px;left:50%;width:7px;height:7px;border-radius:50%;background:#fbbf24;animation:confetti 2.2s .2s ease-in infinite"></div>
        <div style="position:absolute;top:10px;left:68%;width:9px;height:9px;border-radius:50%;background:#f9a8d4;animation:confetti 3s .6s ease-in infinite"></div>
        <div style="position:absolute;top:4px;left:82%;width:6px;height:6px;border-radius:50%;background:#1B6AB5;animation:confetti 2.6s .1s ease-in infinite"></div>
      </div>
      <p style="margin:0 0 6px;font-size:11px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;color:rgba(255,255,255,.65)">MAS CALLNET INDIA PVT. LTD.</p>
      <h1 style="margin:0 0 4px;font-size:30px;font-weight:900;color:#fff;letter-spacing:-.5px">🎂 Happy Birthday!</h1>
      ${branchLine}
    </div>

    <!-- Photo / Cake SVG avatar -->
    <div style="text-align:center;margin-top:-20px;padding:0 32px">
      <div style="display:inline-block;border:4px solid #fff;border-radius:50%;box-shadow:0 4px 16px rgba(7,63,120,.18);background:#fff;overflow:hidden">
        ${photoSection}
      </div>
    </div>

    <!-- Body -->
    <div class="content" style="text-align:center;padding-top:16px">
      <h2 style="margin:0 0 4px;font-size:22px;font-weight:800;color:#073f78">${data.employeeName}</h2>
      ${data.branchName ? `<p style="margin:0 0 20px;font-size:13px;color:#64748b">${data.branchName}</p>` : `<div style="margin-bottom:20px"></div>`}

      <p style="margin:0 0 20px;font-size:16px;line-height:1.75;color:#475569">
        Wishing you a day as bright and joyful as the energy you bring to our team every day!
        May this birthday mark the start of a wonderful new chapter.
      </p>

      <!-- Highlight box -->
      <div style="background:linear-gradient(135deg,#fdf2f8,#eff6ff);border-radius:14px;padding:22px;margin:0 0 22px;border:1px solid #fce7f3">
        <p style="margin:0;font-size:15px;color:#073f78;line-height:1.7;font-weight:600">
          "You are not just a colleague — you are part of the MAS Callnet family. 💙"
        </p>
      </div>

      <!-- Decoration row (SVG icons: balloon, flower, gift) -->
      <div style="display:flex;justify-content:center;gap:20px;margin:20px 0">
        <!-- Balloon -->
        <svg xmlns="http://www.w3.org/2000/svg" width="36" height="48" viewBox="0 0 36 48">
          <ellipse cx="18" cy="18" rx="14" ry="16" fill="#E8231A"/>
          <path d="M18 34 L15 48" stroke="#64748b" stroke-width="1.5" fill="none"/>
          <path d="M15 48 Q18 44 21 48" stroke="#64748b" stroke-width="1.5" fill="none"/>
        </svg>
        <!-- Flower -->
        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
          <circle cx="20" cy="20" r="6" fill="#fbbf24"/>
          <ellipse cx="20" cy="8" rx="5" ry="7" fill="#f9a8d4"/>
          <ellipse cx="20" cy="32" rx="5" ry="7" fill="#f9a8d4"/>
          <ellipse cx="8" cy="20" rx="7" ry="5" fill="#fbcfe8"/>
          <ellipse cx="32" cy="20" rx="7" ry="5" fill="#fbcfe8"/>
        </svg>
        <!-- Gift -->
        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
          <rect x="6" y="18" width="28" height="20" rx="3" fill="#3BAD49"/>
          <rect x="4" y="13" width="32" height="8" rx="3" fill="#2a8f38"/>
          <rect x="18" y="13" width="4" height="25" fill="#fbbf24"/>
          <path d="M20 13 Q12 6 10 11 Q8 17 20 13Z" fill="#fbbf24"/>
          <path d="M20 13 Q28 6 30 11 Q32 17 20 13Z" fill="#fbbf24"/>
        </svg>
      </div>

      <div class="signature">
        <p style="margin:0;font-size:14px;color:#64748b">With warmth &amp; celebration,</p>
        <p style="margin:6px 0 0;font-size:16px;font-weight:800;color:#073f78">Your MAS Callnet Family 💙</p>
      </div>
    </div>

    <!-- Red accent strip + footer -->
    <div style="height:4px;background:#E8231A"></div>
    <div class="footer" style="background:#f8fafc">
      <img src="https://mcnhrms.teammas.in/mcn-logo.png" height="22" alt="MCN" style="height:22px;margin-bottom:8px;opacity:.7" />
      <p class="footer-text">&copy; 2026 Mas Callnet India Pvt. Ltd. All rights reserved.</p>
      <p class="footer-text" style="margin-top:4px">This is an automated birthday greeting from your HR team.</p>
    </div>
  </div>
</div>
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
  const photoSection = data.photoUrl
    ? `<img src="${data.photoUrl}" width="100" height="100"
           alt="${data.employeeName}"
           style="width:100px;height:100px;border-radius:50%;object-fit:cover;border:4px solid #F59E0B;display:block;margin:0 auto" />`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100" style="display:block;margin:0 auto">
         <!-- Trophy body -->
         <rect x="35" y="60" width="30" height="8" rx="3" fill="#e2e8f0"/>
         <rect x="28" y="68" width="44" height="8" rx="4" fill="#cbd5e1"/>
         <!-- Trophy cup -->
         <path d="M25 20 L75 20 L68 55 Q50 65 32 55 Z" fill="#F59E0B"/>
         <!-- Handles -->
         <path d="M25 25 Q10 30 14 42 Q18 50 28 46" stroke="#F59E0B" stroke-width="6" fill="none" stroke-linecap="round"/>
         <path d="M75 25 Q90 30 86 42 Q82 50 72 46" stroke="#F59E0B" stroke-width="6" fill="none" stroke-linecap="round"/>
         <!-- Star shine lines -->
         <line x1="50" y1="5" x2="50" y2="12" stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round"/>
         <line x1="62" y1="8" x2="58" y2="14" stroke="#fbbf24" stroke-width="2" stroke-linecap="round"/>
         <line x1="38" y1="8" x2="42" y2="14" stroke="#fbbf24" stroke-width="2" stroke-linecap="round"/>
         <line x1="72" y1="16" x2="66" y2="19" stroke="#fbbf24" stroke-width="2" stroke-linecap="round"/>
         <line x1="28" y1="16" x2="34" y2="19" stroke="#fbbf24" stroke-width="2" stroke-linecap="round"/>
       </svg>`;

  const branchLine = data.branchName
    ? `<p style="margin:4px 0 0;font-size:13px;color:rgba(255,255,255,.75)">${data.branchName} Team</p>`
    : "";

  const yearLabel = data.yearsCompleted === 1 ? "Year" : "Years";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>${BASE_STYLES}</style>
</head>
<body>
<div class="container">
  <div class="card">

    <!-- Header: MCN deep navy gradient -->
    <div style="background:linear-gradient(135deg,#073f78 0%,#0d5aa7 60%,#1B6AB5 100%);padding:36px 32px 28px;text-align:center;position:relative;overflow:hidden">
      <!-- MCN Logo -->
      <div style="position:absolute;top:16px;right:20px">
        <img src="https://mcnhrms.teammas.in/mcn-logo.png" height="30" alt="MCN" style="height:30px;opacity:.9" />
      </div>
      <!-- Star shimmer dots -->
      <div style="position:absolute;top:10px;left:10%;font-size:16px;opacity:.5">★</div>
      <div style="position:absolute;top:20px;left:30%;font-size:10px;opacity:.4">★</div>
      <div style="position:absolute;top:8px;right:15%;font-size:12px;opacity:.4">★</div>
      <div style="position:absolute;top:28px;right:35%;font-size:8px;opacity:.35">★</div>
      <p style="margin:0 0 6px;font-size:11px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;color:rgba(255,255,255,.65)">MAS CALLNET INDIA PVT. LTD.</p>
      <h1 style="margin:0 0 4px;font-size:28px;font-weight:900;color:#fff;letter-spacing:-.5px">⭐ Work Anniversary!</h1>
      ${branchLine}
    </div>

    <!-- Photo / Trophy SVG avatar -->
    <div style="text-align:center;margin-top:-20px;padding:0 32px">
      <div style="display:inline-block;border:4px solid #fff;border-radius:50%;box-shadow:0 4px 16px rgba(7,63,120,.18);background:#fff;overflow:hidden">
        ${photoSection}
      </div>
    </div>

    <!-- Body -->
    <div class="content" style="text-align:center;padding-top:16px">
      <h2 style="margin:0 0 4px;font-size:22px;font-weight:800;color:#073f78">${data.employeeName}</h2>
      ${data.branchName ? `<p style="margin:0 0 20px;font-size:13px;color:#64748b">${data.branchName}</p>` : `<div style="margin-bottom:20px"></div>`}

      <!-- Year milestone badge -->
      <div style="display:inline-block;background:linear-gradient(135deg,#3BAD49,#2a8f38);border-radius:999px;padding:10px 28px;margin-bottom:22px;box-shadow:0 4px 14px rgba(59,173,73,.3)">
        <span style="font-size:13px;font-weight:700;color:rgba(255,255,255,.85);text-transform:uppercase;letter-spacing:.1em">Celebrating</span>
        <div style="font-size:42px;font-weight:900;color:#fff;line-height:1.1">${data.yearsCompleted}</div>
        <span style="font-size:14px;font-weight:700;color:rgba(255,255,255,.9)">${yearLabel} of Excellence</span>
      </div>

      <p style="margin:0 0 20px;font-size:16px;line-height:1.75;color:#475569">
        Congratulations on this incredible milestone! Your dedication, consistency, and commitment
        have made a lasting impact on our entire team.
      </p>

      <!-- Timeline -->
      <div style="background:linear-gradient(135deg,#eff6ff,#f0fdf4);border-radius:14px;padding:20px;margin:0 0 22px;border:1px solid #dbeafe">
        <p style="margin:0 0 10px;font-size:12px;font-weight:700;color:#1B6AB5;text-transform:uppercase;letter-spacing:.08em">Your Journey</p>
        <div style="display:flex;align-items:center;justify-content:center;gap:10px;font-size:14px;color:#0f172a;font-weight:600;flex-wrap:wrap">
          <span>Joined ${data.joinDate}</span>
          <span style="color:#3BAD49;font-size:20px;font-weight:900">→</span>
          <span style="background:#073f78;color:#fff;border-radius:6px;padding:3px 10px">${data.yearsCompleted} ${yearLabel} Strong 🎉</span>
        </div>
      </div>

      <p style="margin:0 0 24px;font-size:15px;color:#64748b;line-height:1.7">
        Thank you for being a pillar of the MAS Callnet family. Your loyalty and hard work inspire everyone around you!
      </p>

      <!-- Stars decoration row -->
      <div style="display:flex;justify-content:center;gap:12px;margin:16px 0">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="#F59E0B"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
        <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="#F59E0B"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
        <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="#fbbf24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
        <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="#F59E0B"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="#F59E0B"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
      </div>

      <div class="signature">
        <p style="margin:0;font-size:14px;color:#64748b">With pride &amp; appreciation,</p>
        <p style="margin:6px 0 0;font-size:16px;font-weight:800;color:#073f78">MAS Callnet Management 🏆</p>
      </div>
    </div>

    <!-- Green accent strip + footer -->
    <div style="height:4px;background:#3BAD49"></div>
    <div class="footer" style="background:#f8fafc">
      <img src="https://mcnhrms.teammas.in/mcn-logo.png" height="22" alt="MCN" style="height:22px;margin-bottom:8px;opacity:.7" />
      <p class="footer-text">&copy; 2026 Mas Callnet India Pvt. Ltd. All rights reserved.</p>
      <p class="footer-text" style="margin-top:4px">This is an automated work anniversary greeting from your HR team.</p>
    </div>
  </div>
</div>
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
