import { chromium } from "playwright";
import fs from "node:fs/promises";

const baseUrl = "http://127.0.0.1:8081";
const email = "sofiya.sultan@teammas.co.in";
const password = "Noida@1234";
const outDir = ".codex-runtime/playwright-preview";

await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const consoleLogs = [];
const pageErrors = [];
const responses = [];

page.on("console", (msg) => consoleLogs.push(`${msg.type()}: ${msg.text()}`));
page.on("pageerror", (err) => pageErrors.push(err.message));
page.on("response", (response) => {
  const url = response.url();
  if (url.includes("/api/") || response.status() >= 400) {
    responses.push(`${response.status()} ${url}`);
  }
});

async function screenshot(name) {
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: true });
}

async function fillFirst(selectors, value) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      await locator.fill(value);
      return selector;
    }
  }
  throw new Error(`No selector matched for value ${value}`);
}

async function clickFirst(selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      await locator.click();
      return selector;
    }
  }
  throw new Error(`No clickable selector matched: ${selectors.join(", ")}`);
}

const result = {
  baseUrl,
  loginUrl: "",
  finalUrl: "",
  titleTexts: {},
  consoleLogs,
  pageErrors,
  responses,
};

try {
  await page.goto(`${baseUrl}/hr/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  result.loginUrl = page.url();
  await screenshot("01-initial");

  if (/login/i.test(page.url()) || await page.locator("input[type='password']").count()) {
    await fillFirst([
      "input[type='email']",
      "input[name='email']",
      "input[name='identifier']",
      "input[name='login']",
      "input[placeholder*='email' i]",
      "input[placeholder*='employee' i]",
      "input[placeholder*='company' i]",
      "input[placeholder*='EMP' i]",
      "input[type='text']",
      "input:not([type])",
    ], email);
    await fillFirst([
      "input[type='password']",
      "input[name='password']",
      "input[placeholder*='password' i]",
    ], password);
    await clickFirst([
      "button[type='submit']",
      "button:has-text('Login')",
      "button:has-text('Sign in')",
      "button:has-text('Continue')",
    ]);
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await screenshot("02-after-login");
  }

  const routes = [
    ["hr", "/hr/dashboard", "HR Dashboard"],
    ["payroll", "/payroll-hr/dashboard", "Finance / Payroll Dashboard"],
    ["wfm", "/wfm/dashboard", "WFM / Attendance Dashboard"],
    ["manager", "/manager/dashboard", "Manager Dashboard"],
    ["employee", "/my-dashboard", "Welcome"],
  ];

  for (const [key, route, expected] of routes) {
    await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await screenshot(`route-${key}`);
    result.titleTexts[key] = {
      url: page.url(),
      expected,
      h1: await page.locator("h1").first().textContent().catch(() => null),
      bodyHasExpected: await page.getByText(expected, { exact: false }).first().isVisible().catch(() => false),
      bodyTextSample: (await page.locator("body").innerText().catch(() => "")).slice(0, 1000),
    };
  }

  result.finalUrl = page.url();
} finally {
  await fs.writeFile(`${outDir}/result.json`, JSON.stringify(result, null, 2));
  await browser.close();
}
