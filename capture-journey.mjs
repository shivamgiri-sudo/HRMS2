import { chromium, devices } from 'playwright';

const BASE = 'https://mcnhrms.teammas.in';

async function login(page) {
  await page.goto(BASE + '/auth', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);
  // Dismiss cookie banner if present
  await page.locator('button:has-text("Accept")').click({ timeout: 3000 }).catch(() => {});
  await page.locator('button:has-text("Accept Cookies")').click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.locator('input').first().fill('admin@mas.in');
  await page.locator('input[type="password"]').fill('Admin@12345');
  // Click using JS to bypass any overlay
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Sign In'));
    if (btn) btn.click();
  });
  await page.waitForURL(url => !url.toString().includes('/auth'), { timeout: 15000 });
  await page.waitForTimeout(2000);
  // Dismiss cookie banner after login too
  await page.locator('button:has-text("Accept")').click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(500);
}

async function shot(page, name, fullPage = true) {
  // Dismiss cookie banner before every screenshot
  await page.locator('button:has-text("Accept")').click({ timeout: 1500 }).catch(() => {});
  await page.waitForTimeout(300);
  const path = `pictures/journey-${name}.png`;
  await page.screenshot({ path, fullPage });
  console.log(`  📸 ${path}`);
}

async function goto(page, path, label) {
  console.log(`\n→ ${label}`);
  await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.locator('button:has-text("Accept")').click({ timeout: 1500 }).catch(() => {});
  await page.waitForTimeout(300);
}

const browser = await chromium.launch({ headless: true });

// ─── DESKTOP JOURNEY ────────────────────────────────────────────────────────
console.log('\n════════════════════════════════\n  DESKTOP JOURNEY\n════════════════════════════════');
const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
const dp = await desk.newPage();
await login(dp);
console.log('  ✅ Logged in (desktop)');

// 01 - Dashboard
await shot(dp, '01-dashboard');

// 02 - ATS Candidate Registration form (public walk-in form)
await goto(dp, '/ats/candidate-registration', 'Candidate Registration Form');
await shot(dp, '02-candidate-registration-form');

// 03 - ATS Candidate Master (recruiter list view)
await goto(dp, '/ats/candidate-master', 'ATS Candidate Master');
await shot(dp, '03-candidate-master-list');

// 04 - Recruiter Workspace (kanban/stages)
await goto(dp, '/ats/recruiter/workspace', 'Recruiter Workspace');
await shot(dp, '04-recruiter-workspace');

// 05 - Onboarding Bridge / ATS Onboarding
await goto(dp, '/ats/onboarding-bridge', 'Onboarding Bridge');
await shot(dp, '05-onboarding-bridge');

// 06 - HR Onboarding Requests list
await goto(dp, '/ats/onboarding-requests', 'HR Onboarding Requests List');
await shot(dp, '06-hr-onboarding-requests-list');

// 07 - Offer creation form — click first "Create Offer" button
const createOfferBtn = dp.locator('button:has-text("Create Offer")').first();
const hasCO = await createOfferBtn.count();
if (hasCO) {
  await createOfferBtn.click();
  await dp.waitForTimeout(3000);
  await shot(dp, '07-offer-creation-form-full');

  // Capture field population report
  const fieldReport = await dp.evaluate(() => {
    const selects = Array.from(document.querySelectorAll('select'));
    const inputs  = Array.from(document.querySelectorAll('input[type=date], input[type=number], input[type=text]'));
    return {
      selects: selects.map(s => ({
        label: s.closest('[class]')?.querySelector('label')?.textContent?.trim() || s.name || s.id || '?',
        value: s.value,
        optionCount: s.options.length,
        populated: s.value !== '',
      })),
      inputs: inputs.map(i => ({
        label: i.closest('[class]')?.querySelector('label')?.textContent?.trim() || i.placeholder || i.name || '?',
        value: i.value,
        type: i.type,
        populated: i.value !== '',
      })),
    };
  });
  console.log('\n  FIELD POPULATION REPORT:');
  [...fieldReport.selects, ...fieldReport.inputs].forEach(f => {
    const icon = f.populated ? '  ✅' : '  ⚠️ EMPTY';
    console.log(`${icon}  [${f.label?.substring(0,40)}] = "${f.value}" ${f.optionCount ? `(${f.optionCount} options)` : ''}`);
  });

  // Scroll down and screenshot compensation section
  await dp.evaluate(() => window.scrollTo(0, 600));
  await dp.waitForTimeout(400);
  await shot(dp, '07b-offer-compensation-section', false);

  // Go back
  await dp.goBack();
  await dp.waitForTimeout(1500);
} else {
  console.log('  ⚠️  No "Create Offer" button — all candidates already have offers');
}

// 08 - Branch Head Approvals page
await goto(dp, '/ats/offer-approvals', 'Branch Head Offer Approvals');
await shot(dp, '08-branch-head-approvals-list');

// Click first review/approve button if present
const reviewBtn = dp.locator('button:has-text("Review"), button:has-text("Approve"), button:has-text("View Offer"), a:has-text("Review")').first();
if (await reviewBtn.count()) {
  await reviewBtn.click();
  await dp.waitForTimeout(2500);
  await shot(dp, '08b-offer-approval-detail-view');
  await dp.goBack().catch(() => {});
  await dp.waitForTimeout(1000);
}

// 09 - Alternative: branch-head-approval page
await goto(dp, '/ats/branch-head-approval', 'Branch Head Approval (alt page)');
await shot(dp, '09-branch-head-approval-alt');

// 10 - BGV Verification Center
await goto(dp, '/ats/bgv', 'BGV Verification Center');
await shot(dp, '10-bgv-center');

// 11 - Employee list
await goto(dp, '/employees', 'Employee List');
await shot(dp, '11-employees-list');

// 12 - Onboarding (HR manual add employee)
await goto(dp, '/onboarding', 'HR Manual Onboarding');
await shot(dp, '12-hr-manual-onboarding');

await desk.close();

// ─── MOBILE JOURNEY ─────────────────────────────────────────────────────────
console.log('\n════════════════════════════════\n  MOBILE JOURNEY (iPhone 14)\n════════════════════════════════');
const mob = await browser.newContext({
  ...devices['iPhone 14'],
  ignoreHTTPSErrors: true,
});
const mp = await mob.newPage();

// M01 - Candidate onboarding landing (public, no login needed)
console.log('\n→ Candidate Onboarding Full Page (mobile — public)');
await mp.goto(BASE + '/onboard-full', { waitUntil: 'networkidle', timeout: 30000 });
await mp.waitForTimeout(2500);
await mp.locator('button:has-text("Accept")').click({ timeout: 2000 }).catch(() => {});
await shot(mp, 'M01-mobile-onboard-full-landing');

// Scroll to see more
await mp.evaluate(() => window.scrollTo(0, 400));
await mp.waitForTimeout(400);
await shot(mp, 'M01b-mobile-onboard-full-scroll', false);

// M02 - Interview registration (walk-in form)
console.log('\n→ Interview/Walk-in Registration (mobile)');
await mp.goto(BASE + '/interview-registration', { waitUntil: 'networkidle', timeout: 30000 });
await mp.waitForTimeout(2000);
await mp.locator('button:has-text("Accept")').click({ timeout: 2000 }).catch(() => {});
await shot(mp, 'M02-mobile-interview-registration');

// M03 - Auth page
console.log('\n→ Auth page (mobile)');
await mp.goto(BASE + '/auth', { waitUntil: 'networkidle', timeout: 30000 });
await mp.waitForTimeout(1500);
await mp.locator('button:has-text("Accept")').click({ timeout: 2000 }).catch(() => {});
await shot(mp, 'M03-mobile-auth-page');

// M04 - Login on mobile
await mp.locator('input').first().fill('admin@mas.in');
await mp.locator('input[type="password"]').fill('Admin@12345');
await mp.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Sign In'));
  if (btn) btn.click();
});
await mp.waitForURL(url => !url.toString().includes('/auth'), { timeout: 15000 });
await mp.waitForTimeout(2000);
await mp.locator('button:has-text("Accept")').click({ timeout: 2000 }).catch(() => {});
console.log('  ✅ Logged in (mobile)');
await shot(mp, 'M04-mobile-dashboard');

// M05 - Mobile onboarding requests
console.log('\n→ Onboarding Requests (mobile)');
await mp.goto(BASE + '/ats/onboarding-requests', { waitUntil: 'networkidle', timeout: 30000 });
await mp.waitForTimeout(2000);
await mp.locator('button:has-text("Accept")').click({ timeout: 2000 }).catch(() => {});
await shot(mp, 'M05-mobile-onboarding-requests');

// M06 - Mobile employee list
console.log('\n→ Employee List (mobile)');
await mp.goto(BASE + '/employees', { waitUntil: 'networkidle', timeout: 30000 });
await mp.waitForTimeout(2000);
await mp.locator('button:has-text("Accept")').click({ timeout: 2000 }).catch(() => {});
await shot(mp, 'M06-mobile-employees-list');

await mob.close();
await browser.close();

console.log('\n════════════════════════════════');
console.log('  ALL SCREENSHOTS COMPLETE');
console.log('  Check pictures/ folder for journey-*.png');
console.log('════════════════════════════════\n');
