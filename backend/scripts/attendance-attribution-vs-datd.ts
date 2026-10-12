// READ-ONLY. Validate attributeNightShifts() against NCOSEC's own per-shift table (Mx_DATDTrn)
// for EVERY employee with biometric rows in the window. Two independent derivations of "which
// punches form this shift"; every disagreement is listed with the raw punches behind it.
// Usage: npx tsx scripts/attendance-attribution-vs-datd.ts <ignored> <from> <to>
import "dotenv/config";
import sql from "mssql";
import { db } from "../src/db/mysql.js";
import { getNcosecPool } from "../src/db/ncosecDb.js";
import { attributeNightShifts, type PunchBlock } from "../src/modules/wfm/cosec-sync.service.js";

const FROM = process.argv[3] ?? "2026-10-01";
const TO = process.argv[4] ?? "2026-10-12";
const TOL_MIN = 10;
const addDays = (s: string, n: number) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diffMin = (a: string, b: string) => Math.round((new Date(b.replace(" ", "T") + "Z").getTime() - new Date(a.replace(" ", "T") + "Z").getTime()) / 60000);

(async () => {
  const [emps] = await db.execute<any[]>(
    `SELECT DISTINCT e.employee_code, e.biometric_code, GROUP_CONCAT(DISTINCT ebe.cosec_user_id) AS cosec_ids
       FROM attendance_daily_record a JOIN employees e ON e.id = a.employee_id
       LEFT JOIN employee_biometric_enrollment ebe ON ebe.employee_id = e.id
      WHERE a.record_date BETWEEN ? AND ? AND (a.source_system LIKE '%cosec%' OR a.source_system = 'wfm_attendance_session' OR a.source_system = 'regularization')
      GROUP BY e.id, e.employee_code, e.biometric_code`, [FROM, TO]);
  const ids = new Set<string>();
  for (const r of emps as any[]) for (const v of [r.employee_code, r.biometric_code, ...String(r.cosec_ids ?? "").split(",")]) { const t = String(v ?? "").trim(); if (t) ids.add(t); }
  const all = [...ids];
  console.log(`employees: ${(emps as any[]).length}, cosec ids: ${all.length}`);

  const pool = await getNcosecPool();
  const evt = process.env.NCOSEC_EVENT_TABLE?.trim() || "dbo.Mx_ATDEventTrn";
  const dat = process.env.NCOSEC_DAILY_TABLE?.trim() || "dbo.Mx_DATDTrn";
  const uc = process.env.NCOSEC_USER_ID_COLUMN?.trim() || "UserID";
  const dc = process.env.NCOSEC_DATETIME_COLUMN?.trim() || "Edatetime";

  const blocks: PunchBlock[] = [];
  const datd = new Map<string, { in: string; out: string | null }>(); // key user|date
  for (let i = 0; i < all.length; i += 400) {
    const slice = all.slice(i, i + 400);
    const mk = () => { const r = pool.request(); r.input("f", sql.Date, addDays(FROM, -1)); r.input("t", sql.Date, addDays(TO, 1)); slice.forEach((v, j) => r.input(`u${j}`, sql.NVarChar(100), v)); return r; };
    const inl = slice.map((_, j) => `@u${j}`).join(",");
    const r1 = await mk().query(`
      SELECT CAST([${uc}] AS NVARCHAR(100)) AS user_id, CONVERT(CHAR(10), CAST([${dc}] AS DATE), 23) AS d,
             CONVERT(CHAR(19), MIN([${dc}]), 120) AS f, CONVERT(CHAR(19), MAX([${dc}]), 120) AS l, COUNT_BIG(*) AS n
        FROM ${evt} WHERE [${dc}] >= @f AND [${dc}] < @t AND CAST([${uc}] AS NVARCHAR(100)) IN (${inl})
       GROUP BY [${uc}], CAST([${dc}] AS DATE), DATEPART(HOUR, [${dc}])`);
    for (const x of r1.recordset) blocks.push({ cosecUserId: String(x.user_id).trim(), punchDate: String(x.d), firstPunch: String(x.f), lastPunch: String(x.l), totalPunches: Number(x.n) });
    const r2 = await mk().query(`
      SELECT CAST(UserID AS NVARCHAR(100)) AS user_id, CONVERT(CHAR(10), PDate, 23) AS d,
             CONVERT(CHAR(19), Punch1, 120) AS p1, CONVERT(CHAR(19), OutPunch, 120) AS po
        FROM ${dat} WHERE PDate >= @f AND PDate < @t AND CAST(UserID AS NVARCHAR(100)) IN (${inl}) AND Punch1 IS NOT NULL`);
    for (const x of r2.recordset) datd.set(`${String(x.user_id).trim()}|${x.d}`, { in: String(x.p1), out: x.po ? String(x.po) : null });
  }

  const byUser = new Map<string, PunchBlock[]>();
  for (const b of blocks) (byUser.get(b.cosecUserId) ?? byUser.set(b.cosecUserId, []).get(b.cosecUserId)!).push(b);
  const mine = new Map<string, { in: string; out: string; n: number }>();
  for (const [u, bl] of byUser) for (const g of attributeNightShifts(bl, "x", "x").groups) mine.set(`${u}|${g.punchDate}`, { in: g.firstPunch, out: g.lastPunch, n: g.totalPunches });

  let match = 0, openOnly = 0;
  const diffs: any[] = [], onlyMine: any[] = [], onlyDatd: any[] = [];
  for (const [k, d] of datd) {
    const date = k.split("|")[1]; if (date < FROM || date > TO) continue;
    const m = mine.get(k);
    if (!m) { onlyDatd.push({ k, datdIn: d.in, datdOut: d.out }); continue; }
    if (!d.out) { openOnly++; if (Math.abs(diffMin(d.in, m.in)) <= TOL_MIN) { match++; continue; } }
    const inOk = Math.abs(diffMin(d.in, m.in)) <= TOL_MIN;
    const outOk = d.out ? Math.abs(diffMin(d.out, m.out)) <= TOL_MIN : true;
    if (inOk && outOk) match++; else diffs.push({ k, datdIn: d.in.slice(5, 16), datdOut: d.out?.slice(5, 16) ?? "-", mineIn: m.in.slice(5, 16), mineOut: m.out.slice(5, 16), n: m.n, outByMin: d.out ? diffMin(d.out, m.out) : "" });
  }
  for (const [k, m] of mine) { const date = k.split("|")[1]; if (date >= FROM && date <= TO && !datd.has(k)) onlyMine.push({ k, mineIn: m.in.slice(5, 16), mineOut: m.out.slice(5, 16), n: m.n }); }

  const total = match + diffs.length;
  console.log(`\nCOMPARED shift-days present in both: ${total}`);
  console.log(`  MATCH (in & out within ${TOL_MIN} min): ${match}  (${((match / Math.max(total, 1)) * 100).toFixed(2)}%)`);
  console.log(`  DISAGREE: ${diffs.length}`);
  console.log(`  only in NCOSEC daily table (mine has no shift that date): ${onlyDatd.length}`);
  console.log(`  only in mine (daily table has no row): ${onlyMine.length}`);
  const bucket = (f: (d: any) => boolean) => diffs.filter(f).length;
  console.log(`  disagree where mine ends LATER than NCOSEC by >10min: ${bucket((d) => d.outByMin !== "" && d.outByMin > TOL_MIN)}`);
  console.log(`  disagree where mine ends EARLIER than NCOSEC by >10min: ${bucket((d) => d.outByMin !== "" && d.outByMin < -TOL_MIN)}`);
  console.log(`  disagree on shift START: ${bucket((d) => Math.abs(diffMin(`2026-${d.datdIn}:00`, `2026-${d.mineIn}:00`)) > TOL_MIN)}`);
  // ---- per-employee concentration and plausibility classes ----
  const span = (a: string, b: string | null) => (b ? diffMin(`2026-${a}:00`, `2026-${b}:00`) : null);
  const cls = { ncosecImplausibleMinePlausible: 0, bothPlausible: 0, minePlausibleNcosecOpen: 0, mineImplausible: 0, bothImplausible: 0 };
  const perEmp = new Map<string, { n: number; classes: Record<string, number> }>();
  const rows: string[] = ["CSV,employee,date,class,ncosec_in,ncosec_out,ncosec_hours,mine_in,mine_out,mine_hours,punches"];
  for (const d of diffs) {
    const [emp, date] = String(d.k).split("|");
    const ns = span(d.datdIn, d.datdOut === "-" ? null : d.datdOut);
    const ms = span(d.mineIn, d.mineOut);
    const nBad = ns !== null && (ns > 14 * 60 || ns < 60);
    const mBad = ms !== null && (ms > 14 * 60);
    let c: keyof typeof cls;
    if (ns === null) c = mBad ? "mineImplausible" : "minePlausibleNcosecOpen";
    else if (nBad && !mBad) c = "ncosecImplausibleMinePlausible";
    else if (!nBad && !mBad) c = "bothPlausible";
    else if (mBad && !nBad) c = "mineImplausible";
    else c = "bothImplausible";
    cls[c]++;
    const e = perEmp.get(emp) ?? { n: 0, classes: {} }; e.n++; e.classes[c] = (e.classes[c] ?? 0) + 1; perEmp.set(emp, e);
    rows.push(["CSV", emp, date, c, d.datdIn, d.datdOut, ns === null ? "" : (ns / 60).toFixed(1), d.mineIn, d.mineOut, ms === null ? "" : (ms / 60).toFixed(1), d.n].join(","));
  }
  const ranked = [...perEmp.entries()].sort((a, b) => b[1].n - a[1].n);
  console.log(`\nDISAGREE CLASSES: ${JSON.stringify(cls)}`);
  console.log(`DISAGREE employees: ${perEmp.size}; top 10 employees hold ${ranked.slice(0, 10).reduce((s, [, v]) => s + v.n, 0)} of ${diffs.length}; top 30 hold ${ranked.slice(0, 30).reduce((s, [, v]) => s + v.n, 0)}`);
  console.log("DISAGREE by employee (top 40): employee | disagreements | classes");
  for (const [emp, v] of ranked.slice(0, 40)) console.log(`  ${emp} | ${v.n} | ${JSON.stringify(v.classes)}`);
  for (const r of rows) console.log(r);
  console.log("\nDISAGREE samples (key | NCOSEC in->out | mine in->out | punches | out diff min)");
  for (const d of diffs.slice(0, 40)) console.log(`  ${d.k} | ${d.datdIn} -> ${d.datdOut} | ${d.mineIn} -> ${d.mineOut} | ${d.n} | ${d.outByMin}`);
  console.log("\nONLY-IN-NCOSEC samples");
  for (const d of onlyDatd.slice(0, 25)) console.log(`  ${d.k} | ${d.datdIn} -> ${d.datdOut}`);
  console.log("\nONLY-IN-MINE samples");
  for (const d of onlyMine.slice(0, 25)) console.log(`  ${d.k} | ${d.mineIn} -> ${d.mineOut} | ${d.n}`);
  await db.end();
  process.exit(0);
})().catch(async (e) => { console.error("ERR", e?.message ?? e); try { await db.end(); } catch { } process.exit(1); });
