import { KIND_LABEL, type RequestKind, type RosterRequest } from "./types";

/** Parse `?kind=&id=` from the roster-cell badges. Unknown kinds are ignored. */
export function parseDeepLink(params: URLSearchParams): { kind: RequestKind | null; id: string | null } {
  const k = params.get("kind");
  const kind = k && k in KIND_LABEL ? (k as RequestKind) : null;
  const id = params.get("id")?.trim() || null;
  return { kind, id };
}

/** The request to pre-select once the list has loaded, or null when absent/not found. */
export function findDeepLinked(requests: readonly RosterRequest[], link: { kind: RequestKind | null; id: string | null }): RosterRequest | null {
  if (!link.id) return null;
  return requests.find((r) => r.id === link.id && (!link.kind || r.kind === link.kind)) ?? null;
}

/** "Open in roster": the live roster tab of /wfm/team-roster on the request's date, focused on its employee. */
export function teamRosterHref(request: Pick<RosterRequest, "date" | "employeeId">): string {
  const q = new URLSearchParams({ tab: "roster" });
  if (request.date) q.set("date", request.date);
  if (request.employeeId) q.set("employee", request.employeeId);
  return `/wfm/team-roster?${q.toString()}`;
}
