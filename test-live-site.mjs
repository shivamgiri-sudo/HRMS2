import { chromium } from 'playwright';

(async () => {
  console.log('🚀 Starting Playwright verification...\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1920, height: 1080 }
  });

  const page = await context.newPage();

  try {
    // Step 1: Navigate to login
    console.log('📍 Navigating to login page...');
    await page.goto('https://mcnhrms.teammas.in/auth', { waitUntil: 'networkidle', timeout: 30000 });
    console.log('✅ Login page loaded');

    // Step 2: Login (need credentials - using dummy for now)
    console.log('\n📍 Attempting login...');
    // Note: Replace with actual test credentials
    await page.fill('input[name="identifier"], input[type="email"], input[placeholder*="mail"]', 'test@example.com');
    await page.fill('input[name="password"], input[type="password"]', 'test123');

    console.log('⚠️  Skipping actual login (need real credentials)');
    console.log('   Testing public page load instead...\n');

    // Step 3: Test the onboarding page load without auth
    console.log('📍 Testing page load (no auth)...');
    await page.goto('https://mcnhrms.teammas.in/ats/onboarding-requests', {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    // Step 4: Check what's actually loaded
    const title = await page.title();
    console.log('✅ Page title:', title);

    // Step 5: Check if NativeHROnboardingRequests component loaded
    const bodyText = await page.textContent('body');
    const hasOnboarding = bodyText.includes('Onboarding') || bodyText.includes('onboarding');
    console.log('📦 Onboarding content found:', hasOnboarding);

    // Step 6: Check loaded JS chunks
    console.log('\n📍 Checking loaded JavaScript chunks...');
    const scripts = await page.$$eval('script[src]', scripts =>
      scripts.map(s => s.src).filter(src => src.includes('NativeHR') || src.includes('Onboarding'))
    );
    console.log('🔗 NativeHR-related scripts:', scripts.length > 0 ? scripts : 'None found in initial load');

    // Step 7: Check if select elements exist (for dropdown testing)
    await page.waitForTimeout(2000); // Wait for any lazy loads
    const selectElements = await page.$$('select');
    console.log('📋 Select elements on page:', selectElements.length);

    if (selectElements.length > 0) {
      // Check computed styles of first select
      const firstSelect = selectElements[0];
      const bgColor = await firstSelect.evaluate(el => window.getComputedStyle(el).backgroundColor);
      const color = await firstSelect.evaluate(el => window.getComputedStyle(el).color);
      console.log('🎨 First select dropdown styles:');
      console.log('   Background:', bgColor);
      console.log('   Text color:', color);
    }

    // Step 8: Check for shadcn Select components
    const shadcnSelects = await page.$$('[role="combobox"], .select-trigger, [data-radix-select-trigger]');
    console.log('📋 Shadcn Select components:', shadcnSelects.length);

    // Step 9: Take screenshot
    console.log('\n📸 Taking screenshot...');
    await page.screenshot({ path: 'live-site-test.png', fullPage: false });
    console.log('✅ Screenshot saved: live-site-test.png');

    // Step 10: Check network requests for the NativeHR JS file
    console.log('\n📍 Checking network for NativeHR chunk...');
    const finalUrl = page.url();
    console.log('📍 Final URL:', finalUrl);

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('VERIFICATION SUMMARY:');
    console.log('='.repeat(60));
    console.log('Page loads:', '✅');
    console.log('NativeHR component:', hasOnboarding ? '✅ Content detected' : '❌ Not detected');
    console.log('Native <select> elements:', selectElements.length > 0 ? `✅ Found ${selectElements.length}` : '❌ None found');
    console.log('Shadcn Select components:', shadcnSelects.length > 0 ? `Found ${shadcnSelects.length}` : 'None');

    if (finalUrl.includes('/auth')) {
      console.log('\n⚠️  REDIRECTED TO LOGIN - Need valid credentials to test the actual page');
      console.log('   The page requires authentication to view');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await browser.close();
    console.log('\n✅ Test complete');
  }
})();
