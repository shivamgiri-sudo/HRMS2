export interface AtsCandidate {
  id: string;
  candidate_code: string;
  full_name: string;
  mobile: string;
  email: string | null;
  gender: string | null;
  date_of_birth: string | null;
  current_stage: string;
  applied_for_process: string | null;
  applied_for_branch: string | null;
  sourcing_channel: string | null;
  referred_by: string | null;
  walk_in_date: string | null;
  remarks: string | null;
  active_status: number;
  created_at: string;
  updated_at: string;
}

export interface AtsCandidateStageLog {
  id: string;
  candidate_id: string;
  from_stage: string | null;
  to_stage: string;
  stage_date: string;
  remarks: string | null;
  updated_by: string | null;
  interview_slot_id: string | null;
  created_at: string;
}

export interface AtsOnboardingBridge {
  id: string;
  candidate_id: string;
  employee_id: string | null;
  bridge_date: string;
  offer_letter_url: string | null;
  joining_date: string | null;
  status: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface AtsSourcingChannel {
  id: string;
  channel_code: string;
  channel_name: string;
  channel_type: string | null;
  active_status: number;
  created_at: string;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface CandidateListFilters {
  page: number;
  limit: number;
  stage?: string;
  branch?: string;
  process?: string;
  search?: string;
  fromDate?: string;
  toDate?: string;
}

export interface CreateCandidateInput {
  fullName: string;
  mobile: string;
  email?: string | null;
  gender?: string | null;
  dateOfBirth?: string | null;
  appliedForProcess?: string | null;
  appliedForBranch?: string | null;
  sourcingChannel?: string | null;
  referredBy?: string | null;
  walkInDate?: string | null;
  remarks?: string | null;
}

export interface CreateOnboardingBridgeInput {
  candidateId: string;
  bridgeDate: string;
  joiningDate?: string | null;
  offerLetterUrl?: string | null;
  notes?: string | null;
}
