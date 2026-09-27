import { Badge } from "@/components/ui/badge";
import { type ClientStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  ARCHIVED: "Archived",
};

const STYLES: Record<ClientStatus, string> = {
  ACTIVE: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  INACTIVE: "bg-muted text-muted-foreground",
  ARCHIVED: "border-border bg-transparent text-muted-foreground",
};

export function ClientStatusBadge({ status }: { status: ClientStatus }) {
  return (
    <Badge variant="secondary" className={cn("gap-1.5", STYLES[status])}>
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          status === "ACTIVE" ? "bg-emerald-500" : "bg-muted-foreground/60",
        )}
      />
      {CLIENT_STATUS_LABELS[status]}
    </Badge>
  );
}
