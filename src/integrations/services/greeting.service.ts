import type { WeatherSummary } from "@/integrations/types/integrations.types";

const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);
const CLOUD_CODES = new Set([2, 3, 45, 48]);
const HEAT_THRESHOLD = 36;

export function getTimeGreeting(date = new Date()): string {
  const hour = date.getHours();

  if (hour >= 5 && hour < 12) return "Good Morning";
  if (hour >= 12 && hour < 17) return "Good Afternoon";
  if (hour >= 17 && hour < 21) return "Good Evening";

  return "Good Night";
}

export function getWeatherCondition(weatherCode: number | null | undefined): Pick<WeatherSummary, "icon" | "condition" | "advisory"> {
  if (weatherCode === null || weatherCode === undefined) {
    return {
      icon: "✨",
      condition: "Ready",
      advisory: "Have a focused and productive day.",
    };
  }

  if (RAIN_CODES.has(weatherCode)) {
    return {
      icon: "🌧️",
      condition: "Rainy",
      advisory: "Rain is expected. Carry an umbrella and plan your commute.",
    };
  }

  if (CLOUD_CODES.has(weatherCode)) {
    return {
      icon: "☁️",
      condition: "Cloudy",
      advisory: "Cloudy skies today. Stay energized and keep momentum.",
    };
  }

  if (weatherCode === 0 || weatherCode === 1) {
    return {
      icon: "☀️",
      condition: "Sunny",
      advisory: "Bright start today. Perfect time to close key HR actions.",
    };
  }

  return {
    icon: "🌤️",
    condition: "Pleasant",
    advisory: "A good day to keep your priorities moving.",
  };
}

export function buildPersonalGreeting(name: string, weather?: WeatherSummary | null): string {
  const cleanName = name?.trim() || "Team MAS";
  const greeting = getTimeGreeting();

  if (!weather) {
    return `${greeting}, ${cleanName}`;
  }

  const temperatureText = typeof weather.temperature === "number" ? ` · ${Math.round(weather.temperature)}°C` : "";
  return `${greeting}, ${cleanName} ${weather.icon}${temperatureText}`;
}

export function buildWeatherAdvisory(weather?: WeatherSummary | null): string {
  if (!weather) return "Have a focused and productive day.";

  if (typeof weather.temperature === "number" && weather.temperature >= HEAT_THRESHOLD) {
    return "High temperature outside. Stay hydrated and plan field movement carefully.";
  }

  return weather.advisory;
}
