// Rig e2e (he-e2e2): selection criteria API (S5) per role and approved-requisition edits, against a running backend.
// Never prod: refuses any DB other than the rig container (127.0.0.1:3312). Defaults to an isolated clone of the rig DB.
//   CRIT_API=http://127.0.0.1:5395 CRIT_DB=crit_rig node backend/scripts/he-e2e/criteria-permissions.e2e.mjs
import { createRequire } from "node:module";

const API = process.env.CRIT_API ?? "http://127.0.0.1:5395";
const DB = process.env.CRIT_DB ?? "crit_rig";
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
const results = [];
const ok = (name, cond, detail = "") => { results.push({ name, ok: !!cond, detail }); cond ? pass++ : failN++; console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : `  -> ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`); };

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
  const t = await r.text(); let json = null; try { json = JSON.parse(t); } catch { /* text */ }
  return { status: r.status, json };
}
const idOf = async (code) => (await q("SELECT id FROM job_requisition WHERE requisition_code = ?", [code]))[0].id;
const versions = async (id) => Number((await q("SELECT COUNT(*) n FROM job_requisition_criteria_version WHERE requisition_id = ?", [id]))[0].n);

const R01 = await idOf("RIG-R01"); // NOIDA-2, approved
const R03 = await idOf("RIG-R03"); // AHMEDABAD, approved
const R05 = await idOf("RIG-R05"); // NOIDA, closed
const R06 = await idOf("RIG-R06"); // NOIDA, approved
const R09 = await idOf("RIG-R09"); // NOIDA-2, pending_approval
// Reset the criteria columns from the pristine rig seed (mas_hrms) so every run starts from the same state.
async function resetFromSeed() {
  if (DB === "mas_hrms") return;
  await q(`UPDATE ${DB}.job_requisition c JOIN mas_hrms.job_requisition m ON m.id = c.id
              SET c.education_requirement = m.education_requirement, c.skills_required = m.skills_required, c.meta_target_age_min = m.meta_target_age_min,
                  c.meta_target_age_max = m.meta_target_age_max, c.experience_min_years = m.experience_min_years, c.experience_max_years = m.experience_max_years,
                  c.night_shift_required = m.night_shift_required, c.shift_requirement = m.shift_requirement, c.meta_screening_config = m.meta_screening_config,
                  c.selection_rules = NULL`);
}
await resetFromSeed();

try {
const S = {};
for (const role of Object.keys(USERS)) S[role] = await login(role);
ok("every role logs in", Object.keys(S).length === 7);

// 1. read: the criteria view follows the requisition's own scope rule (same inScope) and the read roles
for (const role of Object.keys(USERS).filter((r) => r !== "admin")) for (const [code, id] of [["R01", R01], ["R03", R03]]) {
  const req = await call(S[role], "GET", `/api/job-requisition/${id}`);
  const crit = await call(S[role], "GET", `/api/job-requisition/${id}/criteria`);
  const want = req.status === 200 ? 200 : req.status === 403 && role !== "admin" ? 403 : req.status;
  ok(`${role} GET ${code}/criteria = requisition read (${req.status})`, crit.status === want || (role === "admin" && crit.status === req.status), { req: req.status, crit: crit.status });
}
// admin is not a requisition reader but is a Hiring Engine viewer: criteria readable, inside its (NOIDA) branch scope only
ok("admin (HE viewer, NOIDA) reads NOIDA R06 criteria", (await call(S.admin, "GET", `/api/job-requisition/${R06}/criteria`)).status === 200);
ok("admin gets 404 on NOIDA-2 / Ahmedabad criteria", (await call(S.admin, "GET", `/api/job-requisition/${R01}/criteria`)).status === 404 && (await call(S.admin, "GET", `/api/job-requisition/${R03}/criteria`)).status === 404);
ok("hr of NOIDA gets 404 writing a NOIDA-2 requisition (branch scope)", (await call(S.hr, "PUT", `/api/job-requisition/${R01}/criteria`, { patch: { skillsRequired: "x" }, reason: "x" })).status === 404);
ok("ceo reads criteria (HE viewer, org-wide)", (await call(S.ceo, "GET", `/api/job-requisition/${R01}/criteria`)).status === 200);

// 2. write gate on an approved requisition
const patch = { educationRequirement: "12th pass" };
for (const role of ["recruiter", "ceo", "admin"]) {
  const r = await call(S[role], "PUT", `/api/job-requisition/${R01}/criteria`, { patch, reason: "rig" });
  ok(`${role} cannot write criteria (403)`, r.status === 403, r.status);
}
const noReason = await call(S.branch_hr_noida2, "PUT", `/api/job-requisition/${R01}/criteria`, { patch });
ok("branch HR (NOIDA-2, role hr) on approved without a reason -> 400", noReason.status === 400, noReason.json?.message);
const v0 = await versions(R01);
const saved = await call(S.branch_hr_noida2, "PUT", `/api/job-requisition/${R01}/criteria`, { patch, reason: "Client asked for graduates (rig)" });
ok("branch HR on approved with a reason -> 200 + new version", saved.status === 200 && saved.json?.data?.versionNo > 0, saved.json);
ok("one version row added", (await versions(R01)) === v0 + 1);
const audit = await q("SELECT field, old_json, new_json, actor_role, approval_status_at_change, reason FROM job_requisition_criteria_audit WHERE requisition_id = ? ORDER BY id DESC LIMIT 1", [R01]);
ok("audit row: field, old -> new, actor role, status approved, reason", audit[0]?.field === "education_requirement" && audit[0].new_json === "12th pass" && audit[0].actor_role === "hr" && audit[0].approval_status_at_change === "approved" && /graduates/.test(audit[0].reason), audit[0]);
ok("column updated", (await q("SELECT education_requirement e FROM job_requisition WHERE id = ?", [R01]))[0].e === "12th pass");
const again = await call(S.branch_hr_noida2, "PUT", `/api/job-requisition/${R01}/criteria`, { patch, reason: "again" });
ok("same values again -> no new version", again.status === 200 && again.json?.data?.versionId === null && (await versions(R01)) === v0 + 1, again.json?.data);
const salary = await call(S.branch_hr_noida2, "PUT", `/api/job-requisition/${R01}/criteria`, { patch: { salaryMax: 99999 }, reason: "x" });
ok("salary (locked) -> 400 needs re-approval", salary.status === 400 && /re-approval/.test(salary.json?.message), salary.json);
const legacy = await call(S.branch_hr_noida2, "PATCH", `/api/job-requisition/${R01}`, { education_requirement: "12th" });
ok("legacy PATCH on approved criteria still 409", legacy.status === 409, legacy.status);
const contra = await call(S.branch_hr_noida2, "PUT", `/api/job-requisition/${R01}/criteria`, { patch: { ageMin: 40, ageMax: 30 }, reason: "x" });
ok("contradiction -> 422 with issues, nothing written", contra.status === 422 && contra.json?.issues?.length > 0 && (await versions(R01)) === v0 + 1, contra.json);
const closed = await call(S.super_admin, "PUT", `/api/job-requisition/${R05}/criteria`, { patch, reason: "x" });
ok("closed requisition -> 409", closed.status === 409, closed.status);
const sa = await call(S.super_admin, "PUT", `/api/job-requisition/${R03}/criteria`, { patch: { ageMin: 18, ageMax: 40 }, reason: "rig: band agreed" });
ok("super_admin edits an approved Ahmedabad requisition", sa.status === 200 && sa.json?.data?.versionNo > 0, sa.json);

// 3. branch HR: same scope as the requisition endpoints
for (const [role, code, id] of [["branch_hr_ahm", "R01", R01], ["branch_hr_noida2", "R03", R03], ["branch_hr_noida2", "R01", R01]]) {
  const req = await call(S[role], "GET", `/api/job-requisition/${id}`);
  const w = await call(S[role], "PUT", `/api/job-requisition/${id}/criteria`, { patch: { skillsRequired: "Excel" }, reason: "rig", dryRun: true });
  ok(`${role} write ${code}: in scope -> 200 (dry run), out of scope -> 404 (requisition read ${req.status})`, req.status === 200 ? w.status === 200 : w.status === 404, { req: req.status, write: w.status });
}

// 4. bulk / copy / template / audit
const vb = (await versions(R01)) + (await versions(R06));
const bulk = await call(S.super_admin, "POST", "/api/job-requisition/criteria/bulk", { requisitionIds: [R01, R06], patch: { ageMin: 18, ageMax: 35, educationRequirement: "12th" }, reason: "rig bulk" });
ok("bulk defaults to dry-run: diffs, filled fields skipped, nothing written", bulk.status === 200 && bulk.json.data.length === 2 && bulk.json.data[0].diff.some((d) => d.skipped === "filled") && (await versions(R01)) + (await versions(R06)) === vb, bulk.json?.data?.[0]);
const copyOut = await call(S.branch_hr_noida2, "POST", "/api/job-requisition/criteria/copy", { fromRequisitionId: R01, toRequisitionIds: [R03], keys: ["age"], dryRun: true });
ok("branch HR copying into another branch's requisition -> 403", copyOut.status === 403, copyOut.status);
const copy = await call(S.super_admin, "POST", "/api/job-requisition/criteria/copy", { fromRequisitionId: R03, toRequisitionIds: [R06], keys: ["age"], replaceFilled: true, reason: "rig copy", dryRun: false });
ok("copy age band from R03 to R06 writes one version with source copy", copy.status === 200 && copy.json.data[0].versionId && (await q("SELECT source FROM job_requisition_criteria_version WHERE id = ?", [copy.json.data[0].versionId]))[0]?.source === "copy", copy.json);
const tpl = await call(S.super_admin, "POST", `/api/job-requisition/${R06}/criteria/template`, { templateId: "telesales", reason: "rig template" });
ok("template apply defaults to dry-run and keeps filled fields", tpl.status === 200 && tpl.json.data.versionId === null && tpl.json.data.skipped.includes("age"), tpl.json?.data?.skipped);
const aud = await call(S.ceo, "GET", `/api/job-requisition/${R01}/criteria/audit`);
ok("ceo reads the audit trail", aud.status === 200 && aud.json.data.items.length >= 1, aud.status);

// 5. the requisition form path (non-approved): legacy PATCH records a 'form' version
await call(S.branch_hr_noida2, "PATCH", `/api/job-requisition/${R09}`, { experience_min_years: 3 });
const vf = await versions(R09);
const form = await call(S.branch_hr_noida2, "PATCH", `/api/job-requisition/${R09}`, { experience_min_years: 4, night_shift_required: true });
const lastSrc = (await q("SELECT source FROM job_requisition_criteria_version WHERE requisition_id = ? ORDER BY version_no DESC LIMIT 1", [R09]))[0]?.source;
ok("form PATCH on a pending requisition -> 200 and a new 'form' version", form.status === 200 && (await versions(R09)) === vf + 1 && lastSrc === "form", { status: form.status, lastSrc });
const same = await call(S.branch_hr_noida2, "PATCH", `/api/job-requisition/${R09}`, { experience_min_years: 4 });
ok("form PATCH that leaves the criteria unchanged adds no version", same.status === 200 && (await versions(R09)) === vf + 1);

} finally {
  await resetFromSeed();
}
console.log(JSON.stringify({ pass, fail: failN }));
await pool.end();
process.exit(failN ? 1 : 0);
