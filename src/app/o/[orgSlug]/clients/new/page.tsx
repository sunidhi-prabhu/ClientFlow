import { ArrowLeft } from "lucide-react";
import { type Metadata } from "next";
import Link from "next/link";

import { ClientForm } from "@/components/clients/client-form";
import { AccessDenied } from "@/components/layout/access-denied";
import { tenantPage } from "@/server/protected";

import { createClientAction } from "../actions";

export const metadata: Metadata = { title: "New client" };

export default async function NewClientPage({ params }: PageProps<"/o/[orgSlug]/clients/new">) {
  const { orgSlug } = await params;
  const access = await tenantPage(orgSlug, "client:create");
  if (!access.allowed)
    return <AccessDenied message="Your role can view clients but not add them." />;
  const slug = access.ctx.organization.slug;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-2">
        <Link
          href={`/o/${slug}/clients`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Clients
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">New client</h1>
      </div>
      <ClientForm organizationSlug={slug} action={createClientAction} submitLabel="Create client" />
    </div>
  );
}
