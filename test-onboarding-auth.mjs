import { chromium } from 'playwright';

(async () => {
  console.log('🚀 Starting authenticated Playwright test...\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1920, height: 1080 },
    serviceWorkers: 'block'
  });

  const page = await context.newPage();

  try {
    // Step 1: Navigate to login page
    console.log('📍 Navigating to login...');
    await page.goto('https://mcnhrms.teammas.in/auth', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Step 2: Find inputs — the first text/email input is the identifier field
    console.log('📍 Finding input fields...');
    const inputs = await page.$$eval('input', els => els.map(e => ({
      type: e.type,
      name: e.name,
      placeholder: e.placeholder,
      id: e.id
    })));
    console.log('   Inputs found:', JSON.stringify(inputs));

    // Fill identifier: use first visible non-hidden input
    await page.locator('input').first().fill('admin@mas.in');
    await page.locator('input[type="password"]').fill('Admin@12345');

    await page.screenshot({ path: 'login-filled.png' });
    console.log('📸 Login filled screenshot saved');

    // Click Sign In button
    await page.click('button:has-text("Sign In")');
    console.log('📍 Clicked Sign In...');

    // Wait for navigation
    await page.waitForURL(url => !url.toString().includes('/auth'), { timeout: 15000 });
    console.log('✅ Logged in! URL:', page.url());
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'dashboard.png' });
    console.log('📸 Dashboard screenshot saved');

    // Step 3: Navigate to onboarding requests
    console.log('\n📍 Navigating to /ats/onboarding-requests...');
    await page.goto('https://mcnhrms.teammas.in/ats/onboarding-requests', {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    await page.waitForTimeout(3000);
    console.log('📍 URL:', page.url());

    await page.screenshot({ path: 'onboarding-list.png', fullPage: true });
    console.log('📸 Onboarding list page saved');

    // Step 4: Click "Create Offer" button
    console.log('\n📍 Looking for Create/New Offer button...');
    const btns = await page.$$eval('button', els => els.map(e => e.textContent?.trim()).filter(Boolean));
    console.log('   Buttons:', btns);

    // Try to click any create/add button
    const createSelectors = [
      'button:has-text("Create Offer")',
      'button:has-text("New Offer")',
      'button:has-text("Create Employment")',
      'button:has-text("Add Offer")',
      'button:has-text("New")',
      'button:has-text("Create")',
      'button:has-text("Add")',
    ];

    let clicked = false;
    for (const sel of createSelectors) {
      const btn = await page.$(sel);
      if (btn) {
        console.log('✅ Clicking:', sel);
        await btn.click();
        clicked = true;
        break;
      }
    }

    if (!clicked) {
      console.log('❌ No create button found. Checking page content...');
      const bodyText = await page.textContent('body');
      console.log('   Page text (first 500):', bodyText?.substring(0, 500));
    }

    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'offer-form.png', fullPage: true });
    console.log('📸 Offer form screenshot saved');

    // Step 5: Check dropdown styles
    const selects = await page.$$('select');
    console.log(`\n📋 ${selects.length} native <select> elements found`);
    for (let idx = 0; idx < Math.min(selects.length, 8); idx++) {
      const el = selects[idx];
      const bg = await el.evaluate(e => window.getComputedStyle(e).backgroundColor);
      const color = await el.evaluate(e => window.getComputedStyle(e).color);
      const elName = await el.evaluate(e => e.name || e.id || 'unnamed');
      const inlineStyle = await el.evaluate(e => e.getAttribute('style') || '');
      console.log(`   [${elName}] bg="${bg}"  color="${color}"  inline="${inlineStyle}"`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    await page.screenshot({ path: 'error-state.png' }).catch(() => {});
  } finally {
    await browser.close();
    console.log('\n✅ Test complete');
  }
})();
