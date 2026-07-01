// =====================================================
// Engagement & Gamification Module Validation Schemas
// File: engagement.validation.ts
// Description: Zod validation schemas for all engagement DTOs
// =====================================================

import { z } from 'zod';

// =====================================================
// ENUM SCHEMAS
// =====================================================

export const BadgeCategorySchema = z.enum([
  'performance',
  'activity',
  'tenure',
  'social',
]);

export const TransactionTypeSchema = z.enum([
  'badge_earned',
  'kudos_sent',
  'kudos_received',
  'survey_completed',
  'pulse_completed',
  'manual_adjustment',
  'tier_bonus',
  'activity_bonus',
]);

export const SurveyTypeSchema = z.enum([
  'engagement',
  'feedback',
  'pulse',
  'custom',
]);

export const QuestionTypeSchema = z.enum([
  'text',
  'rating',
  'multiple_choice',
  'single_choice',
  'yes_no',
  'scale',
]);

export const WorkloadPerceptionSchema = z.enum([
  'too_light',
  'manageable',
  'heavy',
  'overwhelming',
]);

// =====================================================
// JSON FIELD SCHEMAS
// =====================================================

export const BadgeCriteriaSchema = z.object({
  type: z.string(),
  threshold: z.string(),
  criteria: z.string(),
  duration: z.string().optional(),
});

export const TierBenefitsSchema = z.object({
  perks: z.array(z.string()),
});

export const TargetAudienceSchema = z.object({
  all_employees: z.boolean().optional(),
  department_ids: z.array(z.string().uuid()).optional(),
  process_ids: z.array(z.string().uuid()).optional(),
  branch_ids: z.array(z.string().uuid()).optional(),
  employee_ids: z.array(z.string().uuid()).optional(),
});

// =====================================================
// BADGE VALIDATION SCHEMAS
// =====================================================

export const CreateBadgeSchema = z.object({
  badge_name: z.string().min(1, 'Badge name is required').max(100),
  badge_description: z.string().max(500).optional(),
  badge_icon: z.string().url().optional(),
  badge_category: BadgeCategorySchema,
  points_value: z.number().int().min(0),
  criteria_json: BadgeCriteriaSchema.optional(),
  is_active: z.boolean().optional().default(true),
});

export const UpdateBadgeSchema = z.object({
  badge_name: z.string().min(1).max(100).optional(),
  badge_description: z.string().max(500).optional(),
  badge_icon: z.string().url().optional(),
  badge_category: BadgeCategorySchema.optional(),
  points_value: z.number().int().min(0).optional(),
  criteria_json: BadgeCriteriaSchema.optional(),
  is_active: z.boolean().optional(),
});

export const AwardBadgeSchema = z.object({
  employee_id: z.string().uuid('Invalid employee ID'),
  badge_id: z.string().uuid('Invalid badge ID'),
  reason: z.string().max(500).optional(),
  awarded_by: z.string().uuid().optional(),
  metadata_json: z.record(z.any()).optional(),
});

// =====================================================
// POINTS VALIDATION SCHEMAS
// =====================================================

export const AddPointsSchema = z.object({
  employee_id: z.string().uuid('Invalid employee ID'),
  points_delta: z.number().int(),
  transaction_type: TransactionTypeSchema,
  reference_id: z.string().uuid().optional(),
  description: z.string().max(500).optional(),
});

// =====================================================
// TIER VALIDATION SCHEMAS
// =====================================================

export const CreateTierSchema = z.object({
  tier_name: z.string().min(1, 'Tier name is required').max(100),
  tier_level: z.number().int().min(1),
  min_points: z.number().int().min(0),
  max_points: z.number().int().min(0).optional(),
  tier_color: z.string().max(50).optional(),
  tier_icon: z.string().url().optional(),
  benefits_json: TierBenefitsSchema.optional(),
  is_active: z.boolean().optional().default(true),
}).refine(
  (data) => {
    if (data.max_points !== undefined && data.max_points !== null) {
      return data.max_points >= data.min_points;
    }
    return true;
  },
  {
    message: 'max_points must be greater than or equal to min_points',
    path: ['max_points'],
  }
);

export const UpdateTierSchema = z.object({
  tier_name: z.string().min(1).max(100).optional(),
  tier_level: z.number().int().min(1).optional(),
  min_points: z.number().int().min(0).optional(),
  max_points: z.number().int().min(0).optional(),
  tier_color: z.string().max(50).optional(),
  tier_icon: z.string().url().optional(),
  benefits_json: TierBenefitsSchema.optional(),
  is_active: z.boolean().optional(),
}).refine(
  (data) => {
    if (
      data.max_points !== undefined &&
      data.max_points !== null &&
      data.min_points !== undefined
    ) {
      return data.max_points >= data.min_points;
    }
    return true;
  },
  {
    message: 'max_points must be greater than or equal to min_points',
    path: ['max_points'],
  }
);

// =====================================================
// KUDOS VALIDATION SCHEMAS
// =====================================================

export const SendKudosSchema = z.object({
  sender_id: z.string().uuid('Invalid sender ID'),
  receiver_id: z.string().uuid('Invalid receiver ID'),
  kudos_template_id: z.string().uuid().optional(),
  custom_message: z.string().max(1000).optional(),
  points_awarded: z.number().int().min(0).optional(),
  is_anonymous: z.boolean().optional().default(false),
}).refine(
  (data) => data.sender_id !== data.receiver_id,
  {
    message: 'Sender and receiver cannot be the same',
    path: ['receiver_id'],
  }
);

export const CreateKudosTemplateSchema = z.object({
  kudos_title: z.string().min(1, 'Kudos title is required').max(100),
  kudos_message_template: z.string().max(1000).optional(),
  kudos_icon: z.string().url().optional(),
  kudos_category: z.string().max(50).optional(),
  points_value: z.number().int().min(0).optional().default(10),
  is_active: z.boolean().optional().default(true),
});

// =====================================================
// SURVEY VALIDATION SCHEMAS
// =====================================================

export const CreateSurveyQuestionSchema = z.object({
  question_text: z.string().min(1, 'Question text is required').max(1000),
  question_type: QuestionTypeSchema,
  question_order: z.number().int().min(1),
  is_required: z.boolean().optional().default(false),
  options_json: z.array(z.string()).optional(),
  scale_min: z.number().int().optional(),
  scale_max: z.number().int().optional(),
  scale_labels_json: z.record(z.string()).optional(),
}).refine(
  (data) => {
    if (
      ['multiple_choice', 'single_choice'].includes(data.question_type) &&
      (!data.options_json || data.options_json.length < 2)
    ) {
      return false;
    }
    return true;
  },
  {
    message: 'Choice questions must have at least 2 options',
    path: ['options_json'],
  }
).refine(
  (data) => {
    if (
      ['scale', 'rating'].includes(data.question_type) &&
      (data.scale_min === undefined || data.scale_max === undefined)
    ) {
      return false;
    }
    return true;
  },
  {
    message: 'Scale/rating questions must have scale_min and scale_max',
    path: ['scale_min'],
  }
).refine(
  (data) => {
    if (
      data.scale_min !== undefined &&
      data.scale_max !== undefined &&
      data.scale_max <= data.scale_min
    ) {
      return false;
    }
    return true;
  },
  {
    message: 'scale_max must be greater than scale_min',
    path: ['scale_max'],
  }
);

export const CreateSurveySchema = z.object({
  survey_title: z.string().min(1, 'Survey title is required').max(200),
  survey_description: z.string().max(2000).optional(),
  survey_type: SurveyTypeSchema,
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
  is_anonymous: z.boolean().optional().default(false),
  is_active: z.boolean().optional().default(true),
  points_reward: z.number().int().min(0).optional().default(0),
  target_audience_json: TargetAudienceSchema.optional(),
  created_by: z.string().uuid().optional(),
  questions: z.array(CreateSurveyQuestionSchema).min(1, 'At least one question is required'),
}).refine(
  (data) => {
    if (
      data.start_date &&
      data.end_date &&
      new Date(data.end_date) <= new Date(data.start_date)
    ) {
      return false;
    }
    return true;
  },
  {
    message: 'end_date must be after start_date',
    path: ['end_date'],
  }
);

export const SubmitQuestionResponseSchema = z.object({
  question_id: z.string().uuid('Invalid question ID'),
  response_text: z.string().max(5000).optional(),
  response_value: z.number().optional(),
  response_choices_json: z.array(z.string()).optional(),
});

export const SubmitSurveyResponseSchema = z.object({
  survey_id: z.string().uuid('Invalid survey ID'),
  employee_id: z.string().uuid('Invalid employee ID').optional(),
  responses: z.array(SubmitQuestionResponseSchema).min(1, 'At least one response is required'),
});

// =====================================================
// PULSE CHECK VALIDATION SCHEMAS
// =====================================================

export const SubmitPulseCheckSchema = z.object({
  employee_id: z.string().uuid('Invalid employee ID'),
  mood_rating: z.number().int().min(1).max(5),
  energy_level: z.number().int().min(1).max(5).optional(),
  stress_level: z.number().int().min(1).max(5).optional(),
  workload_perception: WorkloadPerceptionSchema.optional(),
  feedback_text: z.string().max(2000).optional(),
  week_start_date: z.string().regex(
    /^\d{4}-\d{2}-\d{2}$/,
    'week_start_date must be in YYYY-MM-DD format'
  ),
});

// =====================================================
// FILTER VALIDATION SCHEMAS
// =====================================================

export const BadgeFiltersSchema = z.object({
  badge_category: BadgeCategorySchema.optional(),
  is_active: z.boolean().optional(),
  search: z.string().max(200).optional(),
});

export const PointsLedgerFiltersSchema = z.object({
  employee_id: z.string().uuid().optional(),
  transaction_type: TransactionTypeSchema.optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
}).refine(
  (data) => {
    if (
      data.date_from &&
      data.date_to &&
      new Date(data.date_to) <= new Date(data.date_from)
    ) {
      return false;
    }
    return true;
  },
  {
    message: 'date_to must be after date_from',
    path: ['date_to'],
  }
);

export const KudosFiltersSchema = z.object({
  sender_id: z.string().uuid().optional(),
  receiver_id: z.string().uuid().optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
  is_anonymous: z.boolean().optional(),
}).refine(
  (data) => {
    if (
      data.date_from &&
      data.date_to &&
      new Date(data.date_to) <= new Date(data.date_from)
    ) {
      return false;
    }
    return true;
  },
  {
    message: 'date_to must be after date_from',
    path: ['date_to'],
  }
);

export const SurveyFiltersSchema = z.object({
  survey_type: SurveyTypeSchema.optional(),
  is_active: z.boolean().optional(),
  is_anonymous: z.boolean().optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
}).refine(
  (data) => {
    if (
      data.date_from &&
      data.date_to &&
      new Date(data.date_to) <= new Date(data.date_from)
    ) {
      return false;
    }
    return true;
  },
  {
    message: 'date_to must be after date_from',
    path: ['date_to'],
  }
);

export const PulseCheckFiltersSchema = z.object({
  employee_id: z.string().uuid().optional(),
  week_start_date: z.string().regex(
    /^\d{4}-\d{2}-\d{2}$/,
    'week_start_date must be in YYYY-MM-DD format'
  ).optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
  mood_rating_min: z.number().int().min(1).max(5).optional(),
  mood_rating_max: z.number().int().min(1).max(5).optional(),
}).refine(
  (data) => {
    if (
      data.date_from &&
      data.date_to &&
      new Date(data.date_to) <= new Date(data.date_from)
    ) {
      return false;
    }
    return true;
  },
  {
    message: 'date_to must be after date_from',
    path: ['date_to'],
  }
).refine(
  (data) => {
    if (
      data.mood_rating_min !== undefined &&
      data.mood_rating_max !== undefined &&
      data.mood_rating_max < data.mood_rating_min
    ) {
      return false;
    }
    return true;
  },
  {
    message: 'mood_rating_max must be greater than or equal to mood_rating_min',
    path: ['mood_rating_max'],
  }
);

// =====================================================
// PAGINATION SCHEMA
// =====================================================

export const PaginationSchema = z.object({
  page: z.number().int().min(1).optional().default(1),
  limit: z.number().int().min(1).max(100).optional().default(20),
});

// =====================================================
// EXPORT TYPE INFERENCE
// =====================================================

export type CreateBadgeInput = z.infer<typeof CreateBadgeSchema>;
export type UpdateBadgeInput = z.infer<typeof UpdateBadgeSchema>;
export type AwardBadgeInput = z.infer<typeof AwardBadgeSchema>;
export type AddPointsInput = z.infer<typeof AddPointsSchema>;
export type CreateTierInput = z.infer<typeof CreateTierSchema>;
export type UpdateTierInput = z.infer<typeof UpdateTierSchema>;
export type SendKudosInput = z.infer<typeof SendKudosSchema>;
export type CreateKudosTemplateInput = z.infer<typeof CreateKudosTemplateSchema>;
export type CreateSurveyInput = z.infer<typeof CreateSurveySchema>;
export type SubmitSurveyResponseInput = z.infer<typeof SubmitSurveyResponseSchema>;
export type SubmitPulseCheckInput = z.infer<typeof SubmitPulseCheckSchema>;
export type BadgeFiltersInput = z.infer<typeof BadgeFiltersSchema>;
export type PointsLedgerFiltersInput = z.infer<typeof PointsLedgerFiltersSchema>;
export type KudosFiltersInput = z.infer<typeof KudosFiltersSchema>;
export type SurveyFiltersInput = z.infer<typeof SurveyFiltersSchema>;
export type PulseCheckFiltersInput = z.infer<typeof PulseCheckFiltersSchema>;
