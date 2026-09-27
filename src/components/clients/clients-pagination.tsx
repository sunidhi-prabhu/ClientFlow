import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

import { clientsListHref, type ClientsListParams } from "./clients-url";

function PageLink({
  href,
  disabled,
  children,
  label,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
  label: string;
}) {
  const className = cn(
    "inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-sm",
    disabled ? "pointer-events-none opacity-50" : "hover:bg-muted",
  );
  return disabled ? (
    <span aria-disabled="true" className={className}>
      {children}
    </span>
  ) : (
    <Link href={href} aria-label={label} className={className}>
      {children}
    </Link>
  );
}

export function ClientsPagination({
  basePath,
  params,
  page,
  pageCount,
  pageSize,
  total,
}: {
  basePath: string;
  params: ClientsListParams;
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
}) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-4">
      <p className="text-sm text-muted-foreground">
        Showing <span className="font-medium text-foreground">{from}</span>–
        <span className="font-medium text-foreground">{to}</span> of{" "}
        <span className="font-medium text-foreground">{total}</span>
      </p>
      {pageCount > 1 && (
        <div className="flex items-center gap-2">
          <PageLink
            href={clientsListHref(basePath, { ...params, page: page - 1 })}
            disabled={page <= 1}
            label="Previous page"
          >
            <ChevronLeft className="size-4" aria-hidden />
            <span className="hidden sm:inline">Previous</span>
          </PageLink>
          <span className="text-sm text-muted-foreground tabular-nums">
            {page} / {pageCount}
          </span>
          <PageLink
            href={clientsListHref(basePath, { ...params, page: page + 1 })}
            disabled={page >= pageCount}
            label="Next page"
          >
            <span className="hidden sm:inline">Next</span>
            <ChevronRight className="size-4" aria-hidden />
          </PageLink>
        </div>
      )}
    </nav>
  );
}
