import { Page } from '@playwright/test';
import { requiredEnv } from './env';

const BACKEND_URL = process.env.E2E_BACKEND_URL ?? 'http://localhost:5055';

export interface AuthSession {
  accessToken: string;
  userId: string;
  role: string;
}

type E2ERole = 'admin' | 'hr' | 'recruiter' | 'branch_head' | 'payroll';

const ROLE_ENV: Record<E2ERole, { email: string; password: string }> = {
  admin: { email: 'E2E_ADMIN_EMAIL', password: 'E2E_ADMIN_PASSWORD' },
  hr: { email: 'E2E_HR_EMAIL', password: 'E2E_HR_PASSWORD' },
  recruiter: { email: 'E2E_RECRUITER_EMAIL', password: 'E2E_RECRUITER_PASSWORD' },
  branch_head: { email: 'E2E_BRANCH_HEAD_EMAIL', password: 'E2E_BRANCH_HEAD_PASSWORD' },
  payroll: { email: 'E2E_PAYROLL_EMAIL', password: 'E2E_PAYROLL_PASSWORD' },
};

const DEMO_CREDS: Record<E2ERole, { email: string; password: string; token: string }> = {
  admin: { email: 'admin@mascallnet.com', password: 'local-demo-admin', token: 'mock-token-admin' },
  hr: { email: 'hr@mascallnet.com', password: 'local-demo-hr', token: 'mock-token-hr' },
  recruiter: { email: 'recruiter@mascallnet.com', password: 'local-demo-recruiter', token: 'mock-token-recruiter' },
  branch_head: { email: 'manager@mascallnet.com', password: 'local-demo-manager', token: 'mock-token-process_manager' },
  payroll: { email: 'finance@mascallnet.com', password: 'local-demo-finance', token: 'mock-token-finance' },
};

function credentialsForRole(role: E2ERole): { email: string; password: string } {
  const env = ROLE_ENV[role];
  const email = process.env[env.email]?.trim();
  const password = process.env[env.password]?.trim();

  if (email && password) return { email, password };
  if (process.env.E2E_USE_DEMO_LOGIN === 'true') return DEMO_CREDS[role];

  requiredEnv(env.email);
  requiredEnv(env.password);
  throw new Error(`Missing credentials for ${role}`);
}

/**
 * Login via the frontend login page using explicit staging/local role credentials.
 * Demo credentials are allowed only when E2E_USE_DEMO_LOGIN=true.
 */
export async function loginAs(page: Page, role: E2ERole): Promise<string> {
  const creds = credentialsForRole(role);

  // Use "load" instead of "networkidle" because Vite HMR websocket keeps network active
  await page.goto(process.env.E2E_LOGIN_PATH ?? '/auth', { waitUntil: 'load', timeout: 60_000 });

  const emailInput = page.locator('#identifier');
  await emailInput.fill(creds.email);

  const passwordInput = page.locator('#password');
  await passwordInput.fill(creds.password);

  // Click submit button
  await page.locator('button[type="submit"]').first().click();

  // Wait for navigation away from login page (the useEffect redirects to /dashboard)
  await page.waitForURL(/dashboard|home|app|hrms/, { timeout: 15_000 }).catch(() => {});
  await page.waitForLoadState('domcontentloaded');

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
