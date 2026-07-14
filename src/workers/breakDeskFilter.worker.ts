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
  branch_id: string;
  process_id: string;
  department_id: string;
  designation_id: string;
  manager_id: string;
  shift: string;
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

    // Dropdown filters
    if (filters.branch_id && filters.branch_id !== 'all') {
      result = result.filter((e) => e.branch_id === filters.branch_id);
    }

    if (filters.process_id && filters.process_id !== 'all') {
      result = result.filter((e) => e.process_id === filters.process_id);
    }

    if (filters.department_id && filters.department_id !== 'all') {
      result = result.filter((e) => e.department_id === filters.department_id);
    }

    if (filters.designation_id && filters.designation_id !== 'all') {
      result = result.filter((e) => e.designation_id === filters.designation_id);
    }

    if (filters.manager_id && filters.manager_id !== 'all') {
      result = result.filter((e) => e.manager_id === filters.manager_id);
    }

    if (filters.shift && filters.shift !== 'all') {
      result = result.filter((e) => e.shift_name === filters.shift);
    }

    // Status filter (primary)
    if (filters.status && filters.status !== 'all') {
      switch (filters.status) {
        case 'on-duty':
          result = result.filter((e) => e.current_status === 'On Duty');
          break;
        case 'on-break':
          result = result.filter((e) => e.current_status === 'On Break');
          break;
        case 'exceeded':
          result = result.filter((e) => e.current_status === 'Break Exceeded');
          break;
        case 'no-punch':
          result = result.filter((e) => !e.biometric_punch_in_time);
          break;
        case 'active-break':
          result = result.filter((e) => !!e.active_break_id);
          break;
        case 'break-limit-reached':
          result = result.filter((e) => Number(e.remaining_daily_break_minutes ?? 1) <= 0);
          break;
        default:
          break;
      }
    }

    // Send filtered result back to main thread
    self.postMessage(result);
  } catch (error) {
    console.error('Filter worker error:', error);
    // Fallback: return original array on error
    self.postMessage(employees);
  }
});
