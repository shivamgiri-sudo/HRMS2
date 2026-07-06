import { test, expect, Page } from '@playwright/test';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOKEN = 'dab2ffec-56f8-4b97-8253-67d0797b0d5a';
const URL = `/onboard-full?token=${TOKEN}`;
const FIXTURE = path.resolve(__dirname, 'fixtures/dummy_doc.png');
const SS = (name: string) => `tests/e2e/screenshots/${name}.png`;

async function waitReady(page: Page) {
  // Wait for React to mount AND spinner to leave
  await page.waitForFunction(
    () => (document.getElementById('root')?.textContent?.trim()?.length ?? 0) > 20,
    { timeout: 20_000 }
  );
  await page.waitForFunction(
    () => !document.querySelector('svg.animate-spin'),
    { timeout: 15_000 }
  ).catch(() => {});
}

async function dismissCookieBanner(page: Page) {
  const accept = page.getByRole('button', { name: /Accept/i });
  if (await accept.isVisible({ timeout: 2000 }).catch(() => false)) {
    await accept.click();
    await page.waitForTimeout(200);
  }
}

async function next(page: Page) {
  await dismissCookieBanner(page);
  await page.getByRole('button', { name: /^Next/i }).click({ force: true });
  await page.waitForTimeout(300);
}

async function saveAndNext(page: Page, btnText: RegExp) {
  await page.getByRole('button', { name: btnText }).first().click();
  // wait for saving spinner gone
  await page.waitForFunction(() => !document.querySelector('svg.animate-spin'), { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(400);
  await next(page);
}

test('Candidate onboarding — all 10 steps', async ({ page }) => {
  // Listen to console for errors
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('[BROWSER ERROR]', msg.text());
  });
  page.on('pageerror', err => console.log('[PAGE ERROR]', err.message));

  // ── Load ─────────────────────────────────────────────────────────────────
  await page.goto(URL);
  await waitReady(page);
  await dismissCookieBanner(page);
  await page.screenshot({ path: SS('01_step1_welcome'), fullPage: true });

  // ── Step 1: Welcome ───────────────────────────────────────────────────────
  await expect(page.getByText(/MAS Callnet Onboarding/i)).toBeVisible();
  await expect(page.getByRole('heading', { name: /dsd dsd/i })).toBeVisible();

  // Accept DPDP privacy consent
  await page.locator('button').filter({ hasText: /consent to processing/i }).first().click();
  await expect(page.getByText(/Privacy consent recorded/i)).toBeVisible();
  await page.screenshot({ path: SS('01_step1_consent_ok'), fullPage: true });
  await next(page);

  // ── Step 2: Personal Details ──────────────────────────────────────────────
  await page.screenshot({ path: SS('02_step2_personal'), fullPage: true });

  await page.locator('select').first().selectOption('Mr').catch(() => {});
  await page.locator('input[placeholder*="Aadhaar"]').first().fill('Rahul Kumar Sharma');
  await page.locator('input[placeholder="Full name"]').first().fill('Ramesh Kumar Sharma');
  await page.locator('input[placeholder="Full name"]').nth(1).fill('Sunita Devi').catch(() => {});
  await page.locator('input[type="date"]').first().fill('1998-06-15');
  // Gender — pick first select with Male option
  await page.locator('select').filter({ has: page.locator('option', { hasText: 'Male' }) }).first().selectOption('Male').catch(() => {});
  await page.locator('select').filter({ has: page.locator('option', { hasText: 'Single' }) }).first().selectOption('Single').catch(() => {});
  await page.locator('select').filter({ has: page.locator('option', { hasText: 'B+' }) }).first().selectOption('B+').catch(() => {});
  await page.locator('input[type="tel"]').nth(0).fill('9979788174');
  await page.locator('input[type="email"]').nth(0).fill('rahul.sharma98@gmail.com');
  // Emergency contact
  await page.locator('input[placeholder="Full name"]').nth(2).fill('Ramesh Kumar Sharma').catch(() => {});
  await page.locator('input[type="tel"]').nth(1).fill('9812345678').catch(() => {});
  // Nominee
  await page.locator('input[placeholder*="Nominee"]').first().fill('Ramesh Kumar Sharma').catch(() => {});
  await page.locator('input[placeholder="100"]').fill('100').catch(() => {});

  await page.screenshot({ path: SS('02_step2_filled'), fullPage: true });
  await saveAndNext(page, /Save Personal Details/i);

  // ── Step 3: Address & KYC ─────────────────────────────────────────────────
  await page.screenshot({ path: SS('03_step3_address'), fullPage: true });

  await page.locator('textarea').first().fill('123, Sector 15, Near Metro Station, Noida');
  await page.locator('select').filter({ has: page.locator('option', { hasText: 'Uttar Pradesh' }) }).first().selectOption('Uttar Pradesh').catch(() => {});
  await page.locator('input[placeholder="City"]').first().fill('Noida');
  await page.locator('input[placeholder="6 digits"]').first().fill('201301');
  await page.locator('#sameAddr').check().catch(() => {});
  await page.locator('button').filter({ hasText: /^Aadhaar Card$/ }).first().click().catch(() => {});
  await page.locator('input[placeholder="ABCDE1234F"]').fill('ABCDE1234F');
  await page.locator('input[placeholder="12-digit number"]').fill('234567890123');

  await page.screenshot({ path: SS('03_step3_filled'), fullPage: true });
  await saveAndNext(page, /Save Address/i);

  // ── Step 4: Documents ─────────────────────────────────────────────────────
  await page.screenshot({ path: SS('04_step4_docs'), fullPage: true });

  // Wait for step 4 UI to be visible
  await expect(page.getByText(/Upload a Document/i)).toBeVisible({ timeout: 10_000 });

  for (const docType of ['Aadhaar', 'PAN Card', '10th Marksheet', 'Cancelled Cheque', 'Passport Photo']) {
    await page.locator('select').first().selectOption(docType).catch(() => {});
    // File input is hidden (.sr-only), so we use setInputFiles directly
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(FIXTURE, { timeout: 5000 });
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: /Upload Document/i }).first().click();
    await page.waitForFunction(() => !document.querySelector('svg.animate-spin'), { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(300);
  }

  await page.screenshot({ path: SS('04_step4_docs_uploaded'), fullPage: true });
  await next(page);

  // ── Step 5: BGV Consent ───────────────────────────────────────────────────
  await page.screenshot({ path: SS('05_step5_bgv'), fullPage: true });
  await page.getByRole('button', { name: /Give Consent/i }).first().click();
  await page.waitForFunction(() => !document.querySelector('svg.animate-spin'), { timeout: 10_000 }).catch(() => {});
  await expect(page.getByText(/Consent Captured/i)).toBeVisible();
  await page.screenshot({ path: SS('05_step5_bgv_ok'), fullPage: true });
  await next(page);

  // ── Step 6: Bank Details ──────────────────────────────────────────────────
  await page.screenshot({ path: SS('06_step6_bank'), fullPage: true });

  await page.locator('input[placeholder="ABCD0123456"]').fill('SBIN0001234');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(1200); // IFSC lookup
  await page.locator('input[placeholder*="Full name as on bank"]').fill('Rahul Kumar Sharma').catch(() => {});
  await page.locator('select').filter({ has: page.locator('option', { hasText: 'Savings' }) }).first().selectOption('Savings').catch(() => {});
  await page.locator('input[placeholder="Enter account number"]').fill('12345678901');
  await page.locator('input[placeholder="Re-enter to confirm"]').fill('12345678901');
  await page.locator('input[placeholder*="Name as on cheque"]').fill('Rahul Kumar Sharma').catch(() => {});

  await page.screenshot({ path: SS('06_step6_bank_filled'), fullPage: true });
  await saveAndNext(page, /Save Bank Details/i);

  // ── Step 7: Education ─────────────────────────────────────────────────────
  await page.screenshot({ path: SS('07_step7_education'), fullPage: true });

  await page.locator('select').filter({ has: page.locator('option', { hasText: '10th / SSC' }) }).first().selectOption('10th / SSC').catch(() => {});
  await page.locator('input[placeholder*="Full institution name"]').fill('Delhi Public School, Noida').catch(() => {});
  await page.locator('input[placeholder*="CBSE"]').fill('CBSE').catch(() => {});
  // Year of passing — last numeric input
  await page.locator('input[inputmode="numeric"]').last().fill('2015').catch(() => {});
  await page.locator('input[placeholder*="72.5"]').fill('82.5').catch(() => {});

  await page.getByRole('button', { name: /Add Qualification/i }).first().click();
  await page.waitForFunction(() => !document.querySelector('svg.animate-spin'), { timeout: 10_000 }).catch(() => {});
  await page.screenshot({ path: SS('07_step7_edu_added'), fullPage: true });
  await next(page);

  // ── Step 8: Experience ────────────────────────────────────────────────────
  await page.screenshot({ path: SS('08_step8_experience'), fullPage: true });

  await page.locator('select').filter({ has: page.locator('option', { hasText: 'Fresher' }) }).first().selectOption('Fresher (No Experience)').catch(() => {});
  await expect(page.getByText(/Fresher profile selected/i)).toBeVisible();

  await page.screenshot({ path: SS('08_step8_fresher'), fullPage: true });
  await saveAndNext(page, /Save Experience/i);

  // ── Step 9: Family & Language ─────────────────────────────────────────────
  await page.screenshot({ path: SS('09_step9_family'), fullPage: true });

  await page.locator('input[placeholder*="Approximate annual income"]').fill('300000').catch(() => {});
  await page.locator('input[placeholder*="Including yourself"]').fill('3').catch(() => {});

  // Add English via quick chip
  await page.locator('button').filter({ hasText: /^English$/ }).click().catch(() => {});
  // Check all skill checkboxes
  const skillBoxes = page.locator('label').filter({ hasText: /^(Read|Write|Speak)$/i }).locator('input[type="checkbox"]');
  for (let i = 0; i < await skillBoxes.count(); i++) await skillBoxes.nth(i).check().catch(() => {});
  await page.getByRole('button', { name: /^Add$/i }).first().click().catch(() => {});
  await page.waitForTimeout(300);

  // Add Hindi
  await page.locator('button').filter({ hasText: /^Hindi$/ }).click().catch(() => {});
  await page.getByRole('button', { name: /^Add$/i }).first().click().catch(() => {});
  await page.waitForTimeout(300);

  await page.screenshot({ path: SS('09_step9_family_filled'), fullPage: true });
  await saveAndNext(page, /Save Family/i);

  // ── Step 10: Statutory & Submit ───────────────────────────────────────────
  await page.screenshot({ path: SS('10_step10_statutory'), fullPage: true });

  // PF / EPS / International worker — all No
  const noButtons = page.locator('button').filter({ hasText: /^No$/ });
  for (let i = 0; i < Math.min(await noButtons.count(), 3); i++) {
    await noButtons.nth(i).click().catch(() => {});
    await page.waitForTimeout(150);
  }
  await page.screenshot({ path: SS('10_step10_yn_done'), fullPage: true });

  // Send OTP
  await page.getByRole('button', { name: /Send OTP/i }).first().click();
  await page.waitForFunction(() => !document.querySelector('svg.animate-spin'), { timeout: 10_000 }).catch(() => {});
  await page.screenshot({ path: SS('10_step10_otp_sent'), fullPage: true });

  // Enter OTP if input visible
  const otpInput = page.locator('input[placeholder="000000"]');
  if (await otpInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await otpInput.fill('123456');
    await page.getByRole('button', { name: /^Verify$/i }).first().click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: SS('10_step10_otp_result'), fullPage: true });
  }

  // Declaration checkbox
  await page.locator('label').filter({ hasText: /true, correct and complete/i })
    .locator('input[type="checkbox"]').first().check().catch(() => {});

  await page.screenshot({ path: SS('10_step10_declaration_done'), fullPage: true });

  // Submit button visible
  await expect(page.getByRole('button', { name: /Submit Onboarding/i })).toBeVisible();
  await page.screenshot({ path: SS('10_step10_final'), fullPage: true });
});
