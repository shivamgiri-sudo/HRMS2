import mysql from 'mysql2/promise';

// The database password is read from the environment, never written here. This file was one
// of 13 that had it as a source literal; the repository is public and the same value
// authenticates mas_hrms, dialer_db, db_bill and mcn_lms. Pasting it back is exactly what
// backend/src/db/__tests__/no-hardcoded-credentials.contract.test.ts exists to catch.
// Run: node --env-file=backend/.env <this script>
if (!process.env.DB_PASSWORD) {
  throw new Error('DB_PASSWORD is not set. Run with: node --env-file=backend/.env <script>');
}

const conn = await mysql.createConnection({
  host: '192.168.10.6', port: 3306,
  user: 'shivam_user', password: process.env.DB_PASSWORD,
  database: 'mas_hrms', dateStrings: true, decimalNumbers: true
});

const data = {};

// 1. Workforce summary
const [ws] = await conn.query(
  "SELECT COUNT(*) as total," +
  " SUM(CASE WHEN employment_status='Active' THEN 1 ELSE 0 END) as active_count," +
  " SUM(CASE WHEN employment_status='inactive' THEN 1 ELSE 0 END) as inactive_count," +
  " SUM(CASE WHEN employment_status='Resigned' THEN 1 ELSE 0 END) as resigned_count," +
  " SUM(CASE WHEN employment_status='terminated' THEN 1 ELSE 0 END) as term_count" +
  " FROM employees"
);
data.workforce = ws[0];

// 2. Branch-wise headcount top 15
const [bh] = await conn.query(
  "SELECT b.branch_name, COUNT(e.id) as total," +
  " SUM(CASE WHEN e.employment_status='Active' THEN 1 ELSE 0 END) as active" +
  " FROM employees e JOIN branch_master b ON e.branch_id = b.id" +
  " GROUP BY b.id, b.branch_name ORDER BY total DESC LIMIT 15"
);
data.branches = bh;

// 3. Monthly joiners last 12 months
const [mj] = await conn.query(
  "SELECT DATE_FORMAT(date_of_joining,'%Y-%m') as month, COUNT(*) as joiners" +
  " FROM employees WHERE date_of_joining >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)" +
  " GROUP BY month ORDER BY month"
);
data.joiners = mj;

// 4. Monthly exits last 12 months
const [me] = await conn.query(
  "SELECT DATE_FORMAT(date_of_exit,'%Y-%m') as month, COUNT(*) as exits" +
  " FROM employees WHERE date_of_exit >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)" +
  " AND date_of_exit IS NOT NULL" +
  " GROUP BY month ORDER BY month"
);
data.exits = me;

// 5. ATS pipeline stages
const [ats] = await conn.query(
  "SELECT current_stage as stage, COUNT(*) as count FROM ats_candidate GROUP BY current_stage ORDER BY count DESC LIMIT 12"
);
data.atsPipeline = ats;

// 6. ATS monthly applications last 6 months
const [atsMon] = await conn.query(
  "SELECT DATE_FORMAT(created_at,'%Y-%m') as month, COUNT(*) as applications" +
  " FROM ats_candidate WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)" +
  " GROUP BY month ORDER BY month"
);
data.atsMonthly = atsMon;

// 7. Attendance last 30 days
const [att] = await conn.query(
  "SELECT record_date, COUNT(*) as present" +
  " FROM attendance_daily_record WHERE record_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)" +
  " GROUP BY record_date ORDER BY record_date"
);
data.attendance = att;

// 8. Leave pending by type
const [lv] = await conn.query(
  "SELECT lt.leave_name, COUNT(lr.id) as count" +
  " FROM leave_request lr" +
  " JOIN leave_type_master lt ON lr.leave_type_id = lt.id" +
  " WHERE lr.status = 'Pending'" +
  " GROUP BY lt.id, lt.leave_name ORDER BY count DESC"
);
data.leavePending = lv;

// 9. Leave approved this month
const [lvApp] = await conn.query(
  "SELECT lt.leave_name, COUNT(lr.id) as count" +
  " FROM leave_request lr" +
  " JOIN leave_type_master lt ON lr.leave_type_id = lt.id" +
  " WHERE lr.status = 'Approved' AND MONTH(lr.from_date) = MONTH(CURDATE()) AND YEAR(lr.from_date) = YEAR(CURDATE())" +
  " GROUP BY lt.id, lt.leave_name ORDER BY count DESC"
);
data.leaveApprovedThisMonth = lvApp;

// 10. New joiners this month
const [nj] = await conn.query(
  "SELECT COUNT(*) as count FROM employees" +
  " WHERE MONTH(date_of_joining) = MONTH(CURDATE()) AND YEAR(date_of_joining) = YEAR(CURDATE())"
);
data.newJoinersThisMonth = Number(nj[0].count);

// 11. Exits this month
const [ex] = await conn.query(
  "SELECT COUNT(*) as count FROM employees" +
  " WHERE date_of_exit IS NOT NULL" +
  " AND MONTH(date_of_exit) = MONTH(CURDATE()) AND YEAR(date_of_exit) = YEAR(CURDATE())"
);
data.exitsThisMonth = Number(ex[0].count);

// 12. Today's attendance count
const [todayAtt] = await conn.query(
  "SELECT COUNT(*) as present FROM attendance_daily_record WHERE record_date = CURDATE()"
);
data.todayAttendance = Number(todayAtt[0].present);

// 13. Process-wise headcount top 10
const [proc] = await conn.query(
  "SELECT p.process_name, COUNT(e.id) as total," +
  " SUM(CASE WHEN e.employment_status='Active' THEN 1 ELSE 0 END) as active" +
  " FROM employees e JOIN process_master p ON e.process_id = p.id" +
  " GROUP BY p.id, p.process_name ORDER BY total DESC LIMIT 10"
);
data.processes = proc;

// 14. ATS offer status breakdown
const [ofr] = await conn.query(
  "SELECT offer_status, COUNT(*) as count FROM ats_candidate WHERE offer_status IS NOT NULL GROUP BY offer_status"
);
data.offerStatus = ofr;

await conn.end();
console.log(JSON.stringify(data, null, 2));
