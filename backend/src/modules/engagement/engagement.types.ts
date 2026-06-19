// =====================================================
// Engagement & Gamification Module Types
// File: engagement.types.ts
// Description: Complete type definitions for badges, points, tiers, kudos, surveys, pulse checks
// =====================================================

// =====================================================
// ENUMS
// =====================================================

export type BadgeCategory = 'performance' | 'activity' | 'tenure' | 'social';

export type TransactionType =
  | 'badge_earned'
  | 'kudos_sent'
  | 'kudos_received'
  | 'survey_completed'
  | 'pulse_completed'
  | 'manual_adjustment'
  | 'tier_bonus'
  | 'activity_bonus';

export type SurveyType = 'engagement' | 'feedback' | 'pulse' | 'custom';

export type QuestionType =
  | 'text'
  | 'rating'
  | 'multiple_choice'
  | 'single_choice'
  | 'yes_no'
  | 'scale';

export type WorkloadPerception =
  | 'too_light'
  | 'manageable'
  | 'heavy'
  | 'overwhelming';

// =====================================================
// DATABASE TABLE INTERFACES
// =====================================================

// 1. Badge Master
export interface BadgeMaster {
  badge_id: string;
  badge_name: string;
  badge_description: string | null;
  badge_icon: string | null;
  badge_category: BadgeCategory;
  points_value: number;
  criteria_json: BadgeCriteria | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// 2. Employee Badge Earned
export interface EmployeeBadgeEarned {
  earned_id: string;
  employee_id: string;
  badge_id: string;
  earned_at: string;
  reason: string | null;
  awarded_by: string | null;
  metadata_json: Record<string, unknown> | null;
}

// 3. Gamification Points Ledger
export interface GamificationPointsLedger {
  transaction_id: string;
  employee_id: string;
  points_delta: number;
  transaction_type: TransactionType;
  reference_id: string | null;
  description: string | null;
  balance_after: number;
  created_at: string;
}

// 4. Gamification Tier Master
export interface GamificationTierMaster {
  tier_id: string;
  tier_name: string;
  tier_level: number;
  min_points: number;
  max_points: number | null;
  tier_color: string | null;
  tier_icon: string | null;
  benefits_json: TierBenefits | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// 5. Employee Tier Status
export interface EmployeeTierStatus {
  status_id: string;
  employee_id: string;
  current_tier_id: string;
  total_points: number;
  points_to_next_tier: number | null;
  tier_achieved_at: string;
  last_updated: string;
}

// 6. Kudos Master
export interface KudosMaster {
  kudos_template_id: string;
  kudos_title: string;
  kudos_message_template: string | null;
  kudos_icon: string | null;
  kudos_category: string | null;
  points_value: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// 7. Kudos Transaction
export interface KudosTransaction {
  kudos_id: string;
  sender_id: string;
  receiver_id: string;
  kudos_template_id: string | null;
  custom_message: string | null;
  points_awarded: number;
  sent_at: string;
  is_anonymous: boolean;
}

// 8. Survey Master
export interface SurveyMaster {
  survey_id: string;
  survey_title: string;
  survey_description: string | null;
  survey_type: SurveyType;
  start_date: string | null;
  end_date: string | null;
  is_anonymous: boolean;
  is_active: boolean;
  points_reward: number;
  target_audience_json: TargetAudience | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// 9. Survey Question
export interface SurveyQuestion {
  question_id: string;
  survey_id: string;
  question_text: string;
  question_type: QuestionType;
  question_order: number;
  is_required: boolean;
  options_json: string[] | null;
  scale_min: number | null;
  scale_max: number | null;
  scale_labels_json: Record<string, string> | null;
}

// 10. Survey Response
export interface SurveyResponse {
  response_id: string;
  survey_id: string;
  question_id: string;
  employee_id: string | null;
  response_text: string | null;
  response_value: number | null;
  response_choices_json: string[] | null;
  submitted_at: string;
}

// 11. Pulse Check
export interface PulseCheck {
  pulse_id: string;
  employee_id: string;
  mood_rating: number;
  energy_level: number | null;
  stress_level: number | null;
  workload_perception: WorkloadPerception | null;
  feedback_text: string | null;
  submitted_at: string;
  week_start_date: string;
}

// =====================================================
// JSON FIELD TYPES
// =====================================================

export interface BadgeCriteria {
  type: string;
  threshold: string;
  criteria: string;
  duration?: string;
}

export interface TierBenefits {
  perks: string[];
}

export interface TargetAudience {
  all_employees?: boolean;
  department_ids?: string[];
  process_ids?: string[];
  branch_ids?: string[];
  employee_ids?: string[];
}

// =====================================================
// DTO TYPES (API Requests/Responses)
// =====================================================

// Badge DTOs
export interface CreateBadgeDTO {
  badge_name: string;
  badge_description?: string;
  badge_icon?: string;
  badge_category: BadgeCategory;
  points_value: number;
  criteria_json?: BadgeCriteria;
  is_active?: boolean;
}

export interface UpdateBadgeDTO {
  badge_name?: string;
  badge_description?: string;
  badge_icon?: string;
  badge_category?: BadgeCategory;
  points_value?: number;
  criteria_json?: BadgeCriteria;
  is_active?: boolean;
}

export interface AwardBadgeDTO {
  employee_id: string;
  badge_id: string;
  reason?: string;
  awarded_by?: string;
  metadata_json?: Record<string, unknown>;
}

// Points DTOs
export interface AddPointsDTO {
  employee_id: string;
  points_delta: number;
  transaction_type: TransactionType;
  reference_id?: string;
  description?: string;
}

export interface PointsBalanceResponse {
  employee_id: string;
  total_points: number;
  current_tier: GamificationTierMaster;
  points_to_next_tier: number | null;
  recent_transactions: GamificationPointsLedger[];
}

// Tier DTOs
export interface CreateTierDTO {
  tier_name: string;
  tier_level: number;
  min_points: number;
  max_points?: number;
  tier_color?: string;
  tier_icon?: string;
  benefits_json?: TierBenefits;
  is_active?: boolean;
}

export interface UpdateTierDTO {
  tier_name?: string;
  tier_level?: number;
  min_points?: number;
  max_points?: number;
  tier_color?: string;
  tier_icon?: string;
  benefits_json?: TierBenefits;
  is_active?: boolean;
}

// Kudos DTOs
export interface SendKudosDTO {
  sender_id: string;
  receiver_id: string;
  kudos_template_id?: string;
  custom_message?: string;
  points_awarded?: number;
  is_anonymous?: boolean;
}

export interface CreateKudosTemplateDTO {
  kudos_title: string;
  kudos_message_template?: string;
  kudos_icon?: string;
  kudos_category?: string;
  points_value?: number;
  is_active?: boolean;
}

export interface KudosWithDetailsResponse extends KudosTransaction {
  sender_name?: string;
  receiver_name: string;
  sender_code?: string;
  receiver_code: string;
  sender_full_name?: string;
  receiver_full_name: string;
  template?: KudosMaster;
}

// Survey DTOs
export interface CreateSurveyDTO {
  survey_title: string;
  survey_description?: string;
  survey_type: SurveyType;
  start_date?: string;
  end_date?: string;
  is_anonymous?: boolean;
  is_active?: boolean;
  points_reward?: number;
  target_audience_json?: TargetAudience;
  created_by?: string;
  questions: CreateSurveyQuestionDTO[];
}

export interface CreateSurveyQuestionDTO {
  question_text: string;
  question_type: QuestionType;
  question_order: number;
  is_required?: boolean;
  options_json?: string[];
  scale_min?: number;
  scale_max?: number;
  scale_labels_json?: Record<string, string>;
}

export interface SubmitSurveyResponseDTO {
  survey_id: string;
  employee_id?: string;
  responses: SubmitQuestionResponseDTO[];
}

export interface SubmitQuestionResponseDTO {
  question_id: string;
  response_text?: string;
  response_value?: number;
  response_choices_json?: string[];
}

export interface SurveyWithQuestionsResponse extends SurveyMaster {
  questions: SurveyQuestion[];
}

export interface SurveyResultsResponse {
  survey: SurveyMaster;
  total_responses: number;
  completion_rate: number;
  question_results: QuestionResultSummary[];
}

export interface QuestionResultSummary {
  question: SurveyQuestion;
  total_responses: number;
  average_value?: number;
  response_distribution?: Record<string, number>;
  text_responses?: string[];
}

// Pulse Check DTOs
export interface SubmitPulseCheckDTO {
  employee_id: string;
  mood_rating: number;
  energy_level?: number;
  stress_level?: number;
  workload_perception?: WorkloadPerception;
  feedback_text?: string;
  week_start_date: string;
}

export interface PulseCheckTrendsResponse {
  employee_id: string;
  period: string;
  average_mood: number;
  average_energy: number;
  average_stress: number;
  checks: PulseCheck[];
}

// =====================================================
// FILTER & QUERY TYPES
// =====================================================

export interface BadgeFilters {
  badge_category?: BadgeCategory;
  is_active?: boolean;
  search?: string;
}

export interface PointsLedgerFilters {
  employee_id?: string;
  transaction_type?: TransactionType;
  date_from?: string;
  date_to?: string;
}

export interface KudosFilters {
  sender_id?: string;
  receiver_id?: string;
  date_from?: string;
  date_to?: string;
  is_anonymous?: boolean;
}

export interface SurveyFilters {
  survey_type?: SurveyType;
  is_active?: boolean;
  is_anonymous?: boolean;
  date_from?: string;
  date_to?: string;
}

export interface PulseCheckFilters {
  employee_id?: string;
  week_start_date?: string;
  date_from?: string;
  date_to?: string;
  mood_rating_min?: number;
  mood_rating_max?: number;
}

// =====================================================
// UTILITY TYPES
// =====================================================

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface LeaderboardEntry {
  employee_id: string;
  employee_name: string;
  total_points: number;
  current_tier: string;
  rank: number;
  badges_earned: number;
}

export interface EmployeeEngagementSummary {
  employee_id: string;
  total_points: number;
  current_tier: GamificationTierMaster;
  points_to_next_tier: number | null;
  badges_earned: EmployeeBadgeEarned[];
  kudos_received_count: number;
  kudos_sent_count: number;
  surveys_completed: number;
  pulse_checks_submitted: number;
  recent_activities: ActivityLogEntry[];
}

export interface ActivityLogEntry {
  activity_type: string;
  activity_description: string;
  points_earned: number;
  timestamp: string;
}
