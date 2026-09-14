import { parseShiftString, normalizeTime12to24, detectOvernight } from '../shift-parser.service';

describe('shift-parser', () => {
  describe('24-hour formats', () => {
    it('parses standard format', () => {
      expect(parseShiftString('07:00-16:00')).toEqual({
        success: true,
        parsed: { type: 'SHIFT', startTime: '07:00', endTime: '16:00', isOvernight: false, rawValue: '07:00-16:00' }
      });
    });

    it('parses overnight shift', () => {
      expect(parseShiftString('15:15-00:15')).toEqual({
        success: true,
        parsed: { type: 'SHIFT', startTime: '15:15', endTime: '00:15', isOvernight: true, rawValue: '15:15-00:15' }
      });
    });

    it('handles spaces around dash', () => {
      expect(parseShiftString('07:00 - 16:00')).toEqual({
        success: true,
        parsed: { type: 'SHIFT', startTime: '07:00', endTime: '16:00', isOvernight: false, rawValue: '07:00 - 16:00' }
      });
    });

    it('handles single digit hours', () => {
      expect(parseShiftString('7:00-16:00')).toEqual({
        success: true,
        parsed: { type: 'SHIFT', startTime: '07:00', endTime: '16:00', isOvernight: false, rawValue: '7:00-16:00' }
      });
    });
  });

  describe('12-hour am/pm formats', () => {
    it('parses pm-am overnight', () => {
      expect(parseShiftString('07:00pm-04:00am')).toEqual({
        success: true,
        parsed: { type: 'SHIFT', startTime: '19:00', endTime: '04:00', isOvernight: true, rawValue: '07:00pm-04:00am' }
      });
    });

    it('parses shorthand pm-am', () => {
      expect(parseShiftString('7pm-4am')).toEqual({
        success: true,
        parsed: { type: 'SHIFT', startTime: '19:00', endTime: '04:00', isOvernight: true, rawValue: '7pm-4am' }
      });
    });

    it('handles uppercase AM/PM with spaces', () => {
      expect(parseShiftString('07:00 PM - 04:00 AM')).toEqual({
        success: true,
        parsed: { type: 'SHIFT', startTime: '19:00', endTime: '04:00', isOvernight: true, rawValue: '07:00 PM - 04:00 AM' }
      });
    });

    it('parses am-pm daytime shift', () => {
      expect(parseShiftString('6am-3pm')).toEqual({
        success: true,
        parsed: { type: 'SHIFT', startTime: '06:00', endTime: '15:00', isOvernight: false, rawValue: '6am-3pm' }
      });
    });

    it('handles 12am correctly (midnight)', () => {
      expect(parseShiftString('12am-8am')).toEqual({
        success: true,
        parsed: { type: 'SHIFT', startTime: '00:00', endTime: '08:00', isOvernight: false, rawValue: '12am-8am' }
      });
    });

    it('handles 12pm correctly (noon)', () => {
      expect(parseShiftString('12pm-8pm')).toEqual({
        success: true,
        parsed: { type: 'SHIFT', startTime: '12:00', endTime: '20:00', isOvernight: false, rawValue: '12pm-8pm' }
      });
    });
  });

  describe('alias lookup fallback', () => {
    it('returns ALIAS_LOOKUP for letter codes', () => {
      expect(parseShiftString('M')).toEqual({
        success: true,
        parsed: { type: 'ALIAS_LOOKUP', aliasKey: 'M', isOvernight: false, rawValue: 'M' }
      });
    });

    it('returns ALIAS_LOOKUP for words', () => {
      expect(parseShiftString('Morning')).toEqual({
        success: true,
        parsed: { type: 'ALIAS_LOOKUP', aliasKey: 'MORNING', isOvernight: false, rawValue: 'Morning' }
      });
    });

    it('returns ALIAS_LOOKUP for shorthand like 6-3', () => {
      expect(parseShiftString('6-3')).toEqual({
        success: true,
        parsed: { type: 'ALIAS_LOOKUP', aliasKey: '6-3', isOvernight: false, rawValue: '6-3' }
      });
    });

    it('returns ALIAS_LOOKUP for General', () => {
      expect(parseShiftString('General')).toEqual({
        success: true,
        parsed: { type: 'ALIAS_LOOKUP', aliasKey: 'GENERAL', isOvernight: false, rawValue: 'General' }
      });
    });
  });

  describe('error handling', () => {
    it('returns error for null', () => {
      expect(parseShiftString(null as any)).toEqual({
        success: false,
        error: 'Invalid input: null or undefined'
      });
    });

    it('returns error for empty string', () => {
      expect(parseShiftString('')).toEqual({
        success: false,
        error: 'Invalid input: empty string'
      });
    });
  });

  describe('normalizeTime12to24', () => {
    it('converts 7pm to 19:00', () => {
      expect(normalizeTime12to24('7pm')).toBe('19:00');
    });

    it('converts 12am to 00:00', () => {
      expect(normalizeTime12to24('12am')).toBe('00:00');
    });

    it('converts 12pm to 12:00', () => {
      expect(normalizeTime12to24('12pm')).toBe('12:00');
    });

    it('converts 07:30am to 07:30', () => {
      expect(normalizeTime12to24('07:30am')).toBe('07:30');
    });
  });

  describe('detectOvernight', () => {
    it('returns true when end <= start', () => {
      expect(detectOvernight('19:00', '04:00')).toBe(true);
      expect(detectOvernight('15:15', '00:15')).toBe(true);
      expect(detectOvernight('23:00', '07:00')).toBe(true);
    });

    it('returns false when end > start', () => {
      expect(detectOvernight('07:00', '16:00')).toBe(false);
      expect(detectOvernight('09:00', '18:00')).toBe(false);
    });
  });
});
