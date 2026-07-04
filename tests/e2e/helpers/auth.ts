import { Page } from '@playwright/test';

const BACKEND_URL = process.env.E2E_BACKEND_URL ?? 'http://localhost:5055';

export interface AuthSession {
  accessToken: string;
  userId: string;
  role: string;
}

const DEMO_CREDS: Record<string, { email: string; password: string; token: string }> = {
  admin: { email: 'admin@mascallnet.com', password: 'local-demo-admin', token: 'mock-token-admin' },
  hr: { email: 'hr@mascallnet.com', password: 'local-demo-hr', token: 'mock-token-hr' },
  recruiter: { email: 'recruiter@mascallnet.com', password: 'local-demo-recruiter', token: 'mock-token-recruiter' },
  branch_head: { email: 'manager@mascallnet.com', password: 'local-demo-manager', token: 'mock-token-process_manager' },
  payroll: { email: 'finance@mascallnet.com', password: 'local-demo-finance', token: 'mock-token-finance' },
};

/**
 * Login via the frontend login page using demo credentials.
 * Navigates to /login, fills credentials, clicks login.
 * Returns the access token from localStorage (demo session or JWT).
 */
export async function loginAs(page: Page, role: keyof typeof DEMO_CREDS): Promise<string> {
  const creds = DEMO_CREDS[role];
  if (!creds) throw new Error(`Unknown role: ${role}`);

  await page.goto('/login');
  await page.waitForLoadState('networkidle');

  // Demo login uses #identifier (email or employee code) and #password
  const emailInput = page.locator('#identifier');
  await emailInput.fill(creds.email);

  const passwordInput = page.locator('#password');
  await passwordInput.fill(creds.password);

  // Click submit button
  await page.locator('button[type="submit"]').first().click();

  // Wait for navigation away from login page
  await page.waitForURL(/dashboard|home|app|hrms/, { timeout: 20_000 }).catch(() => {});
  await page.waitForLoadState('networkidle');

  // Demo mode stores session in hrms_demo_session (JSON with access_token)
  // Real JWT auth stores token in hrms_access_token
  const token = await page.evaluate(() => {
    const demoRaw = localStorage.getItem('hrms_demo_session');
    if (demoRaw) {
      try {
        const demo = JSON.parse(demoRaw);
        if (demo?.access_token) return demo.access_token;
      } catch { /* ignore */ }
    }
    return localStorage.getItem('hrms_access_token');
  });

  if (!token) throw new Error('Failed to retrieve access token after login');

  return token;
}

/**
 * Get backend URL
 */
export function getBackendUrl(): string {
  return BACKEND_URL;
}

export { DEMO_CREDS };
