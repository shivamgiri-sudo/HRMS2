export interface Employee {
  id: string;
  employee_code: string;
  user_id: string | null;
  first_name: string;
  last_name: string | null;
  full_name: string;
  email: string | null;
  mobile: string | null;
  personal_email: string | null;
  personal_phone: string | null;
  gender: "Male" | "Female" | "Other" | null;
  date_of_birth: string | null;
  date_of_joining: string;
  salary_start_date: string | null; // defaults to date_of_joining when null
  date_of_exit: string | null;
  employment_type: string;
  employment_status: string;
  branch_id: string | null;
  department_id: string | null;
  process_id: string | null;
  designation_id: string | null;
  reporting_manager_id: string | null;
  active_status: number;
  photo_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  stats?: {
    total_employees: number;
    active_employees: number;
    inactive_employees: number;
    department_count: number;
  };
  process_breakdown?: Array<{
    process_id: string | null;
    process_name: string;
    active_count: number;
    inactive_count: number;
    total_count: number;
  }>;
}
