export interface BranchLocation {
  label: string;
  latitude: number;
  longitude: number;
}

export interface WeatherSummary {
  temperature: number | null;
  apparentTemperature: number | null;
  humidity: number | null;
  precipitation: number | null;
  windSpeed: number | null;
  weatherCode: number | null;
  icon: string;
  condition: string;
  locationLabel: string;
  advisory: string;
  source: "open-meteo" | "fallback";
}

export interface QuoteSummary {
  content: string;
  author: string;
  source: "dummyjson" | "fallback";
}

export interface PincodeDetails {
  city: string;
  district: string;
  state: string;
  country: string;
  postOffice?: string;
}

export interface HolidaySummary {
  date: string;
  localName: string;
  name: string;
  countryCode: string;
  appliesCountrywide: boolean;
}
