import Link from "next/link";

import { percentOf } from "@/lib/dashboard";
import { cn } from "@/lib/utils";

export type BreakdownSegment = {
  key: string;
  label: string;
  count: number;
  /** Tailwind background class for the bar and legend dot. */
  color: string;
  href?: string;
};

/**
 * Distribution of items across statuses: a stacked bar (decorative) and a
 * legend with the exact counts and shares (what screen readers get).
 */
export function StatusBreakdown({
  label,
  segments,
  emptyText,
}: {
  label: string;
  segments: BreakdownSegment[];
  emptyText: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.count, 0);
  if (total === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;

  return (
    <div className="space-y-3">
      <div aria-hidden className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-muted">
        {segments
          .filter((segment) => segment.count > 0)
          .map((segment) => (
            <div
              key={segment.key}
              className={cn("h-full first:rounded-l-full last:rounded-r-full", segment.color)}
              style={{ width: `${(segment.count / total) * 100}%` }}
            />
          ))}
      </div>
      <ul aria-label={label} className="grid gap-1.5">
        {segments.map((segment) => {
          const name = (
            <span className="flex min-w-0 items-center gap-2">
              <span aria-hidden className={cn("size-2 shrink-0 rounded-full", segment.color)} />
              <span className="truncate">{segment.label}</span>
            </span>
          );
          return (
            <li key={segment.key} className="flex items-center justify-between gap-3 text-sm">
              {segment.href ? (
                <Link href={segment.href} className="min-w-0 hover:underline">
                  {name}
                </Link>
              ) : (
                name
              )}
              <span className="shrink-0 text-muted-foreground tabular-nums">
                <span className="font-medium text-foreground">{segment.count}</span>
                <span className="sr-only"> of {total}, </span>
                <span className="ml-2 inline-block w-10 text-right">
                  {percentOf(segment.count, total)}%
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
