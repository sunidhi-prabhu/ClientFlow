/**
 * Prisma's `contains` becomes `ILIKE '%…%'` without escaping, so `%` and `_`
 * in user input would act as wildcards. Escape them (PostgreSQL's default
 * LIKE escape character is the backslash). Use for every user-supplied
 * `contains` search.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
