/**
 * Bellavita uploader CLI -- one command for Sale / APR / Chat / Cart.
 *
 * Usage:
 *   npx tsx scripts/bellavita/upload.ts --file "C:\path\to\file.xlsx"
 *   npx tsx scripts/bellavita/upload.ts --file "C:\path\to\file.xlsx" --execute
 *   npx tsx scripts/bellavita/upload.ts --file "C:\path\to\file.xlsx" --type sale --execute
 *   npx tsx scripts/bellavita/upload.ts --file "C:\path\to\file.xlsx" --type sale --execute --skip-updates
 *
 * By default this is always a DRY RUN (reports what it would do, writes
 * nothing). Pass --execute to actually write to the database.
 *
 * --type is optional -- the file's own column headers are enough to tell
 * Sale/APR/Chat/Cart apart automatically. Pass --type explicitly only if a
 * file's headers are too far off the usual shape to auto-detect.
 *
 * --skip-updates only applies to --type sale: inserts new order ids but
 * skips the calling_status/current_status update pass on ones that already
 * exist (used when only the "new rows" half of a Sale file is approved).
 */
import XLSX from "xlsx";
import { runSaleUpload } from "./lib/sale.js";
import { runAprUpload } from "./lib/apr.js";
import { runChatUpload } from "./lib/chat.js";
import { runCartUpload } from "./lib/cart.js";

type UploaderType = "sale" | "apr" | "chat" | "cart";

function parseArgs(argv: string[]): { file?: string; type?: UploaderType; execute: boolean; skipUpdates: boolean } {
  const out: { file?: string; type?: UploaderType; execute: boolean; skipUpdates: boolean } = { execute: false, skipUpdates: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file") out.file = argv[++i];
    else if (a === "--type") out.type = argv[++i] as UploaderType;
    else if (a === "--execute") out.execute = true;
    else if (a === "--skip-updates") out.skipUpdates = true;
  }
  return out;
}

/** Sniffs the sheet's header row to tell the four uploaders apart, so --type is optional. */
function detectType(filePath: string): UploaderType | null {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null, range: 0 });
  const headers = new Set(Object.keys(rows[0] ?? {}).map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, "")));
  const has = (...names: string[]) => names.some((n) => headers.has(n.toLowerCase().replace(/[^a-z0-9]/g, "")));

  if (has("Bella Vita Order ID")) return "sale";
  if (has("NOIID") && has("ACHT")) return "apr";
  if (has("Repeat Status") && (has("Unique ID") || has("Unique Id"))) return "chat";
  if (has("Abandoned Cart Link") || (has("Cart ID") && has("Drop Stage"))) return "cart";
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    console.error("Usage: npx tsx scripts/bellavita/upload.ts --file \"<path>\" [--type sale|apr|chat|cart] [--execute] [--skip-updates]");
    process.exit(1);
  }

  const type = args.type ?? detectType(args.file) ?? undefined;
  if (!type) {
    console.error(`Could not auto-detect the file type from its columns. Pass --type sale|apr|chat|cart explicitly.\nFile: ${args.file}`);
    process.exit(1);
  }
  console.log(`Detected/selected type: ${type}${args.type ? " (explicit)" : " (auto-detected from headers)"}`);
  console.log(args.execute ? "Mode: EXECUTE -- this will write to the database." : "Mode: DRY RUN -- no writes will be made.");

  switch (type) {
    case "sale":
      await runSaleUpload(args.file, { execute: args.execute, skipUpdates: args.skipUpdates });
      break;
    case "apr":
      await runAprUpload(args.file, { execute: args.execute });
      break;
    case "chat":
      await runChatUpload(args.file, { execute: args.execute });
      break;
    case "cart":
      await runCartUpload(args.file, { execute: args.execute });
      break;
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
