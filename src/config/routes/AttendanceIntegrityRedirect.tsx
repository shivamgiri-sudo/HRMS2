// src/config/routes/AttendanceIntegrityRedirect.tsx
//
// Query-string-preserving redirect from a pre-merge attendance page to its tab on the
// merged /wfm/attendance-integrity console (Task 6 of the WFM attendance-page merge).
//
// A bare `<Navigate to="/wfm/attendance-integrity?tab=...">` would drop whatever search
// string the old URL carried, and the live reference dashboards deep-link into these old
// paths with real filters (?issueType=missing_adr&status=open, ?severity=warning&status=open,
// etc — see ReferenceSharedPanels.tsx). This reads the original search string and forwards
// every param unchanged, only ever setting `tab` to the value this old path maps to. If the
// original URL happened to already carry a `tab` key (none of the four old routes do today,
// but nothing prevents a stray bookmark or hand-built link from having one), the merged
// tab wins rather than being duplicated as a second `tab=` key in the resulting URL.
//
// One component, parameterized by `toTab`, reused for all four old routes rather than four
// near-duplicate redirect components — see workforce.routes.tsx for the wiring.
import { Navigate, useLocation } from "react-router-dom";

export type AttendanceIntegrityTab = "exceptions" | "mismatches" | "biometric" | "billing";

export function AttendanceIntegrityRedirect({ toTab }: { toTab: AttendanceIntegrityTab }) {
  const { search } = useLocation();
  const original = new URLSearchParams(search);
  const next = new URLSearchParams();
  next.set("tab", toTab);
  for (const [key, value] of original) {
    if (key === "tab") continue; // the merged tab always wins over a coincidental collision
    next.append(key, value);
  }
  return <Navigate to={`/wfm/attendance-integrity?${next.toString()}`} replace />;
}
