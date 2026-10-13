import type { ApprovalAdapter, ApprovalItem, LoopbackCtx } from "../types.js";
import { LoopbackError } from "../types.js";
import { badge, date, dateText, f, fields, iso, long, str } from "../format.js";
import { WFM_APPROVER_ROLES } from "../../wfm/team-roster-types.js";
import { callerScope, holdsLiteralRole, keepInBranch } from "./_scope.js";

const DETAIL_CAP = 100;
const LINES_SHOWN = 40;
type Step = "manager" | "wfm";
const STAGE: Record<Step, string> = { manager: "Stage 1 of 2 — Reporting manager", wfm: "Stage 2 of 2 — WFM (final, applies to roster)" };

const asm = (l: any) => `${l.new?.label || str(l.new?.type) || "?"}`;
function lineText(l: any): string {
  const who = [str(l.employeeName), str(l.employeeCode) && `(${str(l.employeeCode)})`].filter(Boolean).join(" ");
  const change = l.old ? `${l.old.label || str(l.old.type) || "?"} -> ${asm(l)}` : `${asm(l)}`;
  const warn = Array.isArray(l.warnings) && l.warnings.length ? ` [warning: ${l.warnings.map((w: any) => str(w?.message ?? w)).join("; ")}]` : "";
  return `${dateText(l.date)} · ${who}: ${change}${str(l.reason) ? ` — ${str(l.reason)}` : ""}${warn}`;
}

async function listStep(ctx: LoopbackCtx, step: Step): Promise<ApprovalItem[]> {
  let res: any;
  try {
    res = await ctx.call("GET", "/api/wfm/team-roster/approvals", { query: { step, limit: 100 } });
  } catch (e) {
    // The WFM queue 403s for non-WFM roles; that must not hide the manager queue.
    if (e instanceof LoopbackError && (e.status === 401 || e.status === 403 || e.status === 404)) return [];
    throw e;
  }
  const items: any[] = res?.data?.items ?? [];
  const details = new Map<number, any>();
  await Promise.all(
    items.slice(0, DETAIL_CAP).map(async (it) => {
      try {
        details.set(Number(it.id), (await ctx.call("GET", `/api/wfm/team-roster/submissions/${it.id}`))?.data ?? null);
      } catch { /* keep the list row */ }
    }),
  );
  // The module treats admin / super_admin as GLOBAL approvers of both steps; that is "able to", not "designated". Popup rule:
  //  - manager step: ONLY the submission's named manager approver (an admin / super_admin who is not that person is not shown it);
  //  - wfm step: a caller who LITERALLY holds a WFM approver role (wfm, wfm_spoc, wfm_analyst, branch_wfm, ho_wfm), for a submitter in
  //    their own branch (org-wide wfm roles: any). admin / super_admin are shown it only when they also hold one of those roles.
  // Items without a loaded detail are dropped (fail closed) rather than shown unchecked.
  const scope = await callerScope(ctx.userId);
  const wfmHolder = step === "wfm" ? await holdsLiteralRole(ctx.userId, ...(WFM_APPROVER_ROLES as readonly string[])) : false;
  const inBranch = new Set(
    wfmHolder ? (await keepInBranch(ctx.userId, items, (it: any) => ({ employeeCode: it.submitter?.code }), scope)).map((it: any) => Number(it.id)) : [],
  );
  const out: ApprovalItem[] = [];
  for (const it of items) {
    const d = details.get(Number(it.id));
    if (!d) continue;
    // The detail's own permission flag is the module's final word on "can this caller decide this step now".
    if (d?.permissions && !(step === "manager" ? d.permissions.canManagerDecide : d.permissions.canWfmDecide)) continue;
    if (step === "manager") {
      const named = !!scope.employeeId && String(d?.submission?.managerApprover?.id ?? "") === scope.employeeId;
      if (!named) continue;
    } else if (!inBranch.has(Number(it.id))) continue;
    const sub = d?.submission ?? {};
    const lines: any[] = Array.isArray(d?.lines) ? d.lines : [];
    const shown = lines.slice(0, LINES_SHOWN).map(lineText);
    if (lines.length > LINES_SHOWN) shown.push(`... and ${lines.length - LINES_SHOWN} more change(s) - open the submission to see all`);
    const sum = d?.summary;
    const submittedAt = iso(it.submittedAt ?? sub.submittedAt);
    const id = String(it.id);
    out.push({
      uid: `team_roster:${id}`,
      kind: "team_roster",
      kindLabel: "Team roster submission",
      category: "Attendance",
      id,
      title: `${str(it.submissionNo) || `Submission #${id}`} — ${str(it.submitter?.name) || "Team lead"}`,
      subtitle: `${str(it.from).slice(0, 10)} to ${str(it.to).slice(0, 10)} · ${it.lineCount ?? lines.length} change(s)`,
      requester: { name: it.submitter?.name, code: it.submitter?.code },
      stage: STAGE[step],
      fields: fields(
        f("Submission no", it.submissionNo),
        f("Submitted by", it.submitter?.name),
        f("Submitter code", it.submitter?.code),
        f("Reporting manager", it.managerApprover || sub.managerApprover?.name),
        date("From", it.from),
        date("To", it.to),
        f("Changes", it.lineCount ?? sum?.total),
        f("Lines with warnings", it.warningCount ?? sum?.withWarnings),
        badge("Step", step === "manager" ? "Manager approval" : "WFM approval"),
        f("Manager decision", sub.managerDecision ? `${str(sub.managerDecision.decision)}${str(sub.managerDecision.remarks) ? ` — ${str(sub.managerDecision.remarks)}` : ""}` : ""),
        long("Submitter note", sub.note),
        long("Roster changes", shown.join("\n")),
        date("Submitted on", submittedAt),
      ),
      submittedAt,
      viewPath: `/wfm/team-roster?tab=approvals&submission=${encodeURIComponent(id)}&approvalId=${encodeURIComponent(id)}`,
      rejectNeedsReason: true,
      approveLabel: step === "manager" ? "Approve & forward to WFM" : "Approve & apply",
      meta: { step },
    });
  }
  return out;
}

/** Team roster submissions: manager step then WFM step. The module's own queue already excludes the caller's own submissions. */
export const teamRosterAdapter: ApprovalAdapter = {
  kind: "team_roster",
  label: "Team roster submission",
  category: "Attendance",
  async list(ctx) {
    const [m, w] = await Promise.all([listStep(ctx, "manager"), listStep(ctx, "wfm")]);
    return [...m, ...w];
  },
  async decide(ctx, item, action, remarks) {
    const step = item.meta?.step === "wfm" ? "wfm" : "manager";
    await ctx.call("POST", `/api/wfm/team-roster/submissions/${encodeURIComponent(item.id)}/${step}-${action === "approve" ? "approve" : "reject"}`, {
      body: { remarks: remarks || null },
    });
  },
};
