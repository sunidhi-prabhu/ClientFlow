"use server";

import { redirect } from "next/navigation";

import { clientIdInput, createClientInput, updateClientInput } from "@/lib/validation/client";
import { archiveClient, createClient, restoreClient, updateClient } from "@/server/clients/service";
import { tenantAction } from "@/server/protected";

/*
 * Client Server Actions. Each is the standard pipeline (session → tenant
 * context → permission → validation) around a service call. The first
 * argument is the organization slug from the URL, which only selects an
 * organization the caller must already belong to.
 */

const create = tenantAction(
  { permission: "client:create", input: createClientInput },
  async ({ ctx, db, input }) => {
    const client = await createClient({ ctx, db }, input);
    return { id: client.id, organizationSlug: ctx.organization.slug };
  },
);

export async function createClientAction(organizationSlug: string, input: unknown) {
  const result = await create(organizationSlug, input);
  if (result.ok) redirect(`/o/${result.data.organizationSlug}/clients/${result.data.id}`);
  return result;
}

const update = tenantAction(
  { permission: "client:update", input: updateClientInput },
  async ({ ctx, db, input: { id, ...fields } }) => {
    const client = await updateClient({ ctx, db }, id, fields);
    return { id: client.id, organizationSlug: ctx.organization.slug };
  },
);

export async function updateClientAction(organizationSlug: string, input: unknown) {
  const result = await update(organizationSlug, input);
  if (result.ok) redirect(`/o/${result.data.organizationSlug}/clients/${result.data.id}`);
  return result;
}

/** Archiving is the destructive operation for clients: requires client:delete. */
export const archiveClientAction = tenantAction(
  { permission: "client:delete", input: clientIdInput },
  async ({ ctx, db, input }) => {
    const client = await archiveClient({ ctx, db }, input.id);
    return { id: client.id, status: client.status };
  },
);

export const restoreClientAction = tenantAction(
  { permission: "client:delete", input: clientIdInput },
  async ({ ctx, db, input }) => {
    const client = await restoreClient({ ctx, db }, input.id);
    return { id: client.id, status: client.status };
  },
);
