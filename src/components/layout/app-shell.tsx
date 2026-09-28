import type { ReactNode } from "react";

import { Logo } from "@/components/layout/logo";
import { NavLinks } from "@/components/layout/nav-links";
import {
  OrganizationSwitcher,
  type OrganizationSummary,
} from "@/components/layout/organization-switcher";
import { UserMenu } from "@/components/layout/user-menu";
import { type Role } from "@/lib/permissions";

/**
 * Authenticated application frame for one organization: sidebar on desktop,
 * top bar with horizontally scrolling navigation on small screens.
 */
export function AppShell({
  organization,
  organizations,
  user,
  role,
  children,
}: {
  organization: { slug: string; name: string };
  /** The current member's role (navigation hides what it cannot open). */
  role: Role;
  organizations: OrganizationSummary[];
  user: { name: string; email: string };
  children: ReactNode;
}) {
  const basePath = `/o/${organization.slug}`;

  return (
    <div className="flex min-h-dvh">
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex print:hidden">
        <div className="flex h-14 items-center px-5">
          <Logo />
        </div>
        <nav aria-label="Main" className="px-3 py-2">
          <NavLinks orientation="vertical" basePath={basePath} role={role} />
        </nav>
        <div className="mt-auto grid gap-4 border-t px-2 py-4">
          <OrganizationSwitcher current={organization.slug} organizations={organizations} />
          <UserMenu name={user.name} email={user.email} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur md:hidden print:hidden">
          <div className="flex h-14 items-center justify-between gap-2 px-4">
            <Logo />
            <span className="truncate text-sm font-medium">{organization.name}</span>
          </div>
          <nav aria-label="Main" className="px-2 pb-2">
            <NavLinks orientation="horizontal" basePath={basePath} role={role} />
          </nav>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
          {children}
        </main>

        <footer className="grid gap-4 border-t px-2 py-4 md:hidden print:hidden">
          <OrganizationSwitcher current={organization.slug} organizations={organizations} />
          <UserMenu name={user.name} email={user.email} />
        </footer>
      </div>
    </div>
  );
}
