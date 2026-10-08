import { FOCUS } from "../ui";

export const input = `min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 ${FOCUS}`;
export const lbl = "mb-1 block text-xs font-semibold text-slate-700";
export const msg = (e: unknown) => (e instanceof Error ? e.message : "Request failed.");
