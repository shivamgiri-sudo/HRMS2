import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

/**
 * The SLA breach worker mails recruiters and HR through
 * ats-notification.helper -> emailService, a path that reads neither
 * notification_event_config nor notification_log. Disabling all 53 events in
 * the notifications admin screen therefore did nothing to it, and there was no
 * way to stop it short of shipping a deploy — while its in-memory cooldown
 * reset on every restart, so each restart re-alerted everyone.
 *
 * worker_config.enabled is the off switch. These assertions keep it wired.
 */
describe("sla-breach worker kill switch", () => {
  const worker = read("src/workers/sla-breach-worker.ts");

  it("checks worker_config before doing any alerting work", () => {
    expect(worker).toContain("isWorkerEnabled");
    // The guard must sit in the function that sends, not merely be imported.
    const body = worker.match(/async function processSLABreaches\(\)[\s\S]*?\n\}/)?.[0] ?? "";
    expect(body).toContain("isWorkerEnabled(WORKER_NAME)");
  });

  it("guards before the send, not after it", () => {
    const body = worker.match(/async function processSLABreaches\(\)[\s\S]*?\n\}/)?.[0] ?? "";
    const guardAt = body.indexOf("isWorkerEnabled");
    const sendAt = body.indexOf("notifySLABreach");
    expect(guardAt).toBeGreaterThanOrEqual(0);
    expect(sendAt).toBeGreaterThan(guardAt);
  });

  it("uses the worker name that actually exists in worker_config", () => {
    // isWorkerEnabled fails open on a missing row, so a typo here would leave
    // the switch permanently dead with no error anywhere.
    expect(worker).toMatch(/const WORKER_NAME = "sla-breach"/);
  });

  it("still fails open, so an unmanaged worker is not silently killed", () => {
    const helper = read("src/shared/worker-config.ts");
    expect(helper).toContain("rows.length ? Number(rows[0].enabled) === 1 : true");
  });
});

describe("interview-delay-alert kill switch", () => {
  const worker = read("src/workers/interview-delay-alert.worker.ts");

  it("checks worker_config before alerting", () => {
    const body = worker.match(/async function checkDelays\(\)[\s\S]*?\n\}/)?.[0] ?? "";
    expect(body).toContain("isWorkerEnabled(WORKER_NAME)");
    const guardAt = body.indexOf("isWorkerEnabled");
    const sendAt = body.indexOf("sendDelayAlert");
    expect(guardAt).toBeGreaterThanOrEqual(0);
    expect(sendAt).toBeGreaterThan(guardAt);
  });

  it("uses a worker name that migration 1054 actually seeds", () => {
    expect(worker).toMatch(/const WORKER_NAME = 'interview-delay-alert'/);
    const migration = read("sql/1054_alert_worker_governance.sql");
    expect(migration).toContain("'interview-delay-alert'");
  });
});

describe("alert cooldown survives a restart", () => {
  it("neither alert worker keeps its cooldown in memory any more", () => {
    for (const f of [
      "src/workers/sla-breach-worker.ts",
      "src/workers/interview-delay-alert.worker.ts",
    ]) {
      const source = read(f);
      // A module-level Map is what reset on every pm2 restart and re-alerted
      // everyone; ecosystem.config.cjs permits 10 restarts.
      expect(source, `${f} still holds its cooldown in a Map`).not.toMatch(
        /new Map<string, number>\(\)/
      );
      expect(source).toMatch(/from ['"]\.\.\/shared\/alert-cooldown\.js['"]/);
    }
  });

  it("the cooldown table is created and registered in the migration manifest", () => {
    const migration = read("sql/1054_alert_worker_governance.sql");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS alert_cooldown");

    const runner = read("src/db/runPendingMigrations.ts");
    expect(runner).toContain('"1054_alert_worker_governance.sql"');
    // A migration file absent from the manifest never runs — the manifest is an
    // explicit list, not a directory scan.
    expect(runner).toContain('"1053_qa_evaluation_page_access.sql"');
  });

  it("throttling fails open rather than swallowing every alert", () => {
    const helper = read("src/shared/alert-cooldown.ts");
    // A missing table must not silence SLA alerts nobody then hears about.
    expect(helper).toMatch(/catch\s*\{\s*return true;\s*\}/);
  });
});
