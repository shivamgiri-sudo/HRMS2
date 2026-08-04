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
  firstName?: string;
  photoUrl?: string;
  branchName?: string;         // display_name from branch_master
  designation?: string;
  department?: string;
  processName?: string;
  yearsAtCompany?: number;
  gender?: string;             // Male / Female / Other
  bloodGroup?: string;
  city?: string;
  managerName?: string;
  employeeCode?: string;
}

export function birthdayGreetingEmail(data: BirthdayGreetingData): string {
  const firstName = data.firstName || data.employeeName.split(" ")[0];
  const pronoun = data.gender === "Female" ? "her" : "his";
  const pronounCap = data.gender === "Female" ? "Her" : "His";
  const branchLabel = data.branchName || "MAS Callnet";

  // Personalized sub-headline based on available context
  const roleContext = data.designation && data.processName
    ? `${data.designation} · ${data.processName}`
    : data.designation || data.department || "MAS Callnet Team";

  // Build personalized message
  let personalPara = `Today, we celebrate <strong style="color:#E8231A">${firstName}</strong> — a valued ${roleContext.toLowerCase()} at our ${branchLabel} family.`;
  if (data.yearsAtCompany && data.yearsAtCompany > 0) {
    personalPara += ` Over the past <strong style="color:#1B6AB5">${data.yearsAtCompany} year${data.yearsAtCompany > 1 ? "s" : ""}</strong>, ${pronoun} dedication has been an inspiration to everyone around ${pronoun}.`;
  }
  if (data.managerName) {
    personalPara += ` ${pronounCap} team and manager <strong style="color:#073f78">${data.managerName}</strong> join us in wishing ${pronoun} the very best on this special day!`;
  }

  // Info chips — rendered on dark navy bg so use transparent-white style
  const chips: string[] = [];
  if (data.employeeCode) chips.push(`<td style="padding:6px 10px;background:rgba(255,255,255,.15);border-radius:8px;font-size:12px;font-weight:bold;color:#fff;white-space:nowrap;border:1px solid rgba(255,255,255,.2)">🆔 ${data.employeeCode}</td><td width="8"></td>`);
  if (data.designation) chips.push(`<td style="padding:6px 10px;background:rgba(255,255,255,.15);border-radius:8px;font-size:12px;font-weight:bold;color:#fff;white-space:nowrap;border:1px solid rgba(255,255,255,.2)">👔 ${data.designation}</td><td width="8"></td>`);
  if (data.branchName) chips.push(`<td style="padding:6px 10px;background:rgba(255,255,255,.15);border-radius:8px;font-size:12px;font-weight:bold;color:#fff;white-space:nowrap;border:1px solid rgba(255,255,255,.2)">📍 ${data.branchName}</td><td width="8"></td>`);
  if (data.processName || data.department) chips.push(`<td style="padding:6px 10px;background:rgba(255,255,255,.15);border-radius:8px;font-size:12px;font-weight:bold;color:#fff;white-space:nowrap;border:1px solid rgba(255,255,255,.2)">⚙️ ${data.processName || data.department}</td><td width="8"></td>`);
  if (data.bloodGroup) chips.push(`<td style="padding:6px 10px;background:rgba(255,255,255,.15);border-radius:8px;font-size:12px;font-weight:bold;color:#fff;white-space:nowrap;border:1px solid rgba(255,255,255,.2)">🩸 ${data.bloodGroup}</td><td width="8"></td>`);

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

  const MCN_LOGO = `<img src="https://mcnhrms.teammas.in/mcn-logo.png" width="120" height="40" alt="MAS Callnet" style="display:block;max-width:120px;height:auto" />`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Happy Birthday, ${firstName}!</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif">

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f6fb">
<tr><td align="center" style="padding:24px 8px">

<table width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(7,63,120,.1)">

  <!-- ═══ RAINBOW CONFETTI STRIP ═══ -->
  <tr><td height="6" style="background:linear-gradient(90deg,#E8231A 0%,#fbbf24 20%,#3BAD49 40%,#1B6AB5 60%,#E8231A 80%,#fbbf24 100%);font-size:0;line-height:0">&nbsp;</td></tr>

  <!-- ═══ HERO HEADER ═══ -->
  <tr><td style="background:linear-gradient(145deg,#073f78 0%,#1B6AB5 100%);padding:32px 40px 0">
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td valign="middle">
          ${MCN_LOGO}
          <p style="margin:16px 0 0;font-size:11px;font-weight:bold;letter-spacing:.15em;text-transform:uppercase;color:rgba(255,255,255,.6)">MAS CALLNET INDIA PVT. LTD.</p>
        </td>
        <td align="right" valign="top">
          <!-- Decorative balloon cluster SVG -->
          <svg xmlns="http://www.w3.org/2000/svg" width="90" height="110" viewBox="0 0 90 110">
            <!-- Left balloon — MCN Red -->
            <ellipse cx="22" cy="38" rx="18" ry="22" fill="#E8231A"/>
            <ellipse cx="17" cy="29" rx="5" ry="4" fill="rgba(255,255,255,.25)" transform="rotate(-20 17 29)"/>
            <line x1="22" y1="60" x2="20" y2="80" stroke="#94a3b8" stroke-width="1.5"/>
            <!-- Centre balloon — MCN Blue (tallest) -->
            <ellipse cx="45" cy="28" rx="20" ry="26" fill="#1B6AB5"/>
            <ellipse cx="39" cy="17" rx="6" ry="4.5" fill="rgba(255,255,255,.25)" transform="rotate(-25 39 17)"/>
            <line x1="45" y1="54" x2="43" y2="82" stroke="#94a3b8" stroke-width="1.5"/>
            <!-- Right balloon — MCN Green -->
            <ellipse cx="68" cy="40" rx="17" ry="21" fill="#3BAD49"/>
            <ellipse cx="63" cy="31" rx="5" ry="3.5" fill="rgba(255,255,255,.25)" transform="rotate(-22 63 31)"/>
            <line x1="68" y1="61" x2="66" y2="80" stroke="#94a3b8" stroke-width="1.5"/>
            <!-- Shared knot / string end -->
            <line x1="20" y1="80" x2="43" y2="82" stroke="#94a3b8" stroke-width="1"/>
            <line x1="43" y1="82" x2="66" y2="80" stroke="#94a3b8" stroke-width="1"/>
            <circle cx="43" cy="84" r="3" fill="#64748b"/>
            <!-- Confetti dots -->
            <circle cx="8" cy="15" r="3" fill="#fbbf24" opacity=".8"/>
            <circle cx="78" cy="10" r="4" fill="#E8231A" opacity=".7"/>
            <circle cx="85" cy="55" r="3" fill="#fbbf24" opacity=".8"/>
            <rect x="4" y="55" width="8" height="4" rx="2" fill="#3BAD49" transform="rotate(-30 8 57)" opacity=".8"/>
          </svg>
        </td>
      </tr>
    </table>

    <!-- Big heading -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:20px 0 32px">
      <tr>
        <td>
          <h1 style="margin:0;font-size:46px;font-weight:900;color:#ffffff;line-height:1;letter-spacing:-2px">🎂 Happy</h1>
          <h1 style="margin:4px 0 0;font-size:46px;font-weight:900;color:#fbbf24;line-height:1;letter-spacing:-2px">Birthday!</h1>
          ${data.branchName ? `<p style="margin:10px 0 0;font-size:14px;color:rgba(255,255,255,.75);font-weight:bold">${data.branchName}</p>` : ""}
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- ═══ PHOTO + NAME BAND ═══ -->
  <tr><td style="background:linear-gradient(180deg,#1B6AB5 0%,#073f78 100%);padding:0 40px 32px;text-align:center">
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td align="center">
        <!-- Avatar -->
        <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto">
          <tr><td style="border-radius:50%;border:5px solid #fbbf24;box-shadow:0 0 0 4px rgba(251,191,36,.25);overflow:hidden;width:120px;height:120px;display:block">
            ${avatarSection}
          </td></tr>
        </table>
        <h2 style="margin:16px 0 4px;font-size:28px;font-weight:900;color:#ffffff;letter-spacing:-.5px">${data.employeeName}</h2>
        ${chips.length > 0 ? `
        <table cellpadding="0" cellspacing="0" border="0" style="margin:10px auto 0">
          <tr>${chips.join("")}</tr>
        </table>` : ""}
      </td></tr>
    </table>
  </td></tr>

  <!-- ═══ PERSONALIZED MESSAGE ═══ -->
  <tr><td style="padding:32px 40px 0">
    <p style="margin:0 0 20px;font-size:17px;line-height:1.85;color:#334155">
      ${personalPara}
    </p>

    <!-- Quote card -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px">
      <tr><td style="background:linear-gradient(135deg,#fdf2f8,#eff6ff);border-radius:14px;padding:22px 24px;border-left:5px solid #E8231A">
        <p style="margin:0;font-size:16px;font-weight:bold;color:#073f78;line-height:1.75;font-style:italic">
          "Every day you walk in, you bring more than just your skills — you bring energy, care, and a smile that lifts the entire floor. That is what makes you truly irreplaceable. 💙"
        </p>
        <p style="margin:10px 0 0;font-size:12px;color:#94a3b8;font-weight:bold">— MAS Callnet HR &amp; Management</p>
      </td></tr>
    </table>

    <!-- Decoration row: balloon · flower · gift -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px">
      <tr>
        <td align="center" width="33%">
          <svg xmlns="http://www.w3.org/2000/svg" width="48" height="64" viewBox="0 0 48 64">
            <ellipse cx="24" cy="24" rx="20" ry="24" fill="#E8231A"/>
            <ellipse cx="18" cy="14" rx="6" ry="4.5" fill="rgba(255,255,255,.28)" transform="rotate(-25 18 14)"/>
            <path d="M24 48 Q22 56 20 64" stroke="#94a3b8" stroke-width="1.5" fill="none"/>
            <path d="M18 64 Q21 58 24 64" stroke="#94a3b8" stroke-width="1.5" fill="none"/>
          </svg>
          <p style="margin:4px 0 0;font-size:11px;color:#94a3b8;font-weight:bold">Celebrate!</p>
        </td>
        <td align="center" width="33%">
          <svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56">
            <circle cx="28" cy="28" r="7" fill="#f59e0b"/>
            <ellipse cx="28" cy="12" rx="6" ry="9" fill="#f9a8d4"/>
            <ellipse cx="28" cy="44" rx="6" ry="9" fill="#f9a8d4"/>
            <ellipse cx="12" cy="28" rx="9" ry="6" fill="#fbcfe8"/>
            <ellipse cx="44" cy="28" rx="9" ry="6" fill="#fbcfe8"/>
            <ellipse cx="17" cy="17" rx="5.5" ry="8" fill="#fde68a" transform="rotate(-45 17 17)"/>
            <ellipse cx="39" cy="17" rx="5.5" ry="8" fill="#fde68a" transform="rotate(45 39 17)"/>
            <ellipse cx="17" cy="39" rx="5.5" ry="8" fill="#fde68a" transform="rotate(45 17 39)"/>
            <ellipse cx="39" cy="39" rx="5.5" ry="8" fill="#fde68a" transform="rotate(-45 39 39)"/>
            <circle cx="28" cy="28" r="5.5" fill="#f59e0b"/>
          </svg>
          <p style="margin:4px 0 0;font-size:11px;color:#94a3b8;font-weight:bold">Bloom!</p>
        </td>
        <td align="center" width="33%">
          <svg xmlns="http://www.w3.org/2000/svg" width="52" height="56" viewBox="0 0 52 56">
            <rect x="4" y="20" width="44" height="30" rx="4" fill="#3BAD49"/>
            <rect x="2" y="14" width="48" height="10" rx="3" fill="#2a8f38"/>
            <rect x="23" y="14" width="6" height="36" fill="#fbbf24"/>
            <path d="M26 14 Q18 4 14 8 Q10 12 18 14Z" fill="#fbbf24"/>
            <path d="M26 14 Q34 4 38 8 Q42 12 34 14Z" fill="#fbbf24"/>
            <circle cx="26" cy="14" r="4" fill="#f59e0b"/>
          </svg>
          <p style="margin:4px 0 0;font-size:11px;color:#94a3b8;font-weight:bold">Surprise!</p>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- ═══ WISHES BANNER ═══ -->
  <tr><td style="padding:20px 40px 36px">
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="background:linear-gradient(135deg,#073f78,#1B6AB5);border-radius:14px;padding:24px 28px;text-align:center">
        <p style="margin:0 0 6px;font-size:22px">🌸 🎈 🎁 🎊 🌼</p>
        <p style="margin:0 0 6px;font-size:16px;color:#ffffff;line-height:1.75;font-weight:bold">
          Wishing you, ${firstName}, a year full of joy,<br>growth, new adventures, and every happiness!
        </p>
        <p style="margin:0;font-size:14px;color:rgba(255,255,255,.75)">Many happy returns of the day!</p>
        <p style="margin:14px 0 0;font-size:14px;font-weight:bold;color:rgba(255,255,255,.85)">— Your MAS Callnet Family 💙</p>
      </td></tr>
    </table>
  </td></tr>

  <!-- ═══ FOOTER ═══ -->
  <tr><td height="5" style="background:linear-gradient(90deg,#E8231A,#1B6AB5 50%,#3BAD49);font-size:0;line-height:0">&nbsp;</td></tr>
  <tr><td style="background:#f8fafc;padding:20px 40px;text-align:center">
    ${MCN_LOGO.replace('style="display:block;max-width:120px;height:auto"', 'style="display:inline-block;max-width:100px;height:auto;opacity:.65;margin-bottom:8px"')}
    <p style="margin:0;font-size:11px;color:#94a3b8">&copy; 2026 Mas Callnet India Pvt. Ltd. All rights reserved.</p>
    <p style="margin:4px 0 0;font-size:11px;color:#cbd5e1">Automated birthday greeting from your HR team. Please do not reply to this email.</p>
  </td></tr>

</table>

</td></tr>
</table>
</body>
</html>`;
}

export interface WorkAnniversaryData {
  employeeName: string;
  firstName?: string;
  yearsCompleted: number;
  joinDate: string;
  photoUrl?: string;
  branchName?: string;        // display_name from branch_master
  designation?: string;
  department?: string;
  processName?: string;
  employeeCode?: string;
  band?: string;
  managerName?: string;
  gender?: string;
  city?: string;
  employmentType?: string;
}

export function workAnniversaryEmail(data: WorkAnniversaryData): string {
  const yearLabel = data.yearsCompleted === 1 ? "year" : "years";
  const YearLabel = data.yearsCompleted === 1 ? "Year" : "Years";
  const firstName = data.firstName || data.employeeName.split(" ")[0];
  const pronoun = data.gender === "Female" ? "her" : "his";
  const branchLabel = data.branchName || "MAS Callnet";
  const MCN_LOGO = `<img src="https://mcnhrms.teammas.in/mcn-logo.png" width="120" height="40" alt="MAS Callnet" style="display:block;max-width:120px;height:auto" />`;

  // ── Journey narrative paragraphs ──
  const joinYear = data.joinDate ? data.joinDate.split(" ").pop() || data.joinDate : "";

  let journeyOpener = `${data.yearsCompleted === 1
    ? `One year ago, <strong style="color:#073f78">${firstName}</strong> walked through the doors of MAS Callnet and everything changed — for the better.`
    : data.yearsCompleted <= 3
    ? `${data.yearsCompleted} years ago, <strong style="color:#073f78">${firstName}</strong> joined the MAS Callnet family${joinYear ? ` in ${joinYear}` : ""}, and since that first day, every chapter has been remarkable.`
    : `${data.yearsCompleted} incredible years. When <strong style="color:#073f78">${firstName}</strong> first joined MAS Callnet${joinYear ? ` in ${joinYear}` : ""}, few could have predicted just how far this journey would go.`
  }`;

  let journeyRole = "";
  if (data.designation && data.processName) {
    journeyRole = ` Starting out in the <strong style="color:#1B6AB5">${data.processName}</strong> space and rising to the role of <strong style="color:#073f78">${data.designation}</strong>, ${pronoun} path has been defined by one thing: <em>relentless commitment</em>.`;
  } else if (data.designation) {
    journeyRole = ` Today, as a <strong style="color:#073f78">${data.designation}</strong> at our ${branchLabel} office, ${firstName} continues to raise the bar every single day.`;
  } else if (data.processName) {
    journeyRole = ` Deeply embedded in the <strong style="color:#1B6AB5">${data.processName}</strong> team at ${branchLabel}, ${pronoun} contribution has been nothing short of exceptional.`;
  } else if (data.department) {
    journeyRole = ` As a proud member of the <strong style="color:#1B6AB5">${data.department}</strong> team at ${branchLabel}, ${firstName} has built a legacy of hard work and results.`;
  }

  let journeyManager = data.managerName
    ? ` ${firstName}'s supervisor <strong style="color:#073f78">${data.managerName}</strong> and the entire ${branchLabel} leadership team stand proud of this milestone.`
    : "";

  let journeyClose = ` ${data.yearsCompleted === 1
    ? "This is just the beginning — and what a beginning it has been!"
    : data.yearsCompleted <= 5
    ? `${data.yearsCompleted} years of showing up, growing, and giving your absolute best. We are honoured to have you.`
    : `${data.yearsCompleted} years of loyalty, leadership, and love for this organisation. You are the soul of MAS Callnet.`
  }`;

  // Info chips
  const chips: string[] = [];
  if (data.employeeCode) chips.push(`<td style="padding:6px 10px;background:rgba(255,255,255,.15);border-radius:8px;font-size:12px;font-weight:bold;color:#fff;white-space:nowrap;border:1px solid rgba(255,255,255,.2)">🆔 ${data.employeeCode}</td><td width="8"></td>`);
  if (data.designation) chips.push(`<td style="padding:6px 10px;background:rgba(255,255,255,.15);border-radius:8px;font-size:12px;font-weight:bold;color:#fff;white-space:nowrap;border:1px solid rgba(255,255,255,.2)">👔 ${data.designation}</td><td width="8"></td>`);
  if (data.branchName) chips.push(`<td style="padding:6px 10px;background:rgba(255,255,255,.15);border-radius:8px;font-size:12px;font-weight:bold;color:#fff;white-space:nowrap;border:1px solid rgba(255,255,255,.2)">📍 ${data.branchName}</td><td width="8"></td>`);
  if (data.band) chips.push(`<td style="padding:6px 10px;background:rgba(255,255,255,.15);border-radius:8px;font-size:12px;font-weight:bold;color:#fff;white-space:nowrap;border:1px solid rgba(255,255,255,.2)">🏷️ Band ${data.band}</td><td width="8"></td>`);

  const avatarSection = data.photoUrl
    ? `<img src="${data.photoUrl}" width="120" height="120" alt="${data.employeeName}" style="width:120px;height:120px;border-radius:50%;object-fit:cover;display:block" />`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120" style="display:block">
        <circle cx="60" cy="60" r="60" fill="#fef3c7"/>
        <rect x="46" y="90" width="28" height="8" rx="3" fill="#d1d5db"/>
        <rect x="36" y="98" width="48" height="8" rx="4" fill="#e5e7eb"/>
        <path d="M28 28 L92 28 L84 72 Q60 84 36 72 Z" fill="#F59E0B"/>
        <path d="M34 28 L86 28 L79 66 Q60 76 41 66 Z" fill="#fbbf24"/>
        <path d="M28 34 Q10 38 14 54 Q18 64 32 60" stroke="#F59E0B" stroke-width="7" fill="none" stroke-linecap="round"/>
        <path d="M92 34 Q110 38 106 54 Q102 64 88 60" stroke="#F59E0B" stroke-width="7" fill="none" stroke-linecap="round"/>
        <path d="M60 44 l2.5 7.5h7.8l-6.3 4.6 2.5 7.5L60 59.4l-6.5 4.6 2.5-7.5-6.3-4.6h7.8Z" fill="#fff" opacity=".85"/>
        <line x1="60" y1="8" x2="60" y2="16" stroke="#fbbf24" stroke-width="3" stroke-linecap="round"/>
        <line x1="74" y1="11" x2="70" y2="18" stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round"/>
        <line x1="46" y1="11" x2="50" y2="18" stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round"/>
      </svg>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${data.yearsCompleted}-Year Work Anniversary — ${firstName}!</title>
</head>
<body style="margin:0;padding:0;background:#f0f4ff;font-family:Arial,Helvetica,sans-serif">

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f0f4ff">
<tr><td align="center" style="padding:24px 8px">

<table width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(7,63,120,.12)">

  <!-- ═══ GOLD TOP STRIP ═══ -->
  <tr><td height="6" style="background:linear-gradient(90deg,#F59E0B,#fbbf24 30%,#3BAD49 60%,#F59E0B);font-size:0;line-height:0">&nbsp;</td></tr>

  <!-- ═══ HERO HEADER ═══ -->
  <tr><td style="background:linear-gradient(145deg,#042656 0%,#073f78 55%,#0d5aa7 100%);padding:32px 40px 0">
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td valign="middle">
          ${MCN_LOGO}
          <p style="margin:16px 0 0;font-size:11px;font-weight:bold;letter-spacing:.15em;text-transform:uppercase;color:rgba(255,255,255,.55)">MAS CALLNET INDIA PVT. LTD.</p>
        </td>
        <td align="right" valign="top">
          <!-- Trophy + stars SVG -->
          <svg xmlns="http://www.w3.org/2000/svg" width="90" height="110" viewBox="0 0 90 110">
            <!-- Trophy -->
            <path d="M25 22 L65 22 L59 58 Q45 68 31 58 Z" fill="#F59E0B"/>
            <path d="M29 22 L61 22 L56 52 Q45 60 34 52 Z" fill="#fbbf24"/>
            <path d="M25 27 Q10 31 13 44 Q16 52 27 49" stroke="#F59E0B" stroke-width="5" fill="none" stroke-linecap="round"/>
            <path d="M65 27 Q80 31 77 44 Q74 52 63 49" stroke="#F59E0B" stroke-width="5" fill="none" stroke-linecap="round"/>
            <rect x="38" y="66" width="14" height="6" rx="2" fill="#d1d5db"/>
            <rect x="32" y="72" width="26" height="6" rx="3" fill="#e5e7eb"/>
            <!-- Star burst on trophy -->
            <path d="M45 32 l1.8 5.5h5.7l-4.6 3.4 1.8 5.5L45 43l-4.7 3.4 1.8-5.5-4.6-3.4h5.7Z" fill="#fff" opacity=".8"/>
            <!-- Stars above -->
            <path d="M10 12 l1.2 3.6h3.8l-3 2.2 1.2 3.6L10 19l-3.2 2.4 1.2-3.6-3-2.2h3.8Z" fill="#fbbf24" opacity=".9"/>
            <path d="M76 8 l1.2 3.6h3.8l-3 2.2 1.2 3.6L76 15l-3.2 2.4 1.2-3.6-3-2.2h3.8Z" fill="#F59E0B" opacity=".9"/>
            <path d="M82 45 l1 3h3.2l-2.5 1.8 1 3L82 51l-2.7 1.8 1-3-2.5-1.8h3.2Z" fill="#fbbf24" opacity=".8"/>
            <circle cx="6" cy="55" r="3" fill="#3BAD49" opacity=".7"/>
            <circle cx="84" cy="25" r="2.5" fill="#E8231A" opacity=".7"/>
          </svg>
        </td>
      </tr>
    </table>

    <!-- Heading + year badge -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:20px 0 0">
      <tr>
        <td valign="bottom">
          <h1 style="margin:0;font-size:40px;font-weight:900;color:#ffffff;line-height:1;letter-spacing:-1.5px">⭐ Work</h1>
          <h1 style="margin:4px 0 0;font-size:40px;font-weight:900;color:#fbbf24;line-height:1;letter-spacing:-1.5px">Anniversary!</h1>
          ${data.branchName ? `<p style="margin:10px 0 0;font-size:14px;color:rgba(255,255,255,.7);font-weight:bold">${data.branchName}</p>` : ""}
        </td>
        <td align="right" valign="bottom" style="padding-bottom:4px">
          <!-- Big year number badge -->
          <table cellpadding="0" cellspacing="0" border="0">
            <tr><td align="center" style="background:linear-gradient(135deg,#3BAD49,#2a8f38);border-radius:16px;padding:12px 20px;box-shadow:0 4px 16px rgba(59,173,73,.4)">
              <p style="margin:0;font-size:10px;font-weight:bold;color:rgba(255,255,255,.8);text-transform:uppercase;letter-spacing:.1em">Celebrating</p>
              <p style="margin:2px 0;font-size:54px;font-weight:900;color:#fff;line-height:1">${data.yearsCompleted}</p>
              <p style="margin:0;font-size:12px;font-weight:bold;color:rgba(255,255,255,.9)">${YearLabel} of Excellence</p>
            </td></tr>
          </table>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- ═══ PHOTO + NAME BAND ═══ -->
  <tr><td style="background:linear-gradient(180deg,#0d5aa7 0%,#073f78 100%);padding:0 40px 32px;text-align:center">
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td align="center" style="padding-top:28px">
        <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto">
          <tr><td style="border-radius:50%;border:5px solid #F59E0B;box-shadow:0 0 0 4px rgba(245,158,11,.25),0 8px 28px rgba(0,0,0,.25);overflow:hidden;width:120px;height:120px">
            ${avatarSection}
          </td></tr>
        </table>
        <h2 style="margin:16px 0 4px;font-size:26px;font-weight:900;color:#ffffff">${data.employeeName}</h2>
        ${chips.length > 0 ? `
        <table cellpadding="0" cellspacing="0" border="0" style="margin:10px auto 0">
          <tr>${chips.join("")}</tr>
        </table>` : ""}
      </td></tr>
    </table>
  </td></tr>

  <!-- ═══ JOURNEY STORY ═══ -->
  <tr><td style="padding:32px 40px 0">

    <!-- Star row decoration -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px">
      <tr><td align="center">
        <svg xmlns="http://www.w3.org/2000/svg" width="140" height="28" viewBox="0 0 140 28">
          <path d="M14 2l3 6.5h7l-5.5 4 2 6.5L14 15l-6.5 4 2-6.5L4 8.5h7Z" fill="#F59E0B"/>
          <path d="M42 2l3 6.5h7l-5.5 4 2 6.5L42 15l-6.5 4 2-6.5L32 8.5h7Z" fill="#F59E0B"/>
          <path d="M70 0l3.5 7.5h8l-6.5 4.5 2.5 7.5L70 15.5l-7.5 4 2.5-7.5L58 8h8Z" fill="#fbbf24"/>
          <path d="M98 2l3 6.5h7l-5.5 4 2 6.5L98 15l-6.5 4 2-6.5L88 8.5h7Z" fill="#F59E0B"/>
          <path d="M126 2l3 6.5h7l-5.5 4 2 6.5L126 15l-6.5 4 2-6.5L116 8.5h7Z" fill="#F59E0B"/>
        </svg>
      </td></tr>
    </table>

    <!-- Journey narrative -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px">
      <tr><td style="background:linear-gradient(135deg,#eff6ff,#f0fdf4);border-radius:14px;padding:26px 28px;border-left:5px solid #3BAD49">
        <p style="margin:0 0 6px;font-size:10px;font-weight:bold;color:#3BAD49;text-transform:uppercase;letter-spacing:.12em">Your MAS Callnet Journey</p>
        <p style="margin:0 0 14px;font-size:16px;line-height:1.85;color:#1e293b">
          ${journeyOpener}${journeyRole}${journeyManager}${journeyClose}
        </p>
        <!-- Timeline bar -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px">
          <tr>
            <td align="center" width="38%" style="background:#073f78;border-radius:10px 0 0 10px;padding:10px 14px">
              <p style="margin:0;font-size:10px;font-weight:bold;color:rgba(255,255,255,.7);text-transform:uppercase">Joined</p>
              <p style="margin:2px 0 0;font-size:14px;font-weight:900;color:#fff">${data.joinDate}</p>
            </td>
            <td align="center" width="24%" style="background:#1B6AB5;padding:10px 8px">
              <p style="margin:0;font-size:22px;color:#fff;font-weight:900">→</p>
            </td>
            <td align="center" width="38%" style="background:#3BAD49;border-radius:0 10px 10px 0;padding:10px 14px">
              <p style="margin:0;font-size:10px;font-weight:bold;color:rgba(255,255,255,.8);text-transform:uppercase">Today</p>
              <p style="margin:2px 0 0;font-size:14px;font-weight:900;color:#fff">${data.yearsCompleted} ${YearLabel} Strong 🎉</p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </td></tr>

  <!-- ═══ CLOSING BANNER ═══ -->
  <tr><td style="padding:0 40px 36px">
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="background:linear-gradient(135deg,#042656,#073f78 60%,#0d5aa7);border-radius:14px;padding:24px 28px;text-align:center">
        <p style="margin:0 0 8px;font-size:22px">🌟 ✨ 🏆 ✨ 🌟</p>
        <p style="margin:0 0 6px;font-size:17px;color:#ffffff;font-weight:bold;line-height:1.7">
          Thank you, ${firstName}, for ${data.yearsCompleted} extraordinary ${yearLabel}.<br>
          Here's to many more years of achievement!
        </p>
        <p style="margin:14px 0 0;font-size:14px;color:rgba(255,255,255,.75);font-weight:bold">— MAS Callnet Management &amp; HR Team 🏆</p>
      </td></tr>
    </table>
  </td></tr>

  <!-- ═══ FOOTER ═══ -->
  <tr><td height="5" style="background:linear-gradient(90deg,#F59E0B,#073f78 50%,#3BAD49);font-size:0;line-height:0">&nbsp;</td></tr>
  <tr><td style="background:#f8fafc;padding:20px 40px;text-align:center">
    ${MCN_LOGO.replace('style="display:block;max-width:120px;height:auto"', 'style="display:inline-block;max-width:100px;height:auto;opacity:.65;margin-bottom:8px"')}
    <p style="margin:0;font-size:11px;color:#94a3b8">&copy; 2026 Mas Callnet India Pvt. Ltd. All rights reserved.</p>
    <p style="margin:4px 0 0;font-size:11px;color:#cbd5e1">Automated work anniversary greeting from your HR team. Please do not reply to this email.</p>
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
