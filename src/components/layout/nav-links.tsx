"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { mainNavigation } from "@/config/navigation";
import { cn } from "@/lib/utils";

function isActive(pathname: string, basePath: string, href: string) {
  const target = `${basePath}${href}`;
  return href === ""
    ? pathname === basePath
    : pathname === target || pathname.startsWith(`${target}/`);
}

export function NavLinks({
  orientation,
  basePath,
}: {
  orientation: "vertical" | "horizontal";
  /** The organization's root, e.g. `/o/acme`. */
  basePath: string;
}) {
  const pathname = usePathname();

  return (
    <ul
      className={cn(
        "flex gap-1",
        orientation === "vertical" ? "flex-col" : "flex-row overflow-x-auto",
      )}
    >
      {mainNavigation.map(({ title, href, icon: Icon }) => {
        const active = isActive(pathname, basePath, href);
        return (
          <li key={title}>
            <Link
              href={`${basePath}${href}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {title}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
