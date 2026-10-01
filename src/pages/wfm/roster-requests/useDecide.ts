import { useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi, type HrmsApiError } from "@/lib/hrmsApi";
import type { RequestKind } from "./types";

export type DecideAction = "approve" | "reject" | "realign" | "escalate";

export interface DecideInput {
  kind: RequestKind;
  id: string;
  action: DecideAction;
  reason?: string;
  newDate?: string;
  newShiftTemplateId?: string;
  restOverrideReason?: string;
  forceWithoutCounterpartAcceptance?: boolean;
}

export interface BulkInput { items: Array<{ kind: RequestKind; id: string }>; action: "approve" | "reject"; reason?: string }
export interface BulkResult {
  results: Array<{ kind: RequestKind; id: string; ok: boolean; status?: number; error?: string; blockers?: string[] }>;
  okCount: number; failCount: number;
}

/** Pull a display message and any server-reported blockers (409 payload) out of a thrown API error. */
export function errorInfo(e: unknown): { message: string; blockers: string[] } {
  const err = e as HrmsApiError | null;
  const payload = err?.payload as { impact?: { blockers?: unknown } } | null | undefined;
  const blockers = Array.isArray(payload?.impact?.blockers) ? (payload!.impact!.blockers as unknown[]).map(String) : [];
  return { message: err?.message || "Request failed", blockers };
}

export function useDecide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ kind, id, ...body }: DecideInput) =>
      (await hrmsApi.post<{ data: { ok: boolean; applied?: unknown } }>(`/api/roster-requests/${kind}/${encodeURIComponent(id)}/decide`, body)).data,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["rr"] }); },
  });
}

export function useBulkDecide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: BulkInput) =>
      (await hrmsApi.post<{ data: BulkResult }>("/api/roster-requests/bulk-decide", input)).data,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["rr"] }); },
  });
}
