const PRODUCTION_HOST_PATTERNS = [
  /(^|\.)mcnhrms\.teammas\.in$/i,
];

function parseHostname(value: string | undefined): string {
  if (!value) return "";
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}

export function isProductionHost(value: string | undefined): boolean {
  const host = parseHostname(value);
  return PRODUCTION_HOST_PATTERNS.some((pattern) => pattern.test(host));
}

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required ${name}. E2E tests must run against local/staging only with explicit env config.`);
  }
  return value;
}

export function assertSafeE2EEnvironment(): void {
  const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:8080";
  const backendUrl = process.env.E2E_BACKEND_URL ?? "http://localhost:5055";

  if (isProductionHost(baseUrl) || isProductionHost(backendUrl)) {
    throw new Error("Refusing to run HRMS2 E2E against production host. Use local or staging only.");
  }

  const dbHost = process.env.E2E_DB_HOST;
  if (isProductionHost(dbHost) || dbHost === "192.168.11.225") {
    throw new Error("Refusing to run HRMS2 E2E against the production database host.");
  }
}
