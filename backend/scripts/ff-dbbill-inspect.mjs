// Read-only: what do db_bill's F&F-related fields hold? Aggregates only, no names / free text.
import "dotenv/config";
import mysql from "mysql2/promise";
const need = (k) => { const v = process.env[k]; if (!v) throw new Error(`${k} is not set`); return v; };
const c = await mysql.createConnection({
  host: need("BILL_DB_HOST"), port: Number(process.env.BILL_DB_PORT || 3306),
  user: need("BILL_DB_USER"), password: need("BILL_DB_PASSWORD"), database: need("BILL_DB_NAME"), connectTimeout: 20000,
});
const q = async (sql) => { if (!/^\s*(select|show)\b/i.test(sql)) throw new Error("read-only"); try { const [r] = await c.query(sql); return r; } catch (e) { return `ERR ${e.message}`; } };
const p = (l, v) => console.log(`\n== ${l} ==`, typeof v === "string" ? v : JSON.stringify(v).slice(0, 2500));
p("masjclrentry columns (names)", (await q(`SELECT GROUP_CONCAT(COLUMN_NAME) c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='masjclrentry'`)));
p("FnfStatus values (masjclrentry)", await q(`SELECT FnfStatus v, COUNT(*) n FROM masjclrentry GROUP BY 1 ORDER BY n DESC LIMIT 15`));
p("Gratuity values (masjclrentry)", await q(`SELECT Gratuity v, COUNT(*) n, MIN(Gratuity) mn FROM masjclrentry GROUP BY 1 ORDER BY n DESC LIMIT 12`));
p("FnfDoc filled", await q(`SELECT (FnfDoc IS NOT NULL AND FnfDoc<>'') filled, COUNT(*) n FROM masjclrentry GROUP BY 1`));
p("salary_data columns", (await q(`SELECT GROUP_CONCAT(COLUMN_NAME) c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='salary_data'`)));
p("salary_data FnfStatus values", await q(`SELECT FnfStatus v, COUNT(*) n FROM salary_data GROUP BY 1 ORDER BY n DESC LIMIT 12`));
await c.end();
