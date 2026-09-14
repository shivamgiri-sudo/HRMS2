// backend/src/modules/compliance/maternity.types.ts

export type MaternityRecordType = 'delivery' | 'adoption' | 'miscarriage' | 'surrogacy';
export type MaternityStatus = 'applied' | 'approved' | 'active' | 'completed' | 'rejected';

export interface MaternityRecord {
  id: string;
  employee_id: string;
  employee_name?: string;
  employee_code?: string;
  record_type: MaternityRecordType;
  child_birth_order: number;
  entitled_weeks: number;
  expected_delivery_date: string | null;
  actual_delivery_date: string | null;
  leave_start_date: string;
  leave_end_date: string | null;
  paid_weeks: number;
  nursing_break_weeks: number;
  nursing_break_granted: number;
  nursing_break_end_date: string | null;
  work_from_home_option: number;
  complications: number;
  status: MaternityStatus;
  approved_by: string | null;
  leave_request_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateMaternityDTO {
  employee_id: string;
  record_type: MaternityRecordType;
  child_birth_order: number;
  expected_delivery_date?: string | null;
  leave_start_date: string;
  complications?: boolean;
  notes?: string | null;
}

export interface UpdateMaternityDTO {
  status?: MaternityStatus;
  actual_delivery_date?: string | null;
  leave_end_date?: string | null;
  nursing_break_granted?: boolean;
  work_from_home_option?: boolean;
  notes?: string | null;
}

/**
 * Returns entitled weeks per MBA 1961 rules.
 * delivery: 26 weeks for 1st+2nd child, 12 weeks for 3rd+
 * adoption: 8 weeks (MBA 2017)
 * miscarriage/surrogacy: 6 weeks
 * complications: +4 weeks (when complications flag = 1)
 */
export function computeEntitledWeeks(
  recordType: MaternityRecordType,
  childBirthOrder: number,
  complications: boolean
): number {
  let weeks: number;
  switch (recordType) {
    case 'delivery':
      weeks = childBirthOrder <= 2 ? 26 : 12;
      break;
    case 'adoption':
      weeks = 8;
      break;
    case 'miscarriage':
    case 'surrogacy':
      weeks = 6;
      break;
    default:
      weeks = 26;
  }
  return complications ? weeks + 4 : weeks;
}

/**
 * Compute leave end date from start + entitled weeks.
 */
export function computeLeaveEndDate(startDate: string, entitledWeeks: number): string {
  const d = new Date(startDate);
  d.setDate(d.getDate() + entitledWeeks * 7 - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Compute nursing break end date: 15 months post actual_delivery_date.
 */
export function computeNursingBreakEndDate(actualDeliveryDate: string): string {
  const d = new Date(actualDeliveryDate);
  d.setMonth(d.getMonth() + 15);
  return d.toISOString().slice(0, 10);
}
