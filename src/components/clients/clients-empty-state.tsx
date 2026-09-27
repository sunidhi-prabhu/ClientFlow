import { SearchX, Users } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

/** Shown when the list is empty: either no clients yet, or nothing matches the filters. */
export function ClientsEmptyState({
  filtered,
  basePath,
  canCreate,
}: {
  filtered: boolean;
  basePath: string;
  canCreate: boolean;
}) {
  const Icon = filtered ? SearchX : Users;
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted">
        <Icon className="size-5 text-muted-foreground" aria-hidden />
      </span>
      <div className="space-y-1">
        <h2 className="font-medium">{filtered ? "No matching clients" : "No clients yet"}</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          {filtered
            ? "Try a different search or status filter."
            : canCreate
              ? "Add your first client to keep their contact details, notes and history in one place."
              : "Clients added by your team will appear here."}
        </p>
      </div>
      {filtered ? (
        <Link href={basePath} className={buttonVariants({ variant: "outline" })}>
          Clear filters
        </Link>
      ) : (
        canCreate && (
          <Link href={`${basePath}/new`} className={buttonVariants()}>
            Add client
          </Link>
        )
      )}
    </div>
  );
}
