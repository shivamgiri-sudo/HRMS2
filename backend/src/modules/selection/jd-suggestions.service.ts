// Text suggestions for one requisition (S-O8): read them with the current criteria state, accept chosen ones through the one
// audited criteria write path (saveRequisitionCriteria: version, per-field audit, approved => reason, closed => 409), and
// remember dismissals as audit rows (source jd_suggestion) keyed by the suggestion id, which changes when the text changes.
import type { RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { compileCriteria } from "./compile-criteria.js";
import { saveRequisitionCriteria, type Actor } from "./criteria.service.js";
import { loadDbRow, toCriteriaRow } from "./criteria-row.js";
import { patchFromSuggestions, suggestFromText, type JdRequisition, type JdSuggestion } from "./jd-suggestions.js";
import { permissionsFor } from "./selection-roles.js";

type Exec = (sql: string, params?: unknown[]) => Promise<[unknown, unknown]>;
const ex: Exec = (sql, p) => db.execute(sql, p as never) as never;
const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
const DISMISSED = "jd_suggestion_dismissed";
const RESTORED = "jd_suggestion_restored";
const CORE_KEYS = ["education_min", "experience", "age", "location_cities", "night_shift"];

async function loadRequisition(id: string): Promise<JdRequisition> {
  const d = await loadDbRow(ex, id);
  if (!d) throw fail(404, "Requisition not found");
  const [t] = await ex("SELECT job_description, business_justification FROM job_requisition WHERE id = ? LIMIT 1", [id]);
  const text = (t as RowDataPacket[])[0] ?? {};
  return { ...toCriteriaRow(d), jobDescription: (text.job_description as string | null) ?? null, businessJustification: (text.business_justification as string | null) ?? null };
}

/** Suggestion ids currently dismissed (the last dismiss/restore event per id wins). */
async function dismissedIds(id: string): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const [rows] = await ex(`SELECT field, new_json FROM job_requisition_criteria_audit WHERE requisition_id = ? AND source = 'jd_suggestion' AND field IN ('${DISMISSED}', '${RESTORED}') ORDER BY id`, [id]);
    for (const r of rows as RowDataPacket[]) {
      const j = typeof r.new_json === "string" ? JSON.parse(r.new_json) : r.new_json;
      if (!j?.id) continue;
      if (r.field === DISMISSED) out.add(String(j.id)); else out.delete(String(j.id));
    }
  } catch { /* before migration 2145 there is no audit table: nothing dismissed */ }
  return out;
}

async function latestVersion(id: string): Promise<{ id: string; versionNo: number } | null> {
  try {
    const [v] = await ex("SELECT id, version_no FROM job_requisition_criteria_version WHERE requisition_id = ? ORDER BY version_no DESC LIMIT 1", [id]);
    const r = (v as RowDataPacket[])[0];
    return r ? { id: String(r.id), versionNo: Number(r.version_no) } : null;
  } catch { return null; }
}

export async function getSuggestions(id: string, role: string) {
  const r = await loadRequisition(id);
  const out = suggestFromText(r);
  const gone = await dismissedIds(id);
  const compiled = compileCriteria(r);
  const v = await latestVersion(id);
  return {
    suggestions: out.suggestions.filter((s) => !gone.has(s.id)),
    dismissed: out.suggestions.filter((s) => gone.has(s.id)),
    unparsed: out.unparsed, skipped: out.skipped,
    current: {
      approvalStatus: r.approvalStatus, legacy: compiled.legacy, completeness: compiled.completeness, undecided: compiled.undecided,
      /** None of the core criteria decided: the UI says "criteria found in text" rather than "criteria incomplete". */
      structuredEmpty: CORE_KEYS.every((k) => compiled.undecided.includes(k as never)),
      hasText: [r.skillsRequired, r.jobDescription, r.shiftRequirement, r.businessJustification].some((t) => !!t?.trim()),
      versionNo: v?.versionNo ?? null, versionId: v?.id ?? null,
    },
    permissions: permissionsFor(role),
  };
}

function pick(all: JdSuggestion[], ids: string[]): JdSuggestion[] {
  const by = new Map(all.map((s) => [s.id, s]));
  const missing = ids.filter((i) => !by.has(i));
  if (missing.length) throw fail(409, "These suggestions no longer apply (the text or the criteria changed); reload and try again");
  return ids.map((i) => by.get(i)!);
}

export async function acceptSuggestions(a: { requisitionId: string; ids: string[]; values: Record<string, number>; reason: string | null; actor: Actor; dryRun: boolean }) {
  const r = await loadRequisition(a.requisitionId);
  if (r.approvalStatus === "closed") throw fail(409, "Requisition is closed: its criteria are read-only");
  const picks = pick(suggestFromText(r).suggestions, a.ids);
  const { patch, errors } = patchFromSuggestions(r, picks, a.values);
  if (errors.length) throw fail(400, errors.join("; "));
  const reason = a.reason?.trim() ? a.reason.trim() : r.approvalStatus === "approved" ? null
    : `Accepted from the requisition text: ${picks.map((p) => `"${p.matched}"`).join(", ")}`.slice(0, 300);
  const saved = await saveRequisitionCriteria({ requisitionId: a.requisitionId, patch, actor: a.actor, source: "jd_suggestion", reason, dryRun: a.dryRun });
  return { ...saved, accepted: picks.map((p) => p.id), patch, leavesLegacy: r.selectionRules == null };
}

export async function dismissSuggestions(a: { requisitionId: string; ids: string[]; undo: boolean; reason: string | null; actor: Actor }) {
  const r = await loadRequisition(a.requisitionId);
  if (r.approvalStatus === "closed") throw fail(409, "Requisition is closed: its criteria are read-only");
  const picks = pick(suggestFromText(r).suggestions, a.ids);
  const v = await latestVersion(a.requisitionId);
  const field = a.undo ? RESTORED : DISMISSED;
  const params = picks.flatMap((s) => [r.id, v?.id ?? "", field, null, JSON.stringify({ id: s.id, key: s.key, matched: s.matched, phrase: s.phrase.slice(0, 200) }),
    a.actor.id, a.actor.role, "jd_suggestion", a.reason?.slice(0, 300) ?? null, r.approvalStatus ?? ""]);
  await ex(`INSERT INTO job_requisition_criteria_audit (requisition_id, version_id, field, old_json, new_json, actor_id, actor_role, source, reason, approval_status_at_change)
     VALUES ${picks.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ")}`, params);
  return { ids: picks.map((p) => p.id), undo: a.undo };
}
