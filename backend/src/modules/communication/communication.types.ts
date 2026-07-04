// ========== Enums ==========
export type TemplateCategory = 'onboarding' | 'payroll' | 'attendance' | 'leave' | 'performance' | 'alerts' | 'announcements' | 'custom';
export type NotificationCategory = Exclude<TemplateCategory, 'custom'>;
export type Channel = 'email' | 'sms' | 'whatsapp';
export type MultiChannel = Channel | 'multi';
export type DispatchStatus = 'queued' | 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'failed';
export type RetentionCategory = 'critical' | 'standard' | 'routine';

// ========== DB row interfaces ==========
export interface CommunicationTemplate {
  id: string; name: string; subject: string | null; body_html: string;
  body_text: string | null; category: TemplateCategory; channel: MultiChannel;
  variables_schema: VariablesSchema | null; is_active: number; is_critical: number;
  created_by: string | null; created_at: string; updated_at: string;
}
export interface VariablesSchema { [category: string]: { [entity: string]: string[] } }

export interface NotificationPreferences {
  id: string; employee_id: string; category: NotificationCategory;
  preferred_channel: Channel; enabled: number; updated_at: string;
}

export interface DispatchLog {
  id: string; template_id: string | null; template_name: string;
  recipient_employee_id: string | null; recipient_contact: string;
  channel: Channel; status: DispatchStatus; subject: string | null;
  body_preview: string | null; sent_at: string | null; delivered_at: string | null;
  opened_at: string | null; clicked_at: string | null; error_message: string | null;
  is_critical: number; retention_category: RetentionCategory;
  retry_count: number; created_at: string;
}

// ========== DTOs ==========
export interface CreateTemplateDTO {
  name: string; subject?: string; body_html: string; body_text?: string;
  category: TemplateCategory; channel: MultiChannel;
  variables_schema?: VariablesSchema; is_critical?: boolean; created_by: string;
}
export interface UpdateTemplateDTO {
  name?: string; subject?: string; body_html?: string; body_text?: string; is_active?: boolean;
}
export interface TemplateFilters {
  category?: TemplateCategory; channel?: MultiChannel; is_active?: boolean; search?: string;
}
export interface SendMessageDTO {
  template_id?: string; template_name?: string;
  recipient_employee_ids: string[]; data: Record<string, unknown>;
  channel?: Channel; channels?: Channel[]; is_critical?: boolean;
  portal?: PortalNotificationInput | false;
}
export interface BulkSendDTO {
  template_id?: string; template_name?: string;
  recipient_filter: RecipientFilter; data: Record<string, unknown>; channel?: Channel; channels?: Channel[];
  portal?: PortalNotificationInput | false;
}
export interface PortalNotificationInput {
  type?: string; title?: string; message?: string;
  action_url?: string; entity_type?: string; entity_id?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
}
export interface RecipientFilter {
  department?: string; process_id?: string; designation?: string; status?: string;
}
export interface DispatchLogFilters {
  employee_id?: string; channel?: Channel; status?: DispatchStatus;
  date_from?: string; date_to?: string; page?: number; limit?: number;
}
export interface UpdatePreferencesDTO {
  category: NotificationCategory; preferred_channel: Channel; enabled: boolean;
}
export interface RenderTemplateDTO {
  template_id?: string; template_name?: string; data: Record<string, unknown>; channel?: Channel;
}

// ========== Provider types ==========
export interface ProviderResponse { success: boolean; message_id?: string; error?: string; }
export interface DeliveryStatus { status: DispatchStatus; delivered_at?: string; error?: string; }

// ========== Response types ==========
export interface DispatchResult { queued: number; failed: number; dispatch_ids: string[]; portal_created?: number; }
export interface DispatchStats {
  total_sent_today: number; delivery_rate: number; open_rate: number; failed_count: number;
  by_channel: { email: number; sms: number; whatsapp: number };
}
export interface PaginatedDispatchLogs { logs: DispatchLog[]; total: number; page: number; limit: number; }

// ========== Provider config types ==========

export type EmailProviderType = 'nodemailer' | 'sendgrid' | 'mailgun' | 'local-email-tool';
export type SMSProviderType   = 'twilio' | 'msg91' | 'local-sms-tool';
export type WAProviderType    = 'twilio' | 'meta' | 'local-whatsapp-tool';
export type AnyProviderType   = EmailProviderType | SMSProviderType | WAProviderType;

export interface EmailConfig {
  smtp_host?: string;
  smtp_port?: number;
  smtp_secure?: boolean;
  smtp_from?: string;
  smtp_from_name?: string;
  sendgrid_from?: string;
  sendgrid_from_name?: string;
  mailgun_domain?: string;
  mailgun_region?: 'us' | 'eu';
  mailgun_from?: string;
  local_api_url?: string;
}

export interface SMSConfig {
  twilio_messaging_service_sid?: string;
  msg91_sender_id?: string;
  msg91_template_id?: string;
  local_api_url?: string;
  local_sender_id?: string;
}

export interface WAConfig {
  twilio_whatsapp_number?: string;
  meta_phone_number_id?: string;
  meta_waba_id?: string;
  local_api_url?: string;
  local_business_number?: string;
}

export interface EmailSecrets {
  smtp_user?: string;
  smtp_pass?: string;
  sendgrid_api_key?: string;
  mailgun_api_key?: string;
  local_api_key?: string;
}

export interface SMSSecrets {
  twilio_account_sid?: string;
  twilio_auth_token?: string;
  msg91_auth_key?: string;
  local_api_key?: string;
}

export interface WASecrets {
  twilio_account_sid?: string;
  twilio_auth_token?: string;
  meta_access_token?: string;
  local_api_key?: string;
}

export interface ProviderConfig {
  id: string;
  channel: Channel;
  provider_type: AnyProviderType;
  config_json: EmailConfig | SMSConfig | WAConfig;
  is_enabled: boolean;
  test_ok: boolean | null;
  test_error: string | null;
  test_at: string | null;
}

export interface SaveProviderConfigDTO {
  provider_type: AnyProviderType;
  config: EmailConfig | SMSConfig | WAConfig;
  secrets: EmailSecrets | SMSSecrets | WASecrets;
}

export interface TestResult {
  success: boolean;
  error?: string;
  provider: string;
  channel: Channel;
}
