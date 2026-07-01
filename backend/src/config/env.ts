import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(5055),
  FRONTEND_URL: z.string().url().default("http://localhost:8080"),
  BACKEND_URL: z.string().url().default("http://localhost:5056"),

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
  LMS_DB_NAME:     z.string().default("mcn_lms"),
  LMS_DB_POOL_MAX: z.coerce.number().default(10),
  LMS_WRITE_DB_HOST:     z.string().default(""),
  LMS_WRITE_DB_PORT:     z.coerce.number().default(3306),
  LMS_WRITE_DB_USER:     z.string().default(""),
  LMS_WRITE_DB_PASSWORD: z.string().default(""),
  LMS_WRITE_DB_NAME:     z.string().default(""),
  LMS_WRITE_DB_POOL_MAX: z.coerce.number().default(5),
  LMS_PORTAL_URL:  z.string().url().default("https://mcnlms.teammas.in"),
  LMS_BRIDGE_SECRET: z.string().default(""),
  LMS_ADMIN_SESSION_TOKEN: z.string().default(""),

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
  ATS_FORM_API_KEY: z.string().optional(),
  COURT_CHECK_API_URL: z.string().url().default("https://api.infinityai.in"),
  COURT_CHECK_API_KEY: z.string().optional(),
  // Befisc + Luckpay + Crimescan (BGV_PROVIDER=befisc_luckpay)
  BEFISC_API_KEY: z.string().optional(),
  LUCKPAY_BASIC_TOKEN: z.string().optional(),
  LUCKPAY_CLIENT_ID: z.string().optional(),
  CRIMESCAN_API_KEY: z.string().optional(),
  PRESCREENING_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),

  // Billing DB (db_bill) — optional, only needed when billing features are used
  BILL_DB_HOST:     z.string().default(""),
  BILL_DB_PORT:     z.coerce.number().default(3306),
  BILL_DB_USER:     z.string().default(""),
  BILL_DB_PASSWORD: z.string().default(""),
  BILL_DB_NAME:     z.string().default("db_bill"),

  // Cloudinary — optional, enables cloud storage for employee profile photos
  // When absent, photos are stored on local filesystem (default)
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY:    z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
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
  if (parsed.data.BGV_PROVIDER === "befisc_luckpay" && (!parsed.data.LUCKPAY_BASIC_TOKEN || !parsed.data.LUCKPAY_CLIENT_ID || !parsed.data.CRIMESCAN_API_KEY)) {
    console.error("[FATAL] LUCKPAY_BASIC_TOKEN, LUCKPAY_CLIENT_ID, and CRIMESCAN_API_KEY must be set when BGV_PROVIDER=befisc_luckpay.");
    process.exit(1);
  }
}

export const env = {
  ...parsed.data,
  LMS_DB_USER: parsed.data.LMS_DB_USER || parsed.data.DB_USER,
  LMS_DB_PASSWORD: parsed.data.LMS_DB_PASSWORD || parsed.data.DB_PASSWORD,
  LMS_WRITE_DB_HOST: parsed.data.LMS_WRITE_DB_HOST || parsed.data.LMS_DB_HOST,
  LMS_WRITE_DB_PORT: parsed.data.LMS_WRITE_DB_PORT || parsed.data.LMS_DB_PORT,
  LMS_WRITE_DB_NAME: parsed.data.LMS_WRITE_DB_NAME || parsed.data.LMS_DB_NAME,
  LEGACY_SYNC_ENABLED: parsed.data.LEGACY_SYNC_ENABLED === 'true',
  LEGACY_SYNC_PARALLEL_DOMAINS: parsed.data.LEGACY_SYNC_PARALLEL_DOMAINS !== 'false',
  ENABLE_SCHEDULERS: parsed.data.ENABLE_SCHEDULERS === 'true',
  OUTBOUND_ALLOW_PRIVATE_URLS: parsed.data.OUTBOUND_ALLOW_PRIVATE_URLS === 'true',
  SEED_DEMO_DATA: parsed.data.SEED_DEMO_DATA === 'true',
};
