// Rig e2e (he-e2e2, WS3): campaign x requisition links, best-fit routing + HR placement, the matrix per role, the K7BK relink,
// the funnel per requisition, the Naukri / WorkIndia pool bridge (preview only) and the end-date warning. Isolated clone only.
//   WS3_API=http://127.0.0.1:5398 WS3_DB=ws3_rig node backend/scripts/he-e2e/ws3-campaign-matrix.e2e.mjs
// The backend under test runs with META_MULTI_REQ_ROUTING naming the C1 campaign (routing via the ingest helper uses the same env).
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const API = process.env.WS3_API ?? "http://127.0.0.1:5398";
const DB = process.env.WS3_DB ?? "ws3_rig";
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
const results = [];
const ok = (name, cond, detail = "") => { cond ? pass++ : failN++; results.push({ name, ok: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : `  -> ${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 500)}`}`); };
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
  const t = await r.text(); let json = null; try { json = JSON.parse(t); } catch { /* not json */ }
  return { status: r.status, json, text: t };
}
const FULL_MOBILE = /(?<![\d])[6-9]\d{9}(?![\d])/;
const R = Object.fromEntries((await q("SELECT requisition_code, id FROM job_requisition WHERE requisition_code LIKE 'RIG-R%'")).map((r) => [r.requisition_code.slice(4), r.id]));
const C = { c1: "77797932-b652-4f3f-a899-dac34eb57744", c3: "164e1940-c7b8-4ecc-ae79-ffa541be7cbf", c4: "2364f3dd-26b5-4c93-aba4-05d5b77e695c", c5: "3da0c174-9566-4490-ae1c-2e517f89b932",
  c6: "2cbfcc90-3b68-4b9c-a218-a3948fab4125", c2c: "c5d68ed9-4684-4392-a8ab-055c5361978b" };
// Reset this suite's own state so it can run again (clone only).
async function reset() {
  for (const sql of [
    "DELETE FROM qualified_followup WHERE mobile10 LIKE '99999004%'",
    "DELETE FROM meta_lead_raw WHERE meta_lead_id LIKE 'ws3-rt-%'",
    "DELETE FROM selection_person_fact WHERE mobile10 LIKE '99999004%'",
    "DELETE FROM meta_campaign_relink",
    `DELETE FROM meta_campaign_requisition WHERE campaign_id = '${C.c3}' AND requisition_id <> '${R.R05}'`,
    `UPDATE meta_campaign_requisition SET is_primary = 1, removed_at = NULL WHERE campaign_id = '${C.c3}' AND requisition_id = '${R.R05}'`,
    `UPDATE meta_campaign SET requisition_id = '${R.R05}' WHERE id = '${C.c3}'`,
    `UPDATE meta_lead_raw SET requisition_id = '${R.R05}', routed_by = NULL, routed_at = NULL WHERE campaign_id = '${C.c3}'`,
    `DELETE FROM meta_campaign_requisition WHERE campaign_id = '${C.c1}' AND requisition_id NOT IN ('${R.R01}', '${R.R02}')`,
    `UPDATE meta_campaign_requisition SET is_primary = (requisition_id = '${R.R01}'), removed_at = NULL WHERE campaign_id = '${C.c1}'`,
    `UPDATE meta_campaign SET requisition_id = '${R.R01}' WHERE id = '${C.c1}'`,
    // unified enrolment: Live Meta enrols only with its own screen switch (1 = dry run, capped by QUAL_FOLLOWUP_MODE); a missing row is off
    "INSERT INTO he_model_param (param_key, value, sample) VALUES ('policy.followup.meta_live', 1, 0) ON DUPLICATE KEY UPDATE value = 1",
  ]) await q(sql);
  execFileSync("bash", ["-c", `. /home/shuvam/he-e2e2/config.sh; rig_mysql ${DB} < /home/shuvam/he-e2e2/seed/ws3-seed.sql`]);
}
await reset();
if (process.env.WS3_RESET_ONLY) { console.log("reset done"); await pool.end(); process.exit(0); }
const H = {};
for (const role of Object.keys(USERS)) H[role] = await login(role);
const before = { qfu: Number((await q("SELECT COUNT(*) n FROM qualified_followup"))[0].n), heMsg: Number((await q("SELECT COUNT(*) n FROM he_message"))[0].n), approvals: Number((await q("SELECT COUNT(*) n FROM shortlist_approval"))[0].n) };

// ---------- 1. links ----------
{
  const sa = H.super_admin;
  const l = await call(sa, "GET", `/api/meta/campaigns/${C.c1}/requisitions`);
  ok("links: C1 holds R01 (main) and R02", l.status === 200 && l.json.data.map((x) => [x.code, x.isPrimary]).join() === "RIG-R01,true,RIG-R02,false", l.json);
  ok("links: rows carry criteria completeness, seats left and end date", l.json?.data?.[0]?.criteria?.label && typeof l.json.data[0].seatsLeft === "number" && l.json.data[0].endDate, l.json?.data?.[0]);
  const add = await call(sa, "POST", `/api/meta/campaigns/${C.c1}/requisitions`, { requisitionId: R.R04 });
  ok("links: adding a requisition past its end date is allowed with a warning", add.status === 201 && add.json.data.warnings.some((w) => w.includes("end date passed")), add.json);
  const prim = await call(sa, "PUT", `/api/meta/campaigns/${C.c1}/requisitions/${R.R02}/primary`);
  const mirror = (await q("SELECT requisition_id FROM meta_campaign WHERE id = ?", [C.c1]))[0].requisition_id;
  ok("links: make R02 main mirrors meta_campaign.requisition_id", prim.status === 200 && mirror === R.R02, { prim: prim.status, mirror });
  const rm = await call(sa, "DELETE", `/api/meta/campaigns/${C.c1}/requisitions/${R.R04}`);
  ok("links: remove a non-main link (soft)", rm.status === 200 && (await q("SELECT removed_at FROM meta_campaign_requisition WHERE campaign_id = ? AND requisition_id = ?", [C.c1, R.R04]))[0].removed_at, rm.json);
  const audit = Number((await q("SELECT COUNT(*) n FROM audit_action_log WHERE action_type LIKE 'META_CAMPAIGN_REQUISITION_%' AND entity_id = ?", [C.c1]))[0].n);
  ok("links: every link write is audited", audit >= 3, audit);
  ok("links: branch HR Ahmedabad gets 403 on a NOIDA-2 campaign", (await call(H.branch_hr_ahm, "GET", `/api/meta/campaigns/${C.c1}/requisitions`)).status === 403);
  ok("links: branch HR NOIDA-2 reads its campaign", (await call(H.branch_hr_noida2, "GET", `/api/meta/campaigns/${C.c1}/requisitions`)).status === 200);
  ok("links: CEO reads, cannot write", (await call(H.ceo, "GET", `/api/meta/campaigns/${C.c1}/requisitions`)).status === 200 && (await call(H.ceo, "POST", `/api/meta/campaigns/${C.c1}/requisitions`, { requisitionId: R.R04 })).status === 403);
  ok("links: recruiter reads (campaign read role), cannot write", (await call(H.recruiter, "GET", `/api/meta/campaigns/${C.c1}/requisitions`)).status === 200 && (await call(H.recruiter, "PUT", `/api/meta/campaigns/${C.c1}/requisitions/${R.R01}/primary`)).status === 403);
  ok("links: unknown requisition is 400", (await call(sa, "POST", `/api/meta/campaigns/${C.c1}/requisitions`, { requisitionId: "00000000-0000-4000-8000-000000000000" })).status === 400);
}

// ---------- 2. best-fit routing (primary is R02, the night-shift one) + HR placement ----------
{
  const env = { ...process.env };
  const out = execFileSync("bash", ["-c", `. /home/shuvam/he-e2e2/config.sh; cd ${process.env.WS3_WT ?? "/home/shuvam/wt-ws3"}/backend; set -a; . $RIG/backend.env.sh; DB_NAME=${DB}; WS3_DB=${DB}; META_MULTI_REQ_ROUTING=${C.c1}; set +a; $NODE --require $TSX_DIR/preflight.cjs --import file://$TSX_DIR/loader.mjs scripts/he-e2e/ws3-rig-ingest.ts rigform-c1 '${JSON.stringify([
    { leadgenId: "ws3-rt-1", fields: { full_name: "Rig Route Day", phone_number: "+919999900421", education: "Graduate", are_you_ok_with_night_shift: "No" } },
    { leadgenId: "ws3-rt-2", fields: { full_name: "Rig Route Night", phone_number: "+919999900422", education: "10th", are_you_ok_with_night_shift: "Yes" } },
    { leadgenId: "ws3-rt-3", fields: { full_name: "Rig Route None", phone_number: "+919999900423", education: "10th", are_you_ok_with_night_shift: "No" } },
  ])}'`], { env, encoding: "utf8" });
  const res = JSON.parse(out.split("\n").find((l) => l.startsWith("RESULT ")).slice(7));
  const row = async (g) => (await q("SELECT id, requisition_id, routed_by, screening_result, notification_sent_at FROM meta_lead_raw WHERE meta_lead_id = ?", [g]))[0];
  const day = await row("ws3-rt-1"), night = await row("ws3-rt-2"), none = await row("ws3-rt-3");
  ok("routing: night-shift No + graduate goes to the day requisition R01 (best_fit), not the main R02", day.requisition_id === R.R01 && day.routed_by === "best_fit", day);
  ok("routing: the routed lead is screened against R01", day.screening_result === "qualified", day);
  ok("routing: night-shift Yes + 10th fits only R02", night.requisition_id === R.R02 && night.routed_by === "best_fit" && night.screening_result === "qualified", night);
  ok("routing: nothing fits -> held for HR on the main requisition, nothing sent", none.requisition_id === R.R02 && none.routed_by === "hold" && !none.notification_sent_at, none);
  ok("routing: ingest helper returned all three", res.length === 3, res);
  const held = await call(H.branch_hr_noida2, "GET", `/api/meta/campaigns/${C.c1}/routing`);
  ok("routing: the held list shows the lead masked", held.status === 200 && held.json.data.held.some((x) => x.id === none.id) && !FULL_MOBILE.test(held.text), held.text.slice(0, 300));
  const place = await call(H.branch_hr_noida2, "PUT", `/api/meta/leads/${none.id}/requisition`, { requisitionId: R.R01 });
  const after = await row("ws3-rt-3");
  ok("routing: HR places the held lead on R01 (routed_by hr, re-screened)", place.status === 200 && after.requisition_id === R.R01 && after.routed_by === "hr", { place: place.json, after });
  await q("UPDATE meta_lead_raw SET notification_sent_at = NOW() WHERE id = ?", [day.id]);
  const locked = await call(H.branch_hr_noida2, "PUT", `/api/meta/leads/${day.id}/requisition`, { requisitionId: R.R02 });
  ok("routing: a contacted lead cannot be moved (409)", locked.status === 409, locked.json);
  ok("routing: branch HR Ahmedabad cannot place a NOIDA-2 lead (403)", (await call(H.branch_hr_ahm, "PUT", `/api/meta/leads/${night.id}/requisition`, { requisitionId: R.R01 })).status === 403);
  ok("routing: a requisition not linked to the campaign is refused (409)", (await call(H.super_admin, "PUT", `/api/meta/leads/${night.id}/requisition`, { requisitionId: R.R03 })).status === 409);
  await call(H.super_admin, "PUT", `/api/meta/campaigns/${C.c1}/requisitions/${R.R01}/primary`);
}

// ---------- 3. matrix per role ----------
const cellOf = (m, campaignId, reqId, kind) => m.rows.find((r) => r.key === `${campaignId ?? "~"}|${reqId}`)?.cells[kind];
{
  const m = (await call(H.super_admin, "GET", "/api/he/campaign-matrix")).json.data;
  const keys = m.rows.map((r) => r.key);
  ok("matrix: one row per active campaign x link (C1 has R01 and R02)", keys.includes(`${C.c1}|${R.R01}`) && keys.includes(`${C.c1}|${R.R02}`), keys);
  const k7 = cellOf(m, C.c3, R.R05, "meta_live");
  ok("matrix: K7BK-like row (active campaign, closed R05) is idle requisition_closed with the relink offer", k7?.state === "idle" && k7.reason === "requisition_closed" && k7.relink === true, k7);
  ok("matrix: the paused campaign C6 without a stream or activity is left out", !keys.some((k) => k.startsWith(C.c6)), keys);
  ok("matrix: draft campaign C4 is a row; its Meta cells name the campaign state", keys.includes(`${C.c4}|${R.R03}`), keys);
  const r08 = m.rows.find((r) => r.key === `~|${R.R08}`);
  ok("matrix: an open requisition with no campaign (R08 DELHI) is a Hiring Engine only row", r08 && r08.cells.meta_live.state === "not_applicable" && r08.cells.he.state !== "not_applicable", r08?.cells);
  const r04 = m.rows.find((r) => r.requisition.id === R.R04);
  ok("matrix: R04 past its end date shows the warning (not enforced)", r04 && r04.requisition.endDatePassed && Object.values(r04.cells).some((c) => c.reason === "requisition_ended" && c.reasonText.includes("warning")), r04);
  const notMapped = m.rows.flatMap((r) => Object.values(r.cells)).filter((c) => c.state === "not_mapped");
  ok("matrix: every not-mapped cell carries the Open-a-stream prefill", notMapped.length > 0 && notMapped.every((c) => c.mapIt && c.mapIt.requisitionId && c.mapIt.sourceType === c.kind), notMapped.slice(0, 2));
  const c1r01 = cellOf(m, C.c1, R.R01, "meta_live");
  ok("matrix: C1 x R01 Live Meta runs (open stream + people contacted in 48 h)", c1r01?.state === "running" && c1r01.activity48h > 0, c1r01);
  ok("matrix: no full mobile anywhere", !FULL_MOBILE.test(JSON.stringify(m)));
  ok("matrix: enforcement is off", m.enforcedEndDate === false);
  const ahm = (await call(H.branch_hr_ahm, "GET", "/api/he/campaign-matrix")).json.data;
  ok("matrix: branch HR Ahmedabad sees only Ahmedabad rows", ahm.rows.length > 0 && ahm.rows.every((r) => r.requisition.branch === "AHMEDABAD"), ahm.rows.map((r) => r.requisition.branch));
  const n2 = (await call(H.branch_hr_noida2, "GET", "/api/he/campaign-matrix")).json.data;
  ok("matrix: branch HR NOIDA-2 sees only NOIDA-2 rows", n2.rows.length > 0 && n2.rows.every((r) => r.requisition.branch === "NOIDA-2"), n2.rows.map((r) => r.requisition.branch));
  const hr = (await call(H.hr, "GET", "/api/he/campaign-matrix")).json.data;
  ok("matrix: HR NOIDA sees the K7BK row of its branch", hr.rows.every((r) => r.requisition.branch === "NOIDA") && hr.rows.some((r) => r.key === `${C.c3}|${R.R05}`), hr.rows.map((r) => r.key));
  ok("matrix: CEO sees every branch", new Set((await call(H.ceo, "GET", "/api/he/campaign-matrix")).json.data.rows.map((r) => r.requisition.branch)).size >= 3);
  ok("matrix: recruiter is refused (403)", (await call(H.recruiter, "GET", "/api/he/campaign-matrix")).status === 403);
  ok("matrix: admin NOIDA is branch-scoped", (await call(H.admin, "GET", "/api/he/campaign-matrix")).json.data.rows.every((r) => r.requisition.branch === "NOIDA"));
  const one = (await call(H.super_admin, "GET", `/api/he/campaign-matrix?requisitionId=${R.R02}`)).json.data;
  ok("matrix: requisition filter", one.rows.length > 0 && one.rows.every((r) => r.requisition.id === R.R02), one.rows.map((r) => r.key));
  ok("matrix: bad id is 400", (await call(H.super_admin, "GET", "/api/he/campaign-matrix?requisitionId=x")).status === 400);
  const t0 = Date.now(); await call(H.ceo, "GET", "/api/he/campaign-matrix?branch=NOIDA-2"); const ms = Date.now() - t0;
  ok(`matrix: cold read under 2 s (${ms} ms)`, ms < 2000, ms);
}

// ---------- 4. K7BK relink ----------
{
  const pv = await call(H.super_admin, "GET", `/api/meta/campaigns/${C.c3}/relink-preview?to=${R.R01}`);
  const p = pv.json?.data;
  ok("relink: preview splits uncontacted (move) from contacted (stay)", pv.status === 200 && p.move.total === 1 && p.stay === 1, p);
  ok("relink: preview warns about the branch change", p?.warnings?.some((w) => w.includes("NOIDA-2")), p?.warnings);
  ok("relink: preview never returns lead ids or mobiles", !pv.text.includes("moveIds") && !FULL_MOBILE.test(pv.text));
  ok("relink: a closed or full target is refused", (await call(H.super_admin, "GET", `/api/meta/campaigns/${C.c3}/relink-preview?to=${R.R07}`)).status === 409);
  ok("relink: HR NOIDA cannot relink to a NOIDA-2 requisition (403)", (await call(H.hr, "GET", `/api/meta/campaigns/${C.c3}/relink-preview?to=${R.R01}`)).status === 403);
  ok("relink: CEO cannot preview (write roles only)", (await call(H.ceo, "GET", `/api/meta/campaigns/${C.c3}/relink-preview?to=${R.R01}`)).status === 403);
  const noReason = await call(H.super_admin, "POST", `/api/meta/campaigns/${C.c3}/relink`, { toRequisitionId: R.R01, previewHash: p.previewHash, confirm: true, reason: "" });
  ok("relink: a reason is required", noReason.status === 400);
  const stale = await call(H.super_admin, "POST", `/api/meta/campaigns/${C.c3}/relink`, { toRequisitionId: R.R01, previewHash: "0".repeat(64), confirm: true, reason: "K7BK closed" });
  ok("relink: a stale preview is refused (409) and nothing changes", stale.status === 409 && (await q("SELECT requisition_id FROM meta_campaign WHERE id = ?", [C.c3]))[0].requisition_id === R.R05);
  const ap = await call(H.super_admin, "POST", `/api/meta/campaigns/${C.c3}/relink`, { toRequisitionId: R.R01, previewHash: p.previewHash, confirm: true, reason: "K7BK closed; rig batch open" });
  const leads = await q("SELECT parsed_phone, requisition_id, routed_by FROM meta_lead_raw WHERE campaign_id = ? ORDER BY parsed_phone", [C.c3]);
  const links = await q("SELECT requisition_id, is_primary FROM meta_campaign_requisition WHERE campaign_id = ? AND removed_at IS NULL ORDER BY is_primary DESC", [C.c3]);
  const auditRow = (await q("SELECT leads_moved, leads_kept, reason FROM meta_campaign_relink WHERE campaign_id = ? ORDER BY created_at DESC LIMIT 1", [C.c3]))[0];
  ok("relink: confirmed -> 1 moved, 1 stayed", ap.status === 200 && ap.json.data.moved === 1 && ap.json.data.kept === 1, ap.json);
  ok("relink: the contacted lead stayed on R05, the other moved to R01 (routed_by hr)", leads.find((l) => l.parsed_phone.endsWith("110")).requisition_id === R.R05 && leads.find((l) => l.parsed_phone.endsWith("116")).requisition_id === R.R01 && leads.find((l) => l.parsed_phone.endsWith("116")).routed_by === "hr", leads);
  ok("relink: R01 is main, R05 stays linked", links.map((l) => [l.requisition_id, l.is_primary]).join() === `${R.R01},1,${R.R05},0`, links);
  ok("relink: audit row with the reason", auditRow?.leads_moved === 1 && auditRow.leads_kept === 1 && auditRow.reason.startsWith("K7BK closed"), auditRow);
  const m2 = (await call(H.super_admin, "GET", `/api/he/campaign-matrix?campaignId=${C.c3}`)).json.data;
  ok("relink: the matrix now shows C3 on R01 (open) and keeps the R05 row idle", m2.rows.some((r) => r.key === `${C.c3}|${R.R01}`) && cellOf(m2, C.c3, R.R05, "meta_live")?.reason === "requisition_closed", m2.rows.map((r) => r.key));
}

// ---------- 5. funnel per requisition ----------
{
  const a = (await call(H.super_admin, "GET", "/api/he/drive-analytics")).json.data;
  const sums = Object.fromEntries(["meta_live", "meta_old", "he"].map((t) => [t, a.byRequisition.filter((r) => r.sourceType === t).reduce((s, r) => s + r.stages.leads, 0)]));
  ok("funnel: byRequisition per type sums to the journey", ["meta_live", "meta_old", "he"].every((t) => sums[t] === a.journey[t].leads), { sums, journey: a.journey });
  ok("funnel: the routed lead counts under R02 (its own requisition)", a.byRequisition.some((r) => r.requisitionId === R.R02 && r.sourceType === "meta_live" && r.stages.leads > 0), a.byRequisition.filter((r) => r.requisitionId === R.R02));
  ok("funnel: Hiring Engine rows carry no form fills", a.byRequisition.filter((r) => r.sourceType === "he").every((r) => r.stages.fills === 0));
}

// ---------- 6. pool bridge (preview only) ----------
{
  ok("bridge: HR cannot run it (403)", (await call(H.hr, "POST", "/api/he/pool/bridge-ats", { recordTypes: ["naukri_import"] })).status === 403);
  ok("bridge: CEO cannot list it (403)", (await call(H.ceo, "GET", "/api/he/pool/bridge-ats/sources")).status === 403);
  const src = await call(H.admin, "GET", "/api/he/pool/bridge-ats/sources");
  ok("bridge: sources list the RIGW3 files with pool coverage", src.status === 200 && src.json.data.filter((s) => s.sourceDetails.startsWith("RIGW3")).length === 4, src.json?.data);
  ok("bridge: legacy / test records are never listed", !src.json.data.some((s) => s.recordType === "test" || s.recordType === "legacy_employee"));
  const dry = (await call(H.admin, "POST", "/api/he/pool/bridge-ats", { recordTypes: ["naukri_import", "workindia_import"] })).json.data;
  const w3 = dry.batches.filter((b) => b.sourceDetails.startsWith("RIGW3"));
  const sk = w3.reduce((a, b) => { for (const k of Object.keys(b.skipped)) a[k] = (a[k] ?? 0) + b.skipped[k]; return a; }, {});
  ok("bridge: dry run is the default and writes nothing", dry.dryRun === true && Number((await q("SELECT COUNT(*) n FROM he_lead WHERE mobile10 LIKE '99999004%'"))[0].n) === 0);
  ok("bridge: one batch per file (4 RIGW3 files)", w3.length === 4, w3.map((b) => b.sourceDetails));
  ok("bridge: skips legacy-linked, employee, malformed and duplicate mobiles", sk.legacy_employee === 1 && sk.employee === 1 && sk.no_mobile === 1 && sk.duplicate_mobile === 1, sk);
  ok("bridge: 6 RIGW3 people would be added", w3.reduce((s, b) => s + b.inserted, 0) === 6, w3);
  const real = (await call(H.admin, "POST", "/api/he/pool/bridge-ats", { recordTypes: ["naukri_import", "workindia_import"], dryRun: false })).json.data;
  ok("bridge: the real run adds them and says it is preview only", real.dryRun === false && real.next_step.includes("preview"), real.totals);
  const pool = await q(`SELECT l.mobile10, l.education_rank, l.primary_source, l.email, b.label FROM he_lead l JOIN he_lead_batch lb ON lb.lead_id = l.id JOIN he_import_batch b ON b.id = lb.batch_id
                         WHERE l.mobile10 LIKE '99999004%' ORDER BY l.mobile10`);
  ok("bridge: 6 people, each in their file's batch", new Set(pool.map((p) => p.mobile10)).size === 6 && pool.every((p) => p.label.startsWith("RIGW3")), pool);
  ok("bridge: WorkIndia 'Graduate' is not written as an education rank", pool.filter((p) => p.primary_source === "workindia_import").every((p) => p.education_rank == null), pool);
  ok("bridge: Naukri B.Com ranks graduate", pool.find((p) => p.mobile10 === "9999900401")?.education_rank === 5, pool.find((p) => p.mobile10 === "9999900401"));
  const prof = await q("SELECT p.last_employer FROM he_lead_profile p JOIN he_lead l ON l.id = p.lead_id WHERE l.mobile10 LIKE '99999004%'");
  ok("bridge: the 'ccc' employer placeholder is never stored", !prof.some((p) => p.last_employer === "ccc"), prof);
  ok("bridge: the test record is not in the pool", Number((await q("SELECT COUNT(*) n FROM he_lead WHERE mobile10 = '9999900409'"))[0].n) === 0);
  const again = (await call(H.admin, "POST", "/api/he/pool/bridge-ats", { recordTypes: ["naukri_import", "workindia_import"], dryRun: false })).json.data;
  ok("bridge: a second run only enriches (idempotent)", again.totals.inserted === 0 && again.totals.enriched >= 6, again.totals);
  await new Promise((r) => setTimeout(r, 4000)); // the facts cache refresh runs in the background
  const pvw = await call(H.branch_hr_ahm, "GET", `/api/job-requisition/${R.R03}/selection/preview?source=he&sub=naukri_import&sample=50`);
  ok("bridge: the Naukri people reach the criteria preview (masked)", pvw.status === 200 && pvw.json.data.start >= 2 && !FULL_MOBILE.test(pvw.text), { status: pvw.status, start: pvw.json?.data?.start });
  const facts = await q("SELECT mobile10, facts_json FROM selection_person_fact WHERE mobile10 IN ('9999900404', '9999900406') AND source_kind = 'he'");
  const fq = facts.map((f) => { const j = typeof f.facts_json === "string" ? JSON.parse(f.facts_json) : f.facts_json; return [f.mobile10, j.educationRank?.quality, j.locationText?.quality]; });
  ok("bridge: WorkIndia 'Graduate' is source_default (unknown) in the preview facts; 'ccc' is a placeholder", fq.length === 2 && fq.every((x) => x[1] === "source_default") && fq.some((x) => x[0] === "9999900406" && x[2] === "placeholder"), fq);
}

// ---------- 7. nothing enrolled, nothing sent ----------
{
  const now = { heMsg: Number((await q("SELECT COUNT(*) n FROM he_message"))[0].n), approvals: Number((await q("SELECT COUNT(*) n FROM shortlist_approval"))[0].n) };
  ok("safety: no messages and no approvals were created", now.heMsg === before.heMsg && now.approvals === before.approvals, { before, now });
  const qfu = await q("SELECT mobile10, mode_at_enqueue FROM qualified_followup WHERE mobile10 LIKE '99999004%' ORDER BY mobile10");
  ok("safety: only the two routed qualified Live Meta leads got (dry-run) follow-up rows; the held lead and the bridged pool none", qfu.map((r) => `${r.mobile10}:${r.mode_at_enqueue}`).join() === "9999900421:dry_run,9999900422:dry_run", qfu);
}

console.log(`\n${pass} passed, ${failN} failed`);
fs.writeFileSync("/home/shuvam/he-e2e2/results_ws3_api.json", JSON.stringify({ pass, fail: failN, results }, null, 1));
await pool.end();
process.exit(failN ? 1 : 0);
