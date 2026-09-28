import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../../../db/mysql.js', () => ({ db: { execute } }));

import { updateDeliveryStatus } from '../meta-messages.service.js';

describe('updateDeliveryStatus SQL', () => {
  beforeEach(() => {
    execute.mockReset();
    execute.mockResolvedValue([{ affectedRows: 1 }]);
  });

  it('is valid MySQL: no placeholder after IS NOT, and one param per placeholder', async () => {
    await updateDeliveryStatus('wa-1', 'delivered');
    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toMatch(/IS\s+NOT\s+\?/i);
    expect((sql.match(/\?/g) ?? []).length).toBe(params.length);
  });

  it('reports whether a row changed', async () => {
    expect(await updateDeliveryStatus('wa-1', 'sent')).toBe(true);
    execute.mockResolvedValue([{ affectedRows: 0 }]);
    expect(await updateDeliveryStatus('wa-1', 'sent')).toBe(false);
  });
});
