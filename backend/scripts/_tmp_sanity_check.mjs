import mysql from "mysql2/promise";
const conn = await mysql.createConnection({
  host: "122.184.128.90", port: 3306, user: "shivam_user", password: process.env.DB_PASSWORD, database: "mas_hrms",
});
try {
  const [[stats]] = await conn.execute(`
    WITH ordered AS (
      SELECT employee_id, roster_date, shift_start_time, shift_end_time,
             LAG(roster_date) OVER (PARTITION BY employee_id ORDER BY roster_date) AS prev_date,
             LAG(shift_end_time) OVER (PARTITION BY employee_id ORDER BY roster_date) AS prev_end_time
        FROM wfm_roster_assignment
       WHERE is_week_off = 0 AND shift_start_time IS NOT NULL AND shift_end_time IS NOT NULL
    ),
    gaps AS (
      SELECT employee_id, roster_date, shift_start_time, prev_date, prev_end_time,
             TIMESTAMPDIFF(MINUTE, TIMESTAMP(prev_date, prev_end_time), TIMESTAMP(roster_date, shift_start_time)) AS gap_minutes
        FROM ordered WHERE prev_date IS NOT NULL
    )
    SELECT MIN(gap_minutes) mn, MAX(gap_minutes) mx, AVG(gap_minutes) avg_gap,
           SUM(CASE WHEN gap_minutes < 0 THEN 1 ELSE 0 END) negative_count,
           SUM(CASE WHEN gap_minutes < 1440 THEN 1 ELSE 0 END) under_24h,
           COUNT(*) total
      FROM gaps
  `);
  console.log("Gap stats:", JSON.stringify(stats, null, 2));

  // Sample a few rows with the smallest gaps to eyeball real data
  const [sample] = await conn.execute(`
    WITH ordered AS (
      SELECT employee_id, roster_date, shift_start_time, shift_end_time,
             LAG(roster_date) OVER (PARTITION BY employee_id ORDER BY roster_date) AS prev_date,
             LAG(shift_end_time) OVER (PARTITION BY employee_id ORDER BY roster_date) AS prev_end_time
        FROM wfm_roster_assignment
       WHERE is_week_off = 0 AND shift_start_time IS NOT NULL AND shift_end_time IS NOT NULL
    ),
    gaps AS (
      SELECT employee_id, roster_date, shift_start_time, prev_date, prev_end_time,
             TIMESTAMPDIFF(MINUTE, TIMESTAMP(prev_date, prev_end_time), TIMESTAMP(roster_date, shift_start_time)) AS gap_minutes
        FROM ordered WHERE prev_date IS NOT NULL
    )
    SELECT * FROM gaps ORDER BY gap_minutes ASC LIMIT 10
  `);
  console.log("10 smallest gaps:", JSON.stringify(sample, null, 2));

  // Check distinct shift_start_time/shift_end_time value diversity - are times actually varied or all identical?
  const [distinctTimes] = await conn.execute(`
    SELECT shift_start_time, shift_end_time, COUNT(*) c FROM wfm_roster_assignment
    WHERE is_week_off = 0 GROUP BY shift_start_time, shift_end_time ORDER BY c DESC LIMIT 10
  `);
  console.log("Top shift start/end time combos:", JSON.stringify(distinctTimes, null, 2));
} finally { await conn.end(); }
