// Rig API e2e (he-e2e2, jd_rig on backend 5420) for the requisition text suggestions (S-O8): per role, accept through the audited
// criteria path, approved needs a reason, closed 409, dismiss/undo, the AHMEDABAD config case and the night-shift draft.
//   RIG_API=http://127.0.0.1:5420 RIG_DB=jd_rig node backend/scripts/he-e2e/jd-suggest-api.e2e.mjs
import { api, apiLogin, closeDb, q, suite } from "/home/shuvam/he-e2e2/lib/rig.mjs";

if (process.env.RIG_DB !== "jd_rig" || !/:5420$/.test(process.env.RIG_API ?? "")) { console.error("refusing: RIG_DB=jd_rig and RIG_API=...:5420 required"); process.exit(2); }
const { ok, step, done } = suite("jd_suggest_api");
const ID = (code) => `jdrig-${code}`.toLowerCase();
const U = (code) => `/api/job-requisition/${ID(code)}/criteria/suggestions`;
const S = {};
for (const r of ["super_admin", "admin", "hr", "recruiter", "ceo", "branch_hr_ahm", "branch_hr_noida2"]) S[r] = await apiLogin(r);
const get = (role, code) => api(S[role], "GET", U(code));
const keysOf = (res) => (res.json?.data?.suggestions ?? []).map((s) => `${s.key}:${s.mode}`);
const audit = (code) => q("SELECT field, source, reason, approval_status_at_change AS st, actor_role FROM job_requisition_criteria_audit WHERE requisition_id = ? ORDER BY id", [ID(code)]);
const row = async (code) => (await q("SELECT education_requirement, night_shift_required, shift_requirement, meta_screening_config, selection_rules, skills_required FROM job_requisition WHERE id = ?", [ID(code)]))[0];

await step("the 9 real approved texts give the expected suggestions (super_admin)", async () => {
  const want = {
    "AHMEDABAD-SBI-1": [], "REQ-2608-LRD0": ["skills:must", "english:prefer", "languages:prefer", "notice_period:prefer", "age:must"],
    ...Object.fromEntries(["17", "18", "20", "21", "22", "23", "24"].map((n) => [`NOIDA-Onfido-${n}`, ["education_min:must", "typing:prefer"]])),
  };
  for (const [code, keys] of Object.entries(want)) {
    const r = await get("super_admin", code);
    ok(`${code}: 200`, r.status === 200, r.status);
    ok(`${code}: ${keys.join(", ") || "none"}`, JSON.stringify(keysOf(r)) === JSON.stringify(keys), keysOf(r));
  }
  const a = (await get("super_admin", "AHMEDABAD-SBI-1")).json.data;
  ok("AHMEDABAD-SBI-1: no text, honest state", a.current.hasText === false && a.unparsed.length === 0, a.current);
  const o = (await get("super_admin", "NOIDA-Onfido-17")).json.data;
  ok("Onfido-17: structured criteria empty -> 'found in text' state", o.current.structuredEmpty === true && o.current.legacy === true, o.current);
  ok("Onfido-17: every suggestion carries its source phrase", o.suggestions.every((s) => s.phrase === "Graduation with good typing speed" && s.matched), o.suggestions);
});

await step("roles: read roles 200, recruiter 403, view-only cannot write, scope 404", async () => {
  ok("recruiter GET 403", (await get("recruiter", "NOIDA-Onfido-17")).status === 403);
  const ceo = await get("ceo", "NOIDA-Onfido-17");
  ok("ceo GET 200, edit false", ceo.status === 200 && ceo.json.data.permissions.edit === false, ceo.json?.data?.permissions);
  const id = ceo.json.data.suggestions[0].id;
  ok("ceo accept 403", (await api(S.ceo, "POST", `${U("NOIDA-Onfido-17")}/accept`, { ids: [id], reason: "x" })).status === 403);
  ok("ceo dismiss 403", (await api(S.ceo, "POST", `${U("NOIDA-Onfido-17")}/dismiss`, { ids: [id] })).status === 403);
  const adm = await get("admin", "REQ-2608-LRD0");
  ok("admin (NOIDA) GET LRD0 200, edit false", adm.status === 200 && adm.json.data.permissions.edit === false, adm.status);
  ok("admin accept 403", (await api(S.admin, "POST", `${U("REQ-2608-LRD0")}/accept`, { ids: ["x"] })).status === 403);
  ok("branch HR AHMEDABAD cannot see a NOIDA-2 requisition (404)", (await get("branch_hr_ahm", "NOIDA-Onfido-17")).status === 404);
  ok("branch HR NOIDA-2 sees it", (await get("branch_hr_noida2", "NOIDA-Onfido-17")).status === 200);
});

await step("approved requisition: reason required; accept writes one version + audit through the criteria path", async () => {
  const d = (await get("branch_hr_noida2", "NOIDA-Onfido-18")).json.data;
  const ids = Object.fromEntries(d.suggestions.map((s) => [s.key, s.id]));
  const before = await audit("NOIDA-Onfido-18");
  const noReason = await api(S.branch_hr_noida2, "POST", `${U("NOIDA-Onfido-18")}/accept`, { ids: [ids.education_min] });
  ok("no reason: 400", noReason.status === 400 && /reason is required/i.test(noReason.json?.message ?? ""), noReason.json);
  const noNumber = await api(S.branch_hr_noida2, "POST", `${U("NOIDA-Onfido-18")}/accept`, { ids: [ids.typing], reason: "x" });
  ok("typing without a number: 400", noNumber.status === 400 && /needs a number/.test(noNumber.json?.message ?? ""), noNumber.json);
  ok("nothing written by the refusals", (await audit("NOIDA-Onfido-18")).length === before.length);
  const dry = await api(S.branch_hr_noida2, "POST", `${U("NOIDA-Onfido-18")}/accept`, { ids: [ids.education_min, ids.typing], values: { [ids.typing]: 25 }, reason: "Owner: criteria are in the text", dryRun: true });
  ok("dry run 200, no version", dry.status === 200 && dry.json.data.versionId === null && dry.json.data.leavesLegacy === true, dry.json);
  const r = await api(S.branch_hr_noida2, "POST", `${U("NOIDA-Onfido-18")}/accept`, { ids: [ids.education_min, ids.typing], values: { [ids.typing]: 25 }, reason: "Owner: criteria are in the text" });
  ok("accept 200 with a version", r.status === 200 && r.json.data.versionNo > 0, r.json);
  const db = await row("NOIDA-Onfido-18");
  const cfg = typeof db.meta_screening_config === "string" ? JSON.parse(db.meta_screening_config) : db.meta_screening_config;
  const sr = typeof db.selection_rules === "string" ? JSON.parse(db.selection_rules) : db.selection_rules;
  ok("DB: education Graduate, typing 25, auto_notify kept", db.education_requirement === "Graduate" && cfg.min_typing_speed_wpm === 25 && cfg.auto_notify === true, { e: db.education_requirement, cfg });
  ok("DB: rule modes education MUST, typing PREFER", sr?.rules?.education_min?.mode === "must" && sr?.rules?.typing?.mode === "prefer", sr);
  ok("DB: skills text untouched", db.skills_required === "Graduation with good typing speed", db.skills_required);
  const a = (await audit("NOIDA-Onfido-18")).slice(before.length);
  ok("audit: education, config and rules rows, source jd_suggestion, approved, with the reason", a.length === 3 && a.every((x) => x.source === "jd_suggestion" && x.st === "approved" && x.reason === "Owner: criteria are in the text" && x.actor_role === "hr"), a);
  const v = await q("SELECT source, reason FROM job_requisition_criteria_version WHERE requisition_id = ? ORDER BY version_no DESC LIMIT 1", [ID("NOIDA-Onfido-18")]);
  ok("version row source jd_suggestion", v[0]?.source === "jd_suggestion", v);
  const after = (await get("branch_hr_noida2", "NOIDA-Onfido-18")).json.data;
  ok("nothing left to suggest; structured criteria no longer empty", after.suggestions.length === 0 && after.current.structuredEmpty === false && after.current.legacy === false, after.current);
  const stale = await api(S.branch_hr_noida2, "POST", `${U("NOIDA-Onfido-18")}/accept`, { ids: [ids.education_min], reason: "again" });
  ok("accepting an applied suggestion again: 409 (no longer applies)", stale.status === 409, stale.json);
});

await step("dismiss is remembered and audited; undo shows it again", async () => {
  const d = (await get("super_admin", "NOIDA-Onfido-20")).json.data;
  const t = d.suggestions.find((s) => s.key === "typing");
  const r = await api(S.super_admin, "POST", `${U("NOIDA-Onfido-20")}/dismiss`, { ids: [t.id] });
  ok("dismiss 200", r.status === 200, r.json);
  const g = (await get("hr", "NOIDA-Onfido-20"));
  ok("hidden for everyone; listed as dismissed", g.status !== 200 || (g.json.data.suggestions.every((s) => s.id !== t.id) && g.json.data.dismissed.some((s) => s.id === t.id)), g.status);
  const g2 = (await get("super_admin", "NOIDA-Onfido-20")).json.data;
  ok("super_admin sees it dismissed", g2.dismissed.map((s) => s.key).join() === "typing" && keysOf({ json: { data: g2 } }).join() === "education_min:must", g2);
  const a = await audit("NOIDA-Onfido-20");
  ok("audit row jd_suggestion_dismissed", a.some((x) => x.field === "jd_suggestion_dismissed" && x.source === "jd_suggestion"), a);
  await api(S.super_admin, "POST", `${U("NOIDA-Onfido-20")}/dismiss`, { ids: [t.id], undo: true });
  ok("undo: back in the list", (await get("super_admin", "NOIDA-Onfido-20")).json.data.suggestions.some((s) => s.id === t.id));
});

await step("night-shift draft: no reason needed; the flag is set", async () => {
  const d = (await get("branch_hr_noida2", "NIGHT-1")).json.data;
  const n = d.suggestions.find((s) => s.key === "night_shift");
  ok("night shift MUST from the shift field", n?.mode === "must" && n.matched === "Night", d.suggestions);
  const r = await api(S.branch_hr_noida2, "POST", `${U("NIGHT-1")}/accept`, { ids: [n.id] });
  ok("accept without a reason on a draft: 200", r.status === 200, r.json);
  const db = await row("NIGHT-1");
  ok("DB: night_shift_required 1, shift text kept", Number(db.night_shift_required) === 1 && db.shift_requirement === "Night", db);
  const v = await q("SELECT reason FROM job_requisition_criteria_version WHERE requisition_id = ? ORDER BY version_no DESC LIMIT 1", [ID("NIGHT-1")]);
  ok("version reason names the phrase", v[0]?.reason === 'Accepted from the requisition text: "Night"', v);
});

await step("closed requisition: read, but accept and dismiss are 409", async () => {
  const g = await get("super_admin", "CLOSED-19");
  ok("GET 200 with suggestions", g.status === 200 && g.json.data.suggestions.length === 2, g.status);
  const id = g.json.data.suggestions[0].id;
  const before = await audit("CLOSED-19");
  ok("accept 409", (await api(S.super_admin, "POST", `${U("CLOSED-19")}/accept`, { ids: [id], reason: "x" })).status === 409);
  ok("dismiss 409", (await api(S.super_admin, "POST", `${U("CLOSED-19")}/dismiss`, { ids: [id] })).status === 409);
  ok("nothing written", (await audit("CLOSED-19")).length === before.length);
});

await step("AHMEDABAD config: DRA already set is skipped; accepting leaves the screening config intact", async () => {
  ok("branch HR NOIDA-2 cannot see AHMEDABAD (404)", (await get("branch_hr_noida2", "AHM-DRA")).status === 404);
  const d = (await get("branch_hr_ahm", "AHM-DRA")).json.data;
  ok("certificate skipped as already set", d.skipped.map((s) => s.key).join() === "certificate", d.skipped);
  ok("only education 12th MUST suggested", keysOf({ json: { data: d } }).join() === "education_min:must" && d.suggestions[0].value.level === "12th", d.suggestions);
  const cfgBefore = (await row("AHM-DRA")).meta_screening_config;
  const r = await api(S.branch_hr_ahm, "POST", `${U("AHM-DRA")}/accept`, { ids: d.suggestions.map((s) => s.id) });
  ok("accept 200", r.status === 200, r.json);
  const db = await row("AHM-DRA");
  ok("config identical (auto_notify, DRA, custom_field_rules)", JSON.stringify(db.meta_screening_config) === JSON.stringify(cfgBefore), { before: cfgBefore, after: db.meta_screening_config });
  ok("education 12th", db.education_requirement === "12th", db.education_requirement);
});

await step("bad input: 400", async () => {
  for (const body of [{}, { ids: [] }, { ids: ["a"], reason: "x".repeat(301) }, { ids: ["a"], values: { a: "25" } }]) {
    const r = await api(S.super_admin, "POST", `${U("NOIDA-Onfido-21")}/accept`, body);
    ok(`accept ${JSON.stringify(body).slice(0, 40)} -> 400`, r.status === 400, r.status);
  }
});

await closeDb();
process.exit(done() ? 1 : 0);
