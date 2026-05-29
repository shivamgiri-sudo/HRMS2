import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://bebminxoqdjzzfhnrsge.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  'sb_publishable_djqNhT51UKmkO5UXwxzNyA_pMgvaF2b';

const realSupabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});

// A high-fidelity proxy to intercept queries in demo mode
const createSupabaseProxy = (target: any): any => {
  return new Proxy(target, {
    get(obj, prop) {
      if (prop === 'from') {
        return (table: string) => {
          const isDemo = localStorage.getItem("hrms_demo_session");
          if (isDemo) {
            return createQueryBuilderMock(table);
          }
          return obj.from(table);
        };
      }
      if (prop === 'auth') {
        return new Proxy(obj.auth, {
          get(authObj, authProp) {
            if (authProp === 'getSession') {
              return async () => {
                const sessionStr = localStorage.getItem("hrms_demo_session");
                if (sessionStr) {
                  try {
                    const session = JSON.parse(sessionStr);
                    return { data: { session }, error: null };
                  } catch (e) {
                    console.error("Failed to parse local demo session", e);
                  }
                }
                return authObj.getSession();
              };
            }
            if (authProp === 'onAuthStateChange') {
              return (callback: any) => {
                const sessionStr = localStorage.getItem("hrms_demo_session");
                if (sessionStr) {
                  try {
                    const session = JSON.parse(sessionStr);
                    callback('SIGNED_IN', session);
                  } catch (e) {
                    console.error("Failed to parse local demo session in state change", e);
                  }
                }
                return authObj.onAuthStateChange(callback);
              };
            }
            return (authObj as any)[authProp];
          }
        });
      }
      return obj[prop];
    }
  });
};

function createQueryBuilderMock(table: string) {
  const mockData = getMockDataForTable(table);
  
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    neq: () => builder,
    in: () => builder,
    order: () => builder,
    limit: () => builder,
    gte: () => builder,
    lte: () => builder,
    is: () => builder,
    maybeSingle: async () => ({ data: Array.isArray(mockData) ? mockData[0] || null : mockData, error: null }),
    single: async () => ({ data: Array.isArray(mockData) ? mockData[0] || null : mockData, error: null }),
    then: (resolve: any) => {
      resolve({ data: mockData, error: null });
    }
  };
  
  return builder;
}

function getMockDataForTable(table: string): any {
  switch (table) {
    case "employees":
      return [
        {
          id: "demo-employee-id",
          employee_code: "EMP-DEMO-001",
          first_name: "Demo",
          last_name: "Admin",
          email: "demo@mascallnet.com",
          phone: "+91 98765 43210",
          designation: "General Manager",
          hire_date: "2024-01-10",
          status: "active",
          avatar_url: null,
          department: { name: "HR & Operations" }
        },
        {
          id: "emp-2",
          employee_code: "EMP-MCN-002",
          first_name: "Ananya",
          last_name: "Sharma",
          email: "ananya.sharma@mascallnet.com",
          phone: "+91 99999 88888",
          designation: "Operations Manager",
          hire_date: "2024-02-15",
          status: "active",
          avatar_url: null,
          department: { name: "Operations" }
        },
        {
          id: "emp-3",
          employee_code: "EMP-MCN-003",
          first_name: "Rajesh",
          last_name: "Kumar",
          email: "rajesh.kumar@mascallnet.com",
          phone: "+91 88888 77777",
          designation: "Tech Lead",
          hire_date: "2024-03-01",
          status: "active",
          avatar_url: null,
          department: { name: "Technical Support" }
        },
        {
          id: "emp-4",
          employee_code: "EMP-MCN-004",
          first_name: "Siddharth",
          last_name: "Verma",
          email: "siddharth.verma@mascallnet.com",
          phone: "+91 77777 66666",
          designation: "HR Specialist",
          hire_date: "2024-04-20",
          status: "active",
          avatar_url: null,
          department: { name: "Human Resources" }
        }
      ];
    case "leave_requests":
      return [
        {
          id: "leave-1",
          employee_id: "emp-2",
          leave_type_id: "type-1",
          start_date: new Date().toISOString().split("T")[0],
          end_date: new Date(Date.now() + 86400000 * 2).toISOString().split("T")[0],
          days_count: 3,
          reason: "Doctor advised rest due to fever",
          status: "pending",
          created_at: new Date().toISOString(),
        },
        {
          id: "leave-2",
          employee_id: "emp-3",
          leave_type_id: "type-2",
          start_date: new Date(Date.now() - 86400000 * 3).toISOString().split("T")[0],
          end_date: new Date(Date.now() - 86400000 * 2).toISOString().split("T")[0],
          days_count: 2,
          reason: "Family function out of town",
          status: "approved",
          created_at: new Date(Date.now() - 86400000 * 4).toISOString(),
          reviewed_by: "demo-employee-id",
          reviewed_at: new Date().toISOString(),
          review_notes: "Approved, backup resource arranged.",
        }
      ];
    case "leave_types":
      return [
        { id: "type-1", name: "Sick Leave", days_per_year: 10, is_paid: true },
        { id: "type-2", name: "Casual Leave", days_per_year: 12, is_paid: true },
        { id: "type-3", name: "Maternity Leave", days_per_year: 90, is_paid: true }
      ];
    case "departments":
      return [
        { id: "dept-1", name: "HR & Operations", description: "Core HR and facilities operations" },
        { id: "dept-2", name: "Operations", description: "Operational execution and workforce" },
        { id: "dept-3", name: "Technical Support", description: "Product tech support and systems" },
        { id: "dept-4", name: "Human Resources", description: "Talent acquisition and engagement" }
      ];
    case "user_roles":
      return [{ role: "admin" }];
    case "user_assignment_scope":
      return [];
    case "role_page_access":
      return [];
    case "activity_logs":
      return [
        {
          id: "act-1",
          action: "onboarded",
          entity_type: "employee",
          details: { name: "Ananya Sharma", department: "Operations" },
          created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
        },
        {
          id: "act-2",
          action: "approved",
          entity_type: "leave",
          details: { name: "Rajesh Kumar", type: "Sick Leave" },
          created_at: new Date(Date.now() - 3600000 * 5).toISOString(),
        },
        {
          id: "act-3",
          action: "allocated",
          entity_type: "asset",
          details: { name: "MacBook Pro M3", employee: "Ananya Sharma" },
          created_at: new Date(Date.now() - 3600000 * 24).toISOString(),
        }
      ];
    case "employee_leave_eligibility":
      return [
        { leave_type_id: "type-1" },
        { leave_type_id: "type-2" }
      ];
    case "asset_assignments":
      return [
        { id: "asg-1", employee_id: "demo-employee-id", returned_date: null },
        { id: "asg-2", employee_id: "demo-employee-id", returned_date: null },
        { id: "asg-3", employee_id: "demo-employee-id", returned_date: null }
      ];
    default:
      return [];
  }
}

export const supabase = createSupabaseProxy(realSupabase);