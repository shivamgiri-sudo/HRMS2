import type { TemplateCategory } from "./communication.types.js";

export interface BuiltInCommunicationTemplate {
  subject: string;
  body_html: string;
  body_text: string;
  sms_text?: string;
  whatsapp_text?: string;
  category: TemplateCategory;
}

function emailFrame(eyebrow: string, title: string, body: string, actionLabel?: string, actionUrl?: string): string {
  const action = actionLabel && actionUrl
    ? `<p style="margin:28px 0 8px"><a href="${actionUrl}" style="display:inline-block;background:#1B6AB5;color:#fff;text-decoration:none;padding:13px 22px;border-radius:10px;font-weight:700">${actionLabel}</a></p>`
    : "";
  return `<!doctype html>
<html>
<body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#172033">
  <div style="max-width:640px;margin:0 auto;padding:28px 16px">
    <div style="overflow:hidden;border-radius:20px;background:#fff;box-shadow:0 12px 35px rgba(15,23,42,.10)">
      <div style="background:linear-gradient(135deg,#073f78,#1B6AB5 60%,#7357d9);padding:26px 30px;color:#fff">
        <div style="font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#bfdbfe">${eyebrow}</div>
        <h1 style="margin:9px 0 0;font-size:26px;line-height:1.25">${title}</h1>
      </div>
      <div style="padding:28px 30px;font-size:15px;line-height:1.75">
        ${body}
        ${action}
        <p style="margin:28px 0 0;color:#64748b">Regards,<br><strong>Mas Callnet India Pvt Ltd</strong></p>
      </div>
    </div>
    <p style="margin:14px 0 0;text-align:center;font-size:11px;color:#94a3b8">This is a personalised system notification. Do not share confidential HR information.</p>
  </div>
</body>
</html>`;
}

export const builtInTemplates: Record<string, BuiltInCommunicationTemplate> = {
  system_event: {
    subject: "{{notification.title}}",
    category: "alerts",
    body_html: emailFrame(
      "{{notification.category}}",
      "{{notification.title}}",
      `<p>Hi <strong>{{employee.name}}</strong>,</p>
       <p>{{notification.message}}</p>
       {{#if notification.reference}}<p style="padding:12px 14px;border-radius:10px;background:#eff6ff"><strong>Reference:</strong> {{notification.reference}}</p>{{/if}}`,
      "Open HRMS",
      "{{notification.action_url}}",
    ),
    body_text: `Hi {{employee.name}},

{{notification.message}}
{{#if notification.reference}}Reference: {{notification.reference}}{{/if}}
Open HRMS: {{notification.action_url}}

Mas Callnet India Pvt Ltd`,
    whatsapp_text: `*{{notification.title}}*

Hi {{employee.name}},

{{notification.message}}
{{#if notification.reference}}
Reference: {{notification.reference}}{{/if}}

Open HRMS: {{notification.action_url}}

_Mas Callnet India Pvt Ltd_`,
    sms_text: `MCN HRMS: {{notification.title}}. {{notification.short_message}} View: {{notification.action_url}}`,
  },
  leave_submission: {
    subject: "Leave request submitted | {{leave_type}}",
    category: "leave",
    body_html: emailFrame(
      "Leave",
      "Your leave request has been submitted",
      `<p>Hi <strong>{{employee.name}}</strong>,</p>
       <p>We have received your <strong>{{leave_type}}</strong> request for <strong>{{total_days}} day(s)</strong>, from {{from_date}} to {{to_date}}.</p>
       {{#if reason}}<p><strong>Reason:</strong> {{reason}}</p>{{/if}}
       <p>Your approver will review it and you will receive another notification when the status changes.</p>`,
      "Track leave request",
      "/leaves",
    ),
    body_text: "Hi {{employee.name}}, your {{leave_type}} request from {{from_date}} to {{to_date}} for {{total_days}} day(s) has been submitted and is awaiting review.",
    whatsapp_text: "*Leave request submitted*\n\nHi {{employee.name}}, your {{leave_type}} request for {{total_days}} day(s), from {{from_date}} to {{to_date}}, is awaiting approval.\n\nTrack it in HRMS: /leaves",
    sms_text: "MCN HRMS: {{leave_type}} leave submitted for {{total_days}} day(s), {{from_date}} to {{to_date}}. Track in HRMS.",
  },
  leave_status: {
    subject: "Leave request {{status}}",
    category: "leave",
    body_html: emailFrame(
      "Leave decision",
      "Your leave request is {{status}}",
      `<p>Hi <strong>{{employee.name}}</strong>,</p>
       <p>Your leave request has been <strong>{{status}}</strong> by {{reviewer_name}}.</p>
       {{#if review_notes}}<p style="padding:14px;border-left:4px solid #1B6AB5;background:#eff6ff"><strong>Reviewer note:</strong> {{review_notes}}</p>{{/if}}`,
      "View leave details",
      "/leaves",
    ),
    body_text: "Hi {{employee.name}}, your leave request has been {{status}} by {{reviewer_name}}. {{review_notes}}",
    whatsapp_text: "*Leave request {{status}}*\n\nHi {{employee.name}}, your request was {{status}} by {{reviewer_name}}.\n{{#if review_notes}}Note: {{review_notes}}{{/if}}\n\nView details: /leaves",
    sms_text: "MCN HRMS: Your leave request is {{status}}. Review by {{reviewer_name}}. View details in HRMS.",
  },
  employee_onboarding: {
    subject: "Welcome to Mas Callnet India Pvt Ltd",
    category: "onboarding",
    body_html: emailFrame(
      "Welcome",
      "Your employee journey starts here",
      `<p>Hi <strong>{{employee.name}}</strong>,</p>
       <p>Welcome to Mas Callnet India Pvt Ltd. Your profile has been created for the {{department_name}} team.</p>
       <p>Please sign in, verify your personal information, complete pending documents and review your assigned onboarding activities.</p>`,
      "Open your profile",
      "/profile",
    ),
    body_text: "Welcome {{employee.name}} to Mas Callnet India Pvt Ltd. Your employee profile is ready. Sign in to verify details and complete onboarding tasks.",
    whatsapp_text: "*Welcome to Mas Callnet India Pvt Ltd*\n\nHi {{employee.name}}, your employee profile is ready. Please sign in to verify your details and complete onboarding tasks.\n\nOpen HRMS: /profile",
    sms_text: "Welcome to Mas Callnet India Pvt Ltd, {{employee.name}}. Your HRMS profile is ready. Sign in to complete onboarding.",
  },
  performance_review_created: {
    subject: "Performance review update | {{review_period}}",
    category: "performance",
    body_html: emailFrame(
      "Performance",
      "A performance review has been created",
      `<p>Hi <strong>{{employee.name}}</strong>,</p>
       <p>{{reviewer_name}} has created your review for <strong>{{review_period}}</strong>.</p>
       <p>Status: <strong>{{status}}</strong>. Please open HRMS to review the details when it is published.</p>`,
      "View performance",
      "/performance",
    ),
    body_text: "Hi {{employee.name}}, a performance review for {{review_period}} has been created by {{reviewer_name}}. Status: {{status}}.",
    sms_text: "MCN HRMS: Performance review created for {{review_period}}. Sign in to view the latest status.",
  },
  performance_review_acknowledged: {
    subject: "Performance review acknowledged | {{review_period}}",
    category: "performance",
    body_html: emailFrame(
      "Performance",
      "Review acknowledgement recorded",
      `<p>The performance review for <strong>{{employee_name}}</strong>, period <strong>{{review_period}}</strong>, has been acknowledged successfully.</p>`,
      "Open performance workspace",
      "/performance",
    ),
    body_text: "Performance review acknowledgement recorded for {{employee_name}}, {{review_period}}.",
    sms_text: "MCN HRMS: Performance review acknowledgement recorded for {{review_period}}.",
  },
};
