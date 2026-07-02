import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useAuth } from "@/contexts/AuthContext";

export function usePendingApprovals() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["pending-approvals", user?.id],
    queryFn: async () => {
      if (!user?.id) return { count: 0, requests: [] };
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>("/api/leave/requests?status=pending&limit=5");
      const requests = res.data ?? [];
      return { count: requests.length, requests };
    },
    enabled: !!user?.id,
  });
}
