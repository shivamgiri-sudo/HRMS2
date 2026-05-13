import { env } from "../../config/env.js";
import type { ProcessRepository } from "./process.types.js";
import { processRepositorySupabase } from "./process.repository.supabase.js";

export function getProcessRepository(): ProcessRepository {
  if (env.ACTIVE_DB_PROVIDER === "supabase") {
    return processRepositorySupabase;
  }

  throw new Error(
    "SQL Server process repository is not implemented yet. Keep ACTIVE_DB_PROVIDER=supabase for now."
  );
}
