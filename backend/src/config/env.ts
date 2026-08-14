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
for (const envPath of envCandidates) {
  if (!fs.existsSync(envPath) || loadedEnvPaths.has(envPath)) continue;
  dotenv.config({ path: envPath, override: false });
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
  DB_POOL_MAX_IDLE: z.coerce.number().default(5),
  DB_POOL_IDLE_TIMEOUT_MS: z.coerce.number().default(60000),

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
  NCOSEC_RECONCILIATION_ENABLED: z.string().default("true"),
  // Auto-fix is NOT a targeted per-row correction: attendance-reconciliation.service.ts
  // hands the whole window to cosecSyncService.sync(), i.e. a full COSEC biometric
  // re-sync. Safe to run because every attendance_daily_record write in that service is
  // guarded by `is_locked = 0`, so payroll-finalized rows are never rewritten — but it is
  // real work over the whole lookback window, every night.
  NCOSEC_RECONCILIATION_AUTO_FIX: z.string().default("true"),
  NCOSEC_RECONCILIATION_HOUR: z.coerce.number().int().min(0).max(23).default(2),
  // Was 1 — a single missed night left a permanent hole, because the worker only ever
  // looked at yesterday. 7 lets a gap self-heal on the next successful run. Re-detected
  // issues upsert on uq issue_key rather than duplicating.
  NCOSEC_RECONCILIATION_LOOKBACK_DAYS: z.coerce.number().int().min(1).max(31).default(7),

  PORTAL_JWT_SECRET: z.string().min(32).default("change-me-in-production-portal-secret-32ch"),
  JWT_SECRET: z.string().min(32).default('change-me-jwt-secret-32characters!!'),
  // Optional and NOT fatal-checked (unlike JWT_SECRET/PORTAL_JWT_SECRET above): until this
  // is set, candidate-portal.service.ts falls back to JWT_SECRET with a loud startup
  // warning, so an existing production deploy isn't broken by this var simply not being
  // configured yet. The ATS candidate portal previously signed its tokens with JWT_SECRET
  // directly — the SAME secret full employee sessions use — so a valid candidate-portal
  // token could pass signature verification inside requireAuth (audit fix already closed
  // the resulting req.authUser={id:undefined} exposure at the verification layer, but the
  // secrets themselves were still shared). Once this is set in production and the process
  // restarts, candidate-portal tokens use a fully separate secret, same as the client
  // portal already does via PORTAL_JWT_SECRET. (2026-08-13, leave/auth-module audit)
  CANDIDATE_PORTAL_JWT_SECRET: z.string().min(32).optional(),
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
  /**
   * @deprecated The auth URL is derived from the resolved base URL
   * (`${baseUrl}/auth/token`). This value is ignored unless it matches that base
   * — a staging auth URL paired with a production base minted a token for the
   * wrong host and 401'd every call. Retained only for backwards compatibility.
   */
  LUCKPAY_AUTH_URL: z.string().url().default("https://api-banking.luckpay.in/apibanking/api/v1/auth/token"),
  LUCKPAY_PROD_BASE_URL: z.string().url().default("https://api-banking.luckpay.in/apibanking/api/v1"),
  LUCKPAY_BASIC_TOKEN: z.string().optional(),
  LUCKPAY_CLIENT_ID: z.string().optional(),
  LUCKPAY_WEBHOOK_SECRET: z.string().optional(),
  LUCKPAY_TOKEN_CACHE_TTL_SECONDS: z.coerce.number().int().min(1).default(45),
  LUCKPAY_TIMEOUT_MS: z.coerce.number().int().min(1000).default(60000),
  LUCKPAY_PROVIDER_ENABLED: z.string().default("false"),
  // Pull eSign completion instead of waiting for a callback that may never arrive.
  // Default off: checkESignStatus / downloadESignDocument may be billed per call,
  // so this stays disabled until per-endpoint billing is confirmed with Luckpay.
  ESIGN_RECONCILIATION_ENABLED: z.string().default("false"),
  // One signing session for all joining documents instead of one per
  // document. Default off: it changes what an employee is asked to sign,
  // so it is switched on deliberately rather than by deploying.
  JOINING_KIT_ESIGN_ENABLED: z.string().default("false"),
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
  //
  // Every query in the sales-upload module returns ER_TABLEACCESS_DENIED_ERROR — verified
  // live 2026-08-09 on db_masmis.bb_sale, gnc_sale and upload_log. That took out the whole
  // module, not just the two unwired upload routes:
  // /bellavita-dashboard, /gnc-dashboard, /logs and the neemans endpoints all hit the same
  // wall.
  //
  // WHERE db_masmis ACTUALLY LIVES IS STILL UNCONFIRMED — do not repeat my error here.
  // An earlier revision of this comment asserted it is "NOT on the mas_hrms server". That was
  // an inference from ER_TABLEACCESS_DENIED_ERROR, and the inference is invalid: MySQL returns
  // that same code for a database the user has no privileges on WHETHER OR NOT IT EXISTS.
  // Checked directly — `SELECT ... FROM db_definitely_not_here.x` returns the identical error.
  // So the error tells you nothing about location, only about grants.
  //
  // What IS established: 192.168.11.225, described as the MIS server, hosts mcn_lms and does
  // NOT contain db_masmis (confirmed by listing its databases). Prior notes place db_masmis on
  // the mas_hrms host itself, visible only to root — which would make a GRANT the fix and
  // these variables unnecessary. Confirm with a root-level SHOW DATABASES before setting them.
  //
  // These follow the BILL_DB_* pattern above and EMPTY-DEFAULT TO THE MAIN CONNECTION, so
  // they change nothing until set. That is deliberate: they cost nothing if the database
  // turns out to be co-located, and they are the only available fix if it is not.
  MASMIS_DB_HOST:     z.string().default(""),
  MASMIS_DB_PORT:     z.coerce.number().default(0),
  MASMIS_DB_USER:     z.string().default(""),
  MASMIS_DB_PASSWORD: z.string().default(""),
  MASMIS_DB_NAME: z.string().default("db_masmis"),

  // Cross-DB source credentials — used by sourceDb.ts for db_audit, db_external, dialer_db queries
  // Falls back to DB_USER/DB_PASSWORD if not set
  SOURCE_DB_USER:     z.string().default(""),
  SOURCE_DB_PASSWORD: z.string().default(""),

  // AI provider — Gemini
  GEMINI_API_KEY: z.string().default(""),

  // AI provider — Anthropic Claude. Used by the UAT pipeline's validator stage and available
  // to Mira like any other provider. Every key is defaulted so an existing deployment that
  // has never heard of Claude still passes env validation and boots unchanged.
  ANTHROPIC_API_KEY: z.string().default(""),
  ANTHROPIC_DEFAULT_MODEL: z.string().default("claude-opus-5"),
  // Caps thinking AND response text together on this model, so it is sized for a full
  // structured verdict rather than a chat reply.
  ANTHROPIC_MAX_OUTPUT_TOKENS: z.coerce.number().default(8000),
  ANTHROPIC_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("high"),
  ANTHROPIC_TIMEOUT_MS: z.coerce.number().default(300000),

  // UAT pipeline kill switches. Both default OFF: the validator costs money and reaches an
  // external provider, so it must be switched on deliberately rather than by deploying.
  UAT_VALIDATOR_ENABLED: z.string().default("false"),
  UAT_PROMPT_WRITER_ENABLED: z.string().default("false"),
  UAT_BUILDS_ENABLED: z.string().default("false"),
  UAT_DAILY_LLM_USD_CAP: z.coerce.number().default(25),

  // Mira fix pipeline (mira-fix-deploy.service.ts). MIRA_AUTO_DEPLOY_ENABLED is the arming
  // switch for the only stage that can change production: false means apply + verify + record
  // the result and stop, which is a useful dry run in its own right. It defaults to false and
  // must be set deliberately, because "true" means AI-authored diffs reach main and deploy
  // themselves — that is a decision an owner makes once, knowingly, not something a config
  // copy-paste should be able to turn on by accident.
  // Arm drafting first, deploying second — they are independent switches so the diffs this
  // pipeline produces can be read for a while before any of them are allowed to ship.
  MIRA_AUTO_DRAFT_ENABLED: z.string().default("false"),
  MIRA_AUTO_DEPLOY_ENABLED: z.string().default("false"),
  // The repository the pipeline creates its disposable worktrees FROM. Never the directory
  // being served — assertSafeWorktree() refuses to apply a diff inside it either way.
  MIRA_FIX_REPO_PATH: z.string().default(process.cwd()),
  // Where to confirm the deploy actually landed. Loopback by default so confirmation does not
  // depend on DNS, nginx vhost routing or the public certificate; note the port is 5055 here,
  // not 5000.
  MIRA_FIX_HEALTH_URL: z.string().default("http://127.0.0.1:5055"),
  // The gate a drafted diff must pass before it can ship. Split into bin + args so it is
  // execFile'd as an argv array and never string-interpolated into a shell.
  MIRA_FIX_VERIFY_COMMAND_BIN: z.string().default("npx"),
  MIRA_FIX_VERIFY_COMMAND_ARGS: z.string().default("vitest,run,--reporter=basic"),

  // AI provider — OpenAI Whisper (voice transcription fallback for Safari/iOS,
  // where the browser has no Web Speech API)
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_TRANSCRIBE_MODEL: z.string().default("whisper-1"),

  // MCNmeet video meetings
  MCNMEET_ENABLED: z.string().default("false"),
  MCNMEET_BASE_URL: z.string().url().default("https://mcnmeet.teammas.in"),
  MCNMEET_GOOGLE_BACKUP_ENABLED: z.string().default("true"),
  MCNMEET_GOOGLE_AUTO_CREATE_ENABLED: z.string().default("false"),
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
  // Non-fatal: CANDIDATE_PORTAL_JWT_SECRET not being set yet is handled by a safe fallback
  // in candidate-portal.service.ts (see that var's own comment above), not blocked at boot.
  // But if it HAS been set, it must actually be distinct — reusing JWT_SECRET/PORTAL_JWT_SECRET
  // here would defeat the whole point of a separate secret per token audience.
  if (parsed.data.CANDIDATE_PORTAL_JWT_SECRET &&
      (parsed.data.CANDIDATE_PORTAL_JWT_SECRET === parsed.data.JWT_SECRET ||
       parsed.data.CANDIDATE_PORTAL_JWT_SECRET === parsed.data.PORTAL_JWT_SECRET)) {
    console.error('[FATAL] CANDIDATE_PORTAL_JWT_SECRET must be distinct from JWT_SECRET and PORTAL_JWT_SECRET.');
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
  JOINING_KIT_ESIGN_ENABLED: parsed.data.JOINING_KIT_ESIGN_ENABLED === "true",
  ESIGN_RECONCILIATION_ENABLED: parsed.data.ESIGN_RECONCILIATION_ENABLED === "true",
  NCOSEC_RECONCILIATION_ENABLED: parsed.data.NCOSEC_RECONCILIATION_ENABLED !== "false",
  NCOSEC_RECONCILIATION_AUTO_FIX: parsed.data.NCOSEC_RECONCILIATION_AUTO_FIX === "true",
  MIRA_AUTO_DRAFT_ENABLED: parsed.data.MIRA_AUTO_DRAFT_ENABLED === "true",
  MIRA_AUTO_DEPLOY_ENABLED: parsed.data.MIRA_AUTO_DEPLOY_ENABLED === "true",
  MIRA_FIX_REPO_PATH: parsed.data.MIRA_FIX_REPO_PATH,
  MIRA_FIX_HEALTH_URL: parsed.data.MIRA_FIX_HEALTH_URL.replace(/\/+$/, ""),
  MIRA_FIX_VERIFY_COMMAND_BIN: parsed.data.MIRA_FIX_VERIFY_COMMAND_BIN,
  MIRA_FIX_VERIFY_COMMAND_ARGS: parsed.data.MIRA_FIX_VERIFY_COMMAND_ARGS
    .split(",").map((a) => a.trim()).filter(Boolean),
  MCNMEET_ENABLED: parsed.data.MCNMEET_ENABLED === "true",
  MCNMEET_GOOGLE_BACKUP_ENABLED: parsed.data.MCNMEET_GOOGLE_BACKUP_ENABLED !== "false",
  MCNMEET_GOOGLE_AUTO_CREATE_ENABLED: parsed.data.MCNMEET_GOOGLE_AUTO_CREATE_ENABLED === "true",
};
