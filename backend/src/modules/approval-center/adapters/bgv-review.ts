import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, str } from "../format.js";
import { callerHasRole } from "./_roles.js";
import { keepCandidatesInBranch } from "./_scope.js";

/** "HR decision": the inbox endpoint also admits recruiters, who are not the deciders of a failed/mismatched check. */
const DECIDER_ROLES = ["hr", "hr_head", "recruitment_hr", "admin", "super_admin"];

const MAX_ROWS = 100;
const CHUNK = 10;
const label = (s: unknown) => str(s).replace(/_/g, " ");

/**
 * BGV checks stuck in manual_review / mismatch.
 * GET /api/inbox/my-pending lists these by ROLE only (no branch scope), so each candidate row is then opened
 * through GET /api/inbox/derived/candidate_bgv_check/:id — the same endpoint that applies the real
 * role + canAccessCandidate branch guard (403 = outside your scope, dropped). Capped at MAX_ROWS, 10 in flight.
 * "Approve" marks the check verified; "Reject" marks it failed (this is exactly what the inbox derived decide does).
 */
export const bgvReviewAdapter: ApprovalAdapter = {
  kind: "bgv_review",
  label: "BGV manual review",
  category: "Recruitment",
  async list(ctx) {
    if (!(await callerHasRole(ctx.userId, ...DECIDER_ROLES))) return [];
    const res = await ctx.call("GET", "/api/inbox/my-pending");
    const tasks: any[] = (res?.items ?? []).filter(
      (t: any) => t?.source === "derived" && t?.entity_type === "candidate_bgv_check" && t?.entity_id,
    ).slice(0, MAX_ROWS);
    const out: ApprovalItem[] = [];
    for (let i = 0; i < tasks.length; i += CHUNK) {
      const batch = tasks.slice(i, i + CHUNK);
      const details = await Promise.all(
        batch.map((t) =>
          ctx.call("GET", `/api/inbox/derived/candidate_bgv_check/${encodeURIComponent(String(t.entity_id))}`)
            .then((d) => d?.data ?? null)
            .catch(() => null),
        ),
      );
      batch.forEach((t, idx) => {
        const d = details[idx];
        if (!d) return; // not decidable by this caller (outside branch scope / role)
        const status = str(d.status).toLowerCase();
        if (status !== "manual_review" && status !== "mismatch") return;
        const aging = Number(t.aging_hours);
        out.push({
          uid: `bgv_review:${d.id}`,
          kind: "bgv_review",
          kindLabel: "BGV manual review",
          category: "Recruitment",
          id: String(d.id),
          title: `${str(d.candidate_name) || "Candidate"} — ${label(d.check_type)} ${label(d.status)}`,
          subtitle: str(d.candidate_code),
          requester: { name: d.candidate_name, code: d.candidate_code },
          stage: `BGV ${label(d.status)} — HR decision`,
          fields: fields(
            f("Candidate", d.candidate_name),
            f("Candidate code", d.candidate_code),
            f("Mobile", d.mobile),
            f("Email", d.email),
            badge("Check", label(d.check_type)),
            badge("Status", label(d.status)),
            f("Match score", d.match_score != null && d.match_score !== "" ? `${d.match_score}%` : ""),
            long("Result summary", d.result_summary),
            f("Provider", d.provider),
            date("Raised on", d.created_at),
          ),
          submittedAt: iso(d.created_at ?? t.created_at),
          priority: Number.isFinite(aging) && aging >= 72 ? "high" : "normal",
          viewPath: `/ats/bgv?approvalId=${encodeURIComponent(String(d.candidate_id))}`,
          rejectNeedsReason: true,
          approveLabel: "Mark verified",
          rejectLabel: "Mark failed",
          meta: { candidateId: String(d.candidate_id) },
        });
      });
    }
    // canAccessCandidate also admits process-scoped / multi-branch assignment scope; owner policy: own-record branch only.
    return keepCandidatesInBranch(ctx.userId, out, (i) => i.meta?.candidateId);
  },
  async decide(ctx, item, action, remarks) {
    await ctx.call("POST", `/api/inbox/derived/candidate_bgv_check/${encodeURIComponent(item.id)}/decide`, {
      body: { decision: action, remarks: remarks || undefined },
    });
  },
};
