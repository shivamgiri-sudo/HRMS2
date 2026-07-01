import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useAuth } from "@/contexts/AuthContext";

export function useEmployeeStatus() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["employee-status", user?.id],
    queryFn: async () => {
      if (!user?.id) return { isEmployee: false, employeeId: null };

      try {
        const res = await hrmsApi.get<{ data: any }>("/api/employees/me");
        const emp = res.data;
        return {
          isEmployee: !!emp?.id,
          employeeId: emp?.id ?? null,
        };
      } catch {
        return { isEmployee: false, employeeId: null };
      }
    },
    enabled: !!user?.id,
  });
}
