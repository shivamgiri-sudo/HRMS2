import Handlebars from "handlebars";
import type { Channel, NotificationCategory } from "./communication.types.js";
import { dispatchService } from "./dispatch.service.js";

type Priority = "low" | "normal" | "high" | "urgent";

interface NotificationEventDefinition {
  label: string;
  category: NotificationCategory;
  title: string;
  message: string;
  shortMessage: string;
  actionUrl: string;
  priority: Priority;
  channels: Channel[];
  critical?: boolean;
}

const allChannels: Channel[] = ["email", "whatsapp", "sms"];

export const NOTIFICATION_EVENT_CATALOG = {
  onboarding_welcome: {
    label: "Employee welcome",
    category: "onboarding",
    title: "Welcome to Mas Callnet India Pvt Ltd",
    message: "Your employee profile is active. Please verify your details, complete pending documents and review your onboarding tasks.",
    shortMessage: "Your employee profile is active. Complete onboarding tasks.",
    actionUrl: "/profile",
    priority: "high",
    channels: allChannels,
  },
  onboarding_document_pending: {
    label: "Onboarding document pending",
    category: "onboarding",
    title: "Onboarding document action required",
    message: "{{pending_count}} onboarding document(s) are pending. Please upload them by {{deadline}} to avoid a joining delay.",
    shortMessage: "{{pending_count}} onboarding documents are pending.",
    actionUrl: "/profile",
    priority: "high",
    channels: allChannels,
  },
  attendance_late: {
    label: "Late attendance",
    category: "attendance",
    title: "Late attendance recorded",
    message: "Your clock-in for {{date}} was recorded at {{clock_in}}. Submit regularisation if this record is incorrect.",
    shortMessage: "Late clock-in recorded for {{date}}.",
    actionUrl: "/attendance-regularization",
    priority: "normal",
    channels: allChannels,
  },
  attendance_absent: {
    label: "Absence alert",
    category: "attendance",
    title: "Attendance action required",
    message: "You are marked absent for {{date}}. Review the record and submit regularisation with supporting details if required.",
    shortMessage: "You are marked absent for {{date}}.",
    actionUrl: "/attendance-regularization",
    priority: "high",
    channels: allChannels,
  },
  attendance_regularization_update: {
    label: "Regularisation decision",
    category: "attendance",
    title: "Attendance regularisation {{status}}",
    message: "Your regularisation request for {{date}} has been {{status}}. {{remarks}}",
    shortMessage: "Regularisation for {{date}} is {{status}}.",
    actionUrl: "/attendance-regularization",
    priority: "normal",
    channels: allChannels,
  },
  leave_submitted: {
    label: "Leave submitted",
    category: "leave",
    title: "Leave request submitted",
    message: "Your {{leave_type}} request from {{from_date}} to {{to_date}} has been submitted for approval.",
    shortMessage: "Leave request submitted for approval.",
    actionUrl: "/leaves",
    priority: "normal",
    channels: allChannels,
  },
  leave_decision: {
    label: "Leave decision",
    category: "leave",
    title: "Leave request {{status}}",
    message: "Your {{leave_type}} request has been {{status}} by {{reviewer_name}}. {{review_notes}}",
    shortMessage: "Your leave request is {{status}}.",
    actionUrl: "/leaves",
    priority: "normal",
    channels: allChannels,
  },
  payslip_ready: {
    label: "Payslip ready",
    category: "payroll",
    title: "Your payslip is ready",
    message: "Your payslip for {{month}} {{year}} is available in HRMS. Salary amounts remain hidden until you explicitly choose View salary.",
    shortMessage: "Payslip for {{month}} {{year}} is ready.",
    actionUrl: "/profile?tab=payslips",
    priority: "high",
    channels: allChannels,
  },
  salary_credited: {
    label: "Salary credited",
    category: "payroll",
    title: "Salary payment processed",
    message: "Salary for {{month}} {{year}} has been processed. Open your private payslip view for the payment reference and breakdown.",
    shortMessage: "Salary for {{month}} {{year}} has been processed.",
    actionUrl: "/profile?tab=payslips",
    priority: "high",
    channels: allChannels,
  },
  salary_increment: {
    label: "Salary increment",
    category: "payroll",
    title: "Compensation revision published",
    message: "Your compensation revision is effective from {{effective_date}}. Open HRMS privately to review the revised structure.",
    shortMessage: "Compensation revision effective {{effective_date}}.",
    actionUrl: "/employee-stat-card",
    priority: "high",
    channels: allChannels,
  },
  tax_declaration_reminder: {
    label: "Tax declaration reminder",
    category: "payroll",
    title: "Tax declaration due on {{deadline}}",
    message: "Complete or update your tax declaration before {{deadline}}. Late submission may affect projected TDS.",
    shortMessage: "Tax declaration due {{deadline}}.",
    actionUrl: "/payroll/tax-declaration",
    priority: "high",
    channels: allChannels,
  },
  roster_published: {
    label: "Roster published",
    category: "announcements",
    title: "Your roster has been published",
    message: "Your roster for {{period}} is now available. Please review shift timings, weekly offs and acknowledgement requirements.",
    shortMessage: "Roster for {{period}} is published.",
    actionUrl: "/my-roster",
    priority: "high",
    channels: allChannels,
  },
  roster_changed: {
    label: "Roster changed",
    category: "alerts",
    title: "Important roster change",
    message: "Your published roster has changed for {{date}}. New shift: {{shift}}. Reason: {{reason}}",
    shortMessage: "Roster changed for {{date}}.",
    actionUrl: "/my-roster",
    priority: "urgent",
    channels: allChannels,
    critical: true,
  },
  performance_review_ready: {
    label: "Performance review ready",
    category: "performance",
    title: "Performance review ready",
    message: "Your performance review for {{period}} is ready. Please read the feedback and acknowledge it in HRMS.",
    shortMessage: "Performance review for {{period}} is ready.",
    actionUrl: "/performance",
    priority: "high",
    channels: allChannels,
  },
  goal_reminder: {
    label: "Goal reminder",
    category: "performance",
    title: "Goal update due",
    message: "An update for goal '{{goal_name}}' is due on {{deadline}}. Add progress and supporting evidence before the deadline.",
    shortMessage: "Goal update due {{deadline}}.",
    actionUrl: "/goals",
    priority: "normal",
    channels: allChannels,
  },
  appreciation_received: {
    label: "Appreciation received",
    category: "performance",
    title: "You received an appreciation",
    message: "{{sender_name}} appreciated your contribution: {{appreciation_message}}",
    shortMessage: "You received a new appreciation.",
    actionUrl: "/engagement/kudos",
    priority: "normal",
    channels: allChannels,
  },
  promotion_approved: {
    label: "Promotion approved",
    category: "performance",
    title: "Promotion update",
    message: "Your promotion to {{designation}} is effective from {{effective_date}}. Congratulations on this milestone.",
    shortMessage: "Promotion to {{designation}} effective {{effective_date}}.",
    actionUrl: "/employee-stat-card",
    priority: "high",
    channels: allChannels,
  },
  transfer_approved: {
    label: "Transfer approved",
    category: "announcements",
    title: "Role or department change confirmed",
    message: "Your {{change_type}} change to {{new_value}} is effective from {{effective_date}}. Review the employee journey for details.",
    shortMessage: "{{change_type}} change effective {{effective_date}}.",
    actionUrl: "/employee-stat-card",
    priority: "high",
    channels: allChannels,
  },
  pip_started: {
    label: "PIP initiated",
    category: "performance",
    title: "Performance improvement plan started",
    message: "A performance improvement plan has been created from {{start_date}} to {{end_date}}. Review objectives, support and checkpoints.",
    shortMessage: "PIP active from {{start_date}} to {{end_date}}.",
    actionUrl: "/pip-management",
    priority: "high",
    channels: allChannels,
  },
  training_assigned: {
    label: "Training assigned",
    category: "performance",
    title: "New learning assigned",
    message: "The course '{{course_name}}' has been assigned to you. Please complete it by {{deadline}}.",
    shortMessage: "Training '{{course_name}}' due {{deadline}}.",
    actionUrl: "/lms/my-learning",
    priority: "normal",
    channels: allChannels,
  },
  asset_assigned: {
    label: "Asset assigned",
    category: "announcements",
    title: "Company asset assigned",
    message: "{{asset_name}} ({{asset_code}}) has been assigned to you. Verify its condition and acknowledge receipt.",
    shortMessage: "Asset {{asset_code}} assigned to you.",
    actionUrl: "/assets",
    priority: "normal",
    channels: allChannels,
  },
  helpdesk_update: {
    label: "Helpdesk update",
    category: "alerts",
    title: "Helpdesk ticket {{status}}",
    message: "Ticket {{ticket_number}} is now {{status}}. Latest update: {{update_message}}",
    shortMessage: "Ticket {{ticket_number}} is {{status}}.",
    actionUrl: "/helpdesk",
    priority: "normal",
    channels: allChannels,
  },
  policy_update: {
    label: "Policy update",
    category: "announcements",
    title: "Policy acknowledgement required",
    message: "The {{policy_name}} policy was updated on {{published_date}}. Please review and acknowledge it by {{deadline}}.",
    shortMessage: "{{policy_name}} policy acknowledgement due {{deadline}}.",
    actionUrl: "/letters",
    priority: "high",
    channels: allChannels,
  },
  exit_update: {
    label: "Exit journey update",
    category: "alerts",
    title: "Exit request {{status}}",
    message: "Your exit request is {{status}}. Last working date: {{last_working_date}}. Review clearance and handover actions in HRMS.",
    shortMessage: "Exit request is {{status}}.",
    actionUrl: "/exit-management",
    priority: "high",
    channels: allChannels,
  },
  full_final_ready: {
    label: "Full and final ready",
    category: "payroll",
    title: "Full and final statement ready",
    message: "Your full and final settlement statement is ready for review and acknowledgement in HRMS.",
    shortMessage: "Full and final statement is ready.",
    actionUrl: "/profile",
    priority: "high",
    channels: allChannels,
  },
  birthday_greeting: {
    label: "Birthday greeting",
    category: "announcements",
    title: "Happy birthday, {{employee_name}}!",
    message: "Wishing you a wonderful birthday and a rewarding year ahead from everyone at Mas Callnet India Pvt Ltd.",
    shortMessage: "Happy birthday from Team MAS!",
    actionUrl: "/engagement",
    priority: "low",
    channels: allChannels,
  },
  work_anniversary: {
    label: "Work anniversary",
    category: "announcements",
    title: "Happy work anniversary!",
    message: "Thank you for completing {{years}} year(s) with Mas Callnet India Pvt Ltd. We appreciate your contribution and commitment.",
    shortMessage: "Happy {{years}} year work anniversary!",
    actionUrl: "/engagement",
    priority: "low",
    channels: allChannels,
  },
  // ── People Experience Events ─────────────────────────────────────────────
  people_experience_risk_detected: {
    label: "People experience risk detected",
    category: "alerts",
    title: "Engagement risk detected — action required",
    message: "An engagement risk has been identified for {{employee_name}}. Risk level: {{risk_label}}. Recommended: {{top_action}}.",
    shortMessage: "Engagement risk detected for {{employee_name}}.",
    actionUrl: "/people-experience/command-center",
    priority: "high",
    channels: allChannels,
    critical: true,
  },
  people_experience_action_assigned: {
    label: "People experience action assigned",
    category: "alerts",
    title: "Action assigned to you",
    message: "You have been assigned a people experience action for {{employee_name}}: {{action_type}}. Due: {{due_date}}.",
    shortMessage: "PE action assigned: {{action_type}} for {{employee_name}}.",
    actionUrl: "/people-experience/command-center",
    priority: "normal",
    channels: allChannels,
  },
  people_experience_action_overdue: {
    label: "People experience action overdue",
    category: "alerts",
    title: "People experience action overdue",
    message: "Action '{{action_type}}' for {{employee_name}} is overdue (due: {{due_date}}). Please update or escalate.",
    shortMessage: "PE action overdue: {{action_type}} for {{employee_name}}.",
    actionUrl: "/people-experience/command-center",
    priority: "high",
    channels: allChannels,
  },
  // ── Support / Helpdesk Events ─────────────────────────────────────────────
  support_ticket_created: {
    label: "Support ticket created",
    category: "alerts",
    title: "Support ticket raised: {{ticket_code}}",
    message: "Your support ticket {{ticket_code}} has been raised for {{category}}. Our team will respond within the SLA window.",
    shortMessage: "Ticket {{ticket_code}} raised — {{category}}.",
    actionUrl: "/helpdesk",
    priority: "normal",
    channels: allChannels,
  },
  support_ticket_assigned: {
    label: "Support ticket assigned",
    category: "alerts",
    title: "Support ticket {{ticket_code}} assigned",
    message: "Your ticket {{ticket_code}} has been assigned to {{assigned_name}}. Expected resolution: {{sla_due_at}}.",
    shortMessage: "Ticket {{ticket_code}} assigned to {{assigned_name}}.",
    actionUrl: "/helpdesk",
    priority: "normal",
    channels: allChannels,
  },
  support_ticket_sla_breached: {
    label: "SLA breached",
    category: "alerts",
    title: "SLA breached — ticket {{ticket_code}}",
    message: "Ticket {{ticket_code}} ({{priority}}/{{category}}) has breached its SLA. Immediate attention required.",
    shortMessage: "SLA breached: ticket {{ticket_code}}.",
    actionUrl: "/support/command-center",
    priority: "urgent",
    channels: allChannels,
    critical: true,
  },
  // ── Grievance Events ─────────────────────────────────────────────────────
  grievance_submitted: {
    label: "Grievance submitted",
    category: "alerts",
    title: "Grievance {{grievance_code}} received",
    message: "Your grievance {{grievance_code}} has been received. It will be reviewed with full confidentiality as per policy.",
    shortMessage: "Grievance {{grievance_code}} received.",
    actionUrl: "/helpdesk",
    priority: "high",
    channels: allChannels,
  },
  grievance_escalated: {
    label: "Grievance escalated",
    category: "alerts",
    title: "Grievance {{grievance_code}} escalated",
    message: "Grievance {{grievance_code}} has been escalated to level {{escalation_level}} for further review.",
    shortMessage: "Grievance {{grievance_code}} escalated.",
    actionUrl: "/support/grievance-command-center",
    priority: "urgent",
    channels: allChannels,
    critical: true,
  },
  // ── Engagement / Pulse Events ─────────────────────────────────────────────
  kudos_received: {
    label: "Kudos received",
    category: "announcements",
    title: "You received a kudos from {{sender_name}}!",
    message: "{{sender_name}} sent you a kudos: '{{message}}'. Keep up the great work!",
    shortMessage: "Kudos received from {{sender_name}}.",
    actionUrl: "/engagement",
    priority: "low",
    channels: allChannels,
  },
  survey_reminder: {
    label: "Survey reminder",
    category: "announcements",
    title: "Survey pending: {{survey_name}}",
    message: "Please complete the survey '{{survey_name}}' before {{deadline}}. Your feedback matters.",
    shortMessage: "Survey reminder: {{survey_name}} due {{deadline}}.",
    actionUrl: "/engagement",
    priority: "normal",
    channels: allChannels,
  },
  pulse_reminder: {
    label: "Pulse check reminder",
    category: "announcements",
    title: "How are you feeling this week?",
    message: "Take a moment to share your pulse — it only takes 30 seconds and helps us support you better.",
    shortMessage: "Quick pulse check waiting for you.",
    actionUrl: "/engagement",
    priority: "low",
    channels: allChannels,
  },
  esign_reminder: {
    label: "eSign reminder",
    category: "onboarding",
    title: "Joining document eSign pending",
    message: "Your {{document_name}} requires Aadhaar eSign. Please complete it before {{deadline}}. {{days_pending}} day(s) pending.",
    shortMessage: "{{document_name}} eSign pending ({{days_pending}} days).",
    actionUrl: "/profile",
    priority: "high",
    channels: allChannels,
    critical: true,
  },
  esign_escalation_manager: {
    label: "eSign escalation to manager",
    category: "onboarding",
    title: "Employee eSign overdue — action required",
    message: "{{employee_name}} ({{employee_code}}) has not signed {{document_name}} for {{days_pending}} days. Please follow up.",
    shortMessage: "{{employee_name}} eSign overdue ({{days_pending}} days).",
    actionUrl: "/ats/joining-documents-tracker",
    priority: "urgent",
    channels: allChannels,
    critical: true,
  },
  esign_escalation_hr: {
    label: "eSign escalation to HR",
    category: "onboarding",
    title: "eSign link expiring — employee non-responsive",
    message: "{{employee_name}} ({{employee_code}}) has not completed eSign for {{document_name}}. Link expires on {{deadline}}. Consider manual override or re-issuance.",
    shortMessage: "{{employee_name}} eSign link expiring.",
    actionUrl: "/ats/joining-documents-tracker",
    priority: "urgent",
    channels: allChannels,
    critical: true,
  },
} satisfies Record<string, NotificationEventDefinition>;

export type NotificationEventCode = keyof typeof NOTIFICATION_EVENT_CATALOG;

function render(value: string, data: Record<string, unknown>): string {
  return Handlebars.compile(value)(data).replace(/\s+/g, " ").trim();
}

class NotificationEventService {
  listCatalog() {
    return Object.entries(NOTIFICATION_EVENT_CATALOG).map(([code, event]) => ({
      code,
      label: event.label,
      category: event.category,
      priority: event.priority,
      channels: event.channels,
      action_url: event.actionUrl,
      critical: Boolean("critical" in event && event.critical),
    }));
  }

  async dispatch(input: {
    eventCode: NotificationEventCode;
    recipientEmployeeIds: string[];
    data?: Record<string, unknown>;
    channels?: Channel[];
  }) {
    const definition = NOTIFICATION_EVENT_CATALOG[input.eventCode];
    if (!definition) throw new Error("Unknown notification event");
    const data = input.data ?? {};
    const title = render(definition.title, data);
    const message = render(definition.message, data);
    const shortMessage = render(definition.shortMessage, data);
    const critical = "critical" in definition && Boolean(definition.critical);

    return dispatchService.send({
      template_name: "system_event",
      recipient_employee_ids: input.recipientEmployeeIds,
      // Routine events respect the employee's preferred channel. Critical
      // events fan out across all configured channels unless explicitly scoped.
      channels: input.channels ?? (critical ? definition.channels : undefined),
      is_critical: critical,
      data: {
        ...data,
        notification: {
          title,
          message,
          short_message: shortMessage,
          category: definition.category,
          action_url: definition.actionUrl,
          reference: data.reference ?? null,
        },
      },
      portal: {
        type: definition.category,
        title,
        message,
        action_url: definition.actionUrl,
        priority: definition.priority,
      },
    });
  }
}

export const notificationEventService = new NotificationEventService();
