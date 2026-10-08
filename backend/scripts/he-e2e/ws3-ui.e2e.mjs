// Rig UI e2e (he-e2e2, WS3): the campaign map (matrix, Map it prefill, relink preview, funnel drill-down), the campaign drawer's
// requisitions editor and the pool bridge card, per role at desktop / 375 px / dark, with console errors, failed requests and masked
// mobiles in every WS3 response; then a deep matrix over the seeded situations (super_admin).
//   WS3_UI=http://127.0.0.1:5399 WS3_SHOTS=/home/shuvam/he-e2e2/shots/ws3 node backend/scripts/he-e2e/ws3-ui.e2e.mjs
// The UI must proxy to the WS3 backend on the isolated clone (ws3_rig). Nothing is applied from the UI: relink and bridge are previewed.
import fs from "node:fs";
import path from "node:path";

const UI = process.env.WS3_UI ?? "http://127.0.0.1:5399";
const SHOTS = process.env.WS3_SHOTS ?? "/home/shuvam/he-e2e2/shots/ws3";
const ONLY = process.env.WS3_ROLES?.split(",");
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
const WS3 = /\/api\/(he\/campaign-matrix|he\/pool\/|meta\/campaigns\/[^/]+\/(requisitions|routing|relink)|meta\/leads\/[^/]+\/requisition)/;
const FULL_MOBILE = /(?<![\d])[6-9]\d{9}(?![\d])/;

async function login(b, role) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const issues = { console: [], pageErrors: [], failed: [], http: [], ws3Calls: [], unmasked: [] };
  page.on("console", (m) => { if (m.type() === "error") issues.console.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => issues.pageErrors.push(e.message.slice(0, 200)));
  page.on("requestfailed", (r) => { if (!/favicon|hot-update|\.map$|\/@vite|ws:/.test(r.url()) && r.failure()?.errorText !== "net::ERR_ABORTED") issues.failed.push(`${r.method()} ${r.url().replace(UI, "")} ${r.failure()?.errorText}`); });
  page.on("response", async (r) => {
    const u = r.url();
    if (!u.includes("/api/")) return;
    if (r.status() >= 400) issues.http.push(`${r.status()} ${r.request().method()} ${u.replace(UI, "")}`);
    if (WS3.test(u)) {
      issues.ws3Calls.push(`${r.status()} ${u.replace(UI, "")}`);
      try { const t = await r.text(); if (FULL_MOBILE.test(t)) issues.unmasked.push(`${u.replace(UI, "")}: ${t.match(FULL_MOBILE)[0].slice(0, 2)}…`); } catch { /* body gone */ }
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
const sideScroll = async (page) => page.evaluate(() => document.scrollingElement.scrollWidth);
const visible = async (loc) => (await loc.count()) > 0 && (await loc.first().isVisible().catch(() => false));
async function into(page, loc) { if (await visible(loc)) await loc.first().scrollIntoViewIfNeeded().catch(() => {}); }
async function variants(page, name, anchor) {
  await page.setViewportSize({ width: 375, height: 800 });
  await settle(page, 8000);
  const sw = await sideScroll(page);
  if (anchor) await into(page, anchor);
  await shot(page, `${name}_375`);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.waitForTimeout(300);
  await shot(page, `${name}_375_dark`);
  await page.setViewportSize({ width: 1440, height: 1000 });
  if (anchor) await into(page, anchor);
  await shot(page, `${name}_dark`);
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  return sw;
}

const HE = new Set(["super_admin", "admin", "hr", "branch_hr_noida2", "branch_hr_ahm", "ceo"]);
const WRITE = new Set(["super_admin", "admin", "hr", "branch_hr_noida2", "branch_hr_ahm"]);
const BRIDGE = new Set(["super_admin", "admin"]);
const MAP_HEADING = "Campaign map: which drive works on which requisition";
const b = await chromium.launch({ headless: true });
try {
  for (const role of Object.keys(USERS).filter((r) => !ONLY || ONLY.includes(r))) {
    console.log(`\n== ${role}`);
    const { ctx, page, issues } = await login(b, role);
    // A. Summary: the campaign map
    await page.goto(`${UI}/ats/hiring-engine#drives:summary`, { waitUntil: "domcontentloaded" });
    await settle(page);
    const map = page.getByRole("heading", { name: MAP_HEADING });
    if (!HE.has(role)) {
      ok(`${role}: no campaign map (no Hiring Engine access)`, !(await visible(map)));
      await shot(page, `${role}__summary`);
    } else {
      ok(`${role}: campaign map shown`, await visible(map));
      await into(page, map);
      const section = page.locator("section", { has: map });
      const table = section.locator("table");
      ok(`${role}: map has rows or an honest empty state`, (await table.count()) > 0 || (await visible(section.getByText("No campaign or open requisition in your scope"))));
      const words = await section.innerText();
      ok(`${role}: cells read as words (Running / Idle / Not mapped)`, /Running|Idle|Not mapped/.test(words) || words.includes("No campaign or open requisition"), words.slice(0, 200));
      const mapIt = section.getByRole("button", { name: /^Map it:/ });
      const relink = section.getByRole("button", { name: /^Relink to an open requisition:/ });
      const notMappedCells = await section.locator("tbody td", { hasText: "Not mapped" }).count();
      const closedCells = await section.locator("tbody td", { hasText: /is closed|seats of .* are filled/ }).count();
      ok(`${role}: Map it ${WRITE.has(role) ? "offered on every not-mapped cell" : "hidden"} (${notMappedCells} not mapped)`, WRITE.has(role) ? (await mapIt.count()) === notMappedCells : (await mapIt.count()) === 0, await mapIt.count());
      ok(`${role}: Relink ${WRITE.has(role) ? "offered" : "hidden"} where a campaign sits on a closed / full requisition (${closedCells})`, WRITE.has(role) ? (closedCells === 0 || (await relink.count()) > 0) : (await relink.count()) === 0, await relink.count());
      await shot(page, `${role}__campaign_map`);
      const sw = await variants(page, `${role}__campaign_map`, map);
      ok(`${role}: no page side scroll at 375 px (${sw})`, sw <= 380, sw);
      // expand the first row: the funnel drill-down
      const expand = section.locator("button[aria-expanded]").first();
      if (await visible(expand)) {
        await expand.click();
        await page.waitForTimeout(400);
        ok(`${role}: row expands (aria-expanded true) with the three funnels`, (await expand.getAttribute("aria-expanded")) === "true" && (await visible(section.getByRole("heading", { name: "Hiring Engine", level: 5 }))));
        await shot(page, `${role}__map_funnel`);
      }
      if (WRITE.has(role) && (await mapIt.count()) > 0) {
        const label = await mapIt.first().getAttribute("aria-label");
        await mapIt.first().click();
        const dlg = page.getByRole("dialog").filter({ hasText: "Open a stream" });
        await dlg.waitFor({ timeout: 10000 }).catch(() => {});
        const kind = label.includes("Live Meta") ? "Live Meta" : label.includes("Old Meta") ? "Old Meta data" : "Hiring Engine";
        const checked = await dlg.getByRole("radio", { name: kind }).isChecked().catch(() => false);
        ok(`${role}: Map it opens Open-a-stream at the source step, prefilled (${label})`, (await visible(dlg)) && checked, label);
        await shot(page, `${role}__map_it_dialog`);
        await dlg.getByRole("button", { name: "Cancel" }).click().catch(() => page.keyboard.press("Escape"));
        await page.waitForTimeout(300);
      }
    }
    // B. Hiring Engine section: the pool bridge card (admins)
    if (HE.has(role)) {
      await page.goto(`${UI}/ats/hiring-engine#drives:he`, { waitUntil: "domcontentloaded" });
      await settle(page);
      const card = page.getByRole("heading", { name: "Bring imports into the pool" });
      ok(`${role}: pool bridge card ${BRIDGE.has(role) ? "shown" : "hidden"}`, (await visible(card)) === BRIDGE.has(role));
      if (BRIDGE.has(role)) {
        await into(page, card);
        const sec = page.locator("section", { has: card });
        await sec.getByRole("button", { name: "Dry run" }).click();
        await sec.getByText(/would be added/).waitFor({ timeout: 20000 }).catch(() => {});
        ok(`${role}: dry run shows the per-file table and enables the run`, (await visible(sec.getByText(/would be added/))) && (await sec.getByRole("button", { name: "Bring into the pool" }).isEnabled()));
        ok(`${role}: the card says nobody is contacted`, await visible(sec.getByText(/Nobody is contacted/)));
        await shot(page, `${role}__pool_bridge_dry_run`);
        const sw = await variants(page, `${role}__pool_bridge`, card);
        ok(`${role}: bridge card at 375 px without page side scroll (${sw})`, sw <= 380, sw);
      }
    }
    // C. Meta campaign drawer: the requisitions editor (C1 = the multi-requisition campaign)
    await page.goto(`${UI}/ats/meta-campaigns`, { waitUntil: "domcontentloaded" });
    await settle(page);
    const c1 = page.locator("table tbody tr", { hasText: "RIG NOIDA-2 Telesales Oct" });
    if (await visible(c1)) {
      await c1.first().click();
      await settle(page);
      const reqs = page.getByRole("heading", { name: /^Requisitions \(\d+\)$/ });
      await reqs.first().waitFor({ timeout: 15000 }).catch(() => {});
      const h = (await visible(reqs)) ? await reqs.first().innerText() : "";
      ok(`${role}: campaign drawer lists the campaign's requisitions`, h === "Requisitions (2)", h);
      const writer = await visible(page.getByRole("button", { name: /^Remove RIG-R0/ }));
      ok(`${role}: link controls ${WRITE.has(role) ? "shown" : "hidden"}`, writer === WRITE.has(role), writer);
      await into(page, reqs);
      await shot(page, `${role}__campaign_requisitions`);
      const sw = await variants(page, `${role}__campaign_requisitions`, reqs);
      ok(`${role}: campaign drawer at 375 px recorded (${sw})`, true);
    } else ok(`${role}: the NOIDA-2 campaign is not listed for this role (branch scope; the CEO is not a Meta campaign reader)`, !["super_admin", "branch_hr_noida2"].includes(role), role);

    ok(`${role}: no page errors`, issues.pageErrors.length === 0, issues.pageErrors);
    const ws3Err = issues.http.filter((x) => WS3.test(x) && !/ 403 /.test(` ${x}`));
    ok(`${role}: no failed WS3 requests`, ws3Err.length === 0, ws3Err);
    ok(`${role}: every WS3 response masks mobiles`, issues.unmasked.length === 0, issues.unmasked);
    ok(`${role}: no failed network requests`, issues.failed.length === 0, issues.failed);
    const unrelated = issues.http.filter((x) => !WS3.test(x));
    console.log(`   unrelated HTTP errors (other pages): ${JSON.stringify([...new Set(unrelated)]).slice(0, 300)}`);
    console.log(`   console errors: ${issues.console.length}`);
    await ctx.close();
  }

  // D. deep matrix (super_admin)
  if (!ONLY || ONLY.includes("super_admin")) {
    console.log("\n== deep matrix (super_admin)");
    const { ctx, page } = await login(b, "super_admin");
    await page.goto(`${UI}/ats/hiring-engine#drives:summary`, { waitUntil: "domcontentloaded" });
    await settle(page);
    const map = page.getByRole("heading", { name: MAP_HEADING });
    await into(page, map);
    const sec = page.locator("section", { has: map });
    const rowOf = (text) => sec.locator("tbody tr", { hasText: text }).first();
    const k7 = rowOf("RIG K7BK-like");
    ok("deep: K7BK-like row says the requisition is closed and offers the relink", (await k7.innerText()).includes("closed") && (await visible(k7.getByRole("button", { name: /Relink to an open requisition/ }))));
    const multi = await sec.locator("tbody tr", { hasText: "RIG NOIDA-2 Telesales Oct" }).count();
    ok("deep: the multi-requisition campaign shows one row per requisition (2)", multi === 2, multi);
    ok("deep: the paused campaign without activity is not a row", (await sec.locator("tbody tr", { hasText: "RIG paused campaign" }).count()) === 0);
    ok("deep: the draft campaign row names its state", (await rowOf("RIG Draft campaign").innerText()).includes("draft"));
    ok("deep: the owner=he campaign is a row", await visible(rowOf("RIG AHM owner=he campaign")));
    const r04 = rowOf("RIG-R04");
    ok("deep: R04 shows Ended and the end-date warning", (await r04.innerText()).includes("Ended") && (await r04.innerText()).includes("warning"));
    ok("deep: R08 (DELHI) is a Hiring Engine only row", (await rowOf("RIG-R08").innerText()).includes("No campaign: Hiring Engine only"));
    await shot(page, "deep__matrix_all");
    await sec.getByLabel("Only problems").check();
    await page.waitForTimeout(300);
    await shot(page, "deep__matrix_only_problems");
    await sec.getByLabel("State").selectOption("not_mapped");
    await page.waitForTimeout(300);
    const nm = await sec.locator("tbody tr").count();
    ok("deep: state filter Not mapped narrows the rows", nm > 0, nm);
    await shot(page, "deep__matrix_not_mapped");
    await sec.getByLabel("State").selectOption("all");
    await sec.getByLabel("Only problems").uncheck();
    // relink preview from the K7BK cell (not applied)
    await k7.getByRole("button", { name: /Relink to an open requisition/ }).click();
    const dlg = page.getByRole("dialog").filter({ hasText: "Relink to an open requisition" });
    await dlg.waitFor({ timeout: 10000 }).catch(() => {});
    const confirmBtn = dlg.getByRole("button", { name: "Confirm relink" });
    ok("deep: relink dialog opens with Confirm disabled before a preview", (await visible(dlg)) && (await confirmBtn.isDisabled()));
    const opt = await dlg.locator("select option").nth(1).getAttribute("value");
    await dlg.locator("select").selectOption(opt);
    await dlg.getByRole("button", { name: "Preview the move" }).click();
    await dlg.getByText(/not yet contacted move to/).waitFor({ timeout: 10000 }).catch(() => {});
    ok("deep: the preview says who moves and who stays", (await visible(dlg.getByText(/not yet contacted move to/))) && (await visible(dlg.getByText(/already contacted stay on RIG-R05/))));
    await dlg.getByLabel(/Reason/).fill("rig preview only");
    ok("deep: Confirm enabled after preview + reason (not clicked: the API suite applies it)", await confirmBtn.isEnabled());
    await shot(page, "deep__relink_preview");
    await page.setViewportSize({ width: 375, height: 800 });
    await page.waitForTimeout(300);
    await shot(page, "deep__relink_preview_375");
    await dlg.getByRole("button", { name: "Cancel" }).click();
    await ctx.close();
  }
} finally { await b.close(); }
console.log(`\n${pass} passed, ${failN} failed`);
fs.writeFileSync(path.join(SHOTS, "results.json"), JSON.stringify({ pass, fail: failN, results }, null, 1));
process.exit(failN ? 1 : 0);
