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
