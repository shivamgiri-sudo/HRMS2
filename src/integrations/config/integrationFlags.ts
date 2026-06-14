type FlagDefault = boolean;

const readBooleanFlag = (key: string, defaultValue: FlagDefault): boolean => {
  const value = import.meta.env?.[key];

  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  return String(value).toLowerCase() === "true";
};

export const integrationFlags = {
  avatarFallback: readBooleanFlag("VITE_ENABLE_AVATAR_FALLBACK", true),
  weatherGreeting: readBooleanFlag("VITE_ENABLE_WEATHER_GREETING", true),
  quoteWidget: readBooleanFlag("VITE_ENABLE_QUOTE_WIDGET", true),
  pincodeAutoFill: readBooleanFlag("VITE_ENABLE_PINCODE_AUTOFILL", true),
  holidayCalendar: readBooleanFlag("VITE_ENABLE_HOLIDAY_CALENDAR", false),
};

export type IntegrationFlags = typeof integrationFlags;
