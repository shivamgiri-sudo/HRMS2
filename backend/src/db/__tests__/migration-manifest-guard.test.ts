import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const LOCK_PATH = path.join(ROOT, "sql", "MIGRATION_MANIFEST.lock.json");

/**
 * The manifest is the only thing that decides whether a migration ever runs on a
 * fresh environment. It is tracked by full filename in schema_migrations, so an
 * entry that silently disappears means that file is never applied — and nothing
 * fails at the time. The damage shows up as a missing column months later.
 *
 * On 2026-08-02 exactly that happened: a stale working copy of
 * runPendingMigrations.ts was staged whole and removed three other sessions'
 * entries — a branch-head approval enum fix, its follow-up column fix, and the
 * alert_cooldown table the interview-delay worker throttles against. The staged
 * deletion count was visible and was rationalised away as an unrelated rename.
 *
 * These tests exist so that judgement is never load-bearing again.
 *
 * The lock is regenerated deliberately with scripts/update-migration-lock.mjs.
 */

function readManifest(): string[] {
  const src = fs.readFileSync(path.join(ROOT, "src", "db", "runPendingMigrations.ts"), "utf8");
  const start = src.indexOf("MIGRATION_MANIFEST");
  const end = src.indexOf("export type MigrationHealth");
  expect(start, "MIGRATION_MANIFEST not found").toBeGreaterThan(-1);
  return [...src.slice(start, end).matchAll(/"([^"]+\.sql)"/g)].map((m) => m[1]);
}

function readLock(): {
  released: string[];
  approvedDeletions: Array<{ filename: string; reason: string; approvedBy?: string }>;
  knownDangling: string[];
  knownUnlisted: string[];
} {
  return JSON.parse(fs.readFileSync(LOCK_PATH, "utf8"));
}

const sqlFiles = () =>
  fs.readdirSync(path.join(ROOT, "sql")).filter((f) => /\.sql$/.test(f));

describe("migration manifest — removals", () => {
  it("no released entry has been removed without an approved deletion", () => {
    // The exact failure of 2026-08-02.
    const manifest = new Set(readManifest());
    const lock = readLock();
    const approved = new Set(lock.approvedDeletions.map((d) => d.filename));

    const removed = lock.released.filter((f) => !manifest.has(f) && !approved.has(f));

    expect(
      removed,
      removed.length
        ? `${removed.length} migration(s) vanished from the manifest with no approved deletion:\n` +
          removed.map((f) => `  ${f}`).join("\n") +
          `\n\nOn a fresh database these will never run. If the removal is intended, add each to ` +
          `approvedDeletions in sql/MIGRATION_MANIFEST.lock.json with a reason, then run ` +
          `node scripts/update-migration-lock.mjs --write`
        : "",
    ).toEqual([]);
  });

  it("every approved deletion states why", () => {
    // An approval with no reason is a rubber stamp, and the next person cannot
    // tell a deliberate removal from a mistake someone waved through.
    for (const d of readLock().approvedDeletions) {
      expect(d.reason?.trim(), `approvedDeletions entry "${d.filename}" has no reason`).toBeTruthy();
    }
  });
});

describe("migration manifest — ordering", () => {
  it("released entries keep their relative order", () => {
    // Migrations are applied in manifest order. Reordering two that touch the
    // same table changes the resulting schema on a fresh install while leaving
    // every existing environment untouched, so nothing reveals it.
    const manifest = readManifest();
    const lock = readLock();
    const position = new Map(manifest.map((f, i) => [f, i]));

    const stillPresent = lock.released.filter((f) => position.has(f));
    const outOfOrder: string[] = [];
    for (let i = 1; i < stillPresent.length; i++) {
      const prev = position.get(stillPresent[i - 1])!;
      const cur = position.get(stillPresent[i])!;
      if (cur < prev) outOfOrder.push(`${stillPresent[i]} now runs before ${stillPresent[i - 1]}`);
    }
    expect(outOfOrder, outOfOrder.join("\n")).toEqual([]);
  });
});

describe("migration manifest — files and entries agree", () => {
  it("every manifest entry has a file", () => {
    // A dangling entry aborts the run at that point on a fresh database, so
    // everything after it never applies either.
    const files = new Set(sqlFiles());
    const known = new Set(readLock().knownDangling);
    const dangling = readManifest().filter((m) => !files.has(m) && !known.has(m));

    expect(
      dangling,
      dangling.length
        ? `manifest names ${dangling.length} file(s) that do not exist:\n` +
          dangling.map((f) => `  ${f}`).join("\n") +
          `\nA fresh migration run stops here, so nothing after it applies either.`
        : "",
    ).toEqual([]);
  });

  it("no new migration file is left out of the manifest", () => {
    // 156 pre-existing files are unlisted and grandfathered. A NEW one is
    // almost always someone forgetting the manifest, which means their
    // migration runs nowhere.
    const manifest = new Set(readManifest());
    const known = new Set(readLock().knownUnlisted);
    const orphans = sqlFiles().filter((f) => !manifest.has(f) && !known.has(f));

    expect(
      orphans,
      orphans.length
        ? `${orphans.length} migration file(s) exist but are in neither the manifest nor the lock:\n` +
          orphans.map((f) => `  ${f}`).join("\n") +
          `\nAdd them to MIGRATION_MANIFEST, or to knownUnlisted if they are deliberately not run.`
        : "",
    ).toEqual([]);
  });

  it("a released migration file has not been renamed or deleted from disk", () => {
    // Renaming an applied migration makes schema_migrations miss it, so it
    // re-runs on every environment that already had it.
    const files = new Set(sqlFiles());
    const lock = readLock();
    const knownDangling = new Set(lock.knownDangling);
    const gone = lock.released.filter((f) => !files.has(f) && !knownDangling.has(f));

    expect(
      gone,
      gone.length
        ? `${gone.length} released migration file(s) are no longer on disk:\n` + gone.map((f) => `  ${f}`).join("\n")
        : "",
    ).toEqual([]);
  });
});

describe("migration manifest — duplicates", () => {
  it("no filename appears twice", () => {
    // schema_migrations is keyed by filename, so a duplicate entry is either a
    // no-op or a double application depending on the DDL.
    const manifest = readManifest();
    const seen = new Set<string>();
    const dupes = manifest.filter((f) => (seen.has(f) ? true : (seen.add(f), false)));
    expect(dupes, `duplicate manifest entries: ${dupes.join(", ")}`).toEqual([]);
  });

  it("no two files share a name", () => {
    const files = sqlFiles();
    const seen = new Set<string>();
    const dupes = files.filter((f) => (seen.has(f) ? true : (seen.add(f), false)));
    expect(dupes).toEqual([]);
  });

  it("records duplicate numeric prefixes without failing on them", () => {
    // Duplicate NUMBERS are documented as intentional here — tracking is by full
    // filename — so this asserts the count is understood rather than banning it.
    // A sudden jump means someone is numbering blind.
    //
    // 61 -> 62 (2026-08-30): 1631_topup_allocation_driver.sql and
    // 1631_kpi_capture_submission.sql — two unrelated features from concurrent
    // sessions independently picked the same next-available number. Both are
    // real, already-applied migrations tracked by their distinct full filenames,
    // so renaming either risks the system treating an already-run migration as
    // new on a server where it already applied. Acknowledged, not renumbered.
    const byNumber = new Map<string, string[]>();
    for (const f of readManifest()) {
      const n = f.match(/^(\d+)_/)?.[1];
      if (n) byNumber.set(n, [...(byNumber.get(n) ?? []), f]);
    }
    const shared = [...byNumber.values()].filter((v) => v.length > 1);
    //
    // 62 -> 64 (2026-08-30): upstream carried 63 groups, this branch adds 1633.
    // 64 -> 65 (2026-08-31): 1641_create_client_portal_users.sql added by the
    // portal agent while 1641_deactivate_test_slabs_and_deduplicate_packages.sql
    // already exists. Neither is renamed — both are applied by filename in
    // schema_migrations and renaming an applied migration re-runs it.
    //
    // 65 -> 67 (2026-09-03): 1652_gst_tally_export_page_access.sql and
    // 1653_bgv_page_access_hr_variants.sql were registered against the existing
    // 1652_employee_attendance_exception_bucket.sql and
    // 1653_payroll_payable_days_override.sql. Same shape as every collision
    // above: concurrent sessions took the same next-available number. These two
    // are not new work — both are ALREADY APPLIED on production (verified in
    // schema_migrations, 2026-09-03) and were simply never added to the
    // manifest, which meant a fresh install or a DR restore would have rebuilt a
    // database where the GST/Tally Export page and the BGV Verification Center
    // were invisible to the roles that own them. Renaming them to free numbers
    // is the one thing that would break: schema_migrations keys on the filename,
    // so a renamed file reads as never-applied and runs again.
    //
    // 67 -> 69 (2026-09-03): 1644_kpi_studio_foundation.sql and
    // 1645_kpi_studio_resolution.sql registered against the existing
    // 1644_role_report_permissions_wfm_payroll_hr.sql and
    // 1645_pnl_manual_adjustment.sql. Same shape again — concurrent sessions
    // took the same next-available number. The three KPI Studio files shipped
    // with their code and were registered nowhere, so none of their seven
    // tables existed in mas_hrms at all and every KPI Studio query raised
    // ER_NO_SUCH_TABLE; they were applied to production on 2026-09-03 with
    // owner approval and are registered here so a rebuilt database gets them
    // too. Renaming them to free numbers is the one thing that would break:
    // schema_migrations now carries these exact filenames as applied.
    expect(shared.length, "duplicate migration numbers grew unexpectedly").toBeLessThanOrEqual(69);
  });
});
