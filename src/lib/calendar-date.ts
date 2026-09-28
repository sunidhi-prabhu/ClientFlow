/*
 * Calendar days (`@db.Date` columns) are stored as UTC midnight. Always
 * format and compare them in UTC so they never shift by a day.
 */

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

export function formatCalendarDate(date: Date | null): string {
  return date ? dateFormat.format(date) : "—";
}

/** `YYYY-MM-DD` for <input type="date">. */
export function toDateInputValue(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "";
}

/** True if `date` is before today (UTC). */
export function isBeforeToday(date: Date, now: Date = new Date()): boolean {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return date.getTime() < today;
}
