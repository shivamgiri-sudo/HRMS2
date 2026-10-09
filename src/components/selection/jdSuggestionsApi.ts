// The text-suggestion endpoints (S-O8). The server enforces roles, scope, reasons and the closed lock.
import { hrmsApi } from "@/lib/hrmsApi";
import type { JdSuggestionsData } from "./jdSuggestionsModel";
import type { SaveResult } from "./selectionTypes";

type Env<T> = { success: boolean; data: T };
const base = (id: string) => `/api/job-requisition/${encodeURIComponent(id)}/criteria/suggestions`;
export type AcceptResult = SaveResult & { accepted: string[]; patch: Record<string, unknown>; leavesLegacy: boolean };

export const jdSuggestionsApi = {
  get: (id: string) => hrmsApi.get<Env<JdSuggestionsData>>(base(id)).then((r) => r.data),
  accept: (id: string, ids: string[], values: Record<string, number>, reason: string | null, dryRun: boolean) =>
    hrmsApi.post<Env<AcceptResult>>(`${base(id)}/accept`, { ids, values, reason, dryRun }).then((r) => r.data),
  dismiss: (id: string, ids: string[], undo: boolean) => hrmsApi.post<Env<{ ids: string[]; undo: boolean }>>(`${base(id)}/dismiss`, { ids, undo }).then((r) => r.data),
};
