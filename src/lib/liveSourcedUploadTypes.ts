/**
 * Upload types whose dashboard/report no longer reads the table this upload writes into --
 * the data is now fetched live from its real upstream source instead (a live dialer_db table,
 * most often). Uploading one of these codes still works (the table still exists and still
 * accepts rows), it just has no visible effect: nothing on screen reads it anymore.
 *
 * Keep this list to cases confirmed by reading the actual dashboard/report service's source,
 * not by inference -- a wrong entry here tells someone not to upload a file their dashboard
 * actually still depends on, which is worse than this banner not existing at all. Add a new
 * entry only after finding the exact query/comment that proves the live replacement, the same
 * way the entries below were found (see each `source` for where to re-verify).
 */
export interface LiveSourcedUploadType {
  /** One line: what live source replaced the upload, shown directly to the uploader. */
  note: string;
  /** Where this was confirmed in the backend, so a future check knows exactly what to re-read. */
  source: string;
}

export const LIVE_SOURCED_UPLOAD_TYPES: Record<string, LiveSourcedUploadType> = {
  CL_OUTBOUND_MASMIS: {
    note: "Clovia Outbound is now read live from the dialer (dialer_db.cdr_ob_250) on both the Overview and Channels dashboards. Uploading this file has no effect on what's shown.",
    source: "backend/src/modules/process-performance/clovia-lob-outbound.service.ts, clovia-channels-dashboard.service.ts (getOutboundChannel)",
  },
  CL_FEEDBACK_MASMIS: {
    note: "Clovia Feedback / C-SAT is now read live from the dialer's IVR survey log (dialer_db.feedback_log_250). Uploading this file has no effect on what's shown.",
    source: "backend/src/modules/process-performance/clovia-channels-dashboard.service.ts (getFeedbackChannel)",
  },
  CL_APR_MASMIS: {
    note: "Clovia Agent Productivity (APR) is now read live from the dialer's agent log (dialer_db.vicidial_agent_log_250). Uploading this file has no effect on what's shown.",
    source: "backend/src/modules/process-performance/clovia-channels-dashboard.service.ts (getProductivityChannel)",
  },
};

export function liveSourceNoticeFor(uploadTypeCode: string | null | undefined): LiveSourcedUploadType | null {
  if (!uploadTypeCode) return null;
  return LIVE_SOURCED_UPLOAD_TYPES[uploadTypeCode.toUpperCase().trim()] ?? null;
}
