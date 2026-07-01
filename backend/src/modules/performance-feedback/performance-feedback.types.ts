// ===========================
// Database Table Interfaces
// ===========================

export interface PerformanceFeedbackCycle {
  cycle_id: string;
  cycle_name: string;
  period: string | null;
  start_date: string;
  end_date: string;
  deadline: string | null;
  status: CycleStatus;
  feedback_type: string;
  appraisal_cycle_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface PerformanceFeedbackRequest {
  id: string;
  cycle_id: string;
  employee_id: string;
  reviewer_id: string;
  reviewer_type: ReviewerType;
  manager_id?: string;
  request_date: string;
  due_date: string;
  status: RequestStatus;
  created_at: string;
  updated_at: string;
}

export interface CompetencyMaster {
  id: string;
  competency_name: string;
  competency_description: string | null;
  category: CompetencyCategory;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PerformanceFeedbackResponse {
  id: string;
  request_id: string;
  ratings: RatingsJson;
  overall_rating: number;
  strengths: string | null;
  areas_for_improvement: string | null;
  comments: string | null;
  submitted_at: string;
  created_at: string;
  updated_at: string;
}

export interface PerformanceFeedbackReport {
  id: string;
  cycle_id: string;
  employee_id: string;
  self_rating: number | null;
  peer_avg_rating: number | null;
  manager_rating: number | null;
  final_rating: number;
  consolidated_strengths: string | null;
  consolidated_improvements: string | null;
  report_generated_at: string;
  created_at: string;
  updated_at: string;
}

export interface DevelopmentPlan {
  id: string;
  employee_id: string;
  cycle_id: string;
  plan_title: string;
  plan: PlanJson;
  status: DevelopmentPlanStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface DevelopmentPlanGoal {
  id: string;
  development_plan_id: string;
  goal_description: string;
  target_date: string;
  status: GoalStatus;
  completion_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ===========================
// Enum Types
// ===========================

export type CycleStatus = "draft" | "active" | "closed";

export type ReviewerType = "self" | "peer" | "manager";

export type RequestStatus = "pending" | "completed" | "overdue";

export type CompetencyCategory = "technical" | "behavioral" | "leadership";

export type DevelopmentPlanStatus = "draft" | "active" | "completed";

export type GoalStatus = "not_started" | "in_progress" | "completed";

// ===========================
// Nested JSON Field Types
// ===========================

export interface RatingsJson {
  competencies: CompetencyScore[];
  kpis?: KpiScore[];
}

export interface CompetencyScore {
  competency_id: string;
  competency_name: string;
  rating: number;
  comment?: string;
}

export interface KpiScore {
  kpi_id: string;
  kpi_name: string;
  rating: number;
  comment?: string;
}

export interface PlanJson {
  objectives: string[];
  training_needs: string[];
  timeline: string;
  resources_needed?: string[];
}

// ===========================
// API Request DTOs
// ===========================

export interface CreateCycleDto {
  cycle_name: string;
  period: string;
  start_date: string;
  end_date: string;
  deadline: string;
  appraisal_cycle_id?: string;
}

export interface LaunchCycleDto {
  employee_ids: string[];
}

export interface ReviewerAssignment {
  employee_id: string;
  reviewers: ReviewerInfo[];
}

export interface ReviewerInfo {
  reviewer_id: string;
  reviewer_type: ReviewerType;
  due_date: string;
}

export interface SubmitFeedbackDto {
  request_id: string;
  ratings_json: RatingsJson;
  overall_strengths?: string;
  development_areas?: string;
}

export interface FormTemplateDto {
  employee: {
    emp_id: string;
    full_name: string;
    designation: string;
  };
  competencies: CompetencyMaster[];
  kpis: any[];
}

export interface GenerateReportDto {
  cycle_id: string;
  employee_id: string;
}

export interface CreateDevelopmentPlanDto {
  employee_id: string;
  target_date?: string;
  goals?: CreateGoalDto[];
}

export interface CreateGoalDto {
  description: string;
  target_date?: string;
}

export interface UpdateGoalDto {
  goal_id: string;
  status?: GoalStatus;
  completion_date?: string;
  notes?: string;
}

export interface CreateCompetencyDto {
  competency_name: string;
  competency_description?: string;
  category: CompetencyCategory;
}

export interface UpdateCompetencyDto {
  competency_id: string;
  competency_name?: string;
  competency_description?: string;
  category?: CompetencyCategory;
  is_active?: boolean;
}

// ===========================
// API Response DTOs
// ===========================

export interface CycleResponseDto extends PerformanceFeedbackCycle {
  total_employees?: number;
  completed_count?: number;
  pending_count?: number;
}

export interface FeedbackRequestResponseDto extends PerformanceFeedbackRequest {
  employee_name?: string;
  reviewer_name?: string;
  cycle_name?: string;
}

export interface FeedbackResponseDto extends PerformanceFeedbackResponse {
  employee_name?: string;
  reviewer_name?: string;
  reviewer_type?: ReviewerType;
}

export interface ReportResponseDto extends PerformanceFeedbackReport {
  employee_name?: string;
  cycle_name?: string;
  feedback_details?: FeedbackResponseDto[];
}

export interface DevelopmentPlanResponseDto extends DevelopmentPlan {
  employee_name?: string;
  cycle_name?: string;
  goals?: DevelopmentPlanGoal[];
}

export interface CompetencyResponseDto extends CompetencyMaster {
  usage_count?: number;
}

// ===========================
// Query/Filter DTOs
// ===========================

export interface CycleFilters {
  status?: CycleStatus;
  created_by?: string;
  start_date?: string;
  end_date?: string;
}

export interface FeedbackRequestFilters {
  cycle_id?: string;
  employee_id?: string;
  reviewer_id?: string;
  reviewer_type?: ReviewerType;
  status?: RequestStatus;
}

export interface ReportFilters {
  cycle_id?: string;
  employee_id?: string;
  min_rating?: number;
  max_rating?: number;
}

export interface DevelopmentPlanFilters {
  employee_id?: string;
  cycle_id?: string;
  status?: DevelopmentPlanStatus;
  created_by?: string;
}

export interface CompetencyFilters {
  category?: CompetencyCategory;
  is_active?: boolean;
  search?: string;
}

// ===========================
// Pagination
// ===========================

export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

// ===========================
// Statistics & Analytics
// ===========================

export interface CycleStatistics {
  cycle_id: string;
  total_requests: number;
  completed_requests: number;
  pending_requests: number;
  overdue_requests: number;
  completion_rate: number;
  avg_rating: number;
}

export interface EmployeeFeedbackSummary {
  employee_id: string;
  employee_name: string;
  self_rating: number | null;
  peer_count: number;
  peer_avg_rating: number | null;
  manager_rating: number | null;
  final_rating: number;
  feedback_count: number;
}

export interface CompetencyAnalytics {
  competency_id: string;
  competency_name: string;
  category: CompetencyCategory;
  avg_rating: number;
  rating_count: number;
  distribution: RatingDistribution;
}

export interface RatingDistribution {
  rating_1: number;
  rating_2: number;
  rating_3: number;
  rating_4: number;
  rating_5: number;
}
