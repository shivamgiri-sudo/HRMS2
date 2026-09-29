# Request to the DBA of `dialer-report-server` (MySQL 8.0.42, 122.184.128.90)

We are moving the HRMS databases to a dedicated MySQL on the app server (115.241.59.220).
The application's login (`shivam_user`) has database-level grants only, so it cannot record a
binary-log position, replicate, or see other sessions. Please do the following. Everything is
read-only on the source except the two new users.

Replace `APP_IP` with the address the source sees for the app server (currently 115.241.59.220).

## 1. Two dedicated users (do not reuse shivam_user)

```sql
-- Snapshot dump. RELOAD + REPLICATION CLIENT let mysqldump record the binlog position.
CREATE USER 'hrms_dump'@'APP_IP' IDENTIFIED BY '<generate a strong password>' REQUIRE SSL;
GRANT SELECT, SHOW VIEW, TRIGGER, EVENT, LOCK TABLES
  ON mas_hrms.*    TO 'hrms_dump'@'APP_IP';
GRANT SELECT, SHOW VIEW, TRIGGER, EVENT, LOCK TABLES ON db_masmis.*   TO 'hrms_dump'@'APP_IP';
GRANT SELECT, SHOW VIEW, TRIGGER, EVENT, LOCK TABLES ON db_audit.*    TO 'hrms_dump'@'APP_IP';
GRANT SELECT, SHOW VIEW, TRIGGER, EVENT, LOCK TABLES ON db_external.* TO 'hrms_dump'@'APP_IP';
GRANT SELECT, SHOW VIEW, TRIGGER, EVENT, LOCK TABLES ON Shivamgiri.*  TO 'hrms_dump'@'APP_IP';
GRANT RELOAD, REPLICATION CLIENT, PROCESS ON *.* TO 'hrms_dump'@'APP_IP';

-- Phase 3 replication.
CREATE USER 'hrms_repl'@'APP_IP' IDENTIFIED BY '<generate a strong password>' REQUIRE SSL;
GRANT REPLICATION SLAVE ON *.* TO 'hrms_repl'@'APP_IP';
```

`REQUIRE SSL` is recommended because these connections cross the network. If the source has no SSL
configured, drop that clause and tell us; the link is then unencrypted.

## 2. Facts we need confirmed

1. **Every client that writes to `mas_hrms` or `db_masmis` other than the HRMS app.** Anything missed
   here loses its writes at cutover. Known so far: the analyst machine 122.161.76.174 and the
   uploader scripts under `uploader/`. Please check a week of connections (`performance_schema`
   hosts, the general or audit log, or firewall logs), not just the current processlist.
2. **Binary-log retention.** The source keeps 3 days (`binlog_expire_logs_seconds = 259200`). Please
   confirm nobody purges binlogs manually, and keep at least 7 days during the migration.
3. **SSL / network path** between 115.241.59.220 and 122.184.128.90 (bandwidth for about 8 GB, and
   whether the link is public internet).
4. **Cutover window**: a night slot of about 30 minutes.

## 3. Optional, would have saved us hours today

Grant `PROCESS` to the application login `shivam_user`. With it we could see which sessions on that
shared server were causing the slow dashboards (about 35 queries were running at once and we could
identify only about 6 of them).

## 4. What we do NOT need

- No write access to `mas_hrms` or `db_masmis` on the source for these two users.
- Nothing from `dialer_db`; it stays where it is.
- The data of `mas_hrms.upload_batch_row` is not copied; it stays on the source as the archive.
