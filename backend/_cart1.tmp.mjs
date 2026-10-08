import 'dotenv/config';
import mysql from 'mysql2/promise';
const c = await mysql.createConnection({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:'db_masmis',connectTimeout:60000});
const q = async (l, s, p=[]) => { try { const [r]=await c.query(s,p); console.log('\n## '+l+'\n'+(typeof r==='object'?JSON.stringify(r).slice(0,2500):r)); } catch(e){ console.log('\n## '+l+': ERR', e.message); } };
for (const t of ['bb_cart','bb_apr']) { const [cols]=await c.query("SELECT COLUMN_NAME n, COLUMN_TYPE t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='db_masmis' AND TABLE_NAME=? ORDER BY ORDINAL_POSITION",[t]); console.log('\n'+t+' cols:', cols.map(x=>x.n+'['+x.t+']').join(', ')); }
await q('bb_cart date range and per-date counts', "SELECT DATE_FORMAT(call_date,'%Y-%m-%d') d, COUNT(*) n, COUNT(DISTINCT cart_id) carts, COUNT(DISTINCT phone_number) phones FROM bb_cart WHERE call_date>='2026-08-30' GROUP BY call_date ORDER BY call_date");
await q('bb_cart status', "SELECT status, COUNT(*) n FROM bb_cart WHERE call_date>='2026-09-01' GROUP BY status ORDER BY n DESC");
await q('bb_cart disposition', "SELECT disposition, COUNT(*) n FROM bb_cart WHERE call_date>='2026-09-01' GROUP BY disposition ORDER BY n DESC LIMIT 25");
await q('bb_cart sub_disposition', "SELECT sub_disposition, COUNT(*) n FROM bb_cart WHERE call_date>='2026-09-01' GROUP BY sub_disposition ORDER BY n DESC LIMIT 25");
await q('bb_cart agents / null', "SELECT COUNT(DISTINCT agent) agents, SUM(agent IS NULL OR agent='') no_agent, SUM(phone_number IS NULL OR phone_number='') no_phone, SUM(amount IS NULL) no_amt FROM bb_cart WHERE call_date>='2026-09-01'");
await q('bb_cart sample', "SELECT * FROM bb_cart WHERE call_date='2026-09-02' LIMIT 2");
await c.end();
