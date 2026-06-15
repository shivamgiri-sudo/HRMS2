import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { toast } from "sonner";

export interface OnboardingRequest {
  id: string;
  offer_id?: string | null;
  user_id: string;
  email: string;
  full_name: string;
  message: string | null;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

function unwrapRows(payload: unknown): any[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const body = payload as { data?: unknown };
    if (Array.isArray(body.data)) return body.data;
  }
  return [];
}

export function useOnboardingRequests() {
  const queryClient = useQueryClient();

  const requestsQuery = useQuery({
    queryKey: ["onboarding-requests"],
    queryFn: async () => {
      const res = await hrmsApi.get<unknown>("/api/ats/onboarding/requests");
      return unwrapRows(res) as OnboardingRequest[];
    },
  });

  const approveRequest = useMutation({
    mutationFn: async ({ requestId, userId }: { requestId: string; userId: string }) => {
      // Get request details for notification
      const requests = requestsQuery.data ?? [];
      const request = requests.find((r) => r.id === requestId);

      const approvalId = request?.offer_id || requestId;
      await hrmsApi.post(`/api/ats/onboarding/offers/${approvalId}/approve`, {});

      // Fire-and-forget notification
      if (request) {
        hrmsApi.post("/api/communication/dispatch/send", {
          template_name: "onboarding_request_approved",
          recipient_employee_ids: [],
          data: {
            type: "approved",
            request_id: requestId,
            user_email: request.email,
            user_name: request.full_name,
            reviewed_by: userId,
          },
          channel: "email",
        }).catch(() => {});
      }
    },
    onSuccess: () => {
      toast.success("Request approved successfully!");
      queryClient.invalidateQueries({ queryKey: ["onboarding-requests"] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to approve request: ${error.message}`);
    },
  });

  const rejectRequest = useMutation({
    mutationFn: async ({
      requestId,
      userId,
      rejectionReason,
    }: {
      requestId: string;
      userId: string;
      rejectionReason?: string;
    }) => {
      // Get request details for notification
      const requests = requestsQuery.data ?? [];
      const request = requests.find((r) => r.id === requestId);

      const approvalId = request?.offer_id || requestId;
      await hrmsApi.post(`/api/ats/onboarding/offers/${approvalId}/reject`, {
        remarks: rejectionReason,
      });

      // Fire-and-forget notification
      if (request) {
        hrmsApi.post("/api/communication/dispatch/send", {
          template_name: "onboarding_request_rejected",
          recipient_employee_ids: [],
          data: {
            type: "rejected",
            request_id: requestId,
            user_email: request.email,
            user_name: request.full_name,
            reviewed_by: userId,
          },
          channel: "email",
        }).catch(() => {});
      }
    },
    onSuccess: () => {
      toast.success("Request rejected");
      queryClient.invalidateQueries({ queryKey: ["onboarding-requests"] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to reject request: ${error.message}`);
    },
  });

  return {
    requests: requestsQuery.data ?? [],
    isLoading: requestsQuery.isLoading,
    approveRequest,
    rejectRequest,
  };
}
