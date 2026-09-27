import { z } from "zod";

/** URL-safe organization identifier used in `/o/[orgSlug]`. */
export const organizationSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Use at least 3 characters")
  .max(48, "Use at most 48 characters")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens");

export const organizationNameSchema = z
  .string()
  .trim()
  .min(2, "Use at least 2 characters")
  .max(80, "Use at most 80 characters");

/** Derive a slug from an organization name ("Acme Studio" → "acme-studio"). */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}
