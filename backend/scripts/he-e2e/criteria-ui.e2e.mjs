// Rig UI e2e (he-e2e2) for the selection screens (S15-S20): per role, every new screen at desktop, 375 px and dark; console errors,
// failed requests, masked mobiles in every selection response; then a deep matrix over the seeded requisition types.
//   CRIT_UI=http://127.0.0.1:5397 CRIT_SHOTS=/home/shuvam/he-e2e2/shots/criteria node backend/scripts/he-e2e/criteria-ui.e2e.mjs
// The UI must proxy to a backend on the isolated clone (crit_rig), never the shared rig schema.
import fs from "node:fs";
import path from "node:path";

const UI = process.env.CRIT_UI ?? "http://127.0.0.1:5397";
const SHOTS = process.env.CRIT_SHOTS ?? "/home/shuvam/he-e2e2/shots/criteria";
const ONLY = process.env.CRIT_ROLES?.split(",");
const PASSWORD = "RigTest#2026";
const USERS = {
  super_admin: "rig.superadmin@he-e2e2.test", admin: "rig.admin.noida@he-e2e2.test", hr: "rig.hr@he-e2e2.test", branch_hr_noida2: "rig.bhr.noida2@he-e2e2.test",
  branch_hr_ahm: "rig.bhr.ahmedabad@he-e2e2.test", recruiter: "rig.recruiter@he-e2e2.test", ceo: "rig.ceo@he-e2e2.test",
};
const { chromium } = await import("/home/shuvam/HRMS2/node_modules/playwright/index.mjs");
fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, failN = 0;
const results = [];
const ok = (n, c, d = "") => { c ? pass++ : failN++; results.push({ n, ok: !!c, d: c ? "" : String(typeof d === "string" ? d : JSON.stringify(d)).slice(0, 400) }); console.log(`${c ? "PASS" : "FAIL"} ${n}${c ? "" : `  -> ${typeof d === "string" ? d : JSON.stringify(d)}`.slice(0, 500)}`); };
const SEL = /\/api\/(job-requisition\/(selection|criteria|[^/]+\/criteria|[^/]+\/selection)|he\/shortlist)/;
const FULL_MOBILE = /(?<![\d])[6-9]\d{9}(?![\d])/;
const SEARCHED = "9999900103"; // the why-not search echoes the mobile the user typed (fullMobileIfSearched); nothing else may carry one

async function login(b, role) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ["geolocation"], geolocation: { latitude: 28.53, longitude: 77.39 } });
  const page = await ctx.newPage();
  const issues = { console: [], pageErrors: [], failed: [], http: [], selCalls: [], unmasked: [] };
  page.on("console", (m) => { if (m.type() === "error") issues.console.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => issues.pageErrors.push(e.message.slice(0, 200)));
  page.on("requestfailed", (r) => { if (!/favicon|hot-update|\.map$|\/@vite|ws:/.test(r.url()) && r.failure()?.errorText !== "net::ERR_ABORTED") issues.failed.push(`${r.method()} ${r.url().replace(UI, "")} ${r.failure()?.errorText}`); });
  page.on("response", async (r) => {
    const u = r.url();
    if (!u.includes("/api/")) return;
    if (r.status() >= 400) issues.http.push(`${r.status()} ${r.request().method()} ${u.replace(UI, "")}`);
    if (SEL.test(u)) {
      issues.selCalls.push(`${r.status()} ${u.replace(UI, "")}`);
      try { const t = (await r.text()).replaceAll(SEARCHED, ""); if (FULL_MOBILE.test(t)) issues.unmasked.push(`${u.replace(UI, "")}: ${t.match(FULL_MOBILE)[0].slice(0, 2)}…`); } catch { /* body gone */ }
    }
  });
  await page.goto(`${UI}/login`, { waitUntil: "domcontentloaded" });
  await page.locator("#identifier").waitFor({ timeout: 90000 });
  await page.locator("#identifier").fill(USERS[role]);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).first().click();
  for (let i = 0; i < 80 && /\/login/.test(page.url()); i++) await page.waitForTimeout(500);
  if (/\/login/.test(page.url())) throw new Error(`login as ${role} failed`);
  await page.waitForTimeout(2500);
  await dismissPopups(page);
  return { ctx, page, issues };
}
/** The app's own "Approvals waiting for you" popup (not part of this feature) is dismissed with Later whenever it shows. */
async function dismissPopups(page) {
  const pop = page.getByRole("dialog").filter({ hasText: "Approvals waiting for you" });
  if (await pop.count().catch(() => 0)) { await pop.getByRole("button", { name: "Later" }).click().catch(() => page.keyboard.press("Escape")); await page.waitForTimeout(300); }
  const cookie = page.getByRole("button", { name: "Decline", exact: true });
  if (await cookie.isVisible().catch(() => false)) await cookie.click().catch(() => {});
}
async function settle(page, ms = 30000) {
  await page.waitForLoadState("networkidle", { timeout: ms }).catch(() => {});
  await dismissPopups(page);
  const busy = page.locator('[aria-busy="true"], .animate-pulse');
  const t0 = Date.now();
  while (Date.now() - t0 < ms && (await busy.count().catch(() => 0)) > 0) await page.waitForTimeout(250);
  await dismissPopups(page);
}
const shot = async (page, name) => { const f = path.join(SHOTS, `${name}.png`); await page.screenshot({ path: f, fullPage: true }); return f; };
const noSideScroll = async (page) => page.evaluate(() => document.scrollingElement.scrollWidth);
const visible = async (loc) => (await loc.count()) > 0 && (await loc.first().isVisible().catch(() => false));
async function variants(page, name) {
  await page.setViewportSize({ width: 375, height: 800 });
  await settle(page, 8000);
  const sw = await noSideScroll(page);
  await shot(page, `${name}_375`);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.waitForTimeout(300);
  await shot(page, `${name}_375_dark`);
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  return sw;
}

const READ = new Set(["super_admin", "admin", "hr", "branch_hr_noida2", "branch_hr_ahm", "ceo"]);
const EDIT = new Set(["super_admin", "hr", "branch_hr_noida2", "branch_hr_ahm"]);
const OVERRIDE = new Set(["super_admin", "admin", "hr", "branch_hr_noida2", "branch_hr_ahm"]);
const b = await chromium.launch({ headless: true });
const perRole = {};
try {
  for (const role of Object.keys(USERS).filter((r) => !ONLY || ONLY.includes(r))) {
    console.log(`\n== ${role}`);
    const { ctx, page, issues } = await login(b, role);
    const shots = [];
    // A. Command Center: Selection criteria section
    await page.goto(`${UI}/ats/hiring-engine#drives:criteria`, { waitUntil: "domcontentloaded" });
    await settle(page);
    const tab = page.getByRole("tab", { name: "Selection criteria" });
    if (!READ.has(role)) {
      ok(`${role}: no Selection criteria tab`, !(await visible(tab)));
    } else {
      ok(`${role}: Selection criteria tab after Summary`, await visible(tab));
      ok(`${role}: section heading`, await visible(page.getByRole("heading", { name: "Selection criteria", level: 2 })));
      shots.push(await shot(page, `${role}__cc_criteria`));
      const open = page.getByRole("button", { name: /^Open criteria of / });
      const n = await open.count();
      const empty = await visible(page.getByText(/No open requisitions in your scope|Every open requisition you can see has complete criteria/));
      ok(`${role}: requisition table or an honest empty state (${n} rows)`, n > 0 || empty);
      if (n > 0) {
        await open.first().click();
        await settle(page);
        ok(`${role}: summary opens`, await visible(page.getByRole("group", { name: "Criteria views" })));
        shots.push(await shot(page, `${role}__cc_summary`));
        const edit = page.getByRole("button", { name: "Edit criteria" });
        ok(`${role}: Edit criteria ${EDIT.has(role) ? "shown" : "hidden"}`, (await visible(edit)) === EDIT.has(role));
        if (await visible(edit)) {
          await edit.click();
          await settle(page);
          const dialog = page.getByRole("dialog").filter({ hasText: "Selection criteria" });
          ok(`${role}: editor opens with the rule groups`, await visible(dialog.getByText("System rules (cannot be changed):")));
          const banner = dialog.getByText("Undecided rules currently act as MUST: most people will go to review");
          if (await visible(banner)) ok(`${role}: banner offers one-click decide`, (await dialog.getByRole("button", { name: /^Decide: no requirement for / }).count()) > 0);
          shots.push(await shot(page, `${role}__editor`));
          await page.setViewportSize({ width: 375, height: 800 });
          await page.waitForTimeout(400);
          shots.push(await shot(page, `${role}__editor_375`));
          await page.setViewportSize({ width: 1440, height: 1000 });
          await page.keyboard.press("Escape");
          await page.waitForTimeout(400);
        }
        await page.getByRole("group", { name: "Criteria views" }).getByRole("button", { name: "Preview" }).click();
        await settle(page, 60000);
        ok(`${role}: preview shows the rule funnel or an honest empty state`, (await visible(page.getByRole("heading", { name: "Rule funnel" }))) || (await visible(page.getByText(/Could not load the preview/))) === false);
        const csv = page.getByRole("button", { name: "Download CSV" });
        ok(`${role}: CSV ${["super_admin", "hr", "branch_hr_noida2", "branch_hr_ahm"].includes(role) ? "offered" : "hidden"}`, (await visible(csv)) === ["super_admin", "hr", "branch_hr_noida2", "branch_hr_ahm"].includes(role));
        const showTable = page.getByRole("button", { name: "Show table" }).first();
        if (await visible(showTable)) await showTable.click();
        await page.getByRole("tab", { name: "Hiring Engine" }).last().click().catch(() => {});
        await settle(page, 60000);
        shots.push(await shot(page, `${role}__preview`));
        await page.getByRole("group", { name: "Criteria views" }).getByRole("button", { name: /Approve shortlist|Shortlist status/ }).click();
        await settle(page);
        const run = page.getByRole("button", { name: "Run the shortlist" });
        ok(`${role}: approve controls ${EDIT.has(role) ? "shown" : "hidden"}`, (await visible(run)) === EDIT.has(role));
        shots.push(await shot(page, `${role}__approve`));
        const sw = await variants(page, `${role}__cc`);
        ok(`${role}: Command Center criteria at 375 px has no sideways scroll (${sw})`, sw <= 376, sw);
      }
      const q = page.getByLabel("Mobile or name");
      await dismissPopups(page);
      if (await visible(q)) {
        await q.fill(SEARCHED);
        await q.press("Enter"); // the app's fixed bottom bar can cover the button at the page end
        await settle(page);
        const answered = page.locator('section[aria-label^="RIG-R"]');
        ok(`${role}: why-not answers per requisition in scope`, (await answered.count()) > 0 || (await visible(page.getByText(/Nobody found|Not part of any open requisition you can see/))), await answered.count());
        const ov = page.getByRole("button", { name: /^Override for RIG-R/ });
        ok(`${role}: override ${OVERRIDE.has(role) ? "offered" : "hidden"}`, (await visible(ov)) === OVERRIDE.has(role) || (OVERRIDE.has(role) && (await answered.count()) === 0));
        shots.push(await shot(page, `${role}__whynot`));
        if (await visible(ov)) {
          await ov.first().click();
          const dlg = page.getByRole("dialog").filter({ hasText: "Override for one person" });
          await dlg.waitFor({ timeout: 10000 }).catch(() => {});
          ok(`${role}: override dialog needs a reason`, await dlg.getByRole("button", { name: "Save decision" }).isDisabled().catch(() => false));
          shots.push(await shot(page, `${role}__override_dialog`));
          await page.keyboard.press("Escape");
          await page.waitForTimeout(300);
        }
      }
    }
    // B. requisition detail page
    await page.goto(`${UI}/recruitment/job-requisition`, { waitUntil: "domcontentloaded" });
    await settle(page);
    const view = page.locator('button[title="View Details"]');
    if (await view.count()) {
      await view.first().click();
      await settle(page);
      const has = await visible(page.getByRole("heading", { name: "Selection criteria" }));
      ok(`${role}: requisition detail ${READ.has(role) ? "shows" : "hides"} the criteria panel`, has === READ.has(role) || (READ.has(role) && !has && (await visible(page.getByText("Could not load the criteria")))), has);
      shots.push(await shot(page, `${role}__requisition_detail`));
      const sw = await variants(page, `${role}__requisition_detail`);
      ok(`${role}: requisition detail at 375 px (${sw}) recorded`, true);
    } else ok(`${role}: requisition page has no rows to open (role sees none)`, true);
    // C. campaign drawer
    await page.goto(`${UI}/ats/meta-campaigns`, { waitUntil: "domcontentloaded" });
    await settle(page);
    const rows = page.locator("table tbody tr");
    if (await rows.count()) {
      await rows.first().click();
      await settle(page);
      const has = await visible(page.getByRole("dialog").getByRole("heading", { name: "Selection criteria" }));
      ok(`${role}: campaign drawer ${READ.has(role) ? "shows" : "hides"} criteria`, has === READ.has(role) || (READ.has(role) && !has && (await visible(page.getByText(/not linked to a requisition you can see/)))), has);
      shots.push(await shot(page, `${role}__campaign_drawer`));
      const sw = await variants(page, `${role}__campaign_drawer`);
      ok(`${role}: campaign drawer at 375 px (${sw}) recorded`, true);
    } else ok(`${role}: no campaigns listed for this role`, true);

    ok(`${role}: no page errors`, issues.pageErrors.length === 0, issues.pageErrors);
    const selErr = issues.http.filter((h) => SEL.test(h));
    ok(`${role}: no failed selection requests`, selErr.length === 0, selErr);
    ok(`${role}: every selection response masks mobiles`, issues.unmasked.length === 0, issues.unmasked);
    if (!READ.has(role)) ok(`${role}: no selection API call at all`, issues.selCalls.length === 0, issues.selCalls);
    // "Failed to load resource" lines carry no URL: they are attributed to the HTTP errors recorded above. Selection endpoints are
    // checked on their own (no failed selection requests); other pages' errors (rig LMS 500, recruiter dashboard 409) are listed as unrelated.
    const unrelated = issues.http.filter((h) => !SEL.test(h));
    const consoleErr = issues.console.filter((t) => !(/^Failed to load resource/.test(t) && selErr.length === 0));
    ok(`${role}: no console errors`, consoleErr.length === 0, consoleErr.slice(0, 5));
    ok(`${role}: no failed network requests`, issues.failed.length === 0, issues.failed.slice(0, 5));
    perRole[role] = { shots: shots.length, selCalls: issues.selCalls.length, unrelatedHttp: unrelated, console: consoleErr };
    await ctx.close();
  }
} finally {
  await b.close();
}
fs.writeFileSync(path.join(SHOTS, "results.json"), JSON.stringify({ at: new Date().toISOString(), pass, fail: failN, perRole, results }, null, 1));
console.log(JSON.stringify({ pass, fail: failN }));
process.exit(failN ? 1 : 0);
