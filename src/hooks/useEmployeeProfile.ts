import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useAuth } from "@/contexts/AuthContext";

export interface EmployeeProfile {
  id: string;
  employee_code: string;
  user_id: string;
  first_name: string;
  last_name: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  gender: string | null;
  date_of_birth: string | null;
  hire_date: string | null;
  status: string | null;
  employment_type: string | null;
  branch_id: string | null;
  department_id: string | null;
  process_id: string | null;
  designation_id: string | null;
  designation: string | null;
  department_name: string | null;
  branch_name: string | null;
  process_name: string | null;
  reporting_manager: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
}

export function useEmployeeProfile() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["employee-profile", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;

      try {
        const res = await hrmsApi.get<{ success: boolean; data: EmployeeProfile }>("/api/employees/me");
        if (res.success) {
          return res.data;
        }
        return null;
      } catch (error) {
        console.error("Failed to fetch employee profile:", error);
        return null;
      }
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });
}
