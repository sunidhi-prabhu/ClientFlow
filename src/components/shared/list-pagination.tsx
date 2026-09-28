import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

function PageLink({
  href,
  disabled,
  children,
  label,
}: {
  href: string;
  disabled: boolean;
  children: ReactNode;
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

/** "Showing x–y of n" with previous/next links. Renders nothing for an empty list. */
export function ListPagination({
  page,
  pageCount,
  pageSize,
  total,
  hrefForPage,
  totalLabel,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  hrefForPage: (page: number) => string;
  /** Shown instead of `total` (e.g. "10,000+" when counting stopped at a limit). */
  totalLabel?: string;
}) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-4">
      <p className="text-sm text-muted-foreground">
        Showing <span className="font-medium text-foreground">{from}</span>–
        <span className="font-medium text-foreground">{to}</span> of{" "}
        <span className="font-medium text-foreground">{totalLabel ?? total}</span>
      </p>
      {pageCount > 1 && (
        <div className="flex items-center gap-2">
          <PageLink href={hrefForPage(page - 1)} disabled={page <= 1} label="Previous page">
            <ChevronLeft className="size-4" aria-hidden />
            <span className="hidden sm:inline">Previous</span>
          </PageLink>
          <span className="text-sm text-muted-foreground tabular-nums">
            {page} / {pageCount}
          </span>
          <PageLink href={hrefForPage(page + 1)} disabled={page >= pageCount} label="Next page">
            <span className="hidden sm:inline">Next</span>
            <ChevronRight className="size-4" aria-hidden />
          </PageLink>
        </div>
      )}
    </nav>
  );
}
