import { z } from "zod";

/*
 * Client input and query schemas, shared by the server (authoritative) and
 * the client forms (for field hints). Unknown keys such as `organizationId`
 * are stripped: the organization always comes from the tenant context.
 */

/** Optional free text: trimmed, and empty strings stored as null. */
function optionalText(max: number, label: string) {
  return z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .optional()
    .transform((value) => (value ? value : null));
}

/** Phone numbers: digit count limits (E.164 allows at most 15 digits). */
export const MIN_PHONE_DIGITS = 7;
export const MAX_PHONE_DIGITS = 15;
const PHONE_CHARACTERS = /^\+?[0-9().\-\s]*$/;

/** Statuses a user can choose; ARCHIVED is set only by archiving. */
export const EDITABLE_CLIENT_STATUSES = ["ACTIVE", "INACTIVE"] as const;

export const clientFieldsSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(120, "Name must be at most 120 characters"),
  company: optionalText(120, "Company"),
  email: z
    .string()
    .trim()
    .pipe(z.union([z.literal(""), z.email("Enter a valid email address").max(254)]))
    .optional()
    .transform((value) => (value ? value.toLowerCase() : null)),
  phone: z
    .string()
    .trim()
    .max(40, "Phone must be at most 40 characters")
    .regex(PHONE_CHARACTERS, "Use digits, spaces and ( ) - . only, with + only at the start")
    // International format (E.164): at most 15 digits including the country
    // code; fewer than 7 is not a dialable number. Formatting is not counted.
    .refine((value) => {
      // Only counted once the characters are valid (one message per problem).
      if (value === "" || !PHONE_CHARACTERS.test(value)) return true;
      const digits = value.replace(/\D/g, "").length;
      return digits >= MIN_PHONE_DIGITS && digits <= MAX_PHONE_DIGITS;
    }, `Enter ${MIN_PHONE_DIGITS}–${MAX_PHONE_DIGITS} digits, including the country code`)
    .optional()
    .transform((value) => (value ? value : null)),
  address: optionalText(500, "Address"),
  notes: optionalText(5000, "Notes"),
  status: z.enum(EDITABLE_CLIENT_STATUSES).default("ACTIVE"),
});

export type ClientFields = z.infer<typeof clientFieldsSchema>;

export const createClientInput = clientFieldsSchema;

/** Full update: the edit form always sends every field. */
export const updateClientInput = clientFieldsSchema.extend({ id: z.string().min(1) });

export const clientIdInput = z.object({ id: z.string().min(1) });

export const CLIENT_STATUS_FILTERS = ["current", "ACTIVE", "INACTIVE", "ARCHIVED", "all"] as const;
export type ClientStatusFilter = (typeof CLIENT_STATUS_FILTERS)[number];

export const CLIENT_SORTS = ["name", "updated", "created"] as const;
export type ClientSort = (typeof CLIENT_SORTS)[number];

export const DEFAULT_CLIENT_PAGE_SIZE = 20;

/**
 * List query from URL search params. Invalid values fall back to defaults
 * instead of failing, so a hand-edited URL still renders.
 * `status=current` (the default) means ACTIVE and INACTIVE, not ARCHIVED.
 */
export const listClientsQuery = z.object({
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .catch(undefined)
    .transform((value) => (value ? value : undefined)),
  status: z.enum(CLIENT_STATUS_FILTERS).catch("current").default("current"),
  sort: z.enum(CLIENT_SORTS).catch("name").default("name"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .catch(DEFAULT_CLIENT_PAGE_SIZE)
    .default(DEFAULT_CLIENT_PAGE_SIZE),
});

export type ListClientsQuery = z.infer<typeof listClientsQuery>;

/** Parse Next.js `searchParams` (values may be arrays) into a list query. */
export function parseListClientsQuery(
  searchParams: Record<string, string | string[] | undefined>,
): ListClientsQuery {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  return listClientsQuery.parse({
    q: first(searchParams.q),
    status: first(searchParams.status),
    sort: first(searchParams.sort),
    page: first(searchParams.page),
    pageSize: first(searchParams.pageSize),
  });
}
