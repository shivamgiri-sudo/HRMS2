import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useAuth } from "@/contexts/AuthContext";
import { resolveActiveDemoCredential } from "@/lib/demoCreds";

const DEMO_LOGIN_ENABLED = import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEMO_LOGIN === "true";

export function useEmployeeStatus() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["employee-status", user?.id],
    queryFn: async () => {
      if (!user?.id) return { isEmployee: false, employeeId: null };

      const demoCredential = resolveActiveDemoCredential(user, DEMO_LOGIN_ENABLED);
      if (demoCredential) {
        return {
          isEmployee: true,
          employeeId: demoCredential.employeeId,
        };
      }

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
