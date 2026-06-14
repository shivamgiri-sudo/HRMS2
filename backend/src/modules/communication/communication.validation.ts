import { z } from 'zod';

export const TemplateCategorySchema = z.enum(['onboarding','payroll','attendance','leave','performance','alerts','announcements','custom']);
export const NotificationCategorySchema = z.enum(['onboarding','payroll','attendance','leave','performance','alerts','announcements']);
export const ChannelSchema = z.enum(['email','sms','whatsapp']);
export const MultiChannelSchema = z.enum(['email','sms','whatsapp','multi']);
export const DispatchStatusSchema = z.enum(['queued','sent','delivered','opened','clicked','bounced','failed']);
const PortalNotificationSchema = z.object({
  type: z.string().max(64).optional(),
  title: z.string().max(255).optional(),
  message: z.string().max(4000).optional(),
  action_url: z.string().max(512).optional(),
  entity_type: z.string().max(64).optional(),
  entity_id: z.string().uuid().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
});

export const CreateTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  subject: z.string().max(200).optional(),
  body_html: z.string().min(1),
  body_text: z.string().optional(),
  category: TemplateCategorySchema,
  channel: MultiChannelSchema,
  variables_schema: z.record(z.any()).optional(),
  is_critical: z.boolean().optional(),
  created_by: z.string().uuid(),
});

export const UpdateTemplateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  subject: z.string().max(200).optional(),
  body_html: z.string().min(1).optional(),
  body_text: z.string().optional(),
  is_active: z.boolean().optional(),
});

export const TemplateFiltersSchema = z.object({
  category: TemplateCategorySchema.optional(),
  channel: MultiChannelSchema.optional(),
  is_active: z.coerce.boolean().optional(),
  search: z.string().optional(),
});

export const SendMessageSchema = z.object({
  template_id: z.string().uuid().optional(),
  template_name: z.string().optional(),
  recipient_employee_ids: z.array(z.string().uuid()).min(1),
  data: z.record(z.any()),
  channel: ChannelSchema.optional(),
  channels: z.array(ChannelSchema).min(1).max(3).optional(),
  is_critical: z.boolean().optional(),
  portal: z.union([z.literal(false), PortalNotificationSchema]).optional(),
}).refine(d => d.template_id || d.template_name, { message: 'Either template_id or template_name required' });

export const BulkSendSchema = z.object({
  template_id: z.string().uuid().optional(),
  template_name: z.string().optional(),
  recipient_filter: z.object({
    department: z.string().optional(),
    process_id: z.string().uuid().optional(),
    designation: z.string().optional(),
    status: z.string().optional(),
  }),
  data: z.record(z.any()),
  channel: ChannelSchema.optional(),
  channels: z.array(ChannelSchema).min(1).max(3).optional(),
  portal: z.union([z.literal(false), PortalNotificationSchema]).optional(),
}).refine(d => d.template_id || d.template_name, { message: 'Either template_id or template_name required' });

export const DispatchLogFiltersSchema = z.object({
  employee_id: z.string().uuid().optional(),
  channel: ChannelSchema.optional(),
  status: DispatchStatusSchema.optional(),
  date_from: z.string().date().optional(),
  date_to: z.string().date().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export const UpdatePreferencesSchema = z.object({
  category: NotificationCategorySchema,
  preferred_channel: ChannelSchema,
  enabled: z.boolean(),
});

export const RenderTemplateSchema = z.object({
  template_id: z.string().uuid().optional(),
  template_name: z.string().optional(),
  data: z.record(z.any()),
}).refine(d => d.template_id || d.template_name, { message: 'Either template_id or template_name required' });

// ── Provider Config Validation ────────────────────────────────────────────

export const ChannelParamSchema = z.enum(['email', 'sms', 'whatsapp']);

export const SaveEmailConfigSchema = z.object({
  provider_type: z.enum(['nodemailer', 'sendgrid', 'mailgun', 'local-email-tool']),
  config: z.object({
    smtp_host:          z.string().optional(),
    smtp_port:          z.number().int().min(1).max(65535).optional(),
    smtp_secure:        z.boolean().optional(),
    smtp_from:          z.string().email().optional(),
    smtp_from_name:     z.string().optional(),
    sendgrid_from:      z.string().email().optional(),
    sendgrid_from_name: z.string().optional(),
    mailgun_domain:     z.string().optional(),
    mailgun_region:     z.enum(['us', 'eu']).optional(),
    mailgun_from:       z.string().email().optional(),
    local_api_url:      z.string().url().optional().or(z.literal('')),
  }),
  secrets: z.object({
    smtp_user:        z.string().optional(),
    smtp_pass:        z.string().optional(),
    sendgrid_api_key: z.string().optional(),
    mailgun_api_key:  z.string().optional(),
    local_api_key:    z.string().optional(),
  }),
});

export const SaveSMSConfigSchema = z.object({
  provider_type: z.enum(['twilio', 'msg91', 'local-sms-tool']),
  config: z.object({
    twilio_messaging_service_sid: z.string().optional(),
    msg91_sender_id:   z.string().max(6).optional(),
    msg91_template_id: z.string().optional(),
    local_api_url:     z.string().url().optional().or(z.literal('')),
    local_sender_id:   z.string().optional(),
  }),
  secrets: z.object({
    twilio_account_sid: z.string().optional(),
    twilio_auth_token:  z.string().optional(),
    msg91_auth_key:     z.string().optional(),
    local_api_key:      z.string().optional(),
  }),
});

export const SaveWAConfigSchema = z.object({
  provider_type: z.enum(['twilio', 'meta', 'local-whatsapp-tool']),
  config: z.object({
    twilio_whatsapp_number: z.string().optional(),
    meta_phone_number_id:   z.string().optional(),
    meta_waba_id:           z.string().optional(),
    local_api_url:          z.string().url().optional().or(z.literal('')),
    local_business_number:  z.string().optional(),
  }),
  secrets: z.object({
    twilio_account_sid: z.string().optional(),
    twilio_auth_token:  z.string().optional(),
    meta_access_token:  z.string().optional(),
    local_api_key:      z.string().optional(),
  }),
});
