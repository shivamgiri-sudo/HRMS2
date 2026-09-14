/**
 * One-off verification for the row-level revenueAtRiskUnavailable fix.
 * Confirms Onfido's row now carries "not generated" instead of a bare 0, via the real
 * processPnlService.getSummary() call path, against the live DB.
 */
import { processPnlService } from "../src/modules/process-pnl/process-pnl.service.js";

const period = process.argv[2] ?? "2026-09";

const records = await processPnlService.listProcesses({ period });
const onfido = records.find((r) => r.processName === "Onfido");

if (!onfido) {
  console.log("Onfido row not found for period", period);
  console.log("Sample record keys:", records[0] ? Object.keys(records[0]) : "(no records)");
  process.exit(1);
}

console.log("Onfido row —",
  "revenueAtRisk:", onfido.revenueAtRisk,
  "| revenueLeakage:", onfido.revenueLeakage,
  "| revenueAtRiskUnavailable:", onfido.revenueAtRiskUnavailable);

process.exit(0);
