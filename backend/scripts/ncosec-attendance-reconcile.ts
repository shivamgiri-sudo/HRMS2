import "dotenv/config";

type Args = {
  from?: string;
  to?: string;
  apply: boolean;
  ncosecHost?: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--from") args.from = argv[++i];
    else if (arg === "--to") args.to = argv[++i];
    else if (arg === "--ncosec-host") args.ncosecHost = argv[++i];
  }
  if ((args.from && !/^\d{4}-\d{2}-\d{2}$/.test(args.from)) || (args.to && !/^\d{4}-\d{2}-\d{2}$/.test(args.to))) {
    throw new Error("--from and --to must be YYYY-MM-DD");
  }
  if ((args.from && !args.to) || (!args.from && args.to)) {
    throw new Error("Pass both --from and --to, or neither for the default lookback window");
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.ncosecHost) process.env.NCOSEC_DB_HOST = args.ncosecHost;

  const { env } = await import("../src/config/env.js");
  if (args.ncosecHost) {
    process.env.NCOSEC_DB_HOST = args.ncosecHost;
    (env as any).NCOSEC_DB_HOST = args.ncosecHost;
  }

  const { attendanceReconciliationService } = await import("../src/modules/wfm/attendance-reconciliation.service.js");
  const { closePool } = await import("../src/db/mysql.js");
  const { closeNcosecPool } = await import("../src/db/ncosecDb.js");

  try {
    const result = args.from && args.to
      ? await attendanceReconciliationService.audit({ from: args.from, to: args.to, autoFix: args.apply })
      : await attendanceReconciliationService.auditDefaultWindow({ autoFix: args.apply });
    console.dir(result, { depth: null });
    if (!args.apply) console.log("Dry-run ledger update only. Re-run with --apply to reprocess safe rows through COSEC sync.");
  } finally {
    await Promise.allSettled([closePool(), closeNcosecPool()]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
