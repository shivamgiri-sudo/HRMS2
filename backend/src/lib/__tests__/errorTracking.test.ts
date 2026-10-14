import { describe, expect, it, vi } from "vitest";
import { errorTrackingDsn } from "../errorTracking.js";
import { beatUrl, heartbeatUrl, sendBeat } from "../uptimeHeartbeat.js";
import { parseDsn, prepareEnvelope } from "../../routes/errorTunnel.routes.js";

const FE_DSN = "http://0123456789abcdef0123456789abcdef@127.0.0.1:8710/1";

describe("errorTrackingDsn (off by default)", () => {
  it("is null when nothing is configured", () => {
    expect(errorTrackingDsn("api", {})).toBeNull();
    expect(errorTrackingDsn("workers", {})).toBeNull();
  });
  it("rejects malformed DSNs instead of half-starting", () => {
    expect(errorTrackingDsn("api", { ERROR_TRACKING_DSN: "not a url" })).toBeNull();
    expect(errorTrackingDsn("api", { ERROR_TRACKING_DSN: "http://host/1" })).toBeNull(); // no key
    expect(errorTrackingDsn("api", { ERROR_TRACKING_DSN: "ftp://k@host/1" })).toBeNull();
    expect(errorTrackingDsn("api", { ERROR_TRACKING_DSN: "http://k@host/abc" })).toBeNull();
  });
  it("uses the workers DSN for workers and falls back to the API DSN", () => {
    expect(errorTrackingDsn("workers", { ERROR_TRACKING_WORKERS_DSN: "http://w@h/3", ERROR_TRACKING_DSN: "http://a@h/2" })).toBe("http://w@h/3");
    expect(errorTrackingDsn("workers", { ERROR_TRACKING_DSN: "http://a@h/2" })).toBe("http://a@h/2");
    expect(errorTrackingDsn("api", { ERROR_TRACKING_WORKERS_DSN: "http://w@h/3" })).toBeNull();
  });
});

describe("error tunnel", () => {
  const header = (dsn: string) => JSON.stringify({ event_id: "e1", dsn, sent_at: "2026-10-14T00:00:00Z" });
  const event = { message: "PAN ABCDE1234F", user: { id: "u1", email: "x@y.in" }, extra: { salary: 52000 } };

  it("parses DSNs into the upstream envelope URL", () => {
    expect(parseDsn(FE_DSN)).toEqual({ publicKey: "0123456789abcdef0123456789abcdef", projectId: "1", envelopeUrl: "http://127.0.0.1:8710/api/1/envelope/?sentry_key=0123456789abcdef0123456789abcdef&sentry_version=7" });
    expect(parseDsn("http://k@host/sub/path/7")?.envelopeUrl).toBe("http://host/sub/path/api/7/envelope/?sentry_key=k&sentry_version=7");
    expect(parseDsn("garbage")).toBeNull();
  });

  it("is disabled (404) without ERROR_TRACKING_FRONTEND_DSN", () => {
    expect(prepareEnvelope(header(FE_DSN), undefined)).toMatchObject({ ok: false, status: 404 });
  });

  it("refuses envelopes for another project or key (not an open proxy)", () => {
    const body = [header("http://ffffffffffffffffffffffffffffffff@evil.example/1"), '{"type":"event"}', "{}"].join("\n");
    expect(prepareEnvelope(body, FE_DSN)).toMatchObject({ ok: false, status: 403 });
    const otherProject = [header("http://0123456789abcdef0123456789abcdef@127.0.0.1:8710/9"), '{"type":"event"}', "{}"].join("\n");
    expect(prepareEnvelope(otherProject, FE_DSN)).toMatchObject({ ok: false, status: 403 });
  });

  it("always sends to the configured upstream, even if the envelope names another host with the right key", () => {
    const sneaky = [header("http://0123456789abcdef0123456789abcdef@169.254.169.254/1"), '{"type":"event"}', JSON.stringify(event)].join("\n");
    const r = prepareEnvelope(sneaky, FE_DSN);
    expect(r.ok && r.upstream).toBe("http://127.0.0.1:8710/api/1/envelope/?sentry_key=0123456789abcdef0123456789abcdef&sentry_version=7");
  });

  it("scrubs events again and drops attachments/replays", () => {
    const body = [
      header(FE_DSN),
      '{"type":"event","length":999}', JSON.stringify(event),
      '{"type":"attachment","filename":"screen.png"}', "BINARYDATA",
      '{"type":"replay_recording"}', "{}",
      '{"type":"client_report"}', '{"discarded_events":[]}',
    ].join("\n");
    const r = prepareEnvelope(body, FE_DSN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.forwardedItems).toBe(2);
    expect(r.body).not.toContain("ABCDE1234F");
    expect(r.body).not.toContain("x@y.in");
    expect(r.body).not.toContain("52000");
    expect(r.body).not.toContain("BINARYDATA");
    expect(r.body).not.toContain('"length"');
    expect(r.body).toContain("[pan]");
  });

  it("rejects oversized and malformed envelopes", () => {
    expect(prepareEnvelope("x".repeat(300 * 1024), FE_DSN)).toMatchObject({ ok: false, status: 413 });
    expect(prepareEnvelope("not json", FE_DSN)).toMatchObject({ ok: false, status: 400 });
  });
});

describe("uptime heartbeat (off by default)", () => {
  it("is off without a valid push URL", () => {
    expect(heartbeatUrl({})).toBeNull();
    expect(heartbeatUrl({ UPTIME_KUMA_WORKERS_PUSH_URL: "http://kuma/notpush" })).toBeNull();
    expect(heartbeatUrl({ UPTIME_KUMA_WORKERS_PUSH_URL: "http://kuma:3001/api/push/abc?status=up" })).toBe("http://kuma:3001/api/push/abc?status=up");
  });
  it("builds a beat URL with status, short msg and empty ping", () => {
    const u = new URL(beatUrl("http://kuma:3001/api/push/abc?status=up&msg=OK&ping=", "x".repeat(300)));
    expect(u.searchParams.get("status")).toBe("up");
    expect(u.searchParams.get("msg")).toHaveLength(120);
    expect(u.pathname).toBe("/api/push/abc");
  });
  it("never throws when Uptime Kuma is unreachable", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;
    await expect(sendBeat("http://kuma/api/push/abc", "ok", failing)).resolves.toBe(false);
  });
});
