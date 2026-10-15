/**
 * READ-ONLY round 4: the CC-attendance "Access denied" Dinesh reported. The backend logs every
 * requireRole refusal with the caller's roles and the route's required list; read those lines.
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

const dir = "/home/masadmin/.pm2/logs";
const files = readdirSync(dir).filter((f) => /hrms2-backend.*(error|out)\.log$/.test(f));
console.log("log files:", files.join(", "));
for (const f of files) {
  try {
    const out = execFileSync("grep", ["-a", "-E", "requireRole\\] Denied.*(wfm|payroll_hr)", `${dir}/${f}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const lines = out.split("\n").filter(Boolean);
    const counts = new Map<string, number>();
    for (const l of lines) {
      const m = /Denied: user role\(s\) \[(.*?)\] tried route requiring \[(.*?)\]/.exec(l);
      const k = m ? `have[${m[1]}] need[${m[2]}]` : l.slice(0, 160);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    console.log(`\n== ${f}: ${lines.length} matching denials`);
    for (const [k, n] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(n, k);
  } catch (e) {
    console.log(`${f}: no matches (${(e as Error).message.split("\n")[0]})`);
  }
}
