/**
 * AI Provider Type Definitions
 * PeopleOS AI Enhancement Phase 1
 */

export interface AiProvider {
  key: string;
  displayName: string;
  supportsChat: boolean;
  supportsJson: boolean;
  supportsStreaming: boolean;
  supportsEmbeddings?: boolean;
  testConnection(config: SafeAiProviderConfig): Promise<AiProviderTestResult>;
  generateText(request: AiGenerateRequest): Promise<AiGenerateResponse>;
  generateJson?<T>(request: AiGenerateRequest): Promise<T>;
}

export interface AiGenerateRequest {
  userId: string;
  roleKeys: string[];
  providerKey: string;
  model?: string;
  apiKey?: string;
  systemInstruction?: string;
  userQuestion: string;
  sanitizedContext: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
  responseFormat?: 'text' | 'json';
  safetyLevel?: 'strict' | 'moderate' | 'permissive';
  requestSource: string;
  entityType?: string;
  entityId?: string;
}

export interface AiGenerateResponse {
  answer: string;
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  safetyBlocked: boolean;
  fallbackUsed: boolean;
  generatedAt: string;
  sourceContexts: string[];
  dataConfidence?: Record<string, number>;
  insights?: AiInsight[];
  actions?: AiAction[];
}

export interface AiInsight {
  key: string;
  label: string;
  count?: number;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  value?: string | number;
}

export interface AiAction {
  key: string;
  label: string;
  url: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

export interface SafeAiProviderConfig {
  id?: string;
  providerKey: string;
  providerName: string;
  activeStatus?: 'active' | 'inactive';
  isDefault?: boolean;
  modelName?: string;
  baseUrl?: string;
  apiKey?: string;
  timeout?: number;
  safetyConfig?: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
  dailyRequestLimit?: number;
  monthlyRequestLimit?: number;
  dailyTokenLimit?: number;
  monthlyTokenLimit?: number;
}

export interface AiProviderTestResult {
  success: boolean;
  latencyMs: number;
  model: string;
  error?: string;
}

export interface AiProviderConfigRow {
  id: string;
  provider_key: string;
  provider_name: string;
  active_status: 'active' | 'inactive';
  is_default: boolean;
  model_name?: string;
  base_url?: string;
  api_key_secret_ref?: string;
  encrypted_api_key?: string;
  config_json?: string;
  safety_config_json?: string;
  daily_request_limit?: number;
  monthly_request_limit?: number;
  daily_token_limit?: number;
  monthly_token_limit?: number;
  timeout_ms?: number;
  fallback_provider_key?: string;
  created_by?: string;
  updated_by?: string;
  created_at: Date;
  updated_at: Date;
}

export interface AiUsageLogRow {
  id: number;
  provider_key: string;
  model_name?: string;
  user_id: string;
  role_keys_json?: string;
  request_source?: string;
  entity_type?: string;
  entity_id?: string;
  input_token_count?: number;
  output_token_count?: number;
  latency_ms?: number;
  success: boolean;
  fallback_used: boolean;
  safety_blocked: boolean;
  error_message?: string;
  created_at: Date;
}

export interface AiPromptAuditRow {
  id: number;
  user_id: string;
  provider_key: string;
  model_name?: string;
  request_source?: string;
  question_hash: string;
  sanitized_context_hash: string;
  pii_redaction_applied: boolean;
  sensitive_fields_removed_json?: string;
  response_summary?: string;
  created_at: Date;
}

export interface AiFeedbackRow {
  id: number;
  user_id: string;
  provider_key?: string;
  model_name?: string;
  request_id?: number;
  rating: 'helpful' | 'not_helpful' | 'incorrect' | 'unsafe';
  feedback_text?: string;
  created_at: Date;
}

export type PiiCategory =
  | 'payroll_sensitive'
  | 'statutory_sensitive'
  | 'personal_identity'
  | 'bank_sensitive'
  | 'document_sensitive'
  | 'medical_sensitive'
  | 'client_confidential'
  | 'candidate_sensitive'
  | 'employee_sensitive';

export interface PiiDetectionResult {
  hasPii: boolean;
  categories: PiiCategory[];
  redactedValue: string;
  sensitiveFields: string[];
}

export interface SanitizedContext {
  [key: string]: unknown;
  data_confidence?: Record<string, number>;
  last_refreshed_at?: string;
  safe_mode: boolean;
}
