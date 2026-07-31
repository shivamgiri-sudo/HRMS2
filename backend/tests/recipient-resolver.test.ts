/**
 * Recipient resolver — the rules that stop a notification reaching the wrong person.
 *
 * These are the cases that make a wrong recipient a data-leak incident rather than a bug:
 * a payslip copied to a manager, an internal alert reaching a client login, an employee
 * CC'd on a message about themselves, or a `fin` mail falling back to a personal Gmail.
 *
 * The db is mocked by SQL shape (tests/setup.ts convention) so no fixture DB is needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db/mysql.js', () => ({
  db: { execute: vi.fn().mockResolvedValue([[], []]), query: vi.fn().mockResolvedValue([[], []]) },
  pingDb: vi.fn(),
}));

import { resolveRecipients } from '../src/shared/recipient-resolver.js';
import { RecipientResolutionError } from '../src/shared/recipient-resolver.types.js';
import { db } from '../src/db/mysql.js';

type Row = Record<string, unknown>;

const person = (over: Row = {}): Row => ({
  employee_id: 'emp-1', user_id: 'usr-1', employee_code: 'MAS001', name: 'Test Person',
  official_email: 'test.person@teammas.in', office_email: null, email: 'personal@gmail.com',
  personal_email: null, branch_id: 'br-1', process_id: 'pr-1', ...over,
});

/** Route each mocked call by what the SQL is asking for. */
function mockDb(handlers: { [k: string]: Row[] }) {
  const pick = (sql: string): Row[] => {
    if (/FROM client_user/i.test(sql))              return handlers.client ?? [];
    if (/FROM branch_wfm_spoc_config/i.test(sql))   return handlers.spoc ?? [];
    if (/FROM branch_head_assignments/i.test(sql))  return handlers.branchHeadAssigned ?? [];
    if (/JOIN auth_user/i.test(sql))                return handlers.roleScope ?? [];
    if (/JOIN employees e ON e\.id = COALESCE\(sub/i.test(sql)) return handlers.manager ?? [];
    if (/FROM employees e WHERE e\.id = \?/i.test(sql)) return handlers.employee ?? [];
    return [];
  };
  (db.execute as ReturnType<typeof vi.fn>).mockImplementation(async (sql: string) => [pick(sql), []]);
  (db.query   as ReturnType<typeof vi.fn>).mockImplementation(async (sql: string) => [pick(sql), []]);
}

beforeEach(() => vi.clearAllMocks());

describe('financial notifications', () => {
  it('refuses to copy anyone on a financial event about an employee', async () => {
    mockDb({ employee: [person()] });
    await expect(resolveRecipients(
      { to: [{ kind: 'employee' }], cc: [{ kind: 'reporting_manager' }] },
      { sensitivity: 'fin', context: { employeeId: 'emp-1' } },
    )).rejects.toMatchObject({ code: 'FIN_HAS_CC' });
  });

  it('throws before touching the database', async () => {
    mockDb({ employee: [person()] });
    await resolveRecipients(
      { to: [{ kind: 'employee' }], cc: [{ kind: 'reporting_manager' }] },
      { sensitivity: 'fin', context: { employeeId: 'emp-1' } },
    ).catch(() => {});
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('forces the official address even when the selector did not ask for it', async () => {
    mockDb({ employee: [person({ official_email: 'a.b@teammas.in', email: 'a.b@gmail.com' })] });
    const r = await resolveRecipients({ to: [{ kind: 'employee' }] }, { sensitivity: 'fin', context: { employeeId: 'emp-1' } });
    expect(r.to[0].email).toBe('a.b@teammas.in');
    expect(r.to[0].emailSource).toBe('official_email');
  });

  it('drops an employee with no official email rather than falling back to personal', async () => {
    // 156 of 1,152 active employees are in exactly this state (2026-07-31).
    mockDb({ employee: [person({ official_email: null, office_email: null, email: 'someone@gmail.com' })] });
    await expect(resolveRecipients(
      { to: [{ kind: 'employee' }] }, { sensitivity: 'fin', context: { employeeId: 'emp-1' } },
    )).rejects.toMatchObject({ code: 'EMPTY_TO' });
  });

  it('records WHY the recipient was dropped', async () => {
    mockDb({ employee: [person({ official_email: null, office_email: null, email: 'x@gmail.com' })] });
    const err = await resolveRecipients(
      { to: [{ kind: 'employee' }] }, { sensitivity: 'fin', context: { employeeId: 'emp-1' } },
    ).catch((e) => e as RecipientResolutionError);
    expect(err.resolution?.dropped[0]).toMatchObject({ reason: 'no_official_email' });
  });

  it('rejects an official-looking address on a foreign domain', async () => {
    mockDb({ employee: [person({ official_email: 'attacker@noteammas.in' })] });
    await expect(resolveRecipients(
      { to: [{ kind: 'employee' }] }, { sensitivity: 'fin', context: { employeeId: 'emp-1' } },
    )).rejects.toMatchObject({ code: 'EMPTY_TO' });
  });

  it('allows the documented full_final_ready fallback to a personal address', async () => {
    mockDb({ employee: [person({ official_email: null, office_email: null, email: 'exited@gmail.com' })] });
    const r = await resolveRecipients(
      { to: [{ kind: 'employee', emailPolicy: 'official_then_personal' }] },
      { sensitivity: 'fin', context: { employeeId: 'emp-1' } },
    );
    expect(r.to[0].email).toBe('exited@gmail.com');
  });
});

describe('client-portal deny-list', () => {
  it('refuses to send an internal notification to a client login', async () => {
    mockDb({ employee: [person({ official_email: 'shared@teammas.in' })], client: [{ email: 'shared@teammas.in' }] });
    await expect(resolveRecipients(
      { to: [{ kind: 'employee' }] }, { sensitivity: 'int', context: { employeeId: 'emp-1' } },
    )).rejects.toMatchObject({ code: 'CLIENT_AUDIENCE' });
  });

  it('throws rather than quietly filtering the client out', async () => {
    mockDb({ employee: [person({ official_email: 'shared@teammas.in' })], client: [{ email: 'shared@teammas.in' }] });
    const err = await resolveRecipients(
      { to: [{ kind: 'employee' }] }, { sensitivity: 'int', context: { employeeId: 'emp-1' } },
    ).catch((e) => e as RecipientResolutionError);
    // A filtered send would have delivered to everyone else and hidden the misconfiguration.
    expect(err.message).toContain('client-portal users');
  });
});

describe('CC hygiene', () => {
  it('never copies someone on a message about themselves', async () => {
    mockDb({
      employee: [person({ employee_id: 'emp-1', official_email: 'self@teammas.in' })],
      manager:  [person({ employee_id: 'emp-1', official_email: 'self@teammas.in' })], // is own manager
    });
    const r = await resolveRecipients(
      { to: [{ kind: 'employee' }], cc: [{ kind: 'reporting_manager' }] },
      { sensitivity: 'int', context: { employeeId: 'emp-1' } },
    );
    expect(r.cc).toHaveLength(0);
    expect(r.dropped.some((d) => d.reason === 'self_edge')).toBe(true);
  });

  it('does not repeat an address that is already in To', async () => {
    mockDb({
      employee: [person({ employee_id: 'emp-1', official_email: 'dup@teammas.in' })],
      manager:  [person({ employee_id: 'emp-2', official_email: 'dup@teammas.in' })],
    });
    const r = await resolveRecipients(
      { to: [{ kind: 'employee' }], cc: [{ kind: 'reporting_manager' }] },
      { sensitivity: 'int', context: { employeeId: 'emp-1' } },
    );
    expect(r.to).toHaveLength(1);
    expect(r.cc).toHaveLength(0);
    expect(r.dropped.some((d) => d.reason === 'duplicate')).toBe(true);
  });

  it('caps CC and records the overflow instead of silently truncating', async () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      person({ employee_id: `m-${i}`, official_email: `m${i}@teammas.in` }));
    mockDb({ employee: [person({ employee_id: 'emp-1', official_email: 'to@teammas.in' })], roleScope: many });
    const r = await resolveRecipients(
      { to: [{ kind: 'employee' }], cc: [{ kind: 'role_scope', roleKeys: ['hr'] }] },
      { sensitivity: 'int', context: { employeeId: 'emp-1' }, maxCc: 3 },
    );
    expect(r.cc).toHaveLength(3);
    expect(r.truncated).toBe(true);
    expect(r.dropped.filter((d) => d.reason === 'cap_exceeded')).toHaveLength(5);
  });
});

describe('wfm_chain fallback', () => {
  it('falls through to branch HR when no SPOC is configured', async () => {
    // branch_wfm_spoc_config has ZERO rows in production. Without the chain, every roster
    // notification would resolve its CC to nobody and nothing would report it.
    mockDb({ spoc: [], roleScope: [person({ employee_id: 'hr-1', official_email: 'hr@teammas.in' })] });
    const r = await resolveRecipients(
      { to: [{ kind: 'wfm_chain' }] },
      { sensitivity: 'int', context: { branchId: 'br-1' } },
    );
    expect(r.to[0].email).toBe('hr@teammas.in');
    expect(r.to[0].viaSelector).toContain('#wfm_role');
  });

  it('prefers the configured SPOC when one exists', async () => {
    mockDb({ spoc: [person({ employee_id: 'spoc-1', official_email: 'spoc@teammas.in' })] });
    const r = await resolveRecipients(
      { to: [{ kind: 'wfm_chain' }] },
      { sensitivity: 'int', context: { branchId: 'br-1' } },
    );
    expect(r.to[0].email).toBe('spoc@teammas.in');
    expect(r.to[0].viaSelector).toContain('#spoc');
  });
});

describe('conditional recipients', () => {
  it('includes the CEO only above the payroll threshold', async () => {
    mockDb({ roleScope: [person({ employee_id: 'ceo-1', official_email: 'ceo@teammas.in' })] });
    const spec = {
      to: [{ kind: 'role_scope' as const, roleKeys: ['finance'] }],
      cc: [{ kind: 'role_scope' as const, roleKeys: ['ceo'], conditional: 'amount_gt_5000000' }],
    };
    const below = await resolveRecipients(spec, { sensitivity: 'fin', context: { vars: { amount: 4_000_000 } } });
    expect(below.cc).toHaveLength(0);
    expect(below.dropped.some((d) => d.reason === 'condition_not_met')).toBe(true);
  });

  it('fails closed on an unrecognised condition', async () => {
    mockDb({ roleScope: [person({ official_email: 'a@teammas.in' })] });
    const r = await resolveRecipients(
      { to: [{ kind: 'role_scope', roleKeys: ['finance'] }],
        cc: [{ kind: 'role_scope', roleKeys: ['ceo'], conditional: 'not_a_real_guard' }] },
      { sensitivity: 'fin', context: {} },
    );
    expect(r.cc).toHaveLength(0);
  });
});

describe('empty resolution', () => {
  it('throws rather than returning an empty To for the caller to mishandle', async () => {
    mockDb({});
    await expect(resolveRecipients(
      { to: [{ kind: 'employee' }] }, { sensitivity: 'int', context: { employeeId: 'nobody' } },
    )).rejects.toMatchObject({ code: 'EMPTY_TO' });
  });
});
