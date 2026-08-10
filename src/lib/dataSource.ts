export const USE_HRMS_BACKEND = {
  employees:   import.meta.env.VITE_HRMS_EMPLOYEES   === 'backend',
  attendance:  import.meta.env.VITE_HRMS_ATTENDANCE  === 'backend',
  wfm:         import.meta.env.VITE_HRMS_WFM         === 'backend',
  leave:       import.meta.env.VITE_HRMS_LEAVE       === 'backend',
  payroll:     import.meta.env.VITE_HRMS_PAYROLL     === 'backend',
  ats:         import.meta.env.VITE_HRMS_ATS         === 'backend',
  integration: import.meta.env.VITE_HRMS_INTEGRATION === 'backend',
  kpi:         import.meta.env.VITE_HRMS_KPI         === 'backend',
} as const;

export type HrmsModule = keyof typeof USE_HRMS_BACKEND;
