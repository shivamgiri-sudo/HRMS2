import "dotenv/config";

type Args = { from?: string; to?: string; runId?: string; apply: boolean };

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--from") args.from = argv[++i];
    else if (arg === "--to") args.to = argv[++i];
    else if (arg === "--run-id") args.runId = argv[++i];
  }
  if (!args.from || !args.to) {
    throw new Error("Usage: npm run apr:reconcile -- --from YYYY-MM-DD --to YYYY-MM-DD [--run-id ID] [--apply]");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.from) || !/^\d{4}-\d{2}-\d{2}$/.test(args.to)) {
    throw new Error("--from and --to must be YYYY-MM-DD");
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { aprPayrollReconciliationService } = await import("../src/modules/wfm/apr-payroll-reconciliation.service.js");
  const { closePool } = await import("../src/db/mysql.js");
  try {
    const result = await aprPayrollReconciliationService.audit({
      from: args.from!,
      to: args.to!,
      runId: args.runId ?? null,
      apply: args.apply,
    });
    console.dir(result, { depth: null });
    if (!args.apply) console.log("Dry-run ledger update only. Re-run with --apply to repair safe unlocked ADR rows.");
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
