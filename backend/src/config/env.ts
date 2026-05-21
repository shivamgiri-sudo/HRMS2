import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(5000),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_ANON_KEY: z.string().min(1),

  ACTIVE_DB_PROVIDER: z.enum(["supabase", "sqlserver", "mysql"]).default("supabase"),

  // MySQL (mas_hrms) — optional, only required when ACTIVE_DB_PROVIDER includes mysql modules
  DB_HOST:     z.string().default("localhost"),
  DB_PORT:     z.coerce.number().default(3306),
  DB_USER:     z.string().default("root"),
  DB_PASSWORD: z.string().default(""),
  DB_NAME:     z.string().default("mas_hrms"),
  DB_POOL_MAX: z.coerce.number().default(10),
  PORTAL_JWT_SECRET: z.string().min(32).default("change-me-in-production-portal-secret-32ch"),
  SMTP_HOST:   z.string().default("smtp.gmail.com"),
  SMTP_PORT:   z.coerce.number().default(587),
  SMTP_USER:   z.string().default(""),
  SMTP_PASS:   z.string().default(""),
  SMTP_FROM:   z.string().default("noreply@mascallnet.com"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid backend environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
