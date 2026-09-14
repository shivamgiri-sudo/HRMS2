/**
 * Session Context Persistence Utility
 * Manages localStorage for ATS Hiring Entry session context
 */

const STORAGE_KEY = "ats_hiring_session_context_v1";
const MAX_AGE_HOURS = 8;

export interface SessionContext {
  process_name: string;
  hiring_source: string;
  position_name: string;
  wp_group?: string;
  locked: boolean;
  timestamp: number;
}

/**
 * Save session context to localStorage
 */
export function saveSessionContext(context: SessionContext): void {
  try {
    const payload = {
      ...context,
      timestamp: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn("[SessionContext] Failed to save to localStorage:", error);
  }
}

/**
 * Load session context from localStorage
 * Returns null if not found, expired, or invalid
 */
export function loadSessionContext(): SessionContext | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as SessionContext;

    // Validate structure
    if (
      typeof parsed.process_name !== "string" ||
      typeof parsed.hiring_source !== "string" ||
      typeof parsed.position_name !== "string" ||
      typeof parsed.locked !== "boolean" ||
      typeof parsed.timestamp !== "number"
    ) {
      clearSessionContext();
      return null;
    }

    // Check expiry
    if (!isSessionContextValid(parsed, MAX_AGE_HOURS)) {
      clearSessionContext();
      return null;
    }

    return parsed;
  } catch (error) {
    console.warn("[SessionContext] Failed to load from localStorage:", error);
    clearSessionContext();
    return null;
  }
}

/**
 * Clear session context from localStorage
 */
export function clearSessionContext(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn("[SessionContext] Failed to clear localStorage:", error);
  }
}

/**
 * Check if session context is still valid (not expired)
 */
export function isSessionContextValid(
  context: SessionContext,
  maxAgeHours: number
): boolean {
  const ageMs = Date.now() - context.timestamp;
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  return ageMs < maxAgeMs;
}
