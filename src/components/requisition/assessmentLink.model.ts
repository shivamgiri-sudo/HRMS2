/** Pure rules for the per-requisition assessment (BMI) link editor. Mirrors the backend rules in job-requisition-bmi-link.rules.ts. */
export const ASSESSMENT_LINK_MAX = 500;

/** Same roles the backend allows on PATCH /api/job-requisition/:id. */
export const ASSESSMENT_LINK_EDIT_ROLES = [
  'super_admin', 'hr', 'recruitment_hr', 'branch_head', 'operations_manager', 'process_manager', 'assistant_manager',
] as const;

export type AssessmentLinkStatus = 'idle' | 'saving' | 'saved' | 'error';

export function canEditAssessmentLink(role: string | null | undefined, approvalStatus: string): boolean {
  return approvalStatus === 'approved' && !!role && (ASSESSMENT_LINK_EDIT_ROLES as readonly string[]).includes(role);
}

/** Returns an error message, or null when the draft is acceptable (empty clears the link). */
export function validateAssessmentLink(raw: string): string | null {
  const v = raw.trim();
  if (v === '') return null;
  if (v.length > ASSESSMENT_LINK_MAX) return `Link must be at most ${ASSESSMENT_LINK_MAX} characters`;
  if (/[^\x21-\x7e]/.test(v)) return 'Link must be plain ASCII without spaces (use punycode for non-English domains)';
  if (!/^https:\/\//.test(v)) return 'Link must start with https://';
  let url: URL;
  try { url = new URL(v); } catch { return 'Enter a full https link, for example https://…'; }
  if (url.protocol !== 'https:' || !url.hostname) return 'Link must start with https://';
  if (url.username || url.password) return 'Link must not contain a username or password';
  return null;
}

export function isAssessmentLinkDirty(saved: string | null | undefined, draft: string): boolean {
  return (saved ?? '').trim() !== draft.trim();
}
