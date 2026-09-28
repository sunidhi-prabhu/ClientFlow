import { type LucideIcon } from "lucide-react";
import Link from "next/link";
import { type ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Headline number on the dashboard, optionally linking to the full list. */
export function MetricCard({
  title,
  value,
  detail,
  icon: Icon,
  href,
  tone = "default",
}: {
  title: string;
  value: ReactNode;
  detail?: ReactNode;
  icon: LucideIcon;
  href?: string;
  /** "alert" highlights a number that needs attention (e.g. overdue invoices). */
  tone?: "default" | "alert";
}) {
  const body = (
    <Card
      size="sm"
      className={cn(
        "h-full gap-2 px-4 transition-colors",
        href && "group-hover/metric:bg-muted/50",
        tone === "alert" && "ring-destructive/40",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md bg-muted",
            tone === "alert" && "bg-destructive/10",
          )}
        >
          <Icon
            aria-hidden
            className={cn("size-4 text-muted-foreground", tone === "alert" && "text-destructive")}
          />
        </span>
      </div>
      <div
        className={cn(
          "text-2xl font-semibold tracking-tight tabular-nums",
          tone === "alert" && "text-destructive",
        )}
      >
        {value}
      </div>
      {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
    </Card>
  );

  if (!href) return body;
  return (
    <Link
      href={href}
      className="group/metric block rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {body}
    </Link>
  );
}
