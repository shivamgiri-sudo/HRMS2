// Rig UI e2e (he-e2e2, vite 5421 -> backend 5420 -> jd_rig) for "Suggested from the requisition text": accept on an approved
// requisition (reason required), a night-shift draft, a closed one (read-only), the AHMEDABAD config case and a view-only CEO;
// desktop, 375 px and dark; console errors and 5xx collected.
//   JD_UI=http://127.0.0.1:5421 RIG_DB=jd_rig node backend/scripts/he-e2e/jd-suggest-ui.e2e.mjs
import fs from "node:fs";
import path from "node:path";
import { closeDb, q, suite } from "/home/shuvam/he-e2e2/lib/rig.mjs";

const UI = process.env.JD_UI ?? "http://127.0.0.1:5421";
const PAIRS = { jd_rig: ":5421", rel_rig: ":5431" }; // scratch clones only, each with its own vite
if (!PAIRS[process.env.RIG_DB ?? ""] || !UI.endsWith(PAIRS[process.env.RIG_DB])) { console.error("refusing: RIG_DB=jd_rig + JD_UI ...:5421 (or rel_rig + ...:5431) required"); process.exit(2); }
const SHOTS = "/home/shuvam/he-e2e2/shots/jd-suggest";
fs.mkdirSync(SHOTS, { recursive: true });
const USERS = { super_admin: "rig.superadmin@he-e2e2.test", ceo: "rig.ceo@he-e2e2.test", branch_hr_ahm: "rig.bhr.ahmedabad@he-e2e2.test", branch_hr_noida2: "rig.bhr.noida2@he-e2e2.test" };
const { chromium } = await import("/home/shuvam/HRMS2/node_modules/playwright/index.mjs");
const { ok, step, done } = suite("jd_suggest_ui");
const ID = (code) => `jdrig-${code}`.toLowerCase();

async function login(b, role) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const issues = { console: [], pageErrors: [], http5xx: [] };
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|LocationHeartbeat/.test(m.text())) issues.console.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => issues.pageErrors.push(e.message.slice(0, 200)));
  page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 500 && !/lms|quality/i.test(r.url())) issues.http5xx.push(`${r.status()} ${r.url().replace(UI, "")}`); });
  await page.goto(`${UI}/login`, { waitUntil: "domcontentloaded" });
  await page.locator("#identifier").waitFor({ timeout: 90000 });
  await page.locator("#identifier").fill(USERS[role]);
  await page.locator("#password").fill("RigTest#2026");
  await page.getByRole("button", { name: /sign in/i }).first().click();
  for (let i = 0; i < 80 && /\/login/.test(page.url()); i++) await page.waitForTimeout(500);
  if (/\/login/.test(page.url())) throw new Error(`login as ${role} failed`);
  await page.waitForTimeout(2000);
  await popups(page);
  return { ctx, page, issues };
}
async function popups(page) {
  const pop = page.getByRole("dialog").filter({ hasText: "Approvals waiting for you" });
  if (await pop.count().catch(() => 0)) { await pop.getByRole("button", { name: "Later" }).click().catch(() => page.keyboard.press("Escape")); await page.waitForTimeout(300); }
  const cookie = page.getByRole("button", { name: "Decline", exact: true });
  if (await cookie.isVisible().catch(() => false)) await cookie.click().catch(() => {});
}
async function settle(page, ms = 30000) {
  await page.waitForLoadState("networkidle", { timeout: ms }).catch(() => {});
  await popups(page);
  const busy = page.locator('[aria-busy="true"], .animate-pulse');
  const t0 = Date.now();
  while (Date.now() - t0 < ms && (await busy.count().catch(() => 0)) > 0) await page.waitForTimeout(250);
  await popups(page);
}
const visible = async (loc) => (await loc.count()) > 0 && (await loc.first().isVisible().catch(() => false));
const panelOf = (page) => page.getByRole("region", { name: "Suggested from the requisition text" });
async function shots(page, name) {
  const panel = panelOf(page);
  const into = async () => { if (await visible(panel)) await panel.first().scrollIntoViewIfNeeded().catch(() => {}); };
  await into(); await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  await page.setViewportSize({ width: 375, height: 800 }); await page.waitForTimeout(500); await into();
  const sw = await page.evaluate(() => document.scrollingElement.scrollWidth);
  await page.screenshot({ path: path.join(SHOTS, `${name}_375.png`) });
  await page.emulateMedia({ colorScheme: "dark" }); await page.evaluate(() => document.documentElement.classList.add("dark")); await page.waitForTimeout(300); await into();
  await page.screenshot({ path: path.join(SHOTS, `${name}_375_dark.png`) });
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.waitForTimeout(300); await into();
  await page.screenshot({ path: path.join(SHOTS, `${name}_dark.png`) });
  await page.evaluate(() => document.documentElement.classList.remove("dark")); await page.emulateMedia({ colorScheme: "light" });
  return sw;
}
async function openInCommandCenter(page, code) {
  await page.goto(`${UI}/ats/hiring-engine#drives:criteria`, { waitUntil: "domcontentloaded" });
  await settle(page);
  const btn = page.getByRole("button", { name: `Open criteria of JD-${code}`, exact: true });
  await btn.waitFor({ timeout: 30000 });
  await btn.click();
  await settle(page);
}
async function openOnRequisitionPage(page, code) {
  await page.goto(`${UI}/recruitment/job-requisition`, { waitUntil: "domcontentloaded" });
  await settle(page);
  const search = page.getByPlaceholder(/search/i).first();
  if (await visible(search)) { await search.fill(`JD-${code}`); await page.waitForTimeout(800); await settle(page); }
  const tr = page.locator("tr").filter({ hasText: `JD-${code}` }).first();
  await tr.waitFor({ timeout: 30000 });
  await tr.locator('button[title="View Details"]').click();
  await settle(page);
}
const issuesOk = (role, issues) => ok(`${role}: no console errors, page errors or 5xx`, !issues.console.length && !issues.pageErrors.length && !issues.http5xx.length, JSON.stringify(issues));
const rowOf = async (code) => (await q("SELECT education_requirement, night_shift_required, meta_screening_config, selection_rules FROM job_requisition WHERE id = ?", [ID(code)]))[0];
const js = (v) => (typeof v === "string" ? JSON.parse(v) : v);

const b = await chromium.launch({ headless: true });
try {
  await step("approved requisition (Onfido-17), branch HR NOIDA-2: found in text, reason required, Accept all with confirmation", async () => {
    const { ctx, page, issues } = await login(b, "branch_hr_noida2");
    await openInCommandCenter(page, "NOIDA-Onfido-17");
    ok("summary says 'Criteria found in text: 2 suggestions'", await visible(page.getByText("Criteria found in text: 2 suggestions")));
    ok("and not 'Enrolment blocked: criteria incomplete'", !(await visible(page.getByText("Enrolment blocked: criteria incomplete"))));
    const panel = panelOf(page);
    ok("panel with the exact source phrase", await visible(panel.getByText("Skills: “Graduation with good typing speed”")));
    ok("education MUST shown as a word", await visible(panel.getByText("MUST", { exact: true })));
    const accEdu = panel.getByRole("button", { name: "Accept: Minimum qualification: Graduate" });
    ok("Accept disabled until a reason is typed (approved)", await accEdu.isDisabled());
    const accAll = panel.getByRole("button", { name: /^Accept all/ });
    ok("Accept all disabled until the number and reason are typed", await accAll.isDisabled());
    await page.waitForFunction(() => !document.body.innerText.includes("Counting..."), null, { timeout: 60000 }).catch(() => {});
    ok("live preview counts shown", await visible(panel.getByText(/Now: \d+ shortlisted, \d+ to review, \d+ not matching/)));
    const sw = await shots(page, "onf17_before");
    ok(`375 px: no sideways scroll (${sw})`, sw <= 376, sw);
    await panel.getByLabel("Minimum typing speed (wpm)").fill("25");
    await panel.getByLabel("Reason (required for an approved requisition)").fill("Owner: criteria are in the skills text");
    ok("Accept enabled after the reason", !(await accEdu.isDisabled()));
    await accAll.click();
    const dlg = page.getByRole("alertdialog");
    await dlg.waitFor({ timeout: 15000 });
    await page.waitForFunction(() => !document.body.innerText.includes("Counting what changes"), null, { timeout: 60000 }).catch(() => {});
    ok("confirmation shows Now and After counts", (await visible(dlg.getByText(/^Now: /))) && (await visible(dlg.getByText(/^After: \d+ shortlisted/))), await dlg.innerText());
    ok("confirmation warns about leaving today's screening rules", await visible(dlg.getByText(/switch to the criteria engine/)));
    ok("Confirm has focus", await dlg.getByRole("button", { name: "Confirm" }).evaluate((el) => el === document.activeElement));
    await page.screenshot({ path: path.join(SHOTS, "onf17_confirm.png") });
    await dlg.getByRole("button", { name: "Confirm" }).click();
    await page.getByText(/^Accepted 2 suggestions: criteria version \d+/).waitFor({ timeout: 30000 });
    await settle(page);
    ok("after accepting: nothing left to suggest", await visible(panel.getByText(/Nothing to suggest/)));
    ok("summary no longer says 'found in text'", !(await visible(page.getByText("Criteria found in text: 2 suggestions"))));
    ok("summary shows the qualification rule", await visible(page.getByText(/Minimum qualification: .*Graduate/i)));
    const db = await rowOf("NOIDA-Onfido-17");
    ok("DB: Graduate MUST, typing 25 PREFER", db.education_requirement === "Graduate" && js(db.meta_screening_config).min_typing_speed_wpm === 25 && js(db.selection_rules).rules.education_min.mode === "must" && js(db.selection_rules).rules.typing.mode === "prefer", db);
    await shots(page, "onf17_after");
    issuesOk("branch_hr_noida2", issues);
    await ctx.close();
  });

  await step("night-shift draft (NIGHT-1) on the requisition page: one-click Accept, no reason needed", async () => {
    const { ctx, page, issues } = await login(b, "branch_hr_noida2");
    await openOnRequisitionPage(page, "NIGHT-1");
    const panel = panelOf(page);
    await panel.first().waitFor({ timeout: 30000 });
    ok("night shift suggested as MUST from the shift field", await visible(panel.getByText("Willing to work night shift")));
    ok("no reason field on a draft", !(await visible(panel.getByLabel(/Reason/))));
    const sw = await shots(page, "night_before");
    ok(`375 px: no sideways scroll (${sw})`, sw <= 376, sw);
    await panel.getByRole("button", { name: "Accept: Willing to work night shift" }).click();
    await page.getByText(/^Accepted 1 suggestion/).waitFor({ timeout: 30000 });
    ok("DB: night_shift_required = 1", Number((await rowOf("NIGHT-1")).night_shift_required) === 1);
    await panel.getByRole("button", { name: "Dismiss: Typing speed: you set the minimum wpm (the text gives no number)" }).click();
    await page.waitForTimeout(1500); await settle(page);
    ok("dismissed typing is listed under Dismissed (1)", await visible(panel.getByText("Dismissed (1)")));
    await shots(page, "night_after");
    issuesOk("branch_hr_noida2 (night)", issues);
    await ctx.close();
  });

  await step("closed requisition (CLOSED-19): suggestions readable, no write controls", async () => {
    const { ctx, page, issues } = await login(b, "super_admin");
    await openOnRequisitionPage(page, "CLOSED-19");
    const panel = panelOf(page);
    await panel.first().waitFor({ timeout: 30000 });
    ok("says read-only", await visible(panel.getByText("Closed requisition: read-only.")));
    ok("suggestion shown", await visible(panel.getByText("Minimum qualification: Graduate")));
    ok("no Accept / Dismiss", (await panel.getByRole("button", { name: /^(Accept|Dismiss)/ }).count()) === 0);
    const r = await page.evaluate(async (u) => (await fetch(u, { method: "POST", credentials: "include", headers: { "content-type": "application/json", authorization: `Bearer ${localStorage.getItem("hrms_access_token") ?? ""}` }, body: JSON.stringify({ ids: ["x"], reason: "x" }) })).status,
      `/api/job-requisition/${ID("CLOSED-19")}/criteria/suggestions/accept`);
    ok(`a forced accept from the page is refused (${r}: 409 closed, or 401 without a bearer)`, r === 409 || r === 401, r);
    await shots(page, "closed");
    issuesOk("super_admin (closed)", issues);
    await ctx.close();
  });

  await step("AHMEDABAD: empty text is honest; the DRA config is kept when accepting from text", async () => {
    const { ctx, page, issues } = await login(b, "branch_hr_ahm");
    await openInCommandCenter(page, "AHMEDABAD-SBI-1");
    const panel = panelOf(page);
    await panel.first().waitFor({ timeout: 30000 });
    ok("honest empty state", await visible(panel.getByText(/This requisition has no free text/)));
    ok("no 'found in text' badge", !(await visible(page.getByText(/Criteria found in text/))));
    await shots(page, "ahm_sbi1");
    const before = (await rowOf("AHM-DRA")).meta_screening_config;
    await openOnRequisitionPage(page, "AHM-DRA");
    await panel.first().waitFor({ timeout: 30000 });
    await panel.getByText(/^Not used from the text/).click();
    ok("certificate listed as already set", await visible(panel.getByText(/Already set: Certificate/)));
    await panel.getByRole("button", { name: "Accept: Minimum qualification: 12th" }).click();
    await page.getByText(/^Accepted 1 suggestion/).waitFor({ timeout: 30000 });
    const db = await rowOf("AHM-DRA");
    ok("DB: 12th, screening config unchanged", db.education_requirement === "12th" && JSON.stringify(db.meta_screening_config) === JSON.stringify(before), { before, after: db.meta_screening_config });
    await shots(page, "ahm_dra");
    issuesOk("branch_hr_ahm", issues);
    await ctx.close();
  });

  await step("CEO (view-only): sees the suggestions, no write controls", async () => {
    const { ctx, page, issues } = await login(b, "ceo");
    await openInCommandCenter(page, "NOIDA-Onfido-20");
    const panel = panelOf(page);
    await panel.first().waitFor({ timeout: 30000 });
    ok("suggestions visible", await visible(panel.getByText("Minimum qualification: Graduate")));
    ok("no Accept / Dismiss / Accept all / inputs", (await panel.getByRole("button", { name: /^(Accept|Dismiss)/ }).count()) === 0 && (await panel.locator("input").count()) === 0);
    await shots(page, "ceo_view");
    issuesOk("ceo", issues);
    await ctx.close();
  });
} finally {
  await b.close();
  await closeDb();
}
process.exit(done() ? 1 : 0);
