/**
 * ONFIDO_AGENT_DAILY was misconfigured: employee_key_column was "agent_name",
 * a column that does not exist on onfido_agent_daily_raw (it has emp_id,
 * emp_name -- no agent_name at all). This would have failed with
 * ER_BAD_FIELD_ERROR on every read, even after the readSourceValues
 * named_pool dispatch fix (see fix in kpi-studio.sources.ts, commit
 * 3abe8af3/fde5f14f) made this source reachable at all.
 *
 * Could not be caught earlier: the Onfido/Bella DB host (14.97.30.235) was
 * ER_HOST_IS_BLOCKED for the whole session until FLUSH HOSTS was run
 * (2026-09-09, with the user's explicit approval and a provided admin
 * credential -- not something this session could do on its own). The first
 * live read against the real table surfaced this second bug immediately.
 *
 * emp_id holds real MAS employee codes (confirmed live: "MAS63402" etc,
 * matching employee_key_kind's existing "employee_code" setting) -- fixed to
 * emp_id. Verified end-to-end via previewFormula against a real employee
 * (MAS63402 / Vishesh Agrahari): status "computed", reading through the
 * actual onfido_db pool, not a mock.
 *
 * Run with: npx tsx scripts/fix-onfido-agent-daily-employee-key-column.ts
 */
import "dotenv/config";
import { saveDataSource } from "../src/modules/kpi/kpi-studio.service.js";

async function main() {
  const result = await saveDataSource({
    id: "696f5443-ab4c-11f1-8f5c-00155d0ab410",
    source_code: "ONFIDO_AGENT_DAILY",
    source_name: "Onfido agent daily (onfido_db)",
    source_type: "named_pool",
    integration_key: "onfido",
    source_object: "onfido_agent_daily_raw",
    employee_key_column: "emp_id",
    employee_key_kind: "employee_code",
    date_column: "work_date",
    description: "Reads onfido_db through its existing pool. No credential copied anywhere.",
    process_key_kind: "constant",
    process_id: "04f20ddc-67ba-11f1-adb1-00155d0ab410",
  } as never, "demo-super-admin-id");
  console.log("fixed:", JSON.stringify(result));
  process.exit(0);
}
main().catch((e) => { console.error("FAILED", e); process.exit(1); });
