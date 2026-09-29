# Dedicated MySQL for HRMS (runbook)

Why: `mas_hrms` shares `dialer-report-server` (MySQL 8.0.42) with the dialer and reports. Measured
2026-09-30: ~35 queries running at once, only ~6 ours, ~900k rows read/s, dashboard chart calls
taking 12-38 s. This moves the HRMS databases onto the app server (10 cores, /var has 285 GB free).

## What moves

| Schema | Size | Treatment |
|---|---|---|
| `mas_hrms` | 26.5 GB (18.6 GB is `upload_batch_row`) | copy; archive `upload_batch_row` older than 60 days first |
| `db_masmis` | 2.1 GB | copy (written by the uploaders, used in ~100 files) |
| `db_audit`, `db_external`, `Shivamgiri` | 1.5 / 1.1 / 0.2 GB | live replicas; the app reads them through the main pool. The app writes 1 table in each of `db_audit` and `Shivamgiri` (see Risks) |
| `dialer_db` | 7.8 GB | stays remote (has its own `DIALER_DB_HOST` setting) |

## Phases

| # | Step | Script | Downtime |
|---|---|---|---|
| 0 | Discovery: outside clients, root/REPLICATION privileges, `upload_batch_row` policy | (manual, DBA) | none |
| 1 | Build the empty instance on port 3307 | `01-create-instance.sh` | none |
| 2 | Archive old `upload_batch_row`, consistent dump and restore | not written yet | none |
| 3 | Replication from the source, checksum verification, enable backup cron | not written yet | none |
| 4 | Rehearsal: second app copy on :5056 against the new DB, benchmark the dashboard endpoints | not written yet | none |
| 5 | Cutover at night: stop app, wait for lag 0, switch `.env`, start | not written yet | ~10-15 min |
| 6 | Keep the old server as a warm standby (reverse replication) for 7 days | not written yet | none |

## Phase 1: what `01-create-instance.sh` does

Default is a dry run. `--apply` needs root. It refuses to run if port 3307, `/var/mysql-hrms/data` or
`mysql-hrms.service` already exist, if `/var` has < 120 GB free, or if < 8 GB memory is available.

Creates: `/var/mysql-hrms/{data,binlog,tmp,backup}`, `/etc/mysql-hrms/hrms.cnf`,
`/etc/systemd/system/mysql-hrms.service`, generated passwords in `/etc/mysql-hrms/credentials.env`
(mode 600), accounts `hrms_app` and `hrms_backup`, AppArmor rules for the new paths, and
`vm.swappiness=10`. It does not copy data, touch the app's `.env`, or touch the LMS MySQL on 3306.

Config parity with the source (measured): `sql_mode`, `utf8mb4_0900_ai_ci`, `lower_case_table_names=0`,
IST, `REPEATABLE-READ`, lock timeouts, 64 MB packets, ROW binlog, GTID off. Deliberate differences:
6 GB buffer pool (source default), 128 MB temp tables (source 16 MB), performance_schema and a 2 s
slow log on, `event_scheduler=OFF` until cutover.

Checked on the real server on 2026-09-30 (read-only): all 44 options validate under `mysqld
--validate-config` (a bogus-option control fails as expected); dry run passes pre-flight
(mysqld 8.0.46, 285 GB free, 11 GB memory available).

### Apply (after review)

    scp -r scripts/mysql-hrms masadmin@192.168.11.225:/tmp/
    ssh masadmin@192.168.11.225
    cd /tmp/mysql-hrms && sudo ./01-create-instance.sh            # read the dry run
    sudo ./01-create-instance.sh --apply
    sudo mysql-hrms-verify                                        # must end "all checks passed"

### Roll back Phase 1 (nothing else depends on it yet)

    sudo systemctl disable --now mysql-hrms
    sudo rm -rf /var/mysql-hrms /etc/mysql-hrms /etc/systemd/system/mysql-hrms.service \
                /etc/sysctl.d/99-mysql-hrms.conf /usr/local/sbin/mysql-hrms-{backup,verify}
    sudo systemctl daemon-reload && sudo sysctl vm.swappiness=60
    # remove the "mysql-hrms dedicated instance" block from /etc/apparmor.d/local/usr.sbin.mysqld
    # and run: sudo apparmor_parser -r /etc/apparmor.d/usr.sbin.mysqld

## Risks and open items

1. **Outside writers.** Anything else writing to `mas_hrms`/`db_masmis` on the old server is lost at
   cutover. Known outside clients: the analyst machine 122.161.76.174 and Tausif's uploader scripts.
   Phase 0 must list them all.
2. **Memory.** 14 GB shared with several Node apps and the LMS MySQL (about 11 GB available). Ask for
   24-32 GB, then raise `innodb_buffer_pool_size` to 8G.
3. **Single machine.** Backups on the same disk are not disaster backups: set `OFFSITE_TARGET` for
   `mysql-hrms-backup`, and keep the old server as a standby for 7 days after cutover.
4. **Definers.** Views/routines/event are owned by `shivam_user@%` (and one view by
   `shivam_user@192.168.10.42`); triggers by `root@%`. Create those accounts locally or rewrite
   definers during the restore.
5. **Feed schemas written by the app.** `db_audit.neg_category_keywords` and `Shivamgiri.AgentMaster`
   are written by `inbound-quality.service.ts`. As a replica they are read-only, so those two writes
   need a decision before cutover (keep pointing them at the source, or promote the tables).
6. **Disk type.** The OS reports the disk as rotational; a raw write test ran at 2.4 GB/s. Run `fio`
   before raising `innodb_io_capacity`.
7. The app's `MIGRATION_MANIFEST` runner needs `CREATE` on `db_masmis` (migration 449 was blocked by
   its absence). `hrms_app` gets it here.
