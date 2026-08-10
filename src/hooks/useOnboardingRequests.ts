import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { toast } from "sonner";

/**
 * Shape returned by GET /api/ats/onboarding-full/requests. This is an ATS
 * candidate pipeline row (ats_onboarding_request joined to ats_candidate), NOT a
 * user signup request — there is no user_id, reviewed_by or message column.
 */
export interface OnboardingRequest {
  id: string;
  candidate_id: string;
  candidate_code: string | null;
  offer_id?: string | null;
  offer_status?: string | null;
  offered_ctc?: number | string | null;
  profile_status: string | null;
  email: string;
  full_name: string;
  mobile: string | null;
  branch_name: string | null;
  process_name: string | null;
  bank_verification_status: string | null;
  documents_uploaded: number;
  status: string;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * ats_onboarding_request.status carries the full 28-value lifecycle enum
 * (migration 345), not just pending/approved/rejected. Anything not yet decided
 * is still awaiting HR action and must stay visible.
 */
const DECIDED_REJECTED = new Set(["rejected", "cancelled"]);
const DECIDED_APPROVED = new Set([
  "approved", "hr_approved", "branch_head_approved", "payroll_approved",
  "payroll_hr_approved", "bgv_completed", "appointment_signed",
  "employee_creation_pending", "employee_created", "onboarded",
]);
/** Terminal states where an employee record already exists for the candidate. */
const EMPLOYEE_ALREADY_CREATED = new Set(["employee_created", "onboarded"]);

export type RequestBucket = "pending" | "approved" | "rejected";

export function bucketOfRequest(status: string): RequestBucket {
  const s = String(status ?? "").toLowerCase();
  if (DECIDED_REJECTED.has(s)) return "rejected";
  if (DECIDED_APPROVED.has(s)) return "approved";
  return "pending";
}

export function hasEmployeeAlreadyCreated(status: string): boolean {
  return EMPLOYEE_ALREADY_CREATED.has(String(status ?? "").toLowerCase());
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
      const res = await hrmsApi.get<unknown>("/api/ats/onboarding-full/requests");
      return unwrapRows(res) as OnboardingRequest[];
    },
  });

  const approveRequest = useMutation({
    mutationFn: async ({ requestId, userId }: { requestId: string; userId: string }) => {
      // Get request details for notification
      const requests = requestsQuery.data ?? [];
      const request = requests.find((r) => r.id === requestId);

      if (!request?.offer_id) {
        throw new Error("Offer not yet created for this candidate — please build the offer first before approving.");
      }

      await hrmsApi.post(`/api/ats/onboarding/offers/${request.offer_id}/approve`, {});

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

      if (!request?.offer_id) {
        throw new Error("Offer not yet created for this candidate — cannot reject.");
      }

      await hrmsApi.post(`/api/ats/onboarding/offers/${request.offer_id}/reject`, {
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
