import { normalizeAssignment, NormalizerConfig } from '../assignment-normalizer.service';

describe('assignment-normalizer', () => {
  const newConfig: NormalizerConfig = { importMode: 'NEW', hdMapsTo: 'NEEDS_MAPPING' };
  const updateConfig: NormalizerConfig = { importMode: 'UPDATE', hdMapsTo: 'NEEDS_MAPPING' };

  describe('blank handling', () => {
    it('blank in NEW mode → UNASSIGNED', () => {
      expect(normalizeAssignment('', newConfig).type).toBe('UNASSIGNED');
    });
    it('null in NEW mode → UNASSIGNED', () => {
      expect(normalizeAssignment(null, newConfig).type).toBe('UNASSIGNED');
    });
    it('undefined in NEW mode → UNASSIGNED', () => {
      expect(normalizeAssignment(undefined, newConfig).type).toBe('UNASSIGNED');
    });
    it('blank in UPDATE mode → NO_CHANGE', () => {
      expect(normalizeAssignment('', updateConfig).type).toBe('NO_CHANGE');
    });
    it('whitespace-only in UPDATE mode → NO_CHANGE', () => {
      expect(normalizeAssignment('   ', updateConfig).type).toBe('NO_CHANGE');
    });
  });

  describe('literal zero', () => {
    it('0 → HARD_ERROR', () => {
      expect(normalizeAssignment('0', newConfig).type).toBe('HARD_ERROR');
    });
    it('0 in UPDATE mode also → HARD_ERROR', () => {
      expect(normalizeAssignment('0', updateConfig).type).toBe('HARD_ERROR');
    });
  });

  describe('week off variants', () => {
    it('WO → WEEK_OFF', () => expect(normalizeAssignment('WO', newConfig).type).toBe('WEEK_OFF'));
    it('wo → WEEK_OFF', () => expect(normalizeAssignment('wo', newConfig).type).toBe('WEEK_OFF'));
    it('W/O → WEEK_OFF', () => expect(normalizeAssignment('W/O', newConfig).type).toBe('WEEK_OFF'));
    it('Week Off → WEEK_OFF', () => expect(normalizeAssignment('Week Off', newConfig).type).toBe('WEEK_OFF'));
    it('WEEK_OFF → WEEK_OFF', () => expect(normalizeAssignment('WEEK_OFF', newConfig).type).toBe('WEEK_OFF'));
    it('OFF → WEEK_OFF', () => expect(normalizeAssignment('OFF', newConfig).type).toBe('WEEK_OFF'));
  });

  describe('leave variants', () => {
    it('Leave → LEAVE', () => expect(normalizeAssignment('Leave', newConfig).type).toBe('LEAVE'));
    it('LEAVE → LEAVE', () => expect(normalizeAssignment('LEAVE', newConfig).type).toBe('LEAVE'));
    it('L → LEAVE', () => expect(normalizeAssignment('L', newConfig).type).toBe('LEAVE'));
  });

  describe('training variants', () => {
    it('Training → TRAINING', () => expect(normalizeAssignment('Training', newConfig).type).toBe('TRAINING'));
    it('TRAINING → TRAINING', () => expect(normalizeAssignment('TRAINING', newConfig).type).toBe('TRAINING'));
    it('Trg → TRAINING', () => expect(normalizeAssignment('Trg', newConfig).type).toBe('TRAINING'));
  });

  describe('holiday', () => {
    it('Holiday → HOLIDAY', () => expect(normalizeAssignment('Holiday', newConfig).type).toBe('HOLIDAY'));
    it('H → HOLIDAY', () => expect(normalizeAssignment('H', newConfig).type).toBe('HOLIDAY'));
  });

  describe('HD handling', () => {
    it('HD with hdMapsTo=NEEDS_MAPPING → NEEDS_MAPPING', () => {
      const cfg = { ...newConfig, hdMapsTo: 'NEEDS_MAPPING' as const };
      expect(normalizeAssignment('HD', cfg).type).toBe('NEEDS_MAPPING');
    });
    it('HD with hdMapsTo=HALF_DAY → HALF_DAY', () => {
      const cfg = { ...newConfig, hdMapsTo: 'HALF_DAY' as const };
      expect(normalizeAssignment('HD', cfg).type).toBe('HALF_DAY');
    });
    it('Half Day → HALF_DAY', () => {
      expect(normalizeAssignment('Half Day', { ...newConfig, hdMapsTo: 'HALF_DAY' }).type).toBe('HALF_DAY');
    });
  });

  describe('shift strings', () => {
    it('24h shift → SHIFT with shiftParseResult', () => {
      const result = normalizeAssignment('07:00-16:00', newConfig);
      expect(result.type).toBe('SHIFT');
      expect(result.shiftParseResult).toBeDefined();
      expect(result.shiftParseResult?.parsed?.startTime).toBe('07:00');
    });
    it('overnight 12h shift → SHIFT with isOvernight', () => {
      const result = normalizeAssignment('07:00pm-04:00am', newConfig);
      expect(result.type).toBe('SHIFT');
      expect(result.shiftParseResult?.parsed?.isOvernight).toBe(true);
    });
  });

  describe('needs mapping', () => {
    it('unrecognized alias → NEEDS_MAPPING', () => {
      expect(normalizeAssignment('M', newConfig).type).toBe('NEEDS_MAPPING');
    });
    it('Extraction Only → NEEDS_MAPPING', () => {
      expect(normalizeAssignment('Extraction Only', newConfig).type).toBe('NEEDS_MAPPING');
    });
    it('6-3 shorthand → NEEDS_MAPPING (no alias configured)', () => {
      expect(normalizeAssignment('6-3', newConfig).type).toBe('NEEDS_MAPPING');
    });
  });

  describe('customAliases', () => {
    it('customAlias overrides → correct type', () => {
      const cfg: NormalizerConfig = {
        importMode: 'NEW',
        hdMapsTo: 'NEEDS_MAPPING',
        customAliases: { 'EXTRACTION ONLY': 'SHIFT', 'G': 'SHIFT' }
      };
      expect(normalizeAssignment('Extraction Only', cfg).type).toBe('SHIFT');
      expect(normalizeAssignment('g', cfg).type).toBe('SHIFT');
    });
  });
});
