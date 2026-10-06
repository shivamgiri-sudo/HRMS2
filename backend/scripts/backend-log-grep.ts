/**
 * Read-only: print the last few occurrences of a fixed phrase in the backend logs, each with the
 * lines that follow it (stack / SQL error). Secrets-looking values are masked.
 *
 *   npx tsx scripts/backend-log-grep.ts "Error fetching requests"
 */
import fs from "fs";

const PHRASE = process.argv[2] ?? "";
// pm2 writes the live logs under the runner user's ~/.pm2/logs (the repo logs/ dir is stale).
const FILES = [
  "/home/masadmin/.pm2/logs/hrms2-backend-error.log", "/home/masadmin/.pm2/logs/hrms2-backend-out.log",
  "/home/masadmin/.pm2/logs/hrms2-workers-error.log", "/home/masadmin/.pm2/logs/hrms2-workers-out.log",
];
const mask = (l: string) => l.replace(/(token|password|secret|apikey|authorization)([=:"' ]+)[^\s"',]+/gi, "$1$2***");

if (PHRASE.length < 6) { console.log("phrase too short"); process.exit(1); }
for (const f of FILES) {
  let lines: string[];
  try {
    const st = fs.statSync(f);
    const start = Math.max(0, st.size - 40 * 1024 * 1024); // last 40 MB
    const fd = fs.openSync(f, "r");
    const buf = Buffer.alloc(st.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    lines = buf.toString("utf8").split("\n");
  } catch (e) { console.log(`${f}: ${(e as Error).message}`); continue; }
  const hits: number[] = [];
  lines.forEach((l, i) => { if (l.includes(PHRASE)) hits.push(i); });
  console.log(`=== ${f}: ${hits.length} hit(s)`);
  for (const i of hits.slice(-4)) {
    console.log("---");
    for (const l of lines.slice(i, i + 14)) console.log("  " + mask(l).slice(0, 300));
  }
}
