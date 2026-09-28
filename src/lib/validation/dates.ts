import { z } from "zod";

/**
 * Optional calendar day from `<input type="date">` (`YYYY-MM-DD`), stored as
 * UTC midnight in a `@db.Date` column. Blank → null.
 */
export const calendarDateField = (label: string) =>
  z
    .union([z.literal(""), z.iso.date(`${label} must be a valid date`)])
    .optional()
    .transform((value) => (value ? new Date(`${value}T00:00:00.000Z`) : null));
