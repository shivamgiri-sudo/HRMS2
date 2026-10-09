// Rig only (he-e2e2, scratch DB jd_rig): adds requisitions carrying the REAL prod requisition texts (the fixture of
// jdSuggestions.test.ts, texts only) next to the shared seed, plus a night-shift draft, a closed one and an AHMEDABAD DRA variant.
//   RIG_DB=jd_rig node backend/scripts/he-e2e/jd-suggest-rig-seed.mjs
import fs from "node:fs";
import { createRequire } from "node:module";

const DB = process.env.RIG_DB;
if (DB !== "jd_rig") { console.error("refusing: RIG_DB must be jd_rig"); process.exit(2); }
const require = createRequire(new URL("../../package.json", import.meta.url));
const mysql = require("mysql2/promise");
const c = await mysql.createConnection({ host: "127.0.0.1", port: 3312, user: "root", password: "x", database: DB, timezone: "+05:30" });
const fixture = JSON.parse(fs.readFileSync(new URL("../../src/modules/selection/__tests__/fixtures/jd-requisition-texts.json", import.meta.url), "utf8"));
const real = (code) => fixture.rows.find((r) => r.code === code);

const RIG_BRANCH = { "NOIDA-2": "RIG-R01", NOIDA: "RIG-R05", AHMEDABAD: "RIG-R03" };
const toRigBranch = (b) => (b.startsWith("AHMEDABAD") ? "AHMEDABAD" : b);
const ROWS = [
  ...["AHMEDABAD-SBI-1", "NOIDA-Onfido-17", "NOIDA-Onfido-18", "NOIDA-Onfido-20", "NOIDA-Onfido-21", "NOIDA-Onfido-22", "NOIDA-Onfido-23", "NOIDA-Onfido-24", "REQ-2608-LRD0"]
    .map((code) => ({ code, src: real(code), status: "approved" })),
  { code: "NIGHT-1", src: { ...real("NOIDA-Onfido-17"), shiftRequirement: "Night" }, status: "draft" },
  { code: "CLOSED-19", src: real("NOIDA-Onfido-19"), status: "closed" },
  { code: "AHM-DRA", src: { ...real("AHMEDABAD-SBI-1"), skillsRequired: "DRA certificate mandatory, 12th pass" }, status: "draft" },
];

const [cols] = await c.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'job_requisition' ORDER BY ORDINAL_POSITION", [DB]);
const names = cols.map((x) => x.COLUMN_NAME);
// a re-seed is a clean slate for these rows: their versions, audit rows and dismissals go too
for (const t of ["job_requisition_criteria_audit", "job_requisition_criteria_version"]) await c.query(`DELETE FROM ${t} WHERE requisition_id LIKE 'jdrig-%'`);
for (const r of ROWS) {
  const branch = toRigBranch(r.src.branchName);
  const [[tpl]] = await c.query("SELECT * FROM job_requisition WHERE requisition_code = ?", [RIG_BRANCH[branch]]);
  const [[br]] = await c.query("SELECT branch_id, branch_name FROM job_requisition WHERE requisition_code = ?", [RIG_BRANCH[branch]]);
  const id = `jdrig-${r.code}`.toLowerCase().slice(0, 36);
  const row = {
    ...tpl, id, requisition_code: `JD-${r.code}`, branch_id: br.branch_id, branch_name: br.branch_name, process_name: r.src.processName, designation_name: "EXECUTIVE",
    requested_headcount: 20, fulfilled_headcount: 0, approval_status: r.status, active_status: 1, // prod keeps closed requisitions active_status 1 (e.g. NOIDA-Onfido-19)
    closed_at: r.status === "closed" ? new Date() : null, closed_reason: r.status === "closed" ? "filled_externally" : null,
    requisition_validity: new Date(Date.now() + 30 * 864e5), target_joining_date: new Date(Date.now() + 25 * 864e5), training_start_date: new Date(Date.now() + 28 * 864e5),
    education_requirement: r.src.educationRequirement, skills_required: r.src.skillsRequired, job_description: r.src.jobDescription, business_justification: r.src.businessJustification,
    shift_requirement: r.src.shiftRequirement, night_shift_required: 0, rotational_shift: 0, experience_min_years: null, experience_max_years: null,
    meta_target_age_min: null, meta_target_age_max: null, meta_target_locations: null, meta_target_radius_km: null,
    meta_screening_config: r.src.screeningConfig ? JSON.stringify(r.src.screeningConfig) : null, selection_rules: null, bmi_assessment_url: null,
  };
  const keys = names.filter((k) => k in row);
  await c.query(`DELETE FROM job_requisition WHERE id = ?`, [id]);
  await c.query(`INSERT INTO job_requisition (${keys.map((k) => `\`${k}\``).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
    keys.map((k) => (row[k] !== null && typeof row[k] === "object" && !(row[k] instanceof Date) && !Buffer.isBuffer(row[k]) ? JSON.stringify(row[k]) : row[k])));
}
console.log(`jd-suggest seed: ${ROWS.length} requisitions with real texts (${ROWS.map((r) => `JD-${r.code}`).join(", ")})`);
await c.end();
