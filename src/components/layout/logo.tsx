import Link from "next/link";

import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn("flex items-center gap-2 font-semibold tracking-tight", className)}
    >
      <span
        aria-hidden
        className="flex size-7 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground"
      >
        C
      </span>
      <span>ClientFlow</span>
    </Link>
  );
}
