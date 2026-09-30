import { hrmsApi, type HrmsEnvelope } from "@/lib/hrmsApi";
import { PD_API } from "../api";
import type { WhyDimension, WhyResponse } from "./types";

export interface WhyParams { metric: string; by: WhyDimension; from: string; to: string; compareFrom: string; compareTo: string; tl?: string; lob?: string }

export const fetchWhy = async (processId: string, p: WhyParams): Promise<WhyResponse> => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v) qs.set(k, String(v));
  const res = await hrmsApi.get<HrmsEnvelope<WhyResponse>>(`${PD_API}/${encodeURIComponent(processId)}/why?${qs.toString()}`);
  return res.data as WhyResponse;
};
