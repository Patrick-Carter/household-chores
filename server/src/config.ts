export interface AppConfig {
  householdPassword: string;
  adminPassword: string;
  householdTimezone: string;
  sessionDays: number;
}

export function loadConfig(): AppConfig {
  return {
    householdPassword: process.env.HOUSEHOLD_PASSWORD ?? 'carterhub',
    adminPassword: process.env.ADMIN_PASSWORD ?? 'adminhub',
    householdTimezone: process.env.HOUSEHOLD_TIMEZONE ?? 'America/Chicago',
    sessionDays: Number(process.env.SESSION_DAYS ?? 30),
  };
}
