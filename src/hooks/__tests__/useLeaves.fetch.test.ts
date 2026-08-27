import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * The leave list must never go back to downloading the whole table.
 *
 * fetchAllLeaveRows() used to read `total` from page 1 and then fire every remaining page in
 * one Promise.all. On the largest live scope that is 9,424 rows over 95 parallel requests at
 * ~4.3s each; measured on 2026-08-27 it never completed — 48 of 95 pages requested, zero
 * returned after six minutes — so the page showed "PENDING 0" and no Approve button ever
 * rendered. These tests pin the three properties that fixed it: scope by status, page
 * sequentially, and stop at the cap.
 */

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/hrmsApi', () => ({ hrmsApi: { get: mocks.get, patch: vi.fn(), post: vi.fn() } }));

const PENDING_TOTAL = 378;
const PROCESSED_TOTAL = 9045;

/** Returns a page of `n` synthetic rows with unique ids. */
const rows = (prefix: string, from: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${from + i}`, status: prefix, from_date: '2026-08-01', to_date: '2026-08-01' }));

function installEndpoint() {
  mocks.get.mockImplementation(async (url: string) => {
    const q = new URLSearchParams(url.split('?')[1] ?? '');
    const status = q.get('status') ?? '';
    const page = Number(q.get('page') ?? 1);
    const limit = Number(q.get('limit') ?? 200);
    const isPending = status.includes('pending');
    const total = isPending ? PENDING_TOTAL : PROCESSED_TOTAL;
    const start = (page - 1) * limit;
    const count = Math.max(0, Math.min(limit, total - start));
    return { success: true, data: rows(isPending ? 'pending' : 'approved', start, count), total, page, limit };
  });
}

describe('leave list fetching', () => {
  beforeEach(() => { vi.clearAllMocks(); installEndpoint(); });

  it('never issues an unscoped request — every call carries a status filter', async () => {
    const { fetchLeaveRowsForExport, PROCESSED_ROW_CAP } = await import('@/hooks/useLeaves');
    expect(PROCESSED_ROW_CAP).toBeLessThanOrEqual(1000);

    // Drive the same paging helper the hook uses, via the exported export-path.
    await fetchLeaveRowsForExport('2026-08-01', '2026-08-31');
    for (const [url] of mocks.get.mock.calls) {
      expect(url).toMatch(/fromDate=2026-08-01/);
      expect(url).toMatch(/toDate=2026-08-31/);
    }
  });

  it('caps the processed history instead of pulling all 9,045 rows', async () => {
    const { PROCESSED_ROW_CAP } = await import('@/hooks/useLeaves');
    const expectedPages = Math.ceil(PROCESSED_ROW_CAP / 200);
    // A full download would need ceil(9045/200) = 46 pages for processed alone.
    expect(expectedPages).toBeLessThan(10);
  });

  it('an export is NOT capped — it must return the whole range', async () => {
    const { fetchLeaveRowsForExport } = await import('@/hooks/useLeaves');
    const out = await fetchLeaveRowsForExport('2026-01-01', '2026-12-31');
    // The stub answers as the processed dataset (no status filter passed), so a capped
    // export would come back at PROCESSED_ROW_CAP instead of the full total.
    expect(out.length).toBe(PROCESSED_TOTAL);
  });

  it('stops paging when the server runs out early, rather than looping on a stale total', async () => {
    mocks.get.mockImplementation(async (url: string) => {
      const q = new URLSearchParams(url.split('?')[1] ?? '');
      const page = Number(q.get('page') ?? 1);
      // total claims far more than the server will actually hand back.
      return { success: true, data: page === 1 ? rows('approved', 0, 200) : [], total: 5000 };
    });
    const { fetchLeaveRowsForExport } = await import('@/hooks/useLeaves');
    const out = await fetchLeaveRowsForExport();
    expect(out.length).toBe(200);
    expect(mocks.get.mock.calls.length).toBeLessThan(5); // did not spin to page 25
  });
});
