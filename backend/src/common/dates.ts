/** YYYY-MM-DD for "today" in the given IANA time zone. */
export function todayIn(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Converts a DATE column value to YYYY-MM-DD (Prisma returns midnight UTC). */
export const isoDay = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);

/** Parses YYYY-MM-DD into a UTC-midnight Date for a DATE column. */
export const dayToDate = (s: string | null | undefined): Date | null => (s ? new Date(`${s}T00:00:00.000Z`) : null);

export const ISO_DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** True for a real calendar day in YYYY-MM-DD form (rejects 2026-02-30). */
export const isIsoDay = (s: unknown): s is string =>
  typeof s === 'string' && ISO_DAY.test(s) && new Date(`${s}T00:00:00.000Z`).toISOString().slice(0, 10) === s;
