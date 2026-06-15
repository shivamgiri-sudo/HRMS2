import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, parseISO, isValid } from "date-fns";

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
    // Handle ISO strings and date-only strings
    const date = parseISO(dateString);

    if (!isValid(date)) {
      return dateString; // Return original if parsing fails
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
