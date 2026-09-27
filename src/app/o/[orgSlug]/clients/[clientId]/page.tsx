import { ArrowLeft, FolderKanban, Mail, MapPin, Pencil, Phone, Receipt } from "lucide-react";
import { type Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ClientActivityList } from "@/components/clients/client-activity-list";
import { ClientArchiveButton } from "@/components/clients/client-archive-button";
import { ClientStatusBadge } from "@/components/clients/client-status-badge";
import { AccessDenied } from "@/components/layout/access-denied";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NotFoundError } from "@/lib/errors";
import { hasPermission } from "@/lib/permissions";
import { getClient, listClientActivity, listClientProjects } from "@/server/clients/service";
import { tenantPage } from "@/server/protected";

import { archiveClientAction, restoreClientAction } from "../actions";

export const metadata: Metadata = { title: "Client" };

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

export default async function ClientDetailsPage({
  params,
}: PageProps<"/o/[orgSlug]/clients/[clientId]">) {
  const { orgSlug, clientId } = await params;
  const access = await tenantPage(orgSlug, "client:read");
  if (!access.allowed)
    return <AccessDenied message="Ask an owner or admin for access to clients." />;
  const { ctx, db } = access;

  // Unknown ids and other organizations' clients both render the 404 page.
  const client = await getClient(db, clientId).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const canSeeProjects = hasPermission(ctx.role, "project:read");
  const [activity, projects] = await Promise.all([
    listClientActivity(db, client.id),
    canSeeProjects ? listClientProjects(db, client.id) : Promise.resolve([]),
  ]);

  const slug = ctx.organization.slug;
  const archived = client.status === "ARCHIVED";
  const canUpdate = hasPermission(ctx.role, "client:update") && !archived;
  const canArchive = hasPermission(ctx.role, "client:delete");

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link
          href={`/o/${slug}/clients`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Clients
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight break-words">{client.name}</h1>
              <ClientStatusBadge status={client.status} />
            </div>
            <p className="text-sm text-muted-foreground">
              {client.company ? `${client.company} · ` : ""}Client since{" "}
              {dateFormat.format(client.createdAt)}
            </p>
          </div>
          <div className="flex items-start gap-2">
            {canUpdate && (
              <Link
                href={`/o/${slug}/clients/${client.id}/edit`}
                className={buttonVariants({ variant: "outline" })}
              >
                <Pencil aria-hidden />
                Edit
              </Link>
            )}
            {canArchive && (
              <ClientArchiveButton
                organizationSlug={slug}
                clientId={client.id}
                archived={archived}
                archiveAction={archiveClientAction}
                restoreAction={restoreClientAction}
              />
            )}
          </div>
        </div>
        {archived && (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm">
            This client was archived
            {client.archivedAt && ` on ${dateFormat.format(client.archivedAt)}`}. Restore it to make
            changes.
          </p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="grid content-start gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Contact information</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div className="grid gap-1">
                  <dt className="flex items-center gap-1.5 text-muted-foreground">
                    <Mail className="size-4" aria-hidden /> Email
                  </dt>
                  <dd className="break-all">
                    {client.email ? (
                      <a href={`mailto:${client.email}`} className="hover:underline">
                        {client.email}
                      </a>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
                <div className="grid gap-1">
                  <dt className="flex items-center gap-1.5 text-muted-foreground">
                    <Phone className="size-4" aria-hidden /> Phone
                  </dt>
                  <dd>
                    {client.phone ? (
                      <a
                        href={`tel:${client.phone.replace(/[^0-9+]/g, "")}`}
                        className="hover:underline"
                      >
                        {client.phone}
                      </a>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
                <div className="grid gap-1 sm:col-span-2">
                  <dt className="flex items-center gap-1.5 text-muted-foreground">
                    <MapPin className="size-4" aria-hidden /> Address
                  </dt>
                  <dd className="whitespace-pre-line">{client.address ?? "—"}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notes</CardTitle>
            </CardHeader>
            <CardContent>
              {client.notes ? (
                <p className="text-sm break-words whitespace-pre-line">{client.notes}</p>
              ) : (
                <p className="text-sm text-muted-foreground">No notes yet.</p>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FolderKanban className="size-4" aria-hidden /> Projects
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!canSeeProjects ? (
                  <p className="text-sm text-muted-foreground">Your role cannot view projects.</p>
                ) : projects.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No projects for this client yet.</p>
                ) : (
                  <ul className="grid gap-2 text-sm">
                    {projects.map((project) => (
                      <li key={project.id} className="flex justify-between gap-2">
                        <span className="truncate">{project.name}</span>
                        <span className="text-muted-foreground tabular-nums">
                          {dateFormat.format(project.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Receipt className="size-4" aria-hidden /> Invoices
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Invoicing is not available yet. This client&apos;s invoices will appear here.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>

        <Card className="content-start">
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ClientActivityList items={activity} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
