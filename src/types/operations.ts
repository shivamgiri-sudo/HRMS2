/**
 * Operations Dashboard Types
 */

export interface AgentStatus {
  agent_id: string;
  agent_code: string;
  agent_name: string;
  status: 'Logged In' | 'Logged Out' | 'On Break' | 'Absent';
  duration: number; // in minutes
  call_id?: string | null;
  process_name: string | null;
  branch_name: string | null;
  last_activity: string | null;
}

export interface OperationsSummary {
  total_agents: number;
  logged_in: number;
  on_break: number;
  logged_out: number;
  absent: number;
  avg_call_duration: number;
}

export interface ProcessUtilization {
  process_name: string;
  planned_headcount: number;
  actual_logged_in: number;
  utilization_pct: number;
  shrinkage_forecast: number;
}

export interface AttritionSignal {
  type: 'resignation_notice' | 'attendance_drop' | 'quality_decline' | 'escalation';
  severity: 'low' | 'medium' | 'high';
  description: string;
}

export interface EmployeeAttritionRisk {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  risk_score: number; // 0-100
  signals: AttritionSignal[];
  retention_action: string | null;
  last_updated: string;
}

export interface LiveStatusResponse {
  agents: AgentStatus[];
  summary: OperationsSummary;
  timestamp: string;
}

export interface RosterVsActualResponse {
  utilization_pct: number;
  processes: ProcessUtilization[];
  timestamp: string;
}

export interface AttritionRiskResponse {
  employees: EmployeeAttritionRisk[];
  high_risk_count: number;
  medium_risk_count: number;
  timestamp: string;
}
