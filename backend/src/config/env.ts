import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const envCandidates = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "backend", ".env"),
  path.resolve(moduleDir, "../../.env"),
];

const loadedEnvPaths = new Set<string>();
const preserveRuntimeEnv = process.env.HRMS_PRESERVE_RUNTIME_ENV === "true";
for (const envPath of envCandidates) {
  if (!fs.existsSync(envPath) || loadedEnvPaths.has(envPath)) continue;
  dotenv.config({ path: envPath, override: !preserveRuntimeEnv });
  loadedEnvPaths.add(envPath);
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(5055),
  FRONTEND_URL: z.string().url().default("http://localhost:8080"),
  BACKEND_URL: z.string().url().default("http://localhost:5056"),
  // Comma-separated list of additional allowed CORS origins (e.g. staging IP, CDN).
  // Use this instead of hard-coding IPs in source code.
  CORS_ALLOWED_ORIGINS: z.string().default(""),

  ACTIVE_DB_PROVIDER: z.enum(["sqlserver", "mysql"]).default("mysql"),

  // MySQL (mas_hrms)
  DB_HOST:     z.string().default("localhost"),
  DB_PORT:     z.coerce.number().default(3306),
  DB_USER:     z.string().default("root"),
  DB_PASSWORD: z.string().default(""),
  DB_NAME:     z.string().default("mas_hrms"),
  DB_POOL_MAX: z.coerce.number().default(25),

  // Independent MCN LMS MySQL DB. Use dedicated LMS_DB_* credentials in production.
  LMS_DB_HOST:     z.string().default("192.168.11.225"),
  LMS_DB_PORT:     z.coerce.number().default(3306),
  LMS_DB_USER:     z.string().default(""),
  LMS_DB_PASSWORD: z.string().default(""),
  LMS_DB_NAME:     z.string().default("lms_mcn"),
  LMS_DB_POOL_MAX: z.coerce.number().default(10),

  // LMS SSO bridge — backend-only secret, never sent to frontend
  LMS_BRIDGE_SECRET: z.string().default(""),
  LMS_API_URL: z.string().default(""),

  // NCOSEC Biometric DB (Matrix Cosec SQL Server)
  NCOSEC_DB_HOST:     z.string().default(""),
  NCOSEC_DB_PORT:     z.coerce.number().default(1433),
  NCOSEC_DB_USER:     z.string().default(""),
  NCOSEC_DB_PASSWORD: z.string().default(""),
  NCOSEC_DB_NAME:     z.string().default("NCOSEC"),
  NCOSEC_DB_ENCRYPT:  z.string().default("false"),
  NCOSEC_DB_TRUST_CERT: z.string().default("true"),
  NCOSEC_EVENT_TABLE: z.string().default("dbo.Mx_ATDEventTrn"),
  NCOSEC_DAILY_TABLE: z.string().default("dbo.Mx_DATDTrn"),
  NCOSEC_USER_ID_COLUMN: z.string().default("UserID"),
  NCOSEC_DATETIME_COLUMN: z.string().default("Edatetime"),
  NCOSEC_SOURCE_MODE: z.enum(["mysql", "mssql"]).default("mysql"),
  NCOSEC_SYNC_ENABLED: z.string().default("true"),
  NCOSEC_SYNC_CRON: z.string().default("0 */5 * * * *"),
  NCOSEC_SYNC_INTERVAL_MS: z.coerce.number().int().min(60000).default(300000),
  NCOSEC_SYNC_LOOKBACK_DAYS: z.coerce.number().int().min(1).max(31).default(1),

  PORTAL_JWT_SECRET: z.string().min(32).default("change-me-in-production-portal-secret-32ch"),
  JWT_SECRET: z.string().min(32).default('change-me-jwt-secret-32characters!!'),
  OTP_HMAC_SECRET: z.string().min(32).default('change-me-otp-hmac-secret-32chars!'),
  PORTAL_DEMO_BYPASS: z.string().default("false"),
  PAYROLL_BANK_KEY: z.string().min(16).default("hrms-bank-key-dev"),
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be a 64-character hex string').default('0000000000000000000000000000000000000000000000000000000000000000'),
  COMM_SECRET: z.string().min(16).optional(),
  INTERNAL_DEMO_BYPASS: z.string().default("false"),
  ENABLE_SCHEDULERS: z.string().default("false"),
  INTEGRATION_SCHEDULER_TIMEZONE: z.string().default("Asia/Kolkata"),
  INTEGRATION_SCHEDULER_POLL_MS: z.coerce.number().int().min(5000).default(30000),
  INTEGRATION_SCHEDULER_MAX_RETRIES: z.coerce.number().int().min(1).max(5).default(3),
  INTEGRATION_SCHEDULER_RETRY_DELAY_MS: z.coerce.number().int().min(100).default(5000),
  OUTBOUND_ALLOW_PRIVATE_URLS: z.string().default("false"),
  SEED_DEMO_DATA: z.string().default("false"),
  SMTP_HOST:   z.string().default("smtp.gmail.com"),
  SMTP_PORT:   z.coerce.number().default(587),
  SMTP_USER:   z.string().default(""),
  SMTP_PASS:   z.string().default(""),
  SMTP_FROM:   z.string().default("noreply@mascallnet.com"),
  SMTP_FROM_NAME: z.string().default("MAS Callnet HRMS"),

  LEGACY_MYSQL_HOST: z.string().default(""),
  LEGACY_MYSQL_PORT: z.coerce.number().default(3306),
  LEGACY_MYSQL_DATABASE: z.string().default(""),
  LEGACY_MYSQL_USER: z.string().default(""),
  LEGACY_MYSQL_PASSWORD: z.string().default(""),

  LEGACY_MSSQL_HOST:       z.string().default(""),
  LEGACY_MSSQL_PORT:       z.coerce.number().default(1433),
  LEGACY_MSSQL_DATABASE:   z.string().default(""),
  LEGACY_MSSQL_USER:       z.string().default(""),
  LEGACY_MSSQL_PASSWORD:   z.string().default(""),
  LEGACY_MSSQL_ENCRYPT:    z.string().default("false"),
  LEGACY_MSSQL_TRUST_CERT: z.string().default("true"),

  LEGACY_SYNC_ENABLED: z.string().default("false"),
  LEGACY_SYNC_INTERVAL_MS: z.coerce.number().default(60000),
  LEGACY_SYNC_BATCH_SIZE: z.coerce.number().default(1000),
  LEGACY_SYNC_PARALLEL_DOMAINS: z.string().default("true"),
  LEGACY_SYNC_MAX_RETRIES: z.coerce.number().default(3),
  LEGACY_SYNC_RETRY_DELAY_MS: z.coerce.number().default(5000),
  LEGACY_CT_RETENTION_DAYS: z.coerce.number().default(2),

  DIALER_DB_HOST: z.string().default(""),
  DIALER_DB_PORT: z.coerce.number().default(3306),
  DIALER_DB_USER: z.string().default(""),
  DIALER_DB_PASSWORD: z.string().default(""),
  DIALER_DB_NAME: z.string().default(""),

  BGV_WEBHOOK_SECRET: z.string().optional(),
  BGV_PROVIDER: z.enum(["mock", "infinity_ai", "digio", "befisc_luckpay"]).default("mock"),
  INFINITY_AI_API_URL: z.string().url().default("https://api.infinityai.in"),
  INFINITY_AI_API_KEY: z.string().optional(),
  INFINITY_AI_CLIENT_ID: z.string().optional(),
  INFINITY_AI_PORTAL_URL: z.string().url().default("http://candidates.theinfiniti.ai"),
  DIGIO_API_URL: z.string().url().default("https://api.digio.in"),
  DIGIO_CLIENT_ID: z.string().optional(),
  DIGIO_CLIENT_SECRET: z.string().optional(),
  DIGIO_WEBHOOK_SECRET: z.string().optional(),
  LUCKPAY_ENV: z.enum(["staging", "production"]).default("production"),
  LUCKPAY_BASE_URL: z.string().url().default("https://api-banking.luckpay.in/apibanking/api/v1"),
  LUCKPAY_AUTH_URL: z.string().url().default("https://api-banking.luckpay.in/apibanking/api/v1/auth/token"),
  LUCKPAY_PROD_BASE_URL: z.string().url().default("https://api-banking.luckpay.in/apibanking/api/v1"),
  LUCKPAY_BASIC_TOKEN: z.string().optional(),
  LUCKPAY_CLIENT_ID: z.string().optional(),
  LUCKPAY_WEBHOOK_SECRET: z.string().optional(),
  LUCKPAY_TOKEN_CACHE_TTL_SECONDS: z.coerce.number().int().min(1).default(45),
  LUCKPAY_TIMEOUT_MS: z.coerce.number().int().min(1000).default(60000),
  LUCKPAY_PROVIDER_ENABLED: z.string().default("false"),
  ATS_FORM_API_KEY: z.string().optional(),
  COURT_CHECK_API_URL: z.string().url().default("https://api.infinityai.in"),
  COURT_CHECK_API_KEY: z.string().optional(),
  PENNY_DROP_WEBHOOK_SECRET: z.string().optional(),

  // Billing DB (db_bill) — optional, only needed when billing features are used
  BILL_DB_HOST:     z.string().default(""),
  BILL_DB_PORT:     z.coerce.number().default(3306),
  BILL_DB_USER:     z.string().default(""),
  BILL_DB_PASSWORD: z.string().default(""),
  BILL_DB_NAME:     z.string().default("db_bill"),

  // Shivamgiri quality/APR database (shared by quality-dashboard module)
  SHIVAMGIRI_DB_NAME: z.string().default("Shivamgiri"),

  // MASMIS uploaded/processed sales data (Neemans, Bellavita, GNC)
  MASMIS_DB_NAME: z.string().default("db_masmis"),

  // Cross-DB source credentials — used by sourceDb.ts for db_audit, db_external, dialer_db queries
  // Falls back to DB_USER/DB_PASSWORD if not set
  SOURCE_DB_USER:     z.string().default(""),
  SOURCE_DB_PASSWORD: z.string().default(""),

  // AI provider — Gemini
  GEMINI_API_KEY: z.string().default(""),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid backend environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const KNOWN_INSECURE_DEFAULTS = [
  "change-me-in-production-portal-secret-32ch",
  "change-me-jwt-secret-32characters!!",
  "change-me-otp-hmac-secret-32chars!",
];

if (parsed.data.NODE_ENV === "production") {
  if (KNOWN_INSECURE_DEFAULTS.includes(parsed.data.PORTAL_JWT_SECRET)) {
    console.error("[FATAL] PORTAL_JWT_SECRET must be changed from the default value in production.");
    process.exit(1);
  }
  if (KNOWN_INSECURE_DEFAULTS.includes(parsed.data.JWT_SECRET)) {
    console.error("[FATAL] JWT_SECRET must be changed from the default value in production.");
    process.exit(1);
  }
  if (KNOWN_INSECURE_DEFAULTS.includes(parsed.data.OTP_HMAC_SECRET)) {
    console.error("[FATAL] OTP_HMAC_SECRET must be changed from the default value in production.");
    process.exit(1);
  }
  if (parsed.data.PAYROLL_BANK_KEY === "hrms-bank-key-dev") {
    console.error("[FATAL] PAYROLL_BANK_KEY must be set to a secure value in production.");
    process.exit(1);
  }
  if (parsed.data.ENCRYPTION_KEY === '0000000000000000000000000000000000000000000000000000000000000000') {
    console.error('[FATAL] ENCRYPTION_KEY must be set to a secure 64-char hex value in production.');
    process.exit(1);
  }
  if (parsed.data.INTERNAL_DEMO_BYPASS === "true") {
    console.error("[FATAL] INTERNAL_DEMO_BYPASS must not be 'true' in production.");
    process.exit(1);
  }
  if (parsed.data.PORTAL_DEMO_BYPASS === "true") {
    console.error("[FATAL] PORTAL_DEMO_BYPASS must not be 'true' in production.");
    process.exit(1);
  }
  if (parsed.data.OUTBOUND_ALLOW_PRIVATE_URLS === "true") {
    console.error("[FATAL] OUTBOUND_ALLOW_PRIVATE_URLS must not be 'true' in production.");
    process.exit(1);
  }
  if (!parsed.data.BGV_WEBHOOK_SECRET) {
    console.error("[FATAL] BGV_WEBHOOK_SECRET must be set in production.");
    process.exit(1);
  }
  if (!parsed.data.ATS_FORM_API_KEY) {
    console.error("[FATAL] ATS_FORM_API_KEY must be set in production.");
    process.exit(1);
  }
  if (parsed.data.BGV_PROVIDER === "infinity_ai" && !parsed.data.INFINITY_AI_API_KEY) {
    console.error("[FATAL] INFINITY_AI_API_KEY must be set when BGV_PROVIDER=infinity_ai.");
    process.exit(1);
  }
  if (parsed.data.BGV_PROVIDER === "digio" && (!parsed.data.DIGIO_CLIENT_ID || !parsed.data.DIGIO_CLIENT_SECRET)) {
    console.error("[FATAL] DIGIO_CLIENT_ID and DIGIO_CLIENT_SECRET must be set when BGV_PROVIDER=digio.");
    process.exit(1);
  }
  if (parsed.data.LUCKPAY_PROVIDER_ENABLED === "true" && !parsed.data.LUCKPAY_WEBHOOK_SECRET) {
    console.error("[FATAL] LUCKPAY_WEBHOOK_SECRET must be set when LUCKPAY_PROVIDER_ENABLED=true.");
    process.exit(1);
  }
}

// Non-production warning: zero ENCRYPTION_KEY with a live upstream host means
// external-DB credentials stored in MySQL are encrypted with a null key.
if (parsed.data.NODE_ENV !== "production") {
  const zeroKey = '0000000000000000000000000000000000000000000000000000000000000000';
  const isLiveHost = (h: string) => !!h && !/^(localhost|127\.0\.0\.1|::1)$/.test(h.trim());
  if (
    parsed.data.ENCRYPTION_KEY === zeroKey &&
    (isLiveHost(parsed.data.NCOSEC_DB_HOST) || isLiveHost(parsed.data.LMS_DB_HOST))
  ) {
    console.warn(
      '[WARN] ENCRYPTION_KEY is the all-zero default while a live upstream DB host is configured. ' +
      'External-DB connector credentials stored in mas_hrms are encrypted with a null key. ' +
      'Set a real ENCRYPTION_KEY before connecting to production source systems.'
    );
  }
}

export const env = {
  ...parsed.data,
  LMS_DB_USER: parsed.data.LMS_DB_USER || parsed.data.DB_USER,
  LMS_DB_PASSWORD: parsed.data.LMS_DB_PASSWORD || parsed.data.DB_PASSWORD,
  LEGACY_SYNC_ENABLED: parsed.data.LEGACY_SYNC_ENABLED === 'true',
  LEGACY_SYNC_PARALLEL_DOMAINS: parsed.data.LEGACY_SYNC_PARALLEL_DOMAINS !== 'false',
  ENABLE_SCHEDULERS: parsed.data.ENABLE_SCHEDULERS === 'true',
  OUTBOUND_ALLOW_PRIVATE_URLS: parsed.data.OUTBOUND_ALLOW_PRIVATE_URLS === 'true',
  SEED_DEMO_DATA: parsed.data.SEED_DEMO_DATA === 'true',
  LUCKPAY_PROVIDER_ENABLED: parsed.data.LUCKPAY_PROVIDER_ENABLED === "true",
};
