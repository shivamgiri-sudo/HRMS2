/**
 * /api/ats/recruiter/daily-stats and /api/ats/recruiter/other-pending are "self" endpoints: they resolve the
 * caller's own recruiter profile. The backend only serves them to a user holding the `recruiter` role
 * (daily-stats answers 400 "recruiterName is required" for admin/hr/super_admin without one; other-pending
 * answers 403 "No recruiter profile linked"). So the Recruiter Workspace only calls them for recruiter users.
 */
export function canLoadOwnRecruiterStats(roleKeys: readonly string[]): boolean {
  return roleKeys.includes("recruiter");
}
