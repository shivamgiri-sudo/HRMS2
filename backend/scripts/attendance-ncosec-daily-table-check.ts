// READ-ONLY. What does NCOSEC's own daily table (Mx_DATDTrn) hold for a night-shift employee?
// attendance-realtime-ncosec.service.ts reads it for the live view and the monthly summary, so
// this tells us whether that path shows the same 20-25 h days as attendance_daily_record did.
// Usage: npx tsx scripts/attendance-ncosec-daily-table-check.ts <EMPLOYEE_CODE> [from] [to]
import "dotenv/config";
import sql from "mssql";
import { getNcosecPool } from "../src/db/ncosecDb.js";

const CODE = (process.argv[2] ?? "").trim();
const FROM = process.argv[3] ?? "2026-09-10";
const TO = process.argv[4] ?? "2026-10-12";
if (!CODE) { console.error("employee code required"); process.exit(1); }

(async () => {
  const pool = await getNcosecPool();
  const table = process.env.NCOSEC_DAILY_TABLE?.trim() || "dbo.Mx_DATDTrn";
  const req = pool.request();
  req.input("u", sql.NVarChar(100), CODE);
  req.input("f", sql.Date, FROM);
  req.input("t", sql.Date, TO);
  const r = await req.query(`
    SELECT CONVERT(CHAR(10), PDate, 23) AS pdate,
           CONVERT(CHAR(19), Punch1, 120) AS punch1,
           CONVERT(CHAR(19), OutPunch, 120) AS out_punch,
           WorkTime AS work_time_min,
           ROUND(WorkTime / 60.0, 1) AS work_hours
      FROM ${table}
     WHERE CAST(UserID AS NVARCHAR(100)) = @u AND PDate >= @f AND PDate < DATEADD(DAY, 1, @t)
     ORDER BY PDate`);
  console.log(`=== ${table} for ${CODE} (${r.recordset.length} rows) ===`);
  console.table(r.recordset);
  process.exit(0);
})().catch((e) => { console.error("ERR", e?.message ?? e); process.exit(1); });
