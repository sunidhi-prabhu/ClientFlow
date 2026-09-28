import { AppShell } from "@/components/layout/app-shell";
import { requireSessionOrRedirect } from "@/server/auth/session";
import { getTenantContextForPage } from "@/server/tenancy/context";
import { listUserOrganizations } from "@/server/tenancy/memberships";

export default async function OrganizationLayout({
  children,
  params,
}: LayoutProps<"/o/[orgSlug]">) {
  const { orgSlug } = await params;
  const session = await requireSessionOrRedirect();

  // Pages below also call getTenantContext (cached per request); layouts are
  // not the only check because they do not re-run on every navigation.
  const ctx = await getTenantContextForPage(orgSlug);
  const organizations = await listUserOrganizations(session.user.id);

  return (
    <AppShell
      organization={ctx.organization}
      organizations={organizations}
      user={{ name: session.user.name, email: session.user.email }}
      role={ctx.role}
    >
      {children}
    </AppShell>
  );
}
