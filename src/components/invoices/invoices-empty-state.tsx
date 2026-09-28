import { Receipt, SearchX } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { buttonVariants } from "@/components/ui/button";

export function InvoicesEmptyState({
  filtered,
  basePath,
  canCreate,
}: {
  filtered: boolean;
  basePath: string;
  canCreate: boolean;
}) {
  if (filtered) {
    return (
      <EmptyState
        icon={SearchX}
        title="No matching invoices"
        description="Try a different search, status or client filter."
        action={
          <Link href={basePath} className={buttonVariants({ variant: "outline" })}>
            Clear filters
          </Link>
        }
      />
    );
  }
  return (
    <EmptyState
      icon={Receipt}
      title="No invoices yet"
      description={
        canCreate
          ? "Create a draft invoice for a client, add line items, then issue it."
          : "Invoices created by your team will appear here."
      }
      action={
        canCreate && (
          <Link href={`${basePath}/new`} className={buttonVariants()}>
            New invoice
          </Link>
        )
      }
    />
  );
}
