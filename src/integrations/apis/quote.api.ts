import type { QuoteSummary } from "@/integrations/types/integrations.types";
import { fetchWithTimeout } from "@/integrations/utils/fetchWithTimeout";

interface QuotablePayload {
  quote?: string;
  author?: string;
}

const FALLBACK_QUOTES: QuoteSummary[] = [
  {
    content: "Small improvements every day create a stronger workplace.",
    author: "HRMS",
    source: "fallback",
  },
  {
    content: "Great teams are built through clarity, consistency, and care.",
    author: "HRMS",
    source: "fallback",
  },
  {
    content: "Focus on the next right action and progress will follow.",
    author: "HRMS",
    source: "fallback",
  },
];

export function getFallbackQuote(): QuoteSummary {
  const dayIndex = new Date().getDate() % FALLBACK_QUOTES.length;
  return FALLBACK_QUOTES[dayIndex];
}

export async function fetchQuoteOfTheDay(): Promise<QuoteSummary> {
  const payload = await fetchWithTimeout<QuotablePayload>(
    "https://dummyjson.com/quotes/random",
    {},
    3500,
  );

  if (!payload.quote) {
    return getFallbackQuote();
  }

  return {
    content: payload.quote,
    author: payload.author || "Unknown",
    source: "dummyjson",
  };
}
