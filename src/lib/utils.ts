import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, parseISO, isValid } from "date-fns";

/**
 * Normalize a date string before JS Date/parseISO parsing.
 * "YYYY-MM-DD" strings are treated as UTC midnight by default, which shifts
 * the rendered date one day back in UTC+ timezones (e.g. IST).
 * Appending T00:00:00 (no Z) forces local-time interpretation.
 */
export function normalizeDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
    ? `${value.trim()}T00:00:00`
    : value;
}

/** Parse a date-only or full ISO string as local time (no UTC shift). */
export function parseLocalDate(value: string): Date {
  return parseISO(normalizeDate(value));
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format date string to standardized display format
 * Handles ISO strings (2026-05-09T18:30:00.000Z) and date-only strings (2026-05-09)
 * @param dateString - ISO date string or date-only string
 * @param formatString - date-fns format string (default: "MMM d, yyyy")
 * @returns Formatted date string (e.g., "May 9, 2026")
 */
export function formatDate(dateString: string | null | undefined, formatString: string = "MMM d, yyyy"): string {
  if (!dateString) return "";

  try {
    // For date-only strings (YYYY-MM-DD), parseISO treats them as UTC midnight
    // which shifts the date backward in IST (+5:30) and similar timezones.
    // Appending T00:00:00 (no Z) forces local-time parsing and keeps the correct date.
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(dateString.trim())
      ? `${dateString.trim()}T00:00:00`
      : dateString;

    const date = parseISO(normalized);

    if (!isValid(date)) {
      return dateString;
    }

    return format(date, formatString);
  } catch (error) {
    console.error("Date formatting error:", error);
    return dateString;
  }
}

/**
 * Format datetime string to standardized display format with time
 * @param dateString - ISO datetime string
 * @returns Formatted datetime string (e.g., "May 9, 2026 at 6:30 PM")
 */
export function formatDateTime(dateString: string | null | undefined): string {
  if (!dateString) return "";

  try {
    const date = parseISO(dateString);

    if (!isValid(date)) {
      return dateString;
    }

    return format(date, "MMM d, yyyy 'at' h:mm a");
  } catch (error) {
    console.error("DateTime formatting error:", error);
    return dateString;
  }
}
