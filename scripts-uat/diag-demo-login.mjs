import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ baseURL: "http://localhost:8080" });

page.on("console", (msg) => console.log(`[console:${msg.type()}]`, msg.text()));
page.on("requestfailed", (req) => console.log(`[reqfailed]`, req.url(), req.failure()?.errorText));
page.on("response", (res) => {
  if (res.url().includes("/api/")) {
    console.log(`[response] ${res.status()} ${res.url()}`);
  }
});

await page.addInitScript((s) => {
  localStorage.setItem("hrms_demo_session", JSON.stringify(s));
}, {
  access_token: "mock-token-admin",
  user: { id: "demo-admin-id", email: "admin@mascallnet.com" },
});

console.log("Navigating to /dashboard...");
await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);

const localStorageContent = await page.evaluate(() => JSON.stringify(localStorage));
console.log("localStorage after nav:", localStorageContent);

const bodyText = await page.locator("body").textContent();
console.log("Body text (first 500 chars):", bodyText?.slice(0, 500));

const url = page.url();
console.log("Final URL:", url);

await browser.close();
