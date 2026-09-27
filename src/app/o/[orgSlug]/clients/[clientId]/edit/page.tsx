import { ArrowLeft } from "lucide-react";
import { type Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ClientForm } from "@/components/clients/client-form";
import { AccessDenied } from "@/components/layout/access-denied";
import { NotFoundError } from "@/lib/errors";
import { getClient } from "@/server/clients/service";
import { tenantPage } from "@/server/protected";

import { updateClientAction } from "../../actions";

export const metadata: Metadata = { title: "Edit client" };

export default async function EditClientPage({
  params,
}: PageProps<"/o/[orgSlug]/clients/[clientId]/edit">) {
  const { orgSlug, clientId } = await params;
  const access = await tenantPage(orgSlug, "client:update");
  if (!access.allowed)
    return <AccessDenied message="Your role can view clients but not edit them." />;

  const client = await getClient(access.db, clientId).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const slug = access.ctx.organization.slug;
  const detailsPath = `/o/${slug}/clients/${client.id}`;
  // Archived clients are read-only until restored.
  if (client.status === "ARCHIVED") redirect(detailsPath);

  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-2">
        <Link
          href={detailsPath}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {client.name}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Edit client</h1>
      </div>
      <ClientForm
        organizationSlug={slug}
        action={updateClientAction}
        submitLabel="Save changes"
        initial={{ ...client, status: client.status === "INACTIVE" ? "INACTIVE" : "ACTIVE" }}
      />
    </div>
  );
}
