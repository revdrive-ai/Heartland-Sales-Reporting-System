import { getState } from "@/lib/server/appstate";

/* The record of the scheduled LE lock runs (written by
   app/api/cron/le-lock). Kept here so views can read it without importing a
   route handler. */

export type LeCronRun = {
  at: string;
  cycle: string;
  year: number;
  locked: string[];
  skipped: string[];
  failed: { code: string; error: string }[];
  onTime: boolean;
  trigger: "schedule" | "manual";
};

export const cronRunKey = (year: number) => `lecron:${year}`;

export async function lastCronRun(year: number): Promise<LeCronRun | null> {
  return ((await getState(cronRunKey(year)).catch(() => undefined)) as LeCronRun | undefined) ?? null;
}
