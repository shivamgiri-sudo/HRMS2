import type { BranchLocation, WeatherSummary } from "@/integrations/types/integrations.types";
import { getWeatherCondition } from "@/integrations/services/greeting.service";
import { fetchWithTimeout } from "@/integrations/utils/fetchWithTimeout";

interface OpenMeteoPayload {
  current?: {
    temperature_2m?: number;
    apparent_temperature?: number;
    relative_humidity_2m?: number;
    precipitation?: number;
    weather_code?: number;
    wind_speed_10m?: number;
  };
}

const toNumber = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const defaultBranchLocation: BranchLocation = {
  label: import.meta.env?.VITE_HRMS_DEFAULT_CITY || "Noida",
  latitude: toNumber(import.meta.env?.VITE_HRMS_DEFAULT_LATITUDE, 28.5355),
  longitude: toNumber(import.meta.env?.VITE_HRMS_DEFAULT_LONGITUDE, 77.391),
};

const WEATHER_BASE_URL = "https://api.open-meteo.com/v1/forecast";

export async function fetchWeatherSummary(location: BranchLocation = defaultBranchLocation): Promise<WeatherSummary> {
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m",
    timezone: "auto",
  });

  const payload = await fetchWithTimeout<OpenMeteoPayload>(`${WEATHER_BASE_URL}?${params.toString()}`);
  const current = payload.current || {};
  const weatherCode = current.weather_code ?? null;
  const meta = getWeatherCondition(weatherCode);

  return {
    temperature: current.temperature_2m ?? null,
    apparentTemperature: current.apparent_temperature ?? null,
    humidity: current.relative_humidity_2m ?? null,
    precipitation: current.precipitation ?? null,
    windSpeed: current.wind_speed_10m ?? null,
    weatherCode,
    icon: meta.icon,
    condition: meta.condition,
    advisory: meta.advisory,
    locationLabel: location.label,
    source: "open-meteo",
  };
}

export function getFallbackWeatherSummary(locationLabel = defaultBranchLocation.label): WeatherSummary {
  const meta = getWeatherCondition(null);

  return {
    temperature: null,
    apparentTemperature: null,
    humidity: null,
    precipitation: null,
    windSpeed: null,
    weatherCode: null,
    icon: meta.icon,
    condition: meta.condition,
    advisory: meta.advisory,
    locationLabel,
    source: "fallback",
  };
}
