-- 1001_professional_email_templates.sql
-- Professional email templates for all HRMS events
USE mas_hrms;

-- Master table for all email templates (allows admin customization)
CREATE TABLE IF NOT EXISTS email_template_master (
  id                 CHAR(36)       NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  template_key       VARCHAR(100)   NOT NULL UNIQUE,
  template_name      VARCHAR(255)   NOT NULL,
  category           ENUM('ats','hr','payroll','exit','admin','it','engagement','auth') NOT NULL,
  subject            VARCHAR(500)   NOT NULL,
  body_html          MEDIUMTEXT     NOT NULL,
  body_text          TEXT,
  variables_json     JSON           COMMENT 'Array of variable names used in template',
  is_active          TINYINT        NOT NULL DEFAULT 1,
  is_system          TINYINT        NOT NULL DEFAULT 1 COMMENT '1=cannot delete, only edit',
  version            INT            NOT NULL DEFAULT 1,
  created_at         DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by         CHAR(36),
  updated_by         CHAR(36),
  INDEX idx_category (category),
  INDEX idx_active (is_active),
  INDEX idx_key (template_key)
);

-- Template version history for audit
CREATE TABLE IF NOT EXISTS email_template_history (
  id                 CHAR(36)       NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  template_id        CHAR(36)       NOT NULL,
  template_key       VARCHAR(100)   NOT NULL,
  version            INT            NOT NULL,
  subject            VARCHAR(500)   NOT NULL,
  body_html          MEDIUMTEXT     NOT NULL,
  body_text          TEXT,
  changed_by         CHAR(36),
  change_reason      VARCHAR(500),
  created_at         DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_template (template_id),
  INDEX idx_version (template_key, version)
);

-- Insert all professional templates
INSERT INTO email_template_master (template_key, template_name, category, subject, body_html, body_text, variables_json) VALUES

-- ══════════════════════════════════════════════════════════════════════════════
-- ATS TEMPLATES
-- ══════════════════════════════════════════════════════════════════════════════

('INTERVIEW_INVITATION', 'Interview Invitation', 'ats',
'Interview Invitation - {{role}} at MAS Callnet',
'<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Interview Invitation</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,''Helvetica Neue'',Arial,sans-serif">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px">
    <div style="background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 12px 40px rgba(15,23,42,.12)">
      <div style="background:linear-gradient(135deg,#083344 0%,#0f766e 60%,#14b8a6 100%);padding:32px;text-align:center">
        <div style="font-size:11px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;color:#99f6e4;margin-bottom:8px">MAS CALLNET INDIA PVT. LTD.</div>
        <h1 style="margin:0;font-size:26px;font-weight:800;color:#fff">Interview Invitation</h1>
      </div>
      <div style="padding:32px">
        <p style="margin:0 0 20px;font-size:16px;color:#1e293b">Dear <strong>{{candidate_name}}</strong>,</p>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#475569">We are pleased to invite you for an interview for the position of <strong>{{role}}</strong> at MAS Callnet India Pvt. Ltd.</p>

        <div style="background:#f8fafc;border-left:4px solid #0f766e;border-radius:8px;padding:20px;margin:24px 0">
          <table style="width:100%;border-collapse:collapse">
            <tr>
              <td style="padding:8px 0;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;width:120px">Date</td>
              <td style="padding:8px 0;font-size:15px;font-weight:600;color:#0f172a">{{interview_date}}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px">Time</td>
              <td style="padding:8px 0;font-size:15px;font-weight:600;color:#0f172a">{{interview_time}}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px">Location</td>
              <td style="padding:8px 0;font-size:15px;font-weight:600;color:#0f172a">{{location}}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px">Interviewer</td>
              <td style="padding:8px 0;font-size:15px;font-weight:600;color:#0f172a">{{interviewer_name}}</td>
            </tr>
          </table>
        </div>

        <div style="background:#fffbeb;border-left:4px solid #f59e0b;border-radius:8px;padding:16px;margin:24px 0">
          <p style="margin:0;font-size:14px;color:#92400e;line-height:1.6"><strong>Please bring:</strong> Original ID proof (Aadhaar/PAN), updated resume, and educational certificates.</p>
        </div>

        <p style="margin:24px 0 0;font-size:15px;line-height:1.7;color:#475569">Please confirm your attendance by replying to this email or contacting us at the number below.</p>

        <div style="margin:32px 0 24px;padding-top:24px;border-top:1px solid #e2e8f0">
          <p style="margin:0;font-size:14px;color:#64748b">Best regards,</p>
          <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#0f172a">MAS Callnet Recruitment Team</p>
        </div>
      </div>
      <div style="background:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;text-align:center">
        <p style="margin:0;font-size:11px;color:#94a3b8">This is an automated notification. Please do not reply directly to this email.</p>
        <p style="margin:8px 0 0;font-size:11px;color:#94a3b8">&copy; 2026 Mas Callnet India Pvt. Ltd. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>',
'Dear {{candidate_name}},\n\nWe are pleased to invite you for an interview for the position of {{role}} at MAS Callnet India Pvt. Ltd.\n\nInterview Details:\nDate: {{interview_date}}\nTime: {{interview_time}}\nLocation: {{location}}\nInterviewer: {{interviewer_name}}\n\nPlease bring: Original ID proof (Aadhaar/PAN), updated resume, and educational certificates.\n\nPlease confirm your attendance by replying to this email.\n\nBest regards,\nMAS Callnet Recruitment Team',
'["candidate_name","role","interview_date","interview_time","location","interviewer_name"]'),

('OFFER_ACCEPTANCE_CONFIRMATION', 'Offer Acceptance Confirmation', 'ats',
'Welcome Aboard! Your Offer Has Been Accepted - MAS Callnet',
'<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,''Helvetica Neue'',Arial,sans-serif">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px">
    <div style="background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 12px 40px rgba(15,23,42,.12)">
      <div style="background:linear-gradient(135deg,#059669 0%,#10b981 60%,#34d399 100%);padding:32px;text-align:center">
        <div style="font-size:48px;margin-bottom:12px">🎉</div>
        <div style="font-size:11px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;color:#d1fae5;margin-bottom:8px">MAS CALLNET INDIA PVT. LTD.</div>
        <h1 style="margin:0;font-size:26px;font-weight:800;color:#fff">Welcome to the Team!</h1>
      </div>
      <div style="padding:32px">
        <p style="margin:0 0 20px;font-size:16px;color:#1e293b">Dear <strong>{{candidate_name}}</strong>,</p>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#475569">We are thrilled to confirm that your offer for the position of <strong>{{role}}</strong> has been accepted. Welcome to the MAS Callnet family!</p>

        <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;padding:20px;margin:24px 0;text-align:center">
          <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#065f46;text-transform:uppercase;letter-spacing:.5px">Your Start Date</p>
          <p style="margin:0;font-size:24px;font-weight:800;color:#047857">{{start_date}}</p>
        </div>

        <h3 style="margin:28px 0 16px;font-size:16px;font-weight:700;color:#0f172a;border-bottom:2px solid #10b981;padding-bottom:8px">What Happens Next</h3>
        <ul style="margin:0;padding:0 0 0 20px;color:#475569;line-height:1.8">
          <li>Complete your onboarding documents (if not already done)</li>
          <li>HR will contact you with joining day instructions</li>
          <li>Prepare your original documents for verification</li>
          <li>Report to {{branch_name}} on your start date</li>
        </ul>

        <div style="margin:32px 0;text-align:center">
          <a href="{{onboarding_link}}" style="display:inline-block;background:linear-gradient(135deg,#059669,#10b981);color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:15px;box-shadow:0 4px 12px rgba(16,185,129,.3)">Complete Onboarding</a>
        </div>

        <div style="margin:32px 0 24px;padding-top:24px;border-top:1px solid #e2e8f0">
          <p style="margin:0;font-size:14px;color:#64748b">For any queries, contact:</p>
          <p style="margin:4px 0 0;font-size:15px;font-weight:600;color:#0f172a">{{hr_name}} | {{hr_contact}}</p>
        </div>
      </div>
      <div style="background:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;text-align:center">
        <p style="margin:0;font-size:11px;color:#94a3b8">&copy; 2026 Mas Callnet India Pvt. Ltd. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>',
'Dear {{candidate_name}},\n\nWe are thrilled to confirm that your offer for the position of {{role}} has been accepted. Welcome to the MAS Callnet family!\n\nYour Start Date: {{start_date}}\n\nWhat Happens Next:\n- Complete your onboarding documents\n- HR will contact you with joining day instructions\n- Prepare your original documents for verification\n- Report to {{branch_name}} on your start date\n\nFor queries, contact: {{hr_name}} | {{hr_contact}}\n\nBest regards,\nMAS Callnet HR Team',
'["candidate_name","role","start_date","branch_name","onboarding_link","hr_name","hr_contact"]'),

-- ══════════════════════════════════════════════════════════════════════════════
-- PAYROLL TEMPLATES
-- ══════════════════════════════════════════════════════════════════════════════

('PAYSLIP_READY', 'Payslip Ready', 'payroll',
'Your Payslip for {{month}} {{year}} is Ready - MAS Callnet',
'<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,''Helvetica Neue'',Arial,sans-serif">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px">
    <div style="background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 12px 40px rgba(15,23,42,.12)">
      <div style="background:linear-gradient(135deg,#1e40af 0%,#3b82f6 60%,#60a5fa 100%);padding:32px;text-align:center">
        <div style="font-size:11px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;color:#bfdbfe;margin-bottom:8px">MAS CALLNET INDIA PVT. LTD.</div>
        <h1 style="margin:0;font-size:26px;font-weight:800;color:#fff">Payslip Available</h1>
        <p style="margin:8px 0 0;font-size:14px;color:#dbeafe">{{month}} {{year}}</p>
      </div>
      <div style="padding:32px">
        <p style="margin:0 0 20px;font-size:16px;color:#1e293b">Dear <strong>{{employee_name}}</strong>,</p>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#475569">Your payslip for <strong>{{month}} {{year}}</strong> is now available. You can view and download it from the HRMS portal.</p>

        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:24px;margin:24px 0;text-align:center">
          <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:.5px">Net Pay</p>
          <p style="margin:0;font-size:32px;font-weight:800;color:#1e3a8a">₹{{net_pay}}</p>
        </div>

        <div style="margin:28px 0;text-align:center">
          <a href="{{download_link}}" style="display:inline-block;background:linear-gradient(135deg,#1e40af,#3b82f6);color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:15px;box-shadow:0 4px 12px rgba(59,130,246,.3)">View Payslip</a>
        </div>

        <div style="background:#fefce8;border-left:4px solid #eab308;border-radius:8px;padding:16px;margin:24px 0">
          <p style="margin:0;font-size:13px;color:#854d0e;line-height:1.6"><strong>Note:</strong> This is a confidential document. Please do not share your payslip details with unauthorized persons.</p>
        </div>

        <div style="margin:32px 0 24px;padding-top:24px;border-top:1px solid #e2e8f0">
          <p style="margin:0;font-size:14px;color:#64748b">Best regards,</p>
          <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#0f172a">MAS Callnet Payroll Team</p>
        </div>
      </div>
      <div style="background:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;text-align:center">
        <p style="margin:0;font-size:11px;color:#94a3b8">This is a confidential communication intended for the addressee only.</p>
        <p style="margin:8px 0 0;font-size:11px;color:#94a3b8">&copy; 2026 Mas Callnet India Pvt. Ltd. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>',
'Dear {{employee_name}},\n\nYour payslip for {{month}} {{year}} is now available.\n\nNet Pay: Rs. {{net_pay}}\n\nView Payslip: {{download_link}}\n\nThis is a confidential document. Please do not share your payslip details with unauthorized persons.\n\nBest regards,\nMAS Callnet Payroll Team',
'["employee_name","month","year","net_pay","download_link"]'),

('SALARY_CREDITED', 'Salary Credited', 'payroll',
'Salary Credited - {{month}} {{year}} - MAS Callnet',
'<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,''Helvetica Neue'',Arial,sans-serif">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px">
    <div style="background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 12px 40px rgba(15,23,42,.12)">
      <div style="background:linear-gradient(135deg,#047857 0%,#10b981 60%,#34d399 100%);padding:32px;text-align:center">
        <div style="font-size:48px;margin-bottom:12px">💰</div>
        <div style="font-size:11px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;color:#d1fae5;margin-bottom:8px">MAS CALLNET INDIA PVT. LTD.</div>
        <h1 style="margin:0;font-size:26px;font-weight:800;color:#fff">Salary Credited</h1>
      </div>
      <div style="padding:32px">
        <p style="margin:0 0 20px;font-size:16px;color:#1e293b">Dear <strong>{{employee_name}}</strong>,</p>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#475569">Your salary for <strong>{{month}} {{year}}</strong> has been credited to your registered bank account.</p>

        <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;padding:24px;margin:24px 0">
          <table style="width:100%;border-collapse:collapse">
            <tr>
              <td style="padding:10px 0;font-size:13px;font-weight:700;color:#065f46;text-transform:uppercase;letter-spacing:.5px">Amount Credited</td>
              <td style="padding:10px 0;font-size:20px;font-weight:800;color:#047857;text-align:right">₹{{amount}}</td>
            </tr>
            <tr>
              <td style="padding:10px 0;font-size:13px;font-weight:700;color:#065f46;text-transform:uppercase;letter-spacing:.5px;border-top:1px solid #a7f3d0">Account</td>
              <td style="padding:10px 0;font-size:15px;font-weight:600;color:#0f172a;text-align:right;border-top:1px solid #a7f3d0">****{{account_last4}}</td>
            </tr>
            <tr>
              <td style="padding:10px 0;font-size:13px;font-weight:700;color:#065f46;text-transform:uppercase;letter-spacing:.5px;border-top:1px solid #a7f3d0">Reference</td>
              <td style="padding:10px 0;font-size:13px;font-weight:600;color:#64748b;text-align:right;border-top:1px solid #a7f3d0">{{reference}}</td>
            </tr>
          </table>
        </div>

        <p style="margin:24px 0;font-size:14px;color:#64748b;line-height:1.6">Your detailed payslip is available in the HRMS portal. Please verify and report any discrepancies within 3 working days.</p>

        <div style="margin:32px 0 24px;padding-top:24px;border-top:1px solid #e2e8f0">
          <p style="margin:0;font-size:14px;color:#64748b">Best regards,</p>
          <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#0f172a">MAS Callnet Finance Team</p>
        </div>
      </div>
      <div style="background:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;text-align:center">
        <p style="margin:0;font-size:11px;color:#94a3b8">This is a confidential communication. Do not forward.</p>
      </div>
    </div>
  </div>
</body>
</html>',
'Dear {{employee_name}},\n\nYour salary for {{month}} {{year}} has been credited to your registered bank account.\n\nAmount: Rs. {{amount}}\nAccount: ****{{account_last4}}\nReference: {{reference}}\n\nPlease verify and report any discrepancies within 3 working days.\n\nBest regards,\nMAS Callnet Finance Team',
'["employee_name","month","year","amount","account_last4","reference"]'),

-- ══════════════════════════════════════════════════════════════════════════════
-- EXIT TEMPLATES
-- ══════════════════════════════════════════════════════════════════════════════

('FF_SETTLEMENT_COMPLETE', 'F&F Settlement Complete', 'exit',
'Full & Final Settlement Completed - MAS Callnet',
'<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,''Helvetica Neue'',Arial,sans-serif">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px">
    <div style="background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 12px 40px rgba(15,23,42,.12)">
      <div style="background:linear-gradient(135deg,#4338ca 0%,#6366f1 60%,#818cf8 100%);padding:32px;text-align:center">
        <div style="font-size:11px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;color:#c7d2fe;margin-bottom:8px">MAS CALLNET INDIA PVT. LTD.</div>
        <h1 style="margin:0;font-size:26px;font-weight:800;color:#fff">Full & Final Settlement</h1>
        <p style="margin:8px 0 0;font-size:14px;color:#e0e7ff">Settlement Completed</p>
      </div>
      <div style="padding:32px">
        <p style="margin:0 0 20px;font-size:16px;color:#1e293b">Dear <strong>{{employee_name}}</strong>,</p>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#475569">Your Full & Final settlement has been processed successfully. Below are the settlement details:</p>

        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin:24px 0">
          <div style="padding:16px 20px;background:#f1f5f9;border-bottom:1px solid #e2e8f0">
            <p style="margin:0;font-size:14px;font-weight:700;color:#0f172a">Settlement Summary</p>
          </div>
          <div style="padding:20px">
            <table style="width:100%;border-collapse:collapse">
              <tr>
                <td style="padding:10px 0;font-size:14px;color:#475569">Last Working Day</td>
                <td style="padding:10px 0;font-size:14px;font-weight:600;color:#0f172a;text-align:right">{{last_working_day}}</td>
              </tr>
              <tr>
                <td style="padding:10px 0;font-size:14px;color:#475569;border-top:1px solid #e2e8f0">Settlement Amount</td>
                <td style="padding:10px 0;font-size:18px;font-weight:800;color:#047857;text-align:right;border-top:1px solid #e2e8f0">₹{{settlement_amount}}</td>
              </tr>
              <tr>
                <td style="padding:10px 0;font-size:14px;color:#475569;border-top:1px solid #e2e8f0">Payment Date</td>
                <td style="padding:10px 0;font-size:14px;font-weight:600;color:#0f172a;text-align:right;border-top:1px solid #e2e8f0">{{payment_date}}</td>
              </tr>
            </table>
          </div>
        </div>

        <div style="background:#fefce8;border-left:4px solid #eab308;border-radius:8px;padding:16px;margin:24px 0">
          <p style="margin:0;font-size:13px;color:#854d0e;line-height:1.6"><strong>Documents:</strong> Your experience letter and relieving letter have been sent to your registered email. Please collect any pending physical documents from HR within 30 days.</p>
        </div>

        <p style="margin:24px 0;font-size:15px;line-height:1.7;color:#475569">We thank you for your contributions to MAS Callnet and wish you all the best in your future endeavors.</p>

        <div style="margin:32px 0 24px;padding-top:24px;border-top:1px solid #e2e8f0">
          <p style="margin:0;font-size:14px;color:#64748b">Best regards,</p>
          <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#0f172a">MAS Callnet HR & Finance Team</p>
        </div>
      </div>
      <div style="background:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;text-align:center">
        <p style="margin:0;font-size:11px;color:#94a3b8">&copy; 2026 Mas Callnet India Pvt. Ltd. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>',
'Dear {{employee_name}},\n\nYour Full & Final settlement has been processed successfully.\n\nLast Working Day: {{last_working_day}}\nSettlement Amount: Rs. {{settlement_amount}}\nPayment Date: {{payment_date}}\n\nYour experience letter and relieving letter have been sent to your registered email.\n\nWe thank you for your contributions and wish you all the best.\n\nBest regards,\nMAS Callnet HR & Finance Team',
'["employee_name","last_working_day","settlement_amount","payment_date"]'),

-- ══════════════════════════════════════════════════════════════════════════════
-- HR TEMPLATES
-- ══════════════════════════════════════════════════════════════════════════════

('PROBATION_CONFIRMATION', 'Probation Confirmation', 'hr',
'Congratulations! Probation Period Completed - MAS Callnet',
'<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,''Helvetica Neue'',Arial,sans-serif">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px">
    <div style="background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 12px 40px rgba(15,23,42,.12)">
      <div style="background:linear-gradient(135deg,#7c3aed 0%,#8b5cf6 60%,#a78bfa 100%);padding:32px;text-align:center">
        <div style="font-size:48px;margin-bottom:12px">🎊</div>
        <div style="font-size:11px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;color:#ddd6fe;margin-bottom:8px">MAS CALLNET INDIA PVT. LTD.</div>
        <h1 style="margin:0;font-size:26px;font-weight:800;color:#fff">Probation Confirmed!</h1>
      </div>
      <div style="padding:32px">
        <p style="margin:0 0 20px;font-size:16px;color:#1e293b">Dear <strong>{{employee_name}}</strong>,</p>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#475569">Congratulations! We are pleased to inform you that you have successfully completed your probation period and are now confirmed as a permanent employee of MAS Callnet India Pvt. Ltd.</p>

        <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:12px;padding:20px;margin:24px 0;text-align:center">
          <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#6d28d9;text-transform:uppercase;letter-spacing:.5px">Confirmation Date</p>
          <p style="margin:0;font-size:24px;font-weight:800;color:#5b21b6">{{confirmation_date}}</p>
        </div>

        <h3 style="margin:28px 0 16px;font-size:16px;font-weight:700;color:#0f172a;border-bottom:2px solid #8b5cf6;padding-bottom:8px">Your New Benefits</h3>
        <ul style="margin:0;padding:0 0 0 20px;color:#475569;line-height:1.8">
          <li>Full eligibility for all company benefits</li>
          <li>Access to performance incentive programs</li>
          <li>Eligibility for internal job postings</li>
          <li>Enhanced leave entitlements</li>
        </ul>

        <p style="margin:24px 0;font-size:15px;line-height:1.7;color:#475569">Thank you for your dedication and hard work. We look forward to your continued contributions to the team!</p>

        <div style="margin:32px 0 24px;padding-top:24px;border-top:1px solid #e2e8f0">
          <p style="margin:0;font-size:14px;color:#64748b">Best regards,</p>
          <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#0f172a">MAS Callnet HR Team</p>
        </div>
      </div>
      <div style="background:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;text-align:center">
        <p style="margin:0;font-size:11px;color:#94a3b8">&copy; 2026 Mas Callnet India Pvt. Ltd. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>',
'Dear {{employee_name}},\n\nCongratulations! You have successfully completed your probation period and are now confirmed as a permanent employee of MAS Callnet India Pvt. Ltd.\n\nConfirmation Date: {{confirmation_date}}\n\nYour New Benefits:\n- Full eligibility for all company benefits\n- Access to performance incentive programs\n- Eligibility for internal job postings\n- Enhanced leave entitlements\n\nThank you for your dedication. We look forward to your continued contributions!\n\nBest regards,\nMAS Callnet HR Team',
'["employee_name","confirmation_date"]'),

('PROMOTION_ANNOUNCEMENT', 'Promotion Announcement', 'hr',
'Congratulations on Your Promotion! - MAS Callnet',
'<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,''Helvetica Neue'',Arial,sans-serif">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px">
    <div style="background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 12px 40px rgba(15,23,42,.12)">
      <div style="background:linear-gradient(135deg,#b45309 0%,#d97706 60%,#f59e0b 100%);padding:32px;text-align:center">
        <div style="font-size:48px;margin-bottom:12px">🏆</div>
        <div style="font-size:11px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;color:#fef3c7;margin-bottom:8px">MAS CALLNET INDIA PVT. LTD.</div>
        <h1 style="margin:0;font-size:26px;font-weight:800;color:#fff">Congratulations!</h1>
      </div>
      <div style="padding:32px">
        <p style="margin:0 0 20px;font-size:16px;color:#1e293b">Dear <strong>{{employee_name}}</strong>,</p>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#475569">We are thrilled to announce your well-deserved promotion! Your hard work, dedication, and consistent performance have been recognized.</p>

        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:24px;margin:24px 0">
          <table style="width:100%;border-collapse:collapse">
            <tr>
              <td style="padding:12px 0;font-size:13px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:.5px">Previous Role</td>
              <td style="padding:12px 0;font-size:15px;color:#78350f;text-align:right">{{old_role}}</td>
            </tr>
            <tr>
              <td style="padding:12px 0;font-size:13px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:.5px;border-top:1px solid #fde68a">New Role</td>
              <td style="padding:12px 0;font-size:18px;font-weight:800;color:#b45309;text-align:right;border-top:1px solid #fde68a">{{new_role}}</td>
            </tr>
            <tr>
              <td style="padding:12px 0;font-size:13px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:.5px;border-top:1px solid #fde68a">Effective Date</td>
              <td style="padding:12px 0;font-size:15px;font-weight:600;color:#78350f;text-align:right;border-top:1px solid #fde68a">{{effective_date}}</td>
            </tr>
          </table>
        </div>

        <p style="margin:24px 0;font-size:15px;line-height:1.7;color:#475569">This promotion reflects your exceptional contributions and the trust we have in your abilities. We are confident you will excel in your new role.</p>

        <p style="margin:24px 0;font-size:15px;line-height:1.7;color:#475569">Wishing you continued success!</p>

        <div style="margin:32px 0 24px;padding-top:24px;border-top:1px solid #e2e8f0">
          <p style="margin:0;font-size:14px;color:#64748b">Best regards,</p>
          <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#0f172a">MAS Callnet Management</p>
        </div>
      </div>
      <div style="background:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;text-align:center">
        <p style="margin:0;font-size:11px;color:#94a3b8">&copy; 2026 Mas Callnet India Pvt. Ltd. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>',
'Dear {{employee_name}},\n\nCongratulations on your well-deserved promotion!\n\nPrevious Role: {{old_role}}\nNew Role: {{new_role}}\nEffective Date: {{effective_date}}\n\nThis promotion reflects your exceptional contributions. We are confident you will excel in your new role.\n\nWishing you continued success!\n\nBest regards,\nMAS Callnet Management',
'["employee_name","old_role","new_role","effective_date"]'),

('TRANSFER_NOTIFICATION', 'Transfer Notification', 'hr',
'Transfer Notification - MAS Callnet',
'<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,''Helvetica Neue'',Arial,sans-serif">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px">
    <div style="background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 12px 40px rgba(15,23,42,.12)">
      <div style="background:linear-gradient(135deg,#0369a1 0%,#0ea5e9 60%,#38bdf8 100%);padding:32px;text-align:center">
        <div style="font-size:11px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;color:#bae6fd;margin-bottom:8px">MAS CALLNET INDIA PVT. LTD.</div>
        <h1 style="margin:0;font-size:26px;font-weight:800;color:#fff">Transfer Notification</h1>
      </div>
      <div style="padding:32px">
        <p style="margin:0 0 20px;font-size:16px;color:#1e293b">Dear <strong>{{employee_name}}</strong>,</p>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#475569">This is to inform you that your transfer has been approved. Please find the details below:</p>

        <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:12px;padding:24px;margin:24px 0">
          <table style="width:100%;border-collapse:collapse">
            <tr>
              <td style="padding:12px 0;font-size:13px;font-weight:700;color:#0369a1;text-transform:uppercase;letter-spacing:.5px">From Branch</td>
              <td style="padding:12px 0;font-size:15px;color:#0c4a6e;text-align:right">{{from_branch}}</td>
            </tr>
            <tr>
              <td style="padding:12px 0;font-size:13px;font-weight:700;color:#0369a1;text-transform:uppercase;letter-spacing:.5px;border-top:1px solid #bae6fd">To Branch</td>
              <td style="padding:12px 0;font-size:18px;font-weight:800;color:#0369a1;text-align:right;border-top:1px solid #bae6fd">{{to_branch}}</td>
            </tr>
            <tr>
              <td style="padding:12px 0;font-size:13px;font-weight:700;color:#0369a1;text-transform:uppercase;letter-spacing:.5px;border-top:1px solid #bae6fd">Effective Date</td>
              <td style="padding:12px 0;font-size:15px;font-weight:600;color:#0c4a6e;text-align:right;border-top:1px solid #bae6fd">{{effective_date}}</td>
            </tr>
            <tr>
              <td style="padding:12px 0;font-size:13px;font-weight:700;color:#0369a1;text-transform:uppercase;letter-spacing:.5px;border-top:1px solid #bae6fd">Reporting To</td>
              <td style="padding:12px 0;font-size:15px;font-weight:600;color:#0c4a6e;text-align:right;border-top:1px solid #bae6fd">{{new_manager}}</td>
            </tr>
          </table>
        </div>

        <div style="background:#fefce8;border-left:4px solid #eab308;border-radius:8px;padding:16px;margin:24px 0">
          <p style="margin:0;font-size:13px;color:#854d0e;line-height:1.6"><strong>Action Required:</strong> Please complete your handover at the current location and report to your new branch on the effective date.</p>
        </div>

        <div style="margin:32px 0 24px;padding-top:24px;border-top:1px solid #e2e8f0">
          <p style="margin:0;font-size:14px;color:#64748b">Best regards,</p>
          <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#0f172a">MAS Callnet HR Team</p>
        </div>
      </div>
      <div style="background:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;text-align:center">
        <p style="margin:0;font-size:11px;color:#94a3b8">&copy; 2026 Mas Callnet India Pvt. Ltd. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>',
'Dear {{employee_name}},\n\nYour transfer has been approved.\n\nFrom Branch: {{from_branch}}\nTo Branch: {{to_branch}}\nEffective Date: {{effective_date}}\nReporting To: {{new_manager}}\n\nPlease complete your handover and report to your new branch on the effective date.\n\nBest regards,\nMAS Callnet HR Team',
'["employee_name","from_branch","to_branch","effective_date","new_manager"]'),

-- ══════════════════════════════════════════════════════════════════════════════
-- ADMIN/IT TEMPLATES
-- ══════════════════════════════════════════════════════════════════════════════

('DOCUMENT_EXPIRY_REMINDER', 'Document Expiry Reminder', 'admin',
'Document Expiry Alert - Action Required - MAS Callnet',
'<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,''Helvetica Neue'',Arial,sans-serif">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px">
    <div style="background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 12px 40px rgba(15,23,42,.12)">
      <div style="background:linear-gradient(135deg,#dc2626 0%,#ef4444 60%,#f87171 100%);padding:32px;text-align:center">
        <div style="font-size:48px;margin-bottom:12px">⚠️</div>
        <div style="font-size:11px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;color:#fecaca;margin-bottom:8px">MAS CALLNET INDIA PVT. LTD.</div>
        <h1 style="margin:0;font-size:26px;font-weight:800;color:#fff">Document Expiry Alert</h1>
      </div>
      <div style="padding:32px">
        <p style="margin:0 0 20px;font-size:16px;color:#1e293b">Dear <strong>{{employee_name}}</strong>,</p>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#475569">This is a reminder that one of your documents is expiring soon. Please take action to renew it.</p>

        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:24px;margin:24px 0">
          <table style="width:100%;border-collapse:collapse">
            <tr>
              <td style="padding:12px 0;font-size:13px;font-weight:700;color:#b91c1c;text-transform:uppercase;letter-spacing:.5px">Document Type</td>
              <td style="padding:12px 0;font-size:16px;font-weight:700;color:#7f1d1d;text-align:right">{{document_type}}</td>
            </tr>
            <tr>
              <td style="padding:12px 0;font-size:13px;font-weight:700;color:#b91c1c;text-transform:uppercase;letter-spacing:.5px;border-top:1px solid #fecaca">Expiry Date</td>
              <td style="padding:12px 0;font-size:16px;font-weight:700;color:#dc2626;text-align:right;border-top:1px solid #fecaca">{{expiry_date}}</td>
            </tr>
            <tr>
              <td style="padding:12px 0;font-size:13px;font-weight:700;color:#b91c1c;text-transform:uppercase;letter-spacing:.5px;border-top:1px solid #fecaca">Days Remaining</td>
              <td style="padding:12px 0;font-size:20px;font-weight:800;color:#dc2626;text-align:right;border-top:1px solid #fecaca">{{days_left}} days</td>
            </tr>
          </table>
        </div>

        <div style="background:#fefce8;border-left:4px solid #eab308;border-radius:8px;padding:16px;margin:24px 0">
          <p style="margin:0;font-size:13px;color:#854d0e;line-height:1.6"><strong>Action Required:</strong> Please upload the renewed document in the HRMS portal before the expiry date to avoid compliance issues.</p>
        </div>

        <div style="margin:28px 0;text-align:center">
          <a href="{{upload_link}}" style="display:inline-block;background:linear-gradient(135deg,#dc2626,#ef4444);color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:15px;box-shadow:0 4px 12px rgba(220,38,38,.3)">Upload Document</a>
        </div>

        <div style="margin:32px 0 24px;padding-top:24px;border-top:1px solid #e2e8f0">
          <p style="margin:0;font-size:14px;color:#64748b">Best regards,</p>
          <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#0f172a">MAS Callnet Admin Team</p>
        </div>
      </div>
      <div style="background:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;text-align:center">
        <p style="margin:0;font-size:11px;color:#94a3b8">&copy; 2026 Mas Callnet India Pvt. Ltd. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>',
'Dear {{employee_name}},\n\nYour document is expiring soon. Please take action to renew it.\n\nDocument Type: {{document_type}}\nExpiry Date: {{expiry_date}}\nDays Remaining: {{days_left}} days\n\nPlease upload the renewed document in the HRMS portal before the expiry date.\n\nBest regards,\nMAS Callnet Admin Team',
'["employee_name","document_type","expiry_date","days_left","upload_link"]'),

('ASSET_ASSIGNMENT', 'Asset Assignment', 'it',
'Asset Assigned to You - MAS Callnet',
'<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,''Helvetica Neue'',Arial,sans-serif">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px">
    <div style="background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 12px 40px rgba(15,23,42,.12)">
      <div style="background:linear-gradient(135deg,#475569 0%,#64748b 60%,#94a3b8 100%);padding:32px;text-align:center">
        <div style="font-size:48px;margin-bottom:12px">💻</div>
        <div style="font-size:11px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;color:#e2e8f0;margin-bottom:8px">MAS CALLNET INDIA PVT. LTD.</div>
        <h1 style="margin:0;font-size:26px;font-weight:800;color:#fff">Asset Assigned</h1>
      </div>
      <div style="padding:32px">
        <p style="margin:0 0 20px;font-size:16px;color:#1e293b">Dear <strong>{{employee_name}}</strong>,</p>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#475569">The following asset has been assigned to you. Please acknowledge receipt and handle it with care.</p>

        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:24px;margin:24px 0">
          <table style="width:100%;border-collapse:collapse">
            <tr>
              <td style="padding:12px 0;font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px">Asset Type</td>
              <td style="padding:12px 0;font-size:16px;font-weight:700;color:#0f172a;text-align:right">{{asset_type}}</td>
            </tr>
            <tr>
              <td style="padding:12px 0;font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;border-top:1px solid #e2e8f0">Asset ID</td>
              <td style="padding:12px 0;font-size:15px;font-weight:600;color:#0f172a;text-align:right;border-top:1px solid #e2e8f0">{{asset_id}}</td>
            </tr>
            <tr>
              <td style="padding:12px 0;font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;border-top:1px solid #e2e8f0">Issue Date</td>
              <td style="padding:12px 0;font-size:15px;font-weight:600;color:#0f172a;text-align:right;border-top:1px solid #e2e8f0">{{issue_date}}</td>
            </tr>
          </table>
        </div>

        <div style="background:#eff6ff;border-left:4px solid #3b82f6;border-radius:8px;padding:16px;margin:24px 0">
          <p style="margin:0;font-size:13px;color:#1e40af;line-height:1.6"><strong>Important:</strong> You are responsible for this asset. Please report any damage or loss immediately to the IT department.</p>
        </div>

        <div style="margin:32px 0 24px;padding-top:24px;border-top:1px solid #e2e8f0">
          <p style="margin:0;font-size:14px;color:#64748b">Best regards,</p>
          <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#0f172a">MAS Callnet IT Team</p>
        </div>
      </div>
      <div style="background:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;text-align:center">
        <p style="margin:0;font-size:11px;color:#94a3b8">&copy; 2026 Mas Callnet India Pvt. Ltd. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>',
'Dear {{employee_name}},\n\nThe following asset has been assigned to you:\n\nAsset Type: {{asset_type}}\nAsset ID: {{asset_id}}\nIssue Date: {{issue_date}}\n\nYou are responsible for this asset. Please report any damage or loss immediately to the IT department.\n\nBest regards,\nMAS Callnet IT Team',
'["employee_name","asset_type","asset_id","issue_date"]'),

-- ══════════════════════════════════════════════════════════════════════════════
-- ENGAGEMENT TEMPLATES
-- ══════════════════════════════════════════════════════════════════════════════

('BIRTHDAY_GREETING', 'Birthday Greeting', 'engagement',
'Happy Birthday! 🎂 - MAS Callnet',
'<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,''Helvetica Neue'',Arial,sans-serif">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px">
    <div style="background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 12px 40px rgba(15,23,42,.12)">
      <div style="background:linear-gradient(135deg,#db2777 0%,#ec4899 60%,#f472b6 100%);padding:40px 32px;text-align:center">
        <div style="font-size:64px;margin-bottom:16px">🎂</div>
        <h1 style="margin:0;font-size:32px;font-weight:800;color:#fff">Happy Birthday!</h1>
        <p style="margin:12px 0 0;font-size:18px;color:#fbcfe8">{{employee_name}}</p>
      </div>
      <div style="padding:32px;text-align:center">
        <p style="margin:0 0 24px;font-size:18px;line-height:1.7;color:#475569">Wishing you a wonderful birthday filled with joy, laughter, and all the things that make you happy!</p>

        <div style="background:linear-gradient(135deg,#fdf2f8,#fce7f3);border-radius:16px;padding:24px;margin:24px 0">
          <p style="margin:0;font-size:16px;color:#9d174d;line-height:1.7">May this special day bring you endless happiness and may the year ahead be filled with success and new adventures.</p>
        </div>

        <p style="margin:24px 0;font-size:15px;color:#64748b">Thank you for being an amazing part of the MAS Callnet family!</p>

        <div style="margin:32px 0;font-size:32px">🎈🎉🎁</div>

        <div style="margin:32px 0 24px;padding-top:24px;border-top:1px solid #e2e8f0">
          <p style="margin:0;font-size:14px;color:#64748b">Warm wishes,</p>
          <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#0f172a">Your MAS Callnet Family</p>
        </div>
      </div>
      <div style="background:#fdf2f8;padding:20px 32px;border-top:1px solid #fce7f3;text-align:center">
        <p style="margin:0;font-size:11px;color:#9d174d">&copy; 2026 Mas Callnet India Pvt. Ltd. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>',
'Happy Birthday, {{employee_name}}!\n\nWishing you a wonderful birthday filled with joy, laughter, and all the things that make you happy!\n\nMay this special day bring you endless happiness and may the year ahead be filled with success and new adventures.\n\nThank you for being an amazing part of the MAS Callnet family!\n\nWarm wishes,\nYour MAS Callnet Family',
'["employee_name"]'),

('WORK_ANNIVERSARY', 'Work Anniversary', 'engagement',
'Happy Work Anniversary! 🎊 - MAS Callnet',
'<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,''Helvetica Neue'',Arial,sans-serif">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px">
    <div style="background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 12px 40px rgba(15,23,42,.12)">
      <div style="background:linear-gradient(135deg,#7c3aed 0%,#8b5cf6 60%,#a78bfa 100%);padding:40px 32px;text-align:center">
        <div style="font-size:64px;margin-bottom:16px">🎊</div>
        <h1 style="margin:0;font-size:32px;font-weight:800;color:#fff">Happy Work Anniversary!</h1>
        <p style="margin:12px 0 0;font-size:18px;color:#ddd6fe">{{employee_name}}</p>
      </div>
      <div style="padding:32px;text-align:center">
        <div style="background:linear-gradient(135deg,#f5f3ff,#ede9fe);border-radius:16px;padding:24px;margin:0 0 24px">
          <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#6d28d9;text-transform:uppercase;letter-spacing:.5px">Celebrating</p>
          <p style="margin:0;font-size:48px;font-weight:800;color:#5b21b6">{{years_completed}}</p>
          <p style="margin:4px 0 0;font-size:16px;color:#7c3aed">Years with MAS Callnet</p>
        </div>

        <p style="margin:0 0 24px;font-size:18px;line-height:1.7;color:#475569">Congratulations on this milestone! Your dedication, hard work, and contributions have made a real difference.</p>

        <p style="margin:24px 0;font-size:15px;color:#64748b;line-height:1.7">Since joining us on <strong>{{join_date}}</strong>, you have been an invaluable member of our team. Thank you for your commitment and loyalty!</p>

        <div style="margin:32px 0;font-size:32px">🏆✨🌟</div>

        <div style="margin:32px 0 24px;padding-top:24px;border-top:1px solid #e2e8f0">
          <p style="margin:0;font-size:14px;color:#64748b">With appreciation,</p>
          <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#0f172a">MAS Callnet Management</p>
        </div>
      </div>
      <div style="background:#f5f3ff;padding:20px 32px;border-top:1px solid #ede9fe;text-align:center">
        <p style="margin:0;font-size:11px;color:#6d28d9">&copy; 2026 Mas Callnet India Pvt. Ltd. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>',
'Happy Work Anniversary, {{employee_name}}!\n\nCongratulations on completing {{years_completed}} years with MAS Callnet!\n\nYour dedication, hard work, and contributions have made a real difference. Since joining us on {{join_date}}, you have been an invaluable member of our team.\n\nThank you for your commitment and loyalty!\n\nWith appreciation,\nMAS Callnet Management',
'["employee_name","years_completed","join_date"]'),

-- ══════════════════════════════════════════════════════════════════════════════
-- AUTH TEMPLATES (Upgraded versions)
-- ══════════════════════════════════════════════════════════════════════════════

('PASSWORD_RESET', 'Password Reset', 'auth',
'Reset Your Password - MAS Callnet HRMS',
'<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,''Helvetica Neue'',Arial,sans-serif">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px">
    <div style="background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 12px 40px rgba(15,23,42,.12)">
      <div style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 60%,#334155 100%);padding:32px;text-align:center">
        <div style="font-size:11px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;color:#94a3b8;margin-bottom:8px">MAS CALLNET HRMS</div>
        <h1 style="margin:0;font-size:26px;font-weight:800;color:#fff">Password Reset Request</h1>
      </div>
      <div style="padding:32px">
        <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#475569">We received a request to reset your HRMS password. Click the button below to create a new password.</p>

        <div style="margin:28px 0;text-align:center">
          <a href="{{reset_link}}" style="display:inline-block;background:linear-gradient(135deg,#2563eb,#3b82f6);color:#fff;text-decoration:none;padding:16px 40px;border-radius:8px;font-weight:700;font-size:16px;box-shadow:0 4px 12px rgba(37,99,235,.3)">Reset Password</a>
        </div>

        <p style="margin:24px 0;font-size:13px;color:#64748b;text-align:center;word-break:break-all">Or copy this link: {{reset_link}}</p>

        <div style="background:#fef2f2;border-left:4px solid #ef4444;border-radius:8px;padding:16px;margin:24px 0">
          <p style="margin:0;font-size:13px;color:#991b1b;line-height:1.6"><strong>Security Notice:</strong> This link expires in 1 hour. If you did not request this reset, please ignore this email or contact IT support immediately.</p>
        </div>

        <div style="margin:32px 0 24px;padding-top:24px;border-top:1px solid #e2e8f0">
          <p style="margin:0;font-size:14px;color:#64748b">Best regards,</p>
          <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#0f172a">MAS Callnet IT Team</p>
        </div>
      </div>
      <div style="background:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;text-align:center">
        <p style="margin:0;font-size:11px;color:#94a3b8">This is an automated security notification. Do not share this link.</p>
      </div>
    </div>
  </div>
</body>
</html>',
'Password Reset Request\n\nWe received a request to reset your HRMS password.\n\nReset your password: {{reset_link}}\n\nThis link expires in 1 hour. If you did not request this reset, please ignore this email or contact IT support.\n\nMAS Callnet IT Team',
'["reset_link"]'),

('MANAGER_RESIGNATION_NOTICE', 'Manager Resignation Notice', 'exit',
'Resignation Notice - {{employee_name}} - Action Required',
'<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,''Helvetica Neue'',Arial,sans-serif">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px">
    <div style="background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 12px 40px rgba(15,23,42,.12)">
      <div style="background:linear-gradient(135deg,#dc2626 0%,#ef4444 60%,#f87171 100%);padding:32px;text-align:center">
        <div style="font-size:11px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;color:#fecaca;margin-bottom:8px">RESIGNATION NOTICE</div>
        <h1 style="margin:0;font-size:26px;font-weight:800;color:#fff">Team Member Resignation</h1>
      </div>
      <div style="padding:32px">
        <p style="margin:0 0 20px;font-size:16px;color:#1e293b">Dear <strong>{{manager_name}}</strong>,</p>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#475569">This is to notify you that <strong>{{employee_name}}</strong> has submitted a resignation request. Your action is required to review and respond to this request.</p>

        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:24px;margin:24px 0">
          <table style="width:100%;border-collapse:collapse">
            <tr>
              <td style="padding:10px 0;font-size:13px;font-weight:700;color:#b91c1c;text-transform:uppercase;letter-spacing:.5px">Employee</td>
              <td style="padding:10px 0;font-size:15px;font-weight:600;color:#0f172a;text-align:right">{{employee_name}}</td>
            </tr>
            <tr>
              <td style="padding:10px 0;font-size:13px;font-weight:700;color:#b91c1c;text-transform:uppercase;letter-spacing:.5px;border-top:1px solid #fecaca">Employee Code</td>
              <td style="padding:10px 0;font-size:15px;font-weight:600;color:#0f172a;text-align:right;border-top:1px solid #fecaca">{{employee_code}}</td>
            </tr>
            <tr>
              <td style="padding:10px 0;font-size:13px;font-weight:700;color:#b91c1c;text-transform:uppercase;letter-spacing:.5px;border-top:1px solid #fecaca">Exit Request ID</td>
              <td style="padding:10px 0;font-size:13px;color:#64748b;text-align:right;border-top:1px solid #fecaca">{{exit_request_id}}</td>
            </tr>
          </table>
        </div>

        <div style="margin:28px 0;text-align:center">
          <a href="{{review_link}}" style="display:inline-block;background:linear-gradient(135deg,#dc2626,#ef4444);color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:15px;box-shadow:0 4px 12px rgba(220,38,38,.3)">Review & Respond</a>
        </div>

        <div style="background:#fefce8;border-left:4px solid #eab308;border-radius:8px;padding:16px;margin:24px 0">
          <p style="margin:0;font-size:13px;color:#854d0e;line-height:1.6"><strong>Action Required:</strong> Please log in to HRMS to review the resignation details and submit your response (approve/reject/discuss).</p>
        </div>

        <div style="margin:32px 0 24px;padding-top:24px;border-top:1px solid #e2e8f0">
          <p style="margin:0;font-size:14px;color:#64748b">Best regards,</p>
          <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#0f172a">MAS Callnet HRMS</p>
        </div>
      </div>
      <div style="background:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;text-align:center">
        <p style="margin:0;font-size:11px;color:#94a3b8">This is an automated HR notification. Please keep this information confidential.</p>
      </div>
    </div>
  </div>
</body>
</html>',
'Resignation Notice\n\nDear {{manager_name}},\n\n{{employee_name}} ({{employee_code}}) has submitted a resignation request.\n\nExit Request ID: {{exit_request_id}}\n\nPlease log in to HRMS to review and respond to this request.\n\nReview Link: {{review_link}}\n\nMAS Callnet HRMS',
'["manager_name","employee_name","employee_code","exit_request_id","review_link"]')

ON DUPLICATE KEY UPDATE
  template_name = VALUES(template_name),
  subject = VALUES(subject),
  body_html = VALUES(body_html),
  body_text = VALUES(body_text),
  variables_json = VALUES(variables_json),
  updated_at = CURRENT_TIMESTAMP;
