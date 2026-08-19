import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPlanningMode, setPlanningMode } from '../planning-mode.service.js';
import { requireVolumeBased } from '../planning-mode.middleware.js';
import { Request, Response, NextFunction } from 'express';

vi.mock('../../../db/mysql.js', () => ({
  db: {
    query: vi.fn(),
  },
}));

import { db } from '../../../db/mysql.js';

const mockDb = db as any;

describe('planning-mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getPlanningMode', () => {
    it('returns ROSTER_LED for a standard process', async () => {
      mockDb.query.mockResolvedValueOnce([[{ planning_mode: 'ROSTER_LED' }]]);
      const mode = await getPlanningMode('proc123');
      expect(mode).toBe('ROSTER_LED');
      expect(mockDb.query).toHaveBeenCalledWith(
        'SELECT planning_mode FROM process_master WHERE id = ?',
        ['proc123']
      );
    });

    it('returns VOLUME_BASED for a configured process', async () => {
      mockDb.query.mockResolvedValueOnce([[{ planning_mode: 'VOLUME_BASED' }]]);
      const mode = await getPlanningMode('proc456');
      expect(mode).toBe('VOLUME_BASED');
    });

    it('returns ROSTER_LED when column is NULL (default)', async () => {
      mockDb.query.mockResolvedValueOnce([[{ planning_mode: null }]]);
      const mode = await getPlanningMode('proc789');
      expect(mode).toBe('ROSTER_LED');
    });

    it('throws 404 when process not found', async () => {
      mockDb.query.mockResolvedValueOnce([[]]);
      try {
        await getPlanningMode('nonexistent');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).toBe('Process not found');
        expect(err.statusCode).toBe(404);
      }
    });
  });

  describe('setPlanningMode', () => {
    it('updates planning_mode in process_master', async () => {
      mockDb.query
        .mockResolvedValueOnce([[{ id: 'proc123' }]]) // check exists
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // update

      await setPlanningMode('proc123', 'VOLUME_BASED');

      expect(mockDb.query).toHaveBeenCalledTimes(2);
      expect(mockDb.query).toHaveBeenNthCalledWith(
        1,
        'SELECT id FROM process_master WHERE id = ?',
        ['proc123']
      );
      expect(mockDb.query).toHaveBeenNthCalledWith(
        2,
        'UPDATE process_master SET planning_mode = ? WHERE id = ?',
        ['VOLUME_BASED', 'proc123']
      );
    });

    it('throws 404 when process does not exist', async () => {
      mockDb.query.mockResolvedValueOnce([[]]);
      try {
        await setPlanningMode('nonexistent', 'VOLUME_BASED');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).toBe('Process not found');
        expect(err.statusCode).toBe(404);
      }
    });
  });

  describe('requireVolumeBased middleware', () => {
    let req: Partial<Request>;
    let res: Partial<Response>;
    let next: NextFunction;

    beforeEach(() => {
      req = {
        query: {},
        params: {},
        body: {},
      };
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
      next = vi.fn();
    });

    it('calls next() when process is VOLUME_BASED', async () => {
      req.params = { id: 'proc123' };
      mockDb.query.mockResolvedValueOnce([[{ planning_mode: 'VOLUME_BASED' }]]);

      await requireVolumeBased(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 403 when process is ROSTER_LED', async () => {
      req.params = { id: 'proc456' };
      mockDb.query.mockResolvedValueOnce([[{ planning_mode: 'ROSTER_LED' }]]);

      await requireVolumeBased(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: 'This feature requires VOLUME_BASED planning mode for the selected process',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 400 when processId is missing', async () => {
      req.params = {};
      req.query = {};

      await requireVolumeBased(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'processId is required for this feature' });
      expect(next).not.toHaveBeenCalled();
    });

    it('extracts processId from query parameter', async () => {
      req.query = { processId: 'proc789' };
      mockDb.query.mockResolvedValueOnce([[{ planning_mode: 'VOLUME_BASED' }]]);

      await requireVolumeBased(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('prefers params.processId over params.id', async () => {
      req.params = { processId: 'proc789', id: 'other' };
      mockDb.query.mockResolvedValueOnce([[{ planning_mode: 'VOLUME_BASED' }]]);

      await requireVolumeBased(req as Request, res as Response, next);

      expect(mockDb.query).toHaveBeenCalledWith(
        'SELECT planning_mode FROM process_master WHERE id = ?',
        ['proc789']
      );
    });
  });
});
