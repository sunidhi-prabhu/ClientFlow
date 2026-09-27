import { Plus } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

export type OrganizationSummary = { slug: string; name: string; role: string };

/** The user's organizations; the current one is highlighted. */
export function OrganizationSwitcher({
  current,
  organizations,
}: {
  current: string;
  organizations: OrganizationSummary[];
}) {
  return (
    <div className="grid gap-1">
      <p className="px-3 text-xs font-medium text-muted-foreground">Organizations</p>
      <ul className="grid gap-0.5">
        {organizations.map((organization) => (
          <li key={organization.slug}>
            <Link
              href={`/o/${organization.slug}`}
              aria-current={organization.slug === current ? "page" : undefined}
              className={cn(
                "flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-sm",
                organization.slug === current
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
              )}
            >
              <span className="truncate">{organization.name}</span>
              <span className="text-[10px] tracking-wide uppercase">{organization.role}</span>
            </Link>
          </li>
        ))}
      </ul>
      <Link
        href="/onboarding"
        className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
      >
        <Plus className="size-4" aria-hidden />
        New organization
      </Link>
    </div>
  );
}
