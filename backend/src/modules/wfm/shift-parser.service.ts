/**
 * Shift Parser Service
 * Parses shift strings from roster Excel uploads, handling both 24-hour and 12-hour am/pm formats.
 */

export interface ParsedShift {
  type: 'SHIFT' | 'ALIAS_LOOKUP';
  startTime?: string;  // HH:MM (24h format)
  endTime?: string;    // HH:MM (24h format)
  isOvernight: boolean;
  rawValue: string;
  aliasKey?: string;   // For ALIAS_LOOKUP type, uppercase normalized
}

export interface ShiftParserResult {
  success: boolean;
  parsed?: ParsedShift;
  error?: string;
}

/**
 * Converts a time string from minutes to HH:MM format
 */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Detects if a shift is overnight (end time <= start time)
 */
export function detectOvernight(startTime: string, endTime: string): boolean {
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);
  return endMinutes <= startMinutes;
}

/**
 * Converts 12-hour time format to 24-hour format
 * Examples: "7pm" -> "19:00", "12am" -> "00:00", "07:30am" -> "07:30"
 */
export function normalizeTime12to24(timeStr: string): string | null {
  const match = timeStr.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (!match) return null;

  let hour = parseInt(match[1], 10);
  const minutes = match[2] || '00';
  const period = match[3].toLowerCase();

  // Handle 12am (midnight) and 12pm (noon)
  if (hour === 12) {
    hour = period === 'am' ? 0 : 12;
  } else if (period === 'pm') {
    hour += 12;
  }

  // Pad hour to 2 digits
  const hourStr = hour.toString().padStart(2, '0');
  return `${hourStr}:${minutes}`;
}

/**
 * Parses a shift string into structured shift data or identifies it as an alias lookup
 */
export function parseShiftString(raw: string): ShiftParserResult {
  // Step 1: Normalize input
  if (raw === null || raw === undefined) {
    return {
      success: false,
      error: 'Invalid input: null or undefined'
    };
  }

  const trimmed = raw.trim();
  if (trimmed === '') {
    return {
      success: false,
      error: 'Invalid input: empty string'
    };
  }

  // Step 2: Try 24-hour format
  // Pattern: HH:MM-HH:MM or H:MM-HH:MM with optional colons and spaces around dash
  const format24Pattern = /^(\d{1,2}):?(\d{2})\s*[-–—]\s*(\d{1,2}):?(\d{2})$/;
  const match24 = trimmed.match(format24Pattern);

  if (match24) {
    const startHour = match24[1].padStart(2, '0');
    const startMinute = match24[2];
    const endHour = match24[3].padStart(2, '0');
    const endMinute = match24[4];

    const startTime = `${startHour}:${startMinute}`;
    const endTime = `${endHour}:${endMinute}`;

    return {
      success: true,
      parsed: {
        type: 'SHIFT',
        startTime,
        endTime,
        isOvernight: detectOvernight(startTime, endTime),
        rawValue: trimmed
      }
    };
  }

  // Step 3: Try 12-hour am/pm format
  // Pattern: H:MMam-H:MMam or Hpm-Ham with optional minutes and spaces
  const format12Pattern = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*[-–—]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i;
  const match12 = trimmed.match(format12Pattern);

  if (match12) {
    const startHour = match12[1];
    const startMinute = match12[2] || '00';
    const startPeriod = match12[3];
    const endHour = match12[4];
    const endMinute = match12[5] || '00';
    const endPeriod = match12[6];

    const startTime24 = normalizeTime12to24(`${startHour}:${startMinute}${startPeriod}`);
    const endTime24 = normalizeTime12to24(`${endHour}:${endMinute}${endPeriod}`);

    if (startTime24 && endTime24) {
      return {
        success: true,
        parsed: {
          type: 'SHIFT',
          startTime: startTime24,
          endTime: endTime24,
          isOvernight: detectOvernight(startTime24, endTime24),
          rawValue: trimmed
        }
      };
    }
  }

  // Step 4: Neither format matches → ALIAS_LOOKUP
  return {
    success: true,
    parsed: {
      type: 'ALIAS_LOOKUP',
      aliasKey: trimmed.toUpperCase(),
      isOvernight: false,
      rawValue: trimmed
    }
  };
}
