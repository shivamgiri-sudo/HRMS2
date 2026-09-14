// Break Desk Filter Web Worker
// Offloads employee filtering to prevent UI blocking

type DeskEmployee = {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  biometric_id: string;
  branch_id?: string | null;
  process_id?: string | null;
  department_id?: string | null;
  designation_id?: string | null;
  manager_id?: string | null;
  shift_name: string | null;
  current_status: string;
  biometric_punch_in_time: string | null;
  active_break_id: string | null;
  exceeded_minutes: number;
  remaining_daily_break_minutes?: number;
  [key: string]: any;
};

type FiltersState = {
  search: string;
  branch_id: string[];
  process_id: string[];
  department_id: string[];
  designation_id: string[];
  manager_id: string[];
  shift: string[];
  status: string;
};

self.addEventListener('message', (event: MessageEvent) => {
  const { employees, filters, searchQuery } = event.data as {
    employees: DeskEmployee[];
    filters: FiltersState;
    searchQuery: string;
  };

  try {
    let result = [...employees];

    // Search filter (name, code, biometric ID)
    if (searchQuery && searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      result = result.filter((emp) => {
        const name = emp.employee_name?.toLowerCase() || '';
        const code = emp.employee_code?.toLowerCase() || '';
        const bioId = emp.biometric_id?.toLowerCase() || '';
        return name.includes(query) || code.includes(query) || bioId.includes(query);
      });
    }

    // Multi-select dropdown filters
    if (filters.branch_id && filters.branch_id.length > 0) {
      result = result.filter((e) => filters.branch_id.includes(String(e.branch_id ?? '')));
    }

    if (filters.process_id && filters.process_id.length > 0) {
      result = result.filter((e) => filters.process_id.includes(String(e.process_id ?? '')));
    }

    if (filters.department_id && filters.department_id.length > 0) {
      result = result.filter((e) => filters.department_id.includes(String(e.department_id ?? '')));
    }

    if (filters.designation_id && filters.designation_id.length > 0) {
      result = result.filter((e) => filters.designation_id.includes(String(e.designation_id ?? '')));
    }

    if (filters.manager_id && filters.manager_id.length > 0) {
      result = result.filter((e) => filters.manager_id.includes(String(e.manager_id ?? '')));
    }

    if (filters.shift && filters.shift.length > 0) {
      result = result.filter((e) => filters.shift.includes(e.shift_name ?? ''));
    }

    // Status filter — match against current_status directly
    if (filters.status && filters.status !== 'all') {
      const statusVal = filters.status;
      result = result.filter((e) => e.current_status === statusVal);
    }

    // Send filtered result back to main thread
    self.postMessage(result);
  } catch (error) {
    console.error('Filter worker error:', error);
    self.postMessage(employees);
  }
});
