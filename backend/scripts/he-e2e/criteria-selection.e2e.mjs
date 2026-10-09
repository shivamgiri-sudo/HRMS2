// Rig e2e (he-e2e2): selection preview, why-not, overrides, HR approval, enrolment and the criteria-change guard (S10-S14)
// across a matrix of requisition types, roles and branch scopes. Runs against an isolated clone of the rig DB only.
//   CRIT_API=http://127.0.0.1:5395 CRIT_DB=crit_rig node backend/scripts/he-e2e/criteria-selection.e2e.mjs
// The backend under test must run with SELECTION_FOLLOWUP_GUARD=1 and QUAL_FOLLOWUP_MODE=dry_run (no sends).
import { createRequire } from "node:module";

const API = process.env.CRIT_API ?? "http://127.0.0.1:5395";
const DB = process.env.CRIT_DB ?? "crit_rig";
if (DB === "mas_hrms") throw new Error("refusing: run against the clone, not the shared rig schema");
const PASSWORD = "RigTest#2026";
const USERS = {
  super_admin: "rig.superadmin@he-e2e2.test", admin: "rig.admin.noida@he-e2e2.test", hr: "rig.hr@he-e2e2.test", recruiter: "rig.recruiter@he-e2e2.test",
  ceo: "rig.ceo@he-e2e2.test", branch_hr_ahm: "rig.bhr.ahmedabad@he-e2e2.test", branch_hr_noida2: "rig.bhr.noida2@he-e2e2.test",
};
const require = createRequire("/home/shuvam/HRMS2/backend/package.json");
const mysql = require("mysql2/promise");
const pool = mysql.createPool({ host: "127.0.0.1", port: 3312, user: "root", password: "x", database: DB, connectionLimit: 2, dateStrings: true });
const q = async (sql, p = []) => (await pool.query(sql, p))[0];
let pass = 0, failN = 0;
const ok = (name, cond, detail = "") => { cond ? pass++ : failN++; console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : `  -> ${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 400)}`}`); };
async function login(role) {
  const r = await fetch(`${API}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier: USERS[role], email: USERS[role], password: PASSWORD }) });
  const j = await r.json().catch(() => ({}));
  const token = j.accessToken ?? j.token ?? j.data?.accessToken ?? j.data?.token;
  const cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  if (!r.ok) throw new Error(`login ${role}: ${r.status}`);
  return { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(cookie ? { cookie } : {}) };
}
async function call(h, method, url, body) {
  const r = await fetch(`${API}${url}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let json = null; try { json = JSON.parse(t); } catch { /* csv */ }
  return { status: r.status, json, text: t };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ids = Object.fromEntries((await q("SELECT requisition_code, id FROM job_requisition WHERE requisition_code LIKE 'RIG-R%'")).map((r) => [r.requisition_code.slice(4), r.id]));

async function reset() {
  await q(`UPDATE ${DB}.job_requisition c JOIN mas_hrms.job_requisition m ON m.id = c.id
              SET c.education_requirement = m.education_requirement, c.skills_required = m.skills_required, c.meta_target_age_min = m.meta_target_age_min,
                  c.meta_target_age_max = m.meta_target_age_max, c.experience_min_years = m.experience_min_years, c.experience_max_years = m.experience_max_years,
                  c.night_shift_required = m.night_shift_required, c.shift_requirement = m.shift_requirement, c.meta_screening_config = m.meta_screening_config,
                  c.meta_target_locations = m.meta_target_locations, c.selection_rules = NULL`);
  for (const t of ["shortlist_candidate", "shortlist_run", "shortlist_approval", "shortlist_override", "shortlist_override_log"]) await q(`DELETE FROM ${t}`);
  await q("DELETE FROM qualified_followup WHERE origin_label IN ('Approved shortlist', 'Standing approval')");
  await q("DELETE FROM he_model_param WHERE param_key IN ('policy.shortlist.enrol', 'policy.followup.he')");
}
const complete = (city, night = 0) => ({
  educationRequirement: "12th", ageMin: 18, ageMax: 40, targetLocations: [city], nightShiftRequired: night, shiftRequirement: night ? "Night" : "Day",
  selectionRules: { schema: 1, enrolment: { mode: "hr_approves", standingApprovalDays: 7 }, rules: {
    age: { mode: "must", missing: "review", missingBySource: { meta_live: "pass", meta_old: "pass" } }, education_min: { mode: "must", missing: "review" },
    location_cities: { mode: "must", missing: "review" }, ...(night ? { night_shift: { mode: "must", missing: "review" } } : {}),
    // HR decides the stored Meta screening items too; left undecided they default to MUST with unknown = review
    languages: { mode: "off", decided: true }, typing: { mode: "off", decided: true }, english: { mode: "off", decided: true }, gender: { mode: "off", decided: true },
    rotational_shift: { mode: "off", decided: true }, experience: { mode: "off", decided: true } } },
});

await reset();
const S = {};
for (const role of Object.keys(USERS)) S[role] = await login(role);
try {
  // ── 1. permissions per role ──
  for (const role of Object.keys(USERS)) {
    const req = await call(S[role], "GET", `/api/job-requisition/${ids.R01}`);
    const pv = await call(S[role], "GET", `/api/job-requisition/${ids.R01}/selection/preview?source=he`);
    const want = role === "recruiter" ? 403 : role === "admin" ? 404 : req.status === 200 ? 200 : req.status;
    ok(`${role}: preview R01 (NOIDA-2) follows scope (${want})`, pv.status === want, { req: req.status, pv: pv.status });
    const csv = await call(S[role], "GET", `/api/job-requisition/${ids.R01}/selection/preview.csv?source=he`);
    const csvWant = ["super_admin", "hr", "branch_hr_ahm", "branch_hr_noida2"].includes(role) ? (pv.status === 200 ? 200 : 404) : 403;
    ok(`${role}: CSV export ${csvWant}`, csv.status === csvWant, csv.status);
    if (csv.status === 200) ok(`${role}: CSV has masked mobiles only`, !/\b[6-9]\d{9}\b/.test(csv.text) && /x{6}/.test(csv.text), csv.text.slice(0, 200));
    const ov = await call(S[role], "PUT", "/api/he/shortlist/override", { mobile: "9999900103", requisitionScope: ids.R01, kind: "include", reason: "rig" });
    const ovWant = ["recruiter", "ceo"].includes(role) ? 403 : ["admin", "hr", "branch_hr_ahm"].includes(role) ? 404 : 200;
    ok(`${role}: override on R01 -> ${ovWant}`, ov.status === ovWant, ov.status);
    const run = await call(S[role], "POST", "/api/he/shortlist/run", { requisitionId: ids.R01, sourceKind: "he" });
    const runWant = ["recruiter", "ceo", "admin"].includes(role) ? 403 : ["hr", "branch_hr_ahm"].includes(role) ? 404 : 200;
    ok(`${role}: shortlist run on R01 -> ${runWant}`, run.status === runWant, run.status);
  }
  // S15-S20 read models: recruiters get nothing; lists follow scope; permissions travel with the data
  for (const url of ["/api/job-requisition/selection/requisitions", `/api/he/shortlist/approval-state?requisitionId=${ids.R01}&sourceKind=he`, "/api/job-requisition/selection/why?q=99999"]) {
    ok(`recruiter: ${url.split("?")[0]} -> 403`, (await call(S.recruiter, "GET", url)).status === 403);
  }
  const lists = {};
  for (const role of ["super_admin", "ceo", "branch_hr_noida2", "branch_hr_ahm"]) lists[role] = (await call(S[role], "GET", "/api/job-requisition/selection/requisitions")).json?.data;
  const codesOf = (d) => new Set((d?.items ?? []).map((i) => i.code));
  ok("NOIDA-2 HR list: R01 and R02, no Ahmedabad R03", codesOf(lists.branch_hr_noida2).has("RIG-R01") && !codesOf(lists.branch_hr_noida2).has("RIG-R03"), [...codesOf(lists.branch_hr_noida2)]);
  ok("Ahmedabad HR list: R03, no NOIDA-2 R01", codesOf(lists.branch_hr_ahm).has("RIG-R03") && !codesOf(lists.branch_hr_ahm).has("RIG-R01"), [...codesOf(lists.branch_hr_ahm)]);
  ok("ceo list: org-wide, read-only permissions", codesOf(lists.ceo).has("RIG-R01") && codesOf(lists.ceo).has("RIG-R03") && lists.ceo.permissions.edit === false && lists.ceo.permissions.approve === false, lists.ceo?.permissions);
  ok("closed / past-end / full / pending / on-hold are not in the open list", !["RIG-R05", "RIG-R06", "RIG-R07", "RIG-R09", "RIG-R10"].some((c) => codesOf(lists.super_admin).has(c)), [...codesOf(lists.super_admin)]);
  const incOnly = (await call(S.super_admin, "GET", "/api/job-requisition/selection/requisitions?onlyIncomplete=1")).json?.data?.items ?? [];
  ok("only-incomplete filter returns incomplete rows only", incOnly.every((i) => i.completeness.label !== "complete"), incOnly.map((i) => i.completeness.label));
  const camp = (await q("SELECT id FROM meta_campaign WHERE requisition_id IS NOT NULL LIMIT 1"))[0];
  if (camp) {
    ok("campaign read-through: 200 for super_admin, 403 for recruiter", (await call(S.super_admin, "GET", `/api/job-requisition/selection/campaign/${camp.id}/requisitions`)).status === 200
      && (await call(S.recruiter, "GET", `/api/job-requisition/selection/campaign/${camp.id}/requisitions`)).status === 403);
  }
  const star = await call(S.branch_hr_noida2, "PUT", "/api/he/shortlist/override", { mobile: "9999900103", requisitionScope: "*", kind: "exclude", reason: "rig" });
  ok("branch HR cannot set an override for every requisition (*) -> 403", star.status === 403, star.status);
  await reset();

  // ── 2. requisition-type matrix (super_admin) ──
  const SA = S.super_admin;
  for (const [code, city, night] of [["R01", "Noida", 0], ["R02", "Noida", 1], ["R04", "Ahmedabad", 0], ["R06", "Noida", 0], ["R07", "Noida", 0], ["R09", "Noida", 0], ["R10", "Ahmedabad", 0]]) {
    const r = await call(SA, "PUT", `/api/job-requisition/${ids[code]}/criteria`, { patch: complete(city, night), reason: "rig matrix" });
    ok(`${code}: complete criteria saved`, r.status === 200 && r.json?.data?.compiled?.completeness?.enrolmentReady === true, r.json?.message ?? r.json?.data?.compiled?.completeness);
  }
  ok("R05 (closed): criteria are read-only -> 409", (await call(SA, "PUT", `/api/job-requisition/${ids.R05}/criteria`, { patch: complete("Noida"), reason: "x" })).status === 409);
  const expectApprove = { R01: 200, R02: 200, R04: 200, R06: 409, R07: 409, R09: 409, R10: 409 };
  for (const [code, want] of Object.entries(expectApprove)) {
    const run = await call(SA, "POST", "/api/he/shortlist/run", { requisitionId: ids[code], sourceKind: "he" });
    const ap = run.status === 200 ? await call(SA, "POST", "/api/he/shortlist/approve", { requisitionId: ids[code], sourceKind: "he", runId: run.json.data.runId, note: "rig" }) : run;
    ok(`${code}: approve -> ${want}${want === 409 ? ` (${ap.json?.message ?? ""})` : ""}`, ap.status === want, { run: run.status, ap: ap.status, msg: ap.json?.message });
  }
  const r06 = await call(SA, "POST", "/api/he/shortlist/run", { requisitionId: ids.R06, sourceKind: "he" });
  ok("R06 refusal says past its hiring deadline", /past its hiring deadline/.test((await call(SA, "POST", "/api/he/shortlist/approve", { requisitionId: ids.R06, sourceKind: "he", runId: r06.json.data.runId })).json?.message ?? ""));
  const r07 = await call(SA, "POST", "/api/he/shortlist/run", { requisitionId: ids.R07, sourceKind: "he" });
  ok("R07 refusal says the seats are filled", /seats/.test((await call(SA, "POST", "/api/he/shortlist/approve", { requisitionId: ids.R07, sourceKind: "he", runId: r07.json.data.runId })).json?.message ?? ""));
  // empty criteria: only the enrolment mode set -> criteria_incomplete
  await call(SA, "PUT", `/api/job-requisition/${ids.R08}/criteria`, { patch: { educationRequirement: null, ageMin: null, ageMax: null, targetLocations: null, experienceMinYears: null, experienceMaxYears: null, rotationalShift: 0, nightShiftRequired: 0, selectionRules: { schema: 1, rules: {}, enrolment: { mode: "hr_approves", standingApprovalDays: 7 } } }, reason: "rig empty" });
  const r08 = await call(SA, "POST", "/api/he/shortlist/run", { requisitionId: ids.R08, sourceKind: "he" });
  const ap08 = await call(SA, "POST", "/api/he/shortlist/approve", { requisitionId: ids.R08, sourceKind: "he", runId: r08.json?.data?.runId });
  ok("R08 with empty criteria: approve -> 409 criteria_incomplete", ap08.status === 409 && /criteria_incomplete/.test(ap08.json?.message ?? ""), ap08.json);
  const pv08 = await call(SA, "GET", `/api/job-requisition/${ids.R08}/selection/preview?source=he`);
  ok("R08 with empty criteria: the preview still runs, no MUST steps", pv08.status === 200 && pv08.json.data.steps.every((s) => s.kind !== "must"), pv08.json?.data?.steps);
  // version drift
  const r01 = await call(SA, "POST", "/api/he/shortlist/run", { requisitionId: ids.R01, sourceKind: "he" });
  await call(SA, "PUT", `/api/job-requisition/${ids.R01}/criteria`, { patch: { ageMax: 39 }, reason: "rig drift" });
  const drift = await call(SA, "POST", "/api/he/shortlist/approve", { requisitionId: ids.R01, sourceKind: "he", runId: r01.json.data.runId });
  ok("criteria changed after the run -> 409 re-run", drift.status === 409 && /criteria changed/.test(drift.json?.message ?? ""), drift.json);

  // ── 3. night shift and missing data ──
  const pv02 = await call(SA, "GET", `/api/job-requisition/${ids.R02}/selection/preview?source=he`);
  const nightStep = pv02.json?.data?.steps?.find((s) => s.key === "night_shift");
  ok("R02 (night shift): the funnel has a night-shift step and unknown night-shift answers go to review", !!nightStep && nightStep.reviewHere > 0, pv02.json?.data?.steps);
  let prev = pv02.json.data.start;
  ok("R02 funnel invariant (remaining = previous - failed here)", pv02.json.data.steps.every((s) => { const okk = s.remaining === prev - s.failedHere; prev = s.remaining; return okk; }));
  const ccc = await call(SA, "GET", `/api/job-requisition/selection/why?q=9999900206&requisitionId=${ids.R01}`);
  const cccR01 = ccc.json?.data?.[0]?.perRequisition?.[0];
  // 'ccc' address and locality, but the profile says "Uttar Pradesh": a state alone names no city -> unknown, review (never a silent fail)
  ok("WorkIndia 'ccc' (state-only profile): location unknown, verdict review", cccR01?.verdict === "review" && cccR01.unknown.some((u) => /names none of Noida/.test(u.actualText)), cccR01);
  const legacy = await call(SA, "GET", "/api/job-requisition/selection/why?q=9999900207");
  ok("legacy employee: never contacted, explained", legacy.json?.data?.[0]?.perRequisition?.every((r) => r.explanation === "Never contacted: former employee record (legacy import)"), legacy.json?.data?.[0]?.perRequisition?.[0]);
  const test = await call(SA, "GET", "/api/job-requisition/selection/why?q=9999900208");
  ok("test record: never contacted", test.json?.data?.[0]?.perRequisition?.every((r) => r.systemBlock === "test"));
  const pvMeta = await call(SA, "GET", `/api/job-requisition/${ids.R01}/selection/preview?source=meta_live`);
  const ageStep = pvMeta.json?.data?.steps?.find((s) => s.key === "age");
  ok("Live Meta: age unknown passes (missingBySource meta_live pass), never sent to review", pvMeta.status === 200 && (!ageStep || ageStep.reviewHere === 0), ageStep);

  // ── 4. multi-requisition campaign and branch scoping ──
  const meera = await call(SA, "GET", "/api/job-requisition/selection/why?q=9999900113");
  const byCode = Object.fromEntries((meera.json?.data?.[0]?.perRequisition ?? []).map((r) => [r.code, r]));
  ok("one person, two branches: Ahmedabad resident fails NOIDA-2 location, not Ahmedabad's", byCode["RIG-R01"]?.failed?.some((f) => f.key === "location_cities") && !byCode["RIG-R04"]?.failed?.some((f) => f.key === "location_cities"),
    { r01: byCode["RIG-R01"]?.failed, r04: byCode["RIG-R04"]?.failed });
  ok("Ahmedabad HR: NOIDA-2 preview 404", (await call(S.branch_hr_ahm, "GET", `/api/job-requisition/${ids.R01}/selection/preview`)).status === 404);
  const ahmWhy = await call(S.branch_hr_ahm, "GET", "/api/job-requisition/selection/why?q=9999900113");
  ok("Ahmedabad HR: why-not shows only Ahmedabad requisitions", (ahmWhy.json?.data?.[0]?.perRequisition ?? []).every((r) => ["RIG-R03", "RIG-R04"].includes(r.code)) && ahmWhy.json.data[0].perRequisition.length > 0,
    ahmWhy.json?.data?.[0]?.perRequisition?.map((r) => r.code));
  // I3: people are scoped too; ceo / manager roles cannot look people up
  const ahmOther = await call(S.branch_hr_ahm, "GET", "/api/job-requisition/selection/why?q=9999900103");
  ok("Ahmedabad HR: a NOIDA-2-only person is 'not found in your scope' (no masked entry, no values)", ahmOther.status === 200 && Array.isArray(ahmOther.json?.data) && ahmOther.json.data.length === 0 && ahmOther.json.message === "Not found in your scope", ahmOther.json);
  ok("CEO: why-not lookup is 403 (preview-export / override roles only)", (await call(S.ceo, "GET", "/api/job-requisition/selection/why?q=9999900103")).status === 403);
  ok("Ahmedabad HR: shortlist run on NOIDA-2 -> 404", (await call(S.branch_hr_ahm, "POST", "/api/he/shortlist/run", { requisitionId: ids.R01, sourceKind: "he" })).status === 404);

  // ── 5. contradictory rules ──
  ok("contradictory age band -> 422", (await call(SA, "PUT", `/api/job-requisition/${ids.R01}/criteria`, { patch: { ageMin: 40, ageMax: 30 }, reason: "x" })).status === 422);
  ok("contradictory draft preview -> 422", (await call(SA, "POST", `/api/job-requisition/${ids.R01}/selection/preview`, { source: "he", draft: { ageMin: 40, ageMax: 30 } })).status === 422);
  const emp = await call(SA, "PUT", `/api/job-requisition/${ids.R01}/criteria`, { patch: { selectionRules: { schema: 1, rules: {
    employer_include: { mode: "prefer", weight: 5, value: ["Acme"] }, employer_exclude: { mode: "must", value: ["acme"] } } } }, reason: "x" });
  ok("same employer on include and exclude -> 422", emp.status === 422, emp.json);
  const wi = await call(SA, "POST", `/api/job-requisition/${ids.R01}/selection/preview`, { source: "he", draft: { educationRequirement: "Post Graduate" } });
  const savedPv = await call(SA, "GET", `/api/job-requisition/${ids.R01}/selection/preview?source=he`);
  ok("what-if: a stricter draft shortlists fewer, nothing saved", wi.status === 200 && wi.json.data.draft === true && wi.json.data.outcome.shortlist <= savedPv.json.data.outcome.shortlist
    && (await q("SELECT education_requirement e FROM job_requisition WHERE id = ?", [ids.R01]))[0].e === "12th");

  // ── 6. overrides ──
  const inc = await call(S.branch_hr_noida2, "PUT", "/api/he/shortlist/override", { mobile: "9999900103", requisitionScope: ids.R01, kind: "include", reason: "rig: client met him" });
  const whyInc = await call(S.branch_hr_noida2, "GET", `/api/job-requisition/selection/why?q=9999900103&requisitionId=${ids.R01}`);
  ok("include on someone who fails age -> pass with the HR reason", inc.status === 200 && whyInc.json?.data?.[0]?.perRequisition?.[0]?.verdict === "pass" && whyInc.json.data[0].perRequisition[0].override?.reason === "rig: client met him", whyInc.json?.data?.[0]?.perRequisition?.[0]);
  const incLegacy = await call(SA, "PUT", "/api/he/shortlist/override", { mobile: "9999900207", requisitionScope: ids.R01, kind: "include", reason: "rig" });
  ok("include on a legacy employee warns: system exclusion cannot be overridden", incLegacy.json?.data?.warning === "system exclusion cannot be overridden (legacy_employee)", incLegacy.json);
  ok("override history is logged", (await q("SELECT COUNT(*) n FROM shortlist_override_log WHERE mobile10 = '9999900103'"))[0].n >= 1);

  // ── 7. approval + enrol (switch off, then on; dry run) ──
  const run1 = await call(SA, "POST", "/api/he/shortlist/run", { requisitionId: ids.R01, sourceKind: "he" });
  const picked = await q("SELECT mobile10, status FROM shortlist_candidate WHERE run_id = ?", [run1.json.data.runId]);
  const pickedOnly = picked.filter((p) => p.status === "picked");
  ok("the R01 run picks people to approve", pickedOnly.length >= 2, picked.map((p) => p.status));
  const people = await call(SA, "GET", `/api/he/shortlist/run/${run1.json.data.runId}/candidates`);
  ok("run people for the approve bar: masked, row ids only", people.status === 200 && people.json.data.items.length > 0 && !/\b[6-9]\d{9}\b/.test(people.text), people.text.slice(0, 200));
  ok("ceo and recruiter cannot list a run's people (403)", (await call(S.ceo, "GET", `/api/he/shortlist/run/${run1.json.data.runId}/candidates`)).status === 403
    && (await call(S.recruiter, "GET", `/api/he/shortlist/run/${run1.json.data.runId}/candidates`)).status === 403);
  // the approve bar unticks by row id (the screen never holds full mobiles)
  const untickIds = people.json.data.items.filter((p) => p.status === "picked").slice(0, 1).map((p) => p.id);
  const ap1 = await call(SA, "POST", "/api/he/shortlist/approve", { requisitionId: ids.R01, sourceKind: "he", runId: run1.json.data.runId, untickIds, note: "rig batch" });
  ok("approve with untick by row id: the unticked person is not approved", ap1.status === 200 && untickIds.length === 1 && (await q("SELECT status FROM shortlist_candidate WHERE id = ?", [untickIds[0]]))[0]?.status === "unticked", ap1.json);
  const en0 = await call(SA, "POST", "/api/he/shortlist/enrol", { requisitionId: ids.R01, sourceKind: "he" });
  ok("enrol switch off: nothing enrolled", en0.json?.data?.status === "enrol_switch_off" && (await q("SELECT COUNT(*) n FROM qualified_followup WHERE origin_label = 'Approved shortlist'"))[0].n === 0, en0.json);
  await q("INSERT INTO he_model_param (param_key, value, sample) VALUES ('policy.shortlist.enrol', 1, 0) ON DUPLICATE KEY UPDATE value = 1");
  // unified enrolment: a source enrols only with its own screen switch (policy.followup.<source>; 1 = dry run, capped by QUAL_FOLLOWUP_MODE)
  await q("INSERT INTO he_model_param (param_key, value, sample) VALUES ('policy.followup.he', 1, 0) ON DUPLICATE KEY UPDATE value = 1");
  const en1 = await call(SA, "POST", "/api/he/shortlist/enrol", { requisitionId: ids.R01, sourceKind: "he" });
  const enrolledRows = await q("SELECT mode_at_enqueue FROM qualified_followup WHERE origin_label = 'Approved shortlist' AND requisition_id = ?", [ids.R01]);
  ok("enrol switch on: approved people enrolled as dry-run rows (no sends)", en1.json?.data?.enrolled === ap1.json?.data?.approved && enrolledRows.length > 0 && enrolledRows.every((r) => r.mode_at_enqueue === "dry_run"),
    { en1: en1.json, rows: enrolledRows.length, ap1: ap1.json, picked: picked.map((p) => p.status), cands: await q("SELECT status, COUNT(*) n FROM shortlist_candidate WHERE requisition_id = ? GROUP BY status", [ids.R01]) });

  // ── 8. standing approval (Live Meta) ──
  const runM = await call(SA, "POST", "/api/he/shortlist/run", { requisitionId: ids.R01, sourceKind: "meta_live" });
  await call(SA, "POST", "/api/he/shortlist/approve", { requisitionId: ids.R01, sourceKind: "meta_live", runId: runM.json.data.runId });
  const ver = (await q("SELECT id FROM job_requisition_criteria_version WHERE requisition_id = ? ORDER BY version_no DESC LIMIT 1", [ids.R01]))[0].id;
  ok("standing approval longer than 7 days -> 400", (await call(SA, "POST", "/api/he/shortlist/approve-standing", { requisitionId: ids.R01, versionId: ver, days: 9 })).status === 400);
  const st = await call(SA, "POST", "/api/he/shortlist/approve-standing", { requisitionId: ids.R01, versionId: ver, days: 7 });
  ok("standing approval for the current version after a first Live Meta batch", st.status === 200 && !!st.json.data.validUntil, st.json);
  ok("standing approval can be revoked", (await call(SA, "DELETE", `/api/he/shortlist/approve-standing/${st.json.data.approvalId}`)).status === 200);

  // ── 9. criteria change after enrolment (guard on in this backend) ──
  const enrolledMobiles = (await q("SELECT mobile10 FROM qualified_followup WHERE origin_label = 'Approved shortlist' AND requisition_id = ?", [ids.R01])).map((r) => r.mobile10);
  await call(SA, "PUT", `/api/job-requisition/${ids.R01}/criteria`, { patch: { ageMax: 22 }, reason: "rig: younger band" });
  await sleep(2500);
  const verdicts = await q("SELECT mobile10, criteria_verdict, criteria_version_id FROM qualified_followup WHERE origin_label = 'Approved shortlist' AND requisition_id = ?", [ids.R01]);
  const newVer = (await q("SELECT id FROM job_requisition_criteria_version WHERE requisition_id = ? ORDER BY version_no DESC LIMIT 1", [ids.R01]))[0].id;
  ok("a criteria change re-checks enrolled people against the new version", enrolledMobiles.length > 0 && verdicts.every((v) => v.criteria_version_id === newVer && v.criteria_verdict), verdicts);
  ok("people over the new age band now fail", verdicts.some((v) => v.criteria_verdict === "fail"), verdicts);
  const bm = await call(SA, "GET", `/api/he/shortlist/booked-mismatch?requisitionId=${ids.R01}`);
  ok("booked-mismatch list answers (masked)", bm.status === 200 && Array.isArray(bm.json.data) && bm.json.data.every((x) => /x{6}/.test(x.maskedMobile)), bm.json);
  ok("a recruiter cannot read the booked-mismatch list", (await call(S.recruiter, "GET", `/api/he/shortlist/booked-mismatch?requisitionId=${ids.R01}`)).status === 403);
} finally {
  await reset();
}
console.log(JSON.stringify({ pass, fail: failN }));
await pool.end();
process.exit(failN ? 1 : 0);
