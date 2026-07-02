import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export function useOnboardingRequest() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const requestQuery = useQuery({
    queryKey: ["onboarding-request", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;

      try {
        const res = await hrmsApi.get<{ data: any }>("/api/ats/onboarding/requests");
        // The endpoint returns all requests; find the one belonging to this user
        const requests = Array.isArray(res.data) ? res.data : [];
        return requests.find((r: any) => r.user_id === user.id) ?? null;
      } catch {
        return null;
      }
    },
    enabled: !!user?.id,
  });

  const submitRequest = useMutation({
    mutationFn: async ({ message }: { message?: string }) => {
      if (!user?.id || !user?.email) throw new Error("User not authenticated");

      // Get user's name from employee record
      let fullName = user.email.split("@")[0];
      try {
        const meRes = await hrmsApi.get<{ data: any }>("/api/employees/me");
        if (meRes.data) {
          const emp = meRes.data;
          fullName = `${emp.first_name ?? ""} ${emp.last_name ?? ""}`.trim() || fullName;
        }
      } catch { /* fall through to email-derived name */ }

      const data = await hrmsApi.post<{ data: any }>("/api/ats/onboarding/requests", {
        user_id: user.id,
        email: user.email,
        full_name: fullName,
        message,
      });

      // Fire-and-forget notification via communication dispatch
      hrmsApi.post("/api/communication/dispatch/send", {
        template_name: "onboarding_request_submitted",
        recipient_employee_ids: [],
        data: {
          type: "submitted",
          request_id: data?.data?.id,
          user_email: user.email,
          user_name: fullName,
          message,
        },
        channel: "email",
      }).catch(() => {});
    },
    onSuccess: () => {
      toast.success("Onboarding request submitted successfully!");
      queryClient.invalidateQueries({ queryKey: ["onboarding-request", user?.id] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to submit request: ${error.message}`);
    },
  });

  return {
    request: requestQuery.data,
    isLoading: requestQuery.isLoading,
    submitRequest,
  };
}
