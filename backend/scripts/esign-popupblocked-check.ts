/**
 * Clicks "Proceed to Aadhaar eSign" in a context where popups are BLOCKED —
 * the condition a real Chrome/mobile browser enforces, and the one the old
 * window.open call silently failed under.
 *
 * Pass: the tab itself navigates to the provider, so a blocked popup is
 * irrelevant. A "still on review page" result means the fix did not take.
 */
import { chromium } from "playwright";

const TOKEN = process.env.ESIGN_TOKEN ?? "";
const BASE = "https://mcnhrms.teammas.in";

async function run() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 420, height: 880 } });

  // Kill window.open outright. This reproduces a popup blocker exactly: the call
  // returns null and nothing opens. If the page still reaches the provider, the
  // flow no longer depends on popups.
  await ctx.addInitScript(() => {
    (window as unknown as { open: () => null }).open = () => null;
  });

  const page = await ctx.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 140)); });

  await page.goto(`${BASE}/employee/joining-documents/esign/${TOKEN}`, { waitUntil: "networkidle", timeout: 90_000 });
  await page.waitForTimeout(2500);

  const accept = page.getByRole("button", { name: /^Accept$/i }).first();
  if (await accept.count()) { await accept.click({ timeout: 8000 }).catch(() => {}); await page.waitForTimeout(500); }

  const target = page.getByRole("button", { name: /proceed to .*e-?sign/i }).first();
  if (!(await target.count())) { console.log("RESULT: no eSign button on page"); await browser.close(); process.exit(0); }

  const before = page.url();
  const popupPromise = ctx.waitForEvent("page", { timeout: 8000 }).catch(() => null);
  await target.click({ timeout: 15_000 }).catch((e) => console.log("click error:", String(e).slice(0, 90)));
  const popup = await popupPromise;

  // Give the in-tab redirect time to land on the provider.
  await page.waitForURL((u) => !u.href.includes("/joining-documents/esign/"), { timeout: 25_000 }).catch(() => {});
  await page.waitForTimeout(2500);

  const after = page.url();
  console.log("popups blocked in this context: yes (window.open stubbed to null)");
  console.log("new tab opened:", popup ? popup.url().slice(0, 70) : "NO (expected)");
  console.log("tab navigated away:", after === before ? "NO — STILL ON REVIEW PAGE" : "YES");
  console.log("landed on:", after.slice(0, 100));

  const body = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
  console.log("page text:", body.slice(0, 180) || "(empty)");
  console.log("console errors:", JSON.stringify(consoleErrors.slice(0, 3)));

  const reachedProvider = /e-?mudhra|esign|aadhaar/i.test(after) && !after.includes("/joining-documents/esign/");
  console.log(`\nVERDICT: ${reachedProvider ? "PASS — reaches the signing page with popups blocked" : "FAIL — did not reach the provider"}`);

  await page.screenshot({ path: "C:\\tmp\\esign-popupblocked.png" });
  await browser.close();
  process.exit(0);
}

run().catch((e) => { console.error("driver failed:", e); process.exit(1); });
