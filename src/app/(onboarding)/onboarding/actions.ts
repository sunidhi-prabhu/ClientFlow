"use server";

import { redirect } from "next/navigation";

import { createOrganization, createOrganizationInput } from "@/server/organizations/bootstrap";
import { authenticatedAction } from "@/server/protected";

const create = authenticatedAction({ input: createOrganizationInput }, ({ session, input }) =>
  createOrganization(session.user.id, input),
);

/** Create an organization owned by the signed-in user, then open it. */
export async function createOrganizationAction(input: unknown) {
  const result = await create(input);
  if (result.ok) redirect(`/o/${result.data.slug}`);
  return result;
}
