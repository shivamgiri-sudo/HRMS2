import { hrmsApi, type HrmsEnvelope } from "@/lib/hrmsApi";
import { PD_API } from "../api";
import type { ForecastResponse } from "./types";

export const fetchForecast = async (id: string, month: string, tl?: string, lob?: string): Promise<ForecastResponse> => {
  const p = new URLSearchParams({ month });
  if (tl) p.set("tl", tl);
  if (lob) p.set("lob", lob);
  const res = await hrmsApi.get<HrmsEnvelope<ForecastResponse>>(`${PD_API}/${encodeURIComponent(id)}/forecast?${p.toString()}`);
  return res.data as ForecastResponse;
};
