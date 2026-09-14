import type { HolidaySummary } from "@/integrations/types/integrations.types";
import { fetchWithTimeout } from "@/integrations/utils/fetchWithTimeout";

interface HolidayApiPayload {
  date: string;
  localName: string;
  name: string;
  countryCode: string;
  counties?: string[] | null;
}

export async function fetchIndianPublicHolidays(year = new Date().getFullYear()): Promise<HolidaySummary[]> {
  const payload = await fetchWithTimeout<HolidayApiPayload[]>(
    `https://date.nager.at/api/v3/PublicHolidays/${year}/IN`,
    {},
    4500,
  );

  return (payload || []).map((holiday) => ({
    date: holiday.date,
    localName: holiday.localName,
    name: holiday.name,
    countryCode: holiday.countryCode,
    appliesCountrywide: !holiday.counties || holiday.counties.length === 0,
  }));
}
