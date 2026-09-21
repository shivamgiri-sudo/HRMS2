// src/config/routes/RosterCommandCenterRedirect.tsx
//
// Query-string-preserving redirect from a pre-merge roster page to its tab on the merged
// /wfm/roster-command-center console. The sidebar and old bookmarks still point at the six
// pre-merge paths, which 404'd after the merge; this keeps them resolvable. Mirrors
// AttendanceIntegrityRedirect: every original param is forwarded, only `tab` is set.
import { Navigate, useLocation } from "react-router-dom";

export type RosterCommandCenterTab =
  | "live"
  | "team-roster"
  | "analytics"
  | "trends"
  | "compliance"
  | "shifts"
  | "interventions"
  | "audit";

export function RosterCommandCenterRedirect({ toTab }: { toTab: RosterCommandCenterTab }) {
  const { search } = useLocation();
  const next = new URLSearchParams();
  next.set("tab", toTab);
  for (const [key, value] of new URLSearchParams(search)) {
    if (key === "tab") continue;
    next.append(key, value);
  }
  return <Navigate to={`/wfm/roster-command-center?${next.toString()}`} replace />;
}
