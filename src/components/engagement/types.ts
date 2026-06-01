export interface ApiResponse<T> {
  success: boolean;
  data: T;
}

export interface BadgeDefinition {
  badge_id: string;
  badge_name: string;
  badge_description: string | null;
  badge_icon: string | null;
  badge_category: string;
  points_value: number;
}

export interface EarnedBadge extends BadgeDefinition {
  earned_id: string;
  earned_at: string;
  reason: string | null;
}

export interface Tier {
  tier_id?: string;
  tier_name: string;
  tier_color?: string | null;
  tier_icon?: string | null;
  min_points?: number;
  max_points?: number | null;
}

export interface PointsTransaction {
  transaction_id: string;
  points_delta: number;
  transaction_type: string;
  description: string | null;
  created_at: string;
}

export interface Kudos {
  kudos_id: string;
  sender_name: string;
  receiver_name: string;
  kudos_title: string | null;
  custom_message: string | null;
  kudos_icon: string | null;
  kudos_category: string | null;
  points_awarded: number;
  sent_at: string;
  is_anonymous: boolean;
}

export interface KudosTemplate {
  kudos_template_id: string;
  kudos_title: string;
  kudos_message_template: string | null;
  kudos_icon: string | null;
  points_value: number;
}

export interface Survey {
  survey_id: string;
  survey_title: string;
  survey_description: string | null;
  survey_type: string;
  points_reward: number;
  is_anonymous: boolean;
  start_date: string | null;
  end_date: string | null;
}

export interface SurveyQuestion {
  question_id: string;
  question_text: string;
  question_type: string;
  is_required: boolean;
  options_json: string[] | string | null;
  scale_min: number | null;
  scale_max: number | null;
}

export interface SurveyDetail extends Survey {
  questions: SurveyQuestion[];
}

export interface LeaderboardEntry {
  employee_id: string;
  employee_name: string;
  total_points: number;
  current_tier: string;
  rank: number;
  badges_earned: number;
}

export interface EngagementSummary {
  employee_id: string;
  total_points: number;
  current_tier: Tier | null;
  points_to_next_tier: number | null;
  progress_percentage: number;
  badges_earned: EarnedBadge[];
  kudos_received: Kudos[];
  surveys_completed: number;
  pulse_checks_submitted: number;
  recent_transactions: PointsTransaction[];
}
