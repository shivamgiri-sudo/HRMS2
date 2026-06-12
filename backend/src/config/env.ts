import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(5055),
  FRONTEND_URL: z.string().url().default("http://localhost:8080"),

  ACTIVE_DB_PROVIDER: z.enum(["supabase", "sqlserver", "mysql"]).default("mysql"),

  // MySQL (mas_hrms) — optional, only required when ACTIVE_DB_PROVIDER includes mysql modules
  DB_HOST:     z.string().default("localhost"),
  DB_PORT:     z.coerce.number().default(3306),
  DB_USER:     z.string().default("root"),
  DB_PASSWORD: z.string().default(""),
  DB_NAME:     z.string().default("mas_hrms"),
  DB_POOL_MAX: z.coerce.number().default(10),

  // NCOSEC Biometric DB (Matrix Cosec SQL Server)
  NCOSEC_DB_HOST:     z.string().default(""),
  NCOSEC_DB_PORT:     z.coerce.number().default(1433),
  NCOSEC_DB_USER:     z.string().default(""),
  NCOSEC_DB_PASSWORD: z.string().default(""),
  NCOSEC_DB_NAME:     z.string().default("NCOSEC"),
  NCOSEC_DB_ENCRYPT:  z.string().default("false"),

  PORTAL_JWT_SECRET: z.string().min(32).default("change-me-in-production-portal-secret-32ch"),
  JWT_SECRET: z.string().min(32).default('change-me-jwt-secret-32characters!!'),
  // Must be explicitly "true" to enable demo bypass. Production default is disabled.
  PORTAL_DEMO_BYPASS: z.string().default("false"),
  // Required secret for payroll bank account AES encryption. Must be set in production.
  PAYROLL_BANK_KEY: z.string().min(16).default("hrms-bank-key-dev"),
  // Dedicated AES-256-GCM key for communication provider secrets. Falls back to PAYROLL_BANK_KEY if not set.
  COMM_SECRET: z.string().min(16).optional(),
  // Enables mock-token demo bypass. Must NOT be "true" in production.
  INTERNAL_DEMO_BYPASS: z.string().default("false"),
  // Set to "true" to start tenure, communication, attendance, and legacy sync workers.
  ENABLE_SCHEDULERS: z.string().default("false"),
  // Set to "true" to run 043_demo_data.sql during migrations (local dev only).
  SEED_DEMO_DATA: z.string().default("false"),
  SMTP_HOST:   z.string().default("smtp.gmail.com"),
  SMTP_PORT:   z.coerce.number().default(587),
  SMTP_USER:   z.string().default(""),
  SMTP_PASS:   z.string().default(""),
  SMTP_FROM:   z.string().default("noreply@mascallnet.com"),
  SMTP_FROM_NAME: z.string().default("MAS Callnet HRMS"),

  // Legacy MySQL Database
  LEGACY_MYSQL_HOST: z.string().default(""),
  LEGACY_MYSQL_PORT: z.coerce.number().default(3306),
  LEGACY_MYSQL_DATABASE: z.string().default(""),
  LEGACY_MYSQL_USER: z.string().default(""),
  LEGACY_MYSQL_PASSWORD: z.string().default(""),

  // Legacy SQL Server (MSSQL) for historical billing data
  LEGACY_MSSQL_HOST:       z.string().default(""),
  LEGACY_MSSQL_PORT:       z.coerce.number().default(1433),
  LEGACY_MSSQL_DATABASE:   z.string().default(""),
  LEGACY_MSSQL_USER:       z.string().default(""),
  LEGACY_MSSQL_PASSWORD:   z.string().default(""),
  LEGACY_MSSQL_ENCRYPT:    z.string().default("false"),
  LEGACY_MSSQL_TRUST_CERT: z.string().default("true"),

  // Sync configuration
  LEGACY_SYNC_ENABLED: z.string().default("false"),
  LEGACY_SYNC_INTERVAL_MS: z.coerce.number().default(60000),
  LEGACY_SYNC_BATCH_SIZE: z.coerce.number().default(1000),
  LEGACY_SYNC_PARALLEL_DOMAINS: z.string().default("true"),
  LEGACY_SYNC_MAX_RETRIES: z.coerce.number().default(3),
  LEGACY_SYNC_RETRY_DELAY_MS: z.coerce.number().default(5000),
  LEGACY_CT_RETENTION_DAYS: z.coerce.number().default(2),

  // Billing DB (db_bill) — READ-ONLY, source of truth for cost centres
  BILL_DB_HOST:     z.string().default(""),
  BILL_DB_PORT:     z.coerce.number().default(3306),
  BILL_DB_USER:     z.string().default(""),
  BILL_DB_PASSWORD: z.string().default(""),
  BILL_DB_NAME:     z.string().default("db_bill"),

  // Dialer DB (READ-ONLY for call data integration)
  DIALER_DB_HOST: z.string().default(""),
  DIALER_DB_PORT: z.coerce.number().default(3306),
  DIALER_DB_USER: z.string().default(""),
  DIALER_DB_PASSWORD: z.string().default(""),
  DIALER_DB_NAME: z.string().default(""),

  // BGV webhook signature secret — HMAC-SHA256 of raw request body
  BGV_WEBHOOK_SECRET: z.string().optional(),

  // BGV provider selection: "mock" (default/dev), "infinity_ai", "digio"
  BGV_PROVIDER: z.enum(["mock", "infinity_ai", "digio"]).default("mock"),

  // Infinity AI BGV (https://api.infinityai.in) — set when BGV_PROVIDER=infinity_ai
  INFINITY_AI_API_URL: z.string().url().default("https://api.infinityai.in"),
  INFINITY_AI_API_KEY: z.string().optional(),
  INFINITY_AI_CLIENT_ID: z.string().optional(),

  // Digio BGV / eSign / DigiLocker (https://api.digio.in) — set when BGV_PROVIDER=digio
  DIGIO_API_URL: z.string().url().default("https://api.digio.in"),
  DIGIO_CLIENT_ID: z.string().optional(),
  DIGIO_CLIENT_SECRET: z.string().optional(),
  DIGIO_WEBHOOK_SECRET: z.string().optional(),

  // Shared HMAC secret for ATS form webhook endpoints (intake, bgv, doc-upload, confirmation, recruiter-devices).
  // Google App Script sets this as X-ATS-Api-Key. Required in production; warn in dev if absent.
  ATS_FORM_API_KEY: z.string().optional(),
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
  if (parsed.data.INTERNAL_DEMO_BYPASS === "true") {
    console.error("[FATAL] INTERNAL_DEMO_BYPASS must not be 'true' in production.");
    process.exit(1);
  }
  if (parsed.data.PORTAL_DEMO_BYPASS === "true") {
    console.error("[FATAL] PORTAL_DEMO_BYPASS must not be 'true' in production.");
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
}

export const env = {
  ...parsed.data,
  // Convert string boolean env vars to actual booleans
  LEGACY_SYNC_ENABLED: parsed.data.LEGACY_SYNC_ENABLED === 'true',
  LEGACY_SYNC_PARALLEL_DOMAINS: parsed.data.LEGACY_SYNC_PARALLEL_DOMAINS !== 'false',
  ENABLE_SCHEDULERS: parsed.data.ENABLE_SCHEDULERS === 'true',
  SEED_DEMO_DATA: parsed.data.SEED_DEMO_DATA === 'true',
};
