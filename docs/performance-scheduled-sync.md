# Scheduled Performance Source Sync

Scheduled sync is available for approved MySQL, SQL Server, and Google Sheet performance datasets. Excel and CSV datasets remain manual because every run requires an uploaded file.

## Runtime

Production uses the existing PM2 worker process:

```text
hrms-workers
→ dist/src/workers/all-workers.js
→ performance-ingestion scheduler
```

The API process does not run workers when `WORKERS_PROCESS=external`. In local or non-external deployments, the scheduler starts from `server.ts` when `ENABLE_SCHEDULERS=true`.

The scheduler polls once per minute. Individual dataset cron expressions cannot run more frequently than once every five minutes.

## Controls in Performance Hub

Authorised source managers can open **Scheduled performance sync** and:

- Select an approved database or Google Sheet dataset.
- Enter a cron expression or choose a preset.
- Configure a 1–31 day correction-overlap window.
- Enable, update, or disable the schedule.
- Review the calculated next run and previous result.
- Run an approved source immediately for controlled validation.

All schedule mutations and run-now actions require backend write access and the caller’s existing process/branch scope.

## Fail-closed automatic publication

A scheduled run publishes only when all of the following are true:

1. The dataset is active.
2. The dataset mapping is approved.
3. The source type supports automatic reading.
4. The cron expression is due in the dataset timezone.
5. No run is already active for that dataset.
6. Every source row is inside the selected correction window.
7. Employee, process, mapping-version, and KPI metric validation passes.
8. The source generates publishable facts.

By default, any invalid row blocks the whole publication. This prevents a scheduled source from silently publishing a partial employee population.

The following dataset configuration flags are exceptional controls and should remain absent unless formally approved:

```json
{
  "allowPartialPublication": false,
  "allowEmptyPublication": false
}
```

- `allowPartialPublication=true` permits valid rows to publish while invalid rows remain in the exception queue.
- `allowEmptyPublication=true` permits an empty correction window to withdraw that source’s current facts.

Both controls should be approved only for a documented process use case because they alter the default fail-closed policy.

## Correction overlap

A schedule uses the last successful publication checkpoint and re-reads the configured overlap period.

Example:

```text
Last successful checkpoint: 2026-07-26
Current date:              2026-07-27
Overlap days:              2
Automatic window:          2026-07-25 to 2026-07-27
```

The overlap captures late client corrections. Publication supersedes only the selected dataset’s current lineage inside the window, then recalculates canonical KPI facts from all remaining approved sources.

## Distributed execution safety

The scheduler uses two database advisory locks:

- One global scheduler lock so only one worker instance selects due datasets.
- One dataset-specific lock so the same dataset cannot run concurrently.

The ingestion service also blocks an active run recorded in `performance_ingestion_run`. A run left in `running` state for more than two hours is closed as failed before a new attempt.

## Schedule examples

```text
0 2 * * *       Daily at 02:00
0 */6 * * *     Every six hours
0 7 * * 1-5     Weekdays at 07:00
*/30 * * * *    Every thirty minutes
```

Schedules use the dataset’s IANA timezone, normally `Asia/Kolkata`.

## Run evidence

Scheduled runs are stored with:

```text
trigger_type = schedule
run_mode     = publish
```

The same evidence is available as manual runs:

- Source/staged/mapped/invalid totals
- Validation issues
- Mapping exceptions
- Reconciliation results
- Publication batch
- Superseded lineage count
- Error summary and timestamps

A failed scheduled run does not advance the publication checkpoint. After correcting mappings or source data, use **Run approved source now** or wait for the next scheduled occurrence.

## Staging activation sequence

1. Confirm migrations 520 and 521 are applied.
2. Verify `hrms-workers` is built and running.
3. Configure one read-only source and preview one day manually.
4. Resolve every mapping exception.
5. Approve the mapping from the required historical date.
6. Publish one day manually and reconcile totals.
7. Set a low-risk schedule, such as daily at 02:00.
8. Confirm the next scheduled run creates a `trigger_type=schedule` run.
9. Validate employee, Team Leader, Manager, Quality, Branch, and leadership views.
10. Enable additional datasets only after the pilot remains stable.

## Operational monitoring

Monitor:

- `hrms-workers` PM2 status and logs
- Failed scheduled runs
- Open mapping exceptions
- Reconciliation failures
- Dataset checkpoint age
- Last and next schedule timestamps
- Source credentials and read-only access

Do not enable schedules in production until the staging pilot has reconciled at least one full business cycle for each source type.
