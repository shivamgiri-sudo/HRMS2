import { z } from 'zod';

export const TemplateCategorySchema = z.enum(['onboarding','payroll','attendance','leave','performance','alerts','announcements','custom']);
export const NotificationCategorySchema = z.enum(['onboarding','payroll','attendance','leave','performance','alerts','announcements']);
export const ChannelSchema = z.enum(['email','sms','whatsapp']);
export const MultiChannelSchema = z.enum(['email','sms','whatsapp','multi']);
export const DispatchStatusSchema = z.enum(['queued','sent','delivered','opened','clicked','bounced','failed']);

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
  is_critical: z.boolean().optional(),
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
