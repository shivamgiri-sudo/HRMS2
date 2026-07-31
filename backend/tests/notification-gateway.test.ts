/**
 * notificationGateway — the controls that stop a notification storm.
 *
 * The failure this suite exists to prevent is concrete: official-email-compliance.worker.ts
 * once emitted 43,943 duplicate alerts. Every guard below is one of the four independent
 * mechanisms that make a repeat structurally impossible — kill switch, shadow default,
 * DB-level dedupe, and caps/cooldown.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db/mysql.js', () => ({
  db: { execute: vi.fn().mockResolvedValue([[], []]), query: vi.fn().mockResolvedValue([[], []]) },
  pingDb: vi.fn(),
}));

import { notificationGateway, registerDeliverer, __resetDeliverer } from '../src/modules/communication/notification.gateway.js';
import { db } from '../src/db/mysql.js';

type Row = Record<string, unknown>;

const eventConfig = (over: Row = {}): Row => ({
  event_code: 'leave_decision', enabled: 1, dispatch_mode: 'shadow', sensitivity: 'int',
  is_critical: 0, recipient_spec: '{"to":[{"kind":"employee"}]}',
  backfill_floor_at: null, max_per_day: 500, cooldown_minutes: 0, template_key: null, ...over,
});

const employee = (over: Row = {}): Row => ({
  employee_id: 'emp-1', user_id: 'usr-1', employee_code: 'MAS001', name: 'Test',
  official_email: 'test@teammas.in', office_email: null, email: null, personal_email: null,
  branch_id: 'br-1', process_id: null, ...over,
});

interface Scenario {
  config?: Row | null;
  dailyCount?: number;
  cooldownHits?: number;
  employee?: Row[];
  claimInsert?: 'ok' | 'duplicate';
}

function mockDb(s: Scenario) {
  const handler = async (sql: string): Promise<[Row[], unknown]> => {
    if (/FROM notification_event_config/i.test(sql)) return [s.config === null ? [] : [s.config ?? eventConfig()], []];
    if (/COUNT\(\*\) AS n FROM notification_dispatch_claim[\s\S]*INTERVAL 1 DAY/i.test(sql)) return [[{ n: s.dailyCount ?? 0 }], []];
    if (/COUNT\(\*\) AS n FROM notification_dispatch_claim[\s\S]*INTERVAL \? MINUTE/i.test(sql)) return [[{ n: s.cooldownHits ?? 0 }], []];
    if (/INSERT INTO notification_dispatch_claim/i.test(sql)) {
      if (s.claimInsert === 'duplicate') { const e = new Error('dup') as Error & { code: string }; e.code = 'ER_DUP_ENTRY'; throw e; }
      return [{ affectedRows: 1 } as unknown as Row[], []];
    }
    if (/SELECT id FROM notification_dispatch_claim/i.test(sql)) return [[{ id: 'claim-1' }], []];
    if (/UPDATE notification_dispatch_claim/i.test(sql)) return [[], []];
    if (/FROM client_user/i.test(sql)) return [[], []];
    if (/FROM employees e WHERE e\.id = \?/i.test(sql)) return [s.employee ?? [employee()], []];
    return [[], []];
  };
  (db.execute as ReturnType<typeof vi.fn>).mockImplementation(handler);
  (db.query   as ReturnType<typeof vi.fn>).mockImplementation(handler);
}

const call = (over: Partial<Parameters<typeof notificationGateway.notify>[0]> = {}) =>
  notificationGateway.notify({
    eventCode: 'leave_decision', dedupeKey: 'leave_request:lr-1',
    context: { employeeId: 'emp-1' }, entityType: 'leave_request', entityId: 'lr-1', ...over,
  });

beforeEach(() => { vi.clearAllMocks(); __resetDeliverer(); });

describe('kill switch', () => {
  it('refuses an unregistered event — fails closed', async () => {
    mockDb({ config: null });
    const r = await call();
    expect(r.outcome).toBe('disabled');
    expect(r.reason).toContain('not registered');
  });

  it('refuses a disabled event', async () => {
    mockDb({ config: eventConfig({ enabled: 0 }) });
    expect((await call()).outcome).toBe('disabled');
  });

  it("refuses dispatch_mode 'off' even when enabled", async () => {
    mockDb({ config: eventConfig({ enabled: 1, dispatch_mode: 'off' }) });
    expect((await call()).outcome).toBe('disabled');
  });

  it('resolves nobody and sends nothing when disabled', async () => {
    mockDb({ config: eventConfig({ enabled: 0 }) });
    await call();
    const sqls = (db.execute as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /INSERT INTO notification_dispatch_claim/i.test(s))).toBe(false);
  });
});

describe('shadow mode — the shipped default', () => {
  it('resolves and claims but does not deliver', async () => {
    mockDb({});
    const r = await call();
    expect(r.outcome).toBe('shadow');
    expect(r.recipients).toEqual({ to: 1, cc: 0, bcc: 0 });
  });

  it('records the claim so the run can be reviewed with a SELECT', async () => {
    mockDb({});
    await call();
    const sqls = (db.execute as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /INSERT INTO notification_dispatch_claim/i.test(s))).toBe(true);
  });

  it('needs no deliverer registered', async () => {
    mockDb({});
    await expect(call()).resolves.toMatchObject({ outcome: 'shadow' });
  });
});

describe('phase 1a is inert by construction', () => {
  it('throws instead of silently no-oping when a live event has no deliverer', async () => {
    mockDb({ config: eventConfig({ dispatch_mode: 'live' }) });
    await expect(call()).rejects.toThrow(/no NotificationDeliverer is registered/);
  });

  it('delivers once a deliverer is registered', async () => {
    mockDb({ config: eventConfig({ dispatch_mode: 'live' }) });
    const deliver = vi.fn().mockResolvedValue({ dispatchLogId: 'dl-1' });
    registerDeliverer({ deliver });
    const r = await call();
    expect(r.outcome).toBe('sent');
    expect(deliver).toHaveBeenCalledOnce();
  });

  it('marks the claim failed when delivery throws, then rethrows', async () => {
    mockDb({ config: eventConfig({ dispatch_mode: 'live' }) });
    registerDeliverer({ deliver: vi.fn().mockRejectedValue(new Error('smtp down')) });
    await expect(call()).rejects.toThrow('smtp down');
    const sqls = (db.execute as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /UPDATE notification_dispatch_claim/i.test(s))).toBe(true);
  });
});

describe('idempotency', () => {
  it('treats a duplicate claim as already handled rather than an error', async () => {
    mockDb({ claimInsert: 'duplicate' });
    expect((await call()).outcome).toBe('duplicate');
  });

  it('does not deliver when it loses the claim race', async () => {
    mockDb({ config: eventConfig({ dispatch_mode: 'live' }), claimInsert: 'duplicate' });
    const deliver = vi.fn().mockResolvedValue({});
    registerDeliverer({ deliver });
    expect((await call()).outcome).toBe('duplicate');
    expect(deliver).not.toHaveBeenCalled();
  });
});

describe('caps and cooldown', () => {
  it('stops at the daily cap', async () => {
    mockDb({ config: eventConfig({ max_per_day: 10 }), dailyCount: 10 });
    const r = await call();
    expect(r.outcome).toBe('capped');
    expect(r.reason).toContain('daily cap 10');
  });

  it('suppresses a repeat inside the cooldown window', async () => {
    mockDb({ config: eventConfig({ cooldown_minutes: 1440 }), cooldownHits: 1 });
    expect((await call()).outcome).toBe('cooldown');
  });

  it('does not apply cooldown when the caller gave no entity', async () => {
    mockDb({ config: eventConfig({ cooldown_minutes: 1440 }), cooldownHits: 1 });
    const r = await call({ entityType: undefined, entityId: undefined });
    expect(r.outcome).toBe('shadow');
  });
});

describe('refusals are recorded, not lost', () => {
  it('reports undeliverable with the drop reasons attached', async () => {
    mockDb({ employee: [] });
    const r = await call();
    expect(r.outcome).toBe('undeliverable');
    expect(r.dropped?.some((d) => d.reason === 'no_match')).toBe(true);
  });

  it('reports a deny-list refusal as blocked', async () => {
    // A financial event about an employee that names a CC — the resolver refuses outright.
    mockDb({ config: eventConfig({ sensitivity: 'fin', recipient_spec: '{"to":[{"kind":"employee"}],"cc":[{"kind":"reporting_manager"}]}' }) });
    const r = await call();
    expect(r.outcome).toBe('blocked');
  });

  it('writes a claim row even when refusing, so the refusal is auditable', async () => {
    mockDb({ employee: [] });
    await call();
    const sqls = (db.execute as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /INSERT INTO notification_dispatch_claim/i.test(s))).toBe(true);
  });
});
