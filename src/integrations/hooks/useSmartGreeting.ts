import { useEffect, useMemo, useState } from "react";
import { integrationFlags } from "@/integrations/config/integrationFlags";
import { fetchQuoteOfTheDay, getFallbackQuote } from "@/integrations/apis/quote.api";
import { defaultBranchLocation, fetchWeatherSummary, getFallbackWeatherSummary } from "@/integrations/apis/weather.api";
import { buildPersonalGreeting, buildWeatherAdvisory } from "@/integrations/services/greeting.service";
import type { BranchLocation, QuoteSummary, WeatherSummary } from "@/integrations/types/integrations.types";

interface SmartGreetingState {
  weather: WeatherSummary;
  quote: QuoteSummary;
  isLoading: boolean;
}

export function useSmartGreeting(employeeName: string, location: BranchLocation = defaultBranchLocation) {
  const [state, setState] = useState<SmartGreetingState>({
    weather: getFallbackWeatherSummary(location.label),
    quote: getFallbackQuote(),
    isLoading: Boolean(integrationFlags.weatherGreeting || integrationFlags.quoteWidget),
  });

  useEffect(() => {
    let cancelled = false;

    async function loadGreetingData() {
      const weatherPromise = integrationFlags.weatherGreeting
        ? fetchWeatherSummary(location).catch(() => getFallbackWeatherSummary(location.label))
        : Promise.resolve(getFallbackWeatherSummary(location.label));

      const quotePromise = integrationFlags.quoteWidget
        ? fetchQuoteOfTheDay().catch(() => getFallbackQuote())
        : Promise.resolve(getFallbackQuote());

      const [weather, quote] = await Promise.all([weatherPromise, quotePromise]);

      if (!cancelled) {
        setState({ weather, quote, isLoading: false });
      }
    }

    loadGreetingData();

    return () => {
      cancelled = true;
    };
  }, [location.label, location.latitude, location.longitude]);

  const greeting = useMemo(() => buildPersonalGreeting(employeeName, state.weather), [employeeName, state.weather]);
  const advisory = useMemo(() => buildWeatherAdvisory(state.weather), [state.weather]);

  return {
    ...state,
    greeting,
    advisory,
    flags: integrationFlags,
  };
}
